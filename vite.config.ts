import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcssPostcss from "@tailwindcss/postcss";
import autoprefixer from "autoprefixer";
import { execSync } from "child_process";
import { closeSync, openSync, readFileSync, readSync, statSync } from "fs";
import { extname, join, resolve, sep } from "path";
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

          // Use localPath directly - it's already decoded


          // Security: Only allow absolute paths and prevent directory traversal
          // Check for Unix absolute paths (/) and Windows absolute paths (C:\, D:\, etc.)
          const isUnixAbsolute = localPath.startsWith("/");
          const isWindowsAbsolute = /^[a-zA-Z]:[/\\]/.test(localPath);
          if (
            (!isUnixAbsolute && !isWindowsAbsolute) ||
            localPath.includes("..")
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

          // The URL constructor already decodes pathname, so no need to decode again.
          // If the client sends encoded segments, ensure only one decode happens.
          // Remove explicit decodeURIComponent to avoid double-decoding.

          // Security: Validate requestPath to prevent directory traversal
          if (requestPath.includes("..")) {
            res.statusCode = 403;
            res.end("Invalid path");
            return;
          }

          const fullPath = join(localPath, requestPath);

          // Security: Normalize the path and verify it's still within the base directory
          const normalizedBasePath = resolve(localPath);
          const normalizedFullPath = resolve(fullPath);
          // Ensure the full path is strictly within the base directory by checking
          // that it either equals the base path or starts with base path + separator
          // This prevents access to sibling directories (e.g., /home/user/logsbackup
          // when base is /home/user/logs)
          const basePathWithSeparator = normalizedBasePath + sep;
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
            const ext = extname(fullPath).slice(1).toLowerCase();

            // Set appropriate content type
            const contentTypeMap: Record<string, string> = {
              json: "application/json",
              jsonl: "application/x-ndjson",
              txt: "text/plain",
              log: "text/plain",
            };
            const contentType = contentTypeMap[ext] || "application/octet-stream";

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
                  const fd = openSync(fullPath, "r");
                  const content = Buffer.alloc(chunkSize);
                  readSync(fd, content, 0, chunkSize, start);
                  closeSync(fd);

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
            console.error(err);
            res.statusCode = 404;
            res.end("File not found");
          }
        } catch (err) {
          console.error(err);
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