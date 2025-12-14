import fs from 'fs/promises';
import path from 'path';

/**
 * Sanitize string for use in file/folder names
 * Removes/replaces characters that are problematic on various file systems
 * @param input - String to sanitize
 * @returns Sanitized string safe for filenames
 */
export function sanitizeForFilename(input: string): string {
  return (
    input
      // Remove illegal characters: < > : " / \ | ? *
      .replace(/[<>:"/\\|?*]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Trim whitespace
      .trim()
      // Reasonable length limit (200 chars)
      .substring(0, 200)
  );
}

/**
 * Find image file in directory
 * Returns first matching image file with priority order
 * Priority: poster.jpg, poster.png, then any other image
 * @param dirPath - Directory path to search
 * @returns Full path to image file, or null if not found
 */
export async function findImageFile(dirPath: string): Promise<string | null> {
  try {
    const files = await fs.readdir(dirPath);

    // Priority 1: poster.jpg or poster.png (exact name match, case insensitive)
    const posterFile = files.find((f) =>
      /^poster\.(jpg|jpeg|png|webp)$/i.test(f)
    );
    if (posterFile) {
      return path.join(dirPath, posterFile);
    }

    // Priority 2: Any image file (first alphabetically)
    const imageFile = files.find((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
    if (imageFile) {
      return path.join(dirPath, imageFile);
    }

    return null;
  } catch (error) {
    // Directory doesn't exist or not accessible
    return null;
  }
}

/**
 * Get file modification time as Unix timestamp (milliseconds)
 * @param filePath - Path to file
 * @returns Unix timestamp in milliseconds, or null if file not accessible
 */
export async function getFileModTime(filePath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(filePath);
    return Math.floor(stats.mtimeMs);
  } catch (error) {
    return null;
  }
}

/**
 * Validate that file is a readable image
 * Checks file exists, is readable, and has reasonable size (< 50MB)
 * @param filePath - Path to file to validate
 * @returns true if file is valid, false otherwise
 */
export async function validateImageFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);

    // Check it's a file (not directory)
    if (!stats.isFile()) {
      return false;
    }

    // Check reasonable size (< 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (stats.size > maxSize) {
      return false;
    }

    // Check file is readable (attempting to access will throw if not)
    await fs.access(filePath);

    return true;
  } catch (error) {
    return false;
  }
}
