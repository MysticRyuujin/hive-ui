import { Directory, TestRun, TestDetail } from "../types";

const getTimestamp = () => new Date().getTime();

// Check if an address is a local path (starts with local://, or is not an HTTP(S) URL)
const isLocalPath = (address: string): boolean => {
  // Returns true for local:// addresses, or any address not starting with http://, https://, or //
  return (
    address.startsWith("local://") ||
    (
      !address.startsWith("http://") &&
      !address.startsWith("https://") &&
      !address.startsWith("//")
    )
  );
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
  // Encode each path segment to handle special characters like ?, #, &, etc.
  const encodedFilePath = filePath
    .split('/')
    .map(segment => segment ? encodeURIComponent(segment) : '')
    .join('/');
  // Build the proxy URL
  return `/api/local${encodedFilePath}?path=${encodedPath}`;
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
  const encodedPath = filePath
    .split('/')
    .map(segment => segment ? encodeURIComponent(segment) : '')
    .join('/');
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
  return getFetchUrl(discoveryAddr, `/results/${logFile}`);
};