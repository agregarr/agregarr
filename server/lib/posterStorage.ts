import logger from '@server/logger';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const POSTER_STORAGE_DIR = path.join(process.cwd(), 'config', 'posters');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const POSTER_WIDTH = 500; // Standard poster width
const POSTER_HEIGHT = 750; // Standard poster height (2:3 ratio)

/**
 * Security: Validate filename to prevent path traversal attacks
 */
function isValidFilename(filename: string): boolean {
  // Check for basic requirements
  if (!filename || typeof filename !== 'string') {
    return false;
  }

  // Prevent path traversal attempts
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    return false;
  }

  // Only allow valid poster filenames (UUID + extension)
  const validPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i;
  return validPattern.test(filename);
}

/**
 * Initialize poster storage directory
 */
export function initializePosterStorage(): void {
  try {
    if (!fs.existsSync(POSTER_STORAGE_DIR)) {
      fs.mkdirSync(POSTER_STORAGE_DIR, { recursive: true });
      logger.info(`Created poster storage directory: ${POSTER_STORAGE_DIR}`);
    }
  } catch (error) {
    logger.error('Failed to initialize poster storage directory:', error);
    throw error;
  }
}

/**
 * Save uploaded poster file and return the stored filename
 */
export async function savePosterFile(
  fileBuffer: Buffer,
  mimeType: string,
  originalName?: string
): Promise<string> {
  // Validate mime type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(
      `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `File size too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    );
  }

  // Generate unique filename with secure extension mapping
  const extensionMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };

  const fileExtension = extensionMap[mimeType];
  if (!fileExtension) {
    throw new Error('Unsupported file type');
  }

  const filename = `${randomUUID()}.${fileExtension}`;
  const filePath = path.join(POSTER_STORAGE_DIR, filename);

  let image: sharp.Sharp | null = null;
  try {
    // Security: Validate the image buffer with Sharp (this also prevents malicious files)
    image = sharp(fileBuffer);
    const metadata = await image.metadata();

    // Additional security: Verify it's actually an image
    if (
      !metadata.format ||
      !['jpeg', 'png', 'webp'].includes(metadata.format)
    ) {
      throw new Error('Invalid image format detected');
    }

    // Prevent excessively large images that could cause DoS
    if (
      metadata.width &&
      metadata.height &&
      (metadata.width > 5000 || metadata.height > 5000)
    ) {
      throw new Error('Image dimensions too large');
    }

    // Process and optimize the image while preserving format
    let processedBuffer: Buffer;
    if (metadata.format === 'png') {
      processedBuffer = await image
        .resize(POSTER_WIDTH, POSTER_HEIGHT, {
          fit: 'cover',
          position: 'center',
        })
        .png({ quality: 85 })
        .toBuffer();
    } else if (metadata.format === 'webp') {
      processedBuffer = await image
        .resize(POSTER_WIDTH, POSTER_HEIGHT, {
          fit: 'cover',
          position: 'center',
        })
        .webp({ quality: 85 })
        .toBuffer();
    } else {
      // Default to JPEG for jpeg format or fallback
      processedBuffer = await image
        .resize(POSTER_WIDTH, POSTER_HEIGHT, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 85 })
        .toBuffer();
    }

    // Save to disk
    await fs.promises.writeFile(filePath, processedBuffer);

    logger.info(
      `Saved poster file: ${filename}${
        originalName ? ` (original: ${originalName})` : ''
      }`
    );
    return filename;
  } catch (error) {
    logger.error('Failed to save poster file:', error);
    throw new Error('Failed to process and save poster file');
  } finally {
    // Cleanup: Ensure Sharp instance is properly destroyed to prevent memory leaks
    if (image) {
      try {
        image.destroy();
      } catch (destroyError) {
        logger.warn('Failed to destroy Sharp instance:', destroyError);
      }
    }
  }
}

/**
 * Delete a poster file
 */
export async function deletePosterFile(filename: string): Promise<void> {
  if (!filename) return;

  // Security: Validate filename to prevent path traversal
  if (!isValidFilename(filename)) {
    throw new Error('Invalid filename');
  }

  const filePath = path.join(POSTER_STORAGE_DIR, filename);

  // Security: Ensure the resolved path is within the poster directory
  if (!filePath.startsWith(POSTER_STORAGE_DIR)) {
    throw new Error('Invalid file path');
  }

  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info(`Deleted poster file: ${filename}`);
    }
  } catch (error) {
    logger.warn(`Failed to delete poster file ${filename}:`, error);
  }
}

/**
 * Get the full path to a poster file
 */
export function getPosterPath(filename: string): string {
  // Security: Validate filename to prevent path traversal
  if (!isValidFilename(filename)) {
    throw new Error('Invalid filename');
  }

  const filePath = path.join(POSTER_STORAGE_DIR, filename);

  // Security: Ensure the resolved path is within the poster directory
  if (!filePath.startsWith(POSTER_STORAGE_DIR)) {
    throw new Error('Invalid file path');
  }

  return filePath;
}

/**
 * Check if a poster file exists
 */
export function posterExists(filename: string): boolean {
  try {
    // Security validation is handled by getPosterPath
    return fs.existsSync(getPosterPath(filename));
  } catch (error) {
    // Invalid filename or path traversal attempt
    return false;
  }
}

/**
 * Get poster URL for serving via HTTP
 */
export function getPosterUrl(filename: string): string {
  return `/api/v1/collections/poster/${filename}`;
}

/**
 * Clean up orphaned poster files (not referenced by any collection config)
 */
export async function cleanupOrphanedPosters(
  referencedPosters: Set<string>
): Promise<number> {
  try {
    const files = await fs.promises.readdir(POSTER_STORAGE_DIR);
    let deletedCount = 0;

    for (const file of files) {
      if (!referencedPosters.has(file)) {
        await deletePosterFile(file);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} orphaned poster files`);
    }

    return deletedCount;
  } catch (error) {
    logger.error('Failed to cleanup orphaned posters:', error);
    return 0;
  }
}

/**
 * Get all poster filenames currently stored
 */
export async function getAllPosterFiles(): Promise<string[]> {
  try {
    const files = await fs.promises.readdir(POSTER_STORAGE_DIR);
    return files.filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file));
  } catch (error) {
    logger.error('Failed to list poster files:', error);
    return [];
  }
}

/**
 * Validate poster file buffer
 */
export function validatePosterBuffer(buffer: Buffer, mimeType: string): void {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(
      `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `File size too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`
    );
  }
}
