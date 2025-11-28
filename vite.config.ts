import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcssPostcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { execSync } from "child_process";
import { readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import type { Plugin } from "vite";

// Get git info
const getGitVersion = () => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch (e) {
    console.log(e);
    return "development";
  }
};

// Plugin to serve local file system paths
const localFileServerPlugin = (): Plugin => {
  return {
    name: "local-file-server",
    configureServer(server) {
      server.middlewares.use("/api/local", (req, res) => {
        try {
          if (!req.url) {
            res.statusCode = 400;
            res.end("Invalid request");
            return;
          }

          // Parse URL - handle both with and without protocol
          let url: URL;
          try {
            url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
          } catch {
            // Fallback for malformed URLs
            res.statusCode = 400;
            res.end("Invalid URL");
            return;
          }

          const localPath = url.searchParams.get("path");

          if (!localPath) {
            res.statusCode = 400;
            res.end("Missing path parameter");
            return;
          }

          // Decode the path
          const decodedLocalPath = decodeURIComponent(localPath);

          // Security: Only allow absolute paths and prevent directory traversal
          // Check for Unix absolute paths (/) and Windows absolute paths (C:, D:, etc.)
          const isUnixAbsolute = decodedLocalPath.startsWith("/");
          const isWindowsAbsolute = /^[a-zA-Z]:/.test(decodedLocalPath);
          if (
            (!isUnixAbsolute && !isWindowsAbsolute) ||
            decodedLocalPath.includes("..")
          ) {
            res.statusCode = 403;
            res.end("Invalid path");
            return;
          }

          // Remove the query string from the request path
          let requestPath = url.pathname.replace("/api/local", "");
          // Remove leading slash to make it relative (prevents absolute path from overriding base directory)
          if (requestPath.startsWith("/")) {
            requestPath = requestPath.substring(1);
          }

          // Decode URL-encoded characters in the path (e.g., %20 -> space)
          // This is necessary because the pathname contains URL-encoded characters
          // but filesystem paths need the actual characters
          try {
            requestPath = decodeURIComponent(requestPath);
          } catch (err) {
            // If decoding fails (malformed encoding), reject the request
            res.statusCode = 400;
            res.end("Invalid path encoding");
            return;
          }

          // Security: Validate requestPath to prevent directory traversal
          if (requestPath.includes("..")) {
            res.statusCode = 403;
            res.end("Invalid path");
            return;
          }

          const fullPath = join(decodedLocalPath, requestPath);

          // Security: Normalize the path and verify it's still within the base directory
          const normalizedBasePath = resolve(decodedLocalPath);
          const normalizedFullPath = resolve(fullPath);
          // Ensure the full path is strictly within the base directory by checking
          // that it either equals the base path or starts with base path + separator
          // This prevents access to sibling directories (e.g., /home/user/logsbackup
          // when base is /home/user/logs)
          const basePathWithSeparator = normalizedBasePath + "/";
          if (
            normalizedFullPath !== normalizedBasePath &&
            !normalizedFullPath.startsWith(basePathWithSeparator)
          ) {
            res.statusCode = 403;
            res.end("Invalid path");
            return;
          }

          // Check if file exists
          try {
            const stats = statSync(fullPath);

            if (stats.isDirectory()) {
              res.statusCode = 400;
              res.end("Cannot serve directory");
              return;
            }

            const fileSize = stats.size;
            const ext = fullPath.split(".").pop()?.toLowerCase();

            // Set appropriate content type
            const contentType =
              ext === "json"
                ? "application/json"
                : ext === "jsonl"
                ? "application/x-ndjson"
                : ext === "txt" || ext === "log"
                ? "text/plain"
                : "application/octet-stream";

            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");

            // Handle range requests
            const rangeHeader = req.headers.range;
            if (rangeHeader) {
              const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
              if (rangeMatch) {
                const start = parseInt(rangeMatch[1], 10);
                let end = rangeMatch[2]
                  ? parseInt(rangeMatch[2], 10)
                  : fileSize - 1;

                // Clamp end to file size according to RFC 7233
                // If end is beyond file size, serve from start to end of file
                if (end >= fileSize) {
                  end = fileSize - 1;
                }

                // Validate range according to RFC 7233
                if (start >= 0 && start <= end && start < fileSize) {
                  // Valid range - serve partial content
                  const chunkSize = end - start + 1;
                  const fullContent = readFileSync(fullPath);
                  const content = fullContent.subarray(start, end + 1);

                  res.statusCode = 206; // Partial Content
                  res.setHeader(
                    "Content-Range",
                    `bytes ${start}-${end}/${fileSize}`
                  );
                  res.setHeader("Content-Length", chunkSize.toString());
                  res.end(content);
                  return;
                } else {
                  // Invalid range - return 416 Range Not Satisfiable per RFC 7233
                  res.statusCode = 416;
                  res.setHeader("Content-Range", `bytes */${fileSize}`);
                  res.end("Range Not Satisfiable");
                  return;
                }
              } else {
                // Malformed range header - return 416
                res.statusCode = 416;
                res.setHeader("Content-Range", `bytes */${fileSize}`);
                res.end("Range Not Satisfiable");
                return;
              }
            }

            // Serve full file if no range request
            const content = readFileSync(fullPath);
            res.setHeader("Content-Length", content.length.toString());
            res.end(content);
          } catch (err) {
            res.statusCode = 404;
            res.end("File not found");
          }
        } catch (err) {
          res.statusCode = 500;
          res.end("Internal server error");
        }
      });
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localFileServerPlugin()],
  css: {
    postcss: {
      plugins: [tailwindcssPostcss, autoprefixer],
    },
  },
  define: {
    "import.meta.env.VITE_GIT_COMMIT_HASH": JSON.stringify(getGitVersion()),
  },
});