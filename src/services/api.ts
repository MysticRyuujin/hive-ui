import { Directory, TestRun, TestDetail } from "../types";

const getTimestamp = () => new Date().getTime();

// Check if an address is a local file system path (absolute or relative)
// Returns true for:
//   - Explicit local:// prefixed paths
//   - Unix absolute paths (e.g., /path/to/file)
//   - Windows absolute paths (e.g., C:\path\to\file)
//   - Relative paths (e.g., data/file.txt, ./file.txt)
// Returns false for:
//   - Any protocol URL (http://, https://, ftp://, file://, etc.)
//   - Protocol-relative URLs (//example.com)
const isLocalPath = (address: string): boolean => {
  // Explicit local:// prefix
  if (address.startsWith("local://")) {
    return true;
  }

  // Check for any protocol URL (scheme://)
  // Matches: http://, https://, ftp://, file://, etc.
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(address)) {
    return false;
  }

  // Check for protocol-relative URLs (//example.com)
  if (address.startsWith("//")) {
    return false;
  }

  // Everything else is treated as local (absolute or relative paths)
  return true;
};

/**
 * Converts a local directory path and a relative file path into a proxy URL for fetching local files.
 *
 * @param {string} localPath - The base directory path. May include the 'local://' prefix, or be an absolute path (e.g., '/data' or 'C:\\data').
 * @param {string} filePath - The relative file path within the local directory. Should use forward slashes ('/') as separators.
 * @returns {string} The proxy URL to fetch the specified file from the local directory.
 */
const getLocalProxyUrl = (localPath: string, filePath: string): string => {
  // Remove local:// prefix if present
  const cleanPath = localPath.replace(/^local:\/\//, "");
  // Encode the local path as a query parameter
  const encodedPath = encodeURIComponent(cleanPath);
  // Encode each path segment to handle special characters (?, #, &, etc.)
  // This normalizes the encoding of all special characters within each segment
  // Use encodeURIComponent for all segments to preserve empty segments (consecutive slashes)
  const encodedFilePath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  // Build the proxy URL with timestamp for cache invalidation during development
  return `/api/local${encodedFilePath}?path=${encodedPath}&ts=${getTimestamp()}`;
};

/**
 * Determines the correct URL to fetch a resource, using a local proxy URL if the base address is a local path,
 * or a direct HTTP(S) URL otherwise.
 *
 * @param {string} baseAddress - The base address of the resource, which can be a local path or an HTTP(S) URL.
 * @param {string} filePath - The path to the file/resource to fetch, relative to the base address.
 * @returns {string} The URL to use for fetching the resource.
 */
const getFetchUrl = (baseAddress: string, filePath: string): string => {
  if (isLocalPath(baseAddress)) {
    return getLocalProxyUrl(baseAddress, filePath);
  }
  // Encode each path segment to handle special characters like spaces
  // Use encodeURIComponent for all segments to preserve empty segments (consecutive slashes)
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  // Ensure proper path joining: remove trailing slash from baseAddress and leading slash from filePath
  // then join with a single slash
  const normalizedBase = baseAddress.replace(/\/+$/, ""); // Remove trailing slashes
  const normalizedPath = encodedPath.replace(/^\/+/, ""); // Remove leading slashes
  return `${normalizedBase}/${normalizedPath}?ts=${getTimestamp()}`;
};

export const fetchDirectories = async (): Promise<Directory[]> => {
  const response = await fetch(`/discovery.json?ts=${getTimestamp()}`);
  if (!response.ok) {
    throw new Error("Failed to fetch directories");
  }

  const data = await response.json();
  // Remove all trailing slashes from the addresses (but preserve local:// prefix)
  return data.map((directory: Directory) => ({
    ...directory,
    address: directory.address.replace(/\/$/, ""),
  }));
};

export const fetchTestRuns = async (
  directory: Directory
): Promise<TestRun[]> => {
  const url = getFetchUrl(directory.address, "/listing.jsonl");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch test runs");
  }
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
};

export const fetchTestDetail = async (
  discoveryAddr: string,
  fileName: string
): Promise<TestDetail> => {
  const url = getFetchUrl(discoveryAddr, `/results/${fileName}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch test details");
  }
  return await response.json();
};

// Get the URL for fetching log files (supports both HTTP and local paths)
export const getLogFileUrl = (
  discoveryAddr: string,
  logFile: string
): string => {
  // Security: Reject paths containing null bytes to prevent path truncation attacks
  if (logFile.includes("\0")) {
    // Return empty string to indicate invalid path - caller should handle this case
    return "";
  }

  // Handle HTTP and local paths differently:
  // - For HTTP: logFile is always placed in /results/ (matches master branch behavior)
  // - For local: logFile may already contain the correct path structure, so:
  //   * If logFile contains a path separator, normalize and use it (relative to base)
  //   * Otherwise, place it in /results/
  const isLocal = isLocalPath(discoveryAddr);
  let filePath: string;
  
  if (isLocal) {
    // For local paths, respect the path structure in logFile but normalize it
    // Check for path separators (both forward and back slashes for cross-platform support)
    if (logFile.includes("/") || logFile.includes("\\")) {
      // logFile contains a path - normalize it
      // First, normalize backslashes to forward slashes for consistent handling
      let normalizedPath = logFile.replace(/\\/g, "/");
      // Remove leading slashes
      normalizedPath = normalizedPath.replace(/^\/+/, "");
      
      // Security: Normalize path segments to prevent traversal attacks
      // Split by /, filter out dangerous segments ('..', '.') and empty segments, then rejoin
      const segments = normalizedPath.split("/").filter(segment => {
        // Filter out empty segments, current directory, and parent directory references
        return segment !== "" && segment !== "." && segment !== "..";
      });
      
      // Rejoin segments - this prevents ../ from escaping the base directory
      normalizedPath = segments.join("/");
      filePath = `/${normalizedPath}`;
    } else {
      // Just a filename - place it in /results/
      filePath = `/results/${logFile}`;
    }
  } else {
    // For HTTP paths, always place in /results/ (matches master branch behavior)
    const normalizedLogFile = logFile.replace(/^\/+/, ""); // Remove any leading slashes
    filePath = `/results/${normalizedLogFile}`;
  }
  
  return getFetchUrl(discoveryAddr, filePath);
};
