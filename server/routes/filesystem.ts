import logger from '@server/logger';
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';

const filesystemRoutes = Router();

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * GET /api/v1/filesystem/browse
 * Browse directories on the server filesystem
 * Query params:
 *   - path: Directory path to browse (optional, defaults to /)
 */
filesystemRoutes.get('/browse', async (req, res) => {
  try {
    const requestedPath = (req.query.path as string) || '/';

    // Security: Resolve to absolute path to prevent directory traversal
    const absolutePath = path.resolve(requestedPath);

    logger.debug('Browsing filesystem directory', {
      label: 'Filesystem Browser',
      requestedPath,
      absolutePath,
    });

    // Check if directory exists and is accessible
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        return res.status(400).json({
          error: 'Path is not a directory',
          path: absolutePath,
        });
      }
    } catch (error) {
      logger.warn('Failed to access directory', {
        label: 'Filesystem Browser',
        path: absolutePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(404).json({
        error: 'Directory not found or not accessible',
        path: absolutePath,
      });
    }

    // Read directory contents
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

    // System directories to exclude from root level browsing (common container paths)
    const systemDirectories = new Set([
      'app',
      'bin',
      'boot',
      'dev',
      'etc',
      'home',
      'lib',
      'lib64',
      'opt',
      'proc',
      'root',
      'run',
      'sbin',
      'srv',
      'sys',
      'tmp',
      'usr',
      'var',
    ]);

    // Build response with only directories (hide files for cleaner UX)
    const directories: DirectoryEntry[] = [];

    for (const entry of entries) {
      // Skip hidden directories (starting with .)
      if (entry.name.startsWith('.')) {
        continue;
      }

      if (entry.isDirectory()) {
        // Filter out system directories only when at root level
        if (absolutePath === '/' && systemDirectories.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(absolutePath, entry.name);
        directories.push({
          name: entry.name,
          path: fullPath,
          isDirectory: true,
        });
      }
    }

    // Sort directories alphabetically
    directories.sort((a, b) => a.name.localeCompare(b.name));

    // Add parent directory option if not at root
    const parentPath = path.dirname(absolutePath);
    const canGoUp = absolutePath !== '/' && parentPath !== absolutePath;

    res.json({
      currentPath: absolutePath,
      parentPath: canGoUp ? parentPath : null,
      directories,
    });
  } catch (error) {
    logger.error('Error browsing filesystem', {
      label: 'Filesystem Browser',
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to browse directory',
    });
  }
});

export default filesystemRoutes;
