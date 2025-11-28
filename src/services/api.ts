import { Directory, TestRun, TestDetail } from "../types";

const getTimestamp = () => new Date().getTime();

// Check if an address is a local path (starts with local:// or is an absolute path)
const isLocalPath = (address: string): boolean => {
  // Detects local://, Unix absolute paths (/...), and Windows absolute paths (C:\..., C:/...)
  return (
    address.startsWith("local://") ||
    (!address.startsWith("http://") &&
      !address.startsWith("https://") &&
      !address.startsWith("//") &&
      (
        address.startsWith("/") || // Unix absolute path
        /^[a-zA-Z]:[\\/]/.test(address) // Windows absolute path (C:\ or C:/)
      )
    )
  );
};

// Convert local path to proxy URL
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
  return `/api/local${encodedFilePath}?path=${encodedPath}&ts=${getTimestamp()}`;
};

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