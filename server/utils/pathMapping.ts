import type { PathMapping } from '@server/lib/settings';
import logger from '@server/logger';
import path from 'path';

/**
 * Translate a remote path to a local path using path mappings
 *
 * Example:
 * Remote path: C:\serverdata\media\movies
 * Path mapping: { from: "C:\\serverdata\\media", to: "/mnt/serverdata/media" }
 * Result: /mnt/serverdata/media/movies
 *
 * @param remotePath - The path from the remote system (e.g., Radarr/Sonarr Windows path)
 * @param pathMappings - Array of path mappings to apply
 * @returns Translated local path, or original path if no mapping matches
 */
export function translatePath(
  remotePath: string,
  pathMappings?: PathMapping[]
): string {
  // First, try user-defined path mappings
  if (pathMappings && pathMappings.length > 0) {
    // Normalize the remote path for comparison (convert backslashes to forward slashes)
    const normalizedRemotePath = remotePath.replace(/\\/g, '/');

    // Try each path mapping
    for (const mapping of pathMappings) {
      const normalizedFrom = mapping.from.replace(/\\/g, '/');

      // Check if the remote path starts with this mapping's "from" path
      if (
        normalizedRemotePath === normalizedFrom ||
        normalizedRemotePath.startsWith(normalizedFrom + '/')
      ) {
        // Extract the relative path after the "from" prefix
        const relativePath = normalizedRemotePath.substring(
          normalizedFrom.length
        );

        // Combine with the "to" path
        const localPath = path.join(mapping.to, relativePath);

        logger.debug('Path translated using mapping', {
          label: 'Path Mapping',
          remotePath,
          localPath,
          mapping: { from: mapping.from, to: mapping.to },
        });

        return localPath;
      }
    }
  }

  // No user mapping found - try automatic conversion for cross-platform compatibility
  // If we're on Linux/WSL and got a Windows path, convert it automatically
  if (process.platform === 'linux' && isWindowsPath(remotePath)) {
    const convertedPath = convertWindowsPathToLinux(remotePath);

    logger.debug('Auto-converted Windows path to Linux/WSL path', {
      label: 'Path Mapping',
      remotePath,
      convertedPath,
      platform: process.platform,
    });

    return convertedPath;
  }

  // No conversion needed - return original path
  logger.debug('No path translation needed', {
    label: 'Path Mapping',
    remotePath,
    platform: process.platform,
  });

  return remotePath;
}

/**
 * Check if a path appears to be a Windows path
 */
export function isWindowsPath(filePath: string): boolean {
  // Check for drive letter (C:, D:, etc.) or UNC path (\\server\share)
  return /^[A-Za-z]:/.test(filePath) || /^\\\\/.test(filePath);
}

/**
 * Convert Windows path to WSL/Linux path automatically
 * Handles common cases like WSL mounts and Docker volumes
 *
 * Examples:
 * - C:\serverdata\media → /mnt/c/serverdata/media (WSL)
 * - \\server\share\path → /server/share/path (UNC to Linux)
 */
export function convertWindowsPathToLinux(windowsPath: string): string {
  // Already a Linux path, return as-is
  if (!isWindowsPath(windowsPath)) {
    return windowsPath;
  }

  // Handle drive letter paths (C:\, D:\, etc.)
  const driveMatch = windowsPath.match(/^([A-Za-z]):(\\|\/)(.*)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    const restOfPath = driveMatch[3];

    // Convert to WSL mount path: C:\ → /mnt/c/
    const linuxPath = `/mnt/${driveLetter}/${restOfPath}`;

    // Normalize path separators
    return linuxPath.replace(/\\/g, '/');
  }

  // Handle UNC paths (\\server\share\path)
  const uncMatch = windowsPath.match(/^\\\\([^\\]+)\\(.+)/);
  if (uncMatch) {
    const serverPath = uncMatch[1];
    const sharePath = uncMatch[2];

    // Convert to Linux path: \\server\share → /server/share
    const linuxPath = `/${serverPath}/${sharePath}`;

    // Normalize path separators
    return linuxPath.replace(/\\/g, '/');
  }

  // Fallback: just normalize separators
  return windowsPath.replace(/\\/g, '/');
}
