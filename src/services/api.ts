import { Directory, TestRun, TestDetail } from "../types";

const getTimestamp = () => new Date().getTime();

// Check if an address is a local path
// Returns true for:
//   - Explicit local:// prefixed paths
//   - Absolute paths (Unix /path or Windows C:\path)
//   - Relative paths (anything else)
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
// Get the actual URL to fetch from (either direct HTTP or through proxy)
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
  return `${baseAddress}${encodedPath}?ts=${getTimestamp()}`;
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
  // Determine the file path:
  // - If logFile starts with /, it's already an absolute path, use as-is
  // - If logFile contains / (but doesn't start with it), it's a relative path
  // - Otherwise, it's just a filename, so place it in /results/
  let filePath: string;
  if (logFile.startsWith('/')) {
    // Already an absolute path
    filePath = logFile;
  } else if (logFile.includes('/')) {
    // Relative path (e.g., "subdir/file.log")
    filePath = `/${logFile}`;
  } else {
    // Just a filename (e.g., "file.log")
    filePath = `/results/${logFile}`;
  }
  return getFetchUrl(discoveryAddr, filePath);
};
