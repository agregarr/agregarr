import logger from '@server/logger';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  deletePosterFile,
  getPosterPath,
  posterExists,
  savePosterFile,
} from './posterStorage';

const POSTER_STORAGE_DIR = path.join(process.cwd(), 'config', 'posters');
const THUMBNAIL_PREFIX = 'thumb_';
const MAX_THUMBNAIL_WIDTH = 200;
const MAX_THUMBNAIL_HEIGHT = 300;

export interface PosterFileResult {
  filename: string;
  thumbnailFilename?: string;
  size: number;
}

/**
 * Save a poster buffer and create thumbnail
 */
export async function savePosterWithThumbnail(
  posterBuffer: Buffer,
  originalName?: string
): Promise<PosterFileResult> {
  try {
    // Save the main poster file
    const filename = await savePosterFile(
      posterBuffer,
      'image/jpeg', // Always save as JPEG for consistency
      originalName
    );

    // Create thumbnail
    let thumbnailFilename: string | undefined;
    try {
      const thumbnailBuffer = await sharp(posterBuffer)
        .resize(MAX_THUMBNAIL_WIDTH, MAX_THUMBNAIL_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Generate thumbnail filename
      const baseFilename = path.parse(filename).name;
      const thumbnailName = `${THUMBNAIL_PREFIX}${baseFilename}.jpg`;
      const thumbnailPath = path.join(POSTER_STORAGE_DIR, thumbnailName);

      await fs.promises.writeFile(thumbnailPath, thumbnailBuffer);
      thumbnailFilename = thumbnailName;

      logger.debug('Created poster thumbnail', {
        filename,
        thumbnailFilename,
        originalSize: posterBuffer.length,
        thumbnailSize: thumbnailBuffer.length,
      });
    } catch (thumbnailError) {
      logger.warn('Failed to create thumbnail, continuing without it', {
        filename,
        error: thumbnailError,
      });
    }

    logger.info('Saved poster with thumbnail', {
      filename,
      thumbnailFilename,
      size: posterBuffer.length,
    });

    return {
      filename,
      thumbnailFilename,
      size: posterBuffer.length,
    };
  } catch (error) {
    logger.error('Failed to save poster with thumbnail:', error);
    throw new Error('Failed to save poster file');
  }
}

/**
 * Load a poster file from storage
 */
export async function loadPosterFile(filename: string): Promise<Buffer> {
  try {
    if (!posterExists(filename)) {
      throw new Error(`Poster file not found: ${filename}`);
    }

    const filePath = getPosterPath(filename);
    return await fs.promises.readFile(filePath);
  } catch (error) {
    logger.error('Failed to load poster file:', error);
    throw new Error('Failed to load poster file');
  }
}

/**
 * Load thumbnail file from storage
 */
export async function loadThumbnailFile(
  filename: string
): Promise<Buffer | null> {
  try {
    if (!filename) return null;

    const thumbnailPath = path.join(POSTER_STORAGE_DIR, filename);

    if (!fs.existsSync(thumbnailPath)) {
      logger.debug('Thumbnail file not found', { filename });
      return null;
    }

    return await fs.promises.readFile(thumbnailPath);
  } catch (error) {
    logger.warn('Failed to load thumbnail file:', error);
    return null;
  }
}

/**
 * Delete poster and its thumbnail
 */
export async function deletePosterWithThumbnail(
  filename: string,
  thumbnailFilename?: string
): Promise<void> {
  try {
    // Delete main poster file
    await deletePosterFile(filename);

    // Delete thumbnail if it exists
    if (thumbnailFilename) {
      try {
        const thumbnailPath = path.join(POSTER_STORAGE_DIR, thumbnailFilename);
        if (fs.existsSync(thumbnailPath)) {
          await fs.promises.unlink(thumbnailPath);
          logger.debug('Deleted poster thumbnail', { thumbnailFilename });
        }
      } catch (thumbnailError) {
        logger.warn('Failed to delete thumbnail file', {
          thumbnailFilename,
          error: thumbnailError,
        });
      }
    }

    logger.info('Deleted poster with thumbnail', {
      filename,
      thumbnailFilename,
    });
  } catch (error) {
    logger.error('Failed to delete poster with thumbnail:', error);
    throw new Error('Failed to delete poster files');
  }
}

/**
 * Get poster URL for serving
 */
export function getPosterUrl(filename: string): string {
  return `/api/v1/posters/files/${filename}`;
}

/**
 * Get thumbnail URL for serving
 */
export function getThumbnailUrl(filename: string): string {
  return `/api/v1/posters/thumbnails/${filename}`;
}

/**
 * Validate and process uploaded poster buffer
 */
export async function processUploadedPoster(
  buffer: Buffer,
  originalName?: string
): Promise<PosterFileResult> {
  try {
    // Validate and process the image with Sharp
    const processedBuffer = await sharp(buffer)
      .resize(1000, 1500, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    return await savePosterWithThumbnail(processedBuffer, originalName);
  } catch (error) {
    logger.error('Failed to process uploaded poster:', error);
    throw new Error('Failed to process poster image');
  }
}

/**
 * Clean up orphaned thumbnail files
 */
export async function cleanupOrphanedThumbnails(): Promise<number> {
  try {
    if (!fs.existsSync(POSTER_STORAGE_DIR)) {
      return 0;
    }

    const files = await fs.promises.readdir(POSTER_STORAGE_DIR);
    const thumbnailFiles = files.filter((file) =>
      file.startsWith(THUMBNAIL_PREFIX)
    );

    let cleanedCount = 0;

    for (const thumbnailFile of thumbnailFiles) {
      // Extract the base filename from thumbnail
      const baseFilename = thumbnailFile
        .replace(THUMBNAIL_PREFIX, '')
        .replace(/\.[^.]+$/, '');

      // Look for corresponding main poster file
      const possibleMainFiles = files.filter(
        (file) =>
          !file.startsWith(THUMBNAIL_PREFIX) && file.includes(baseFilename)
      );

      if (possibleMainFiles.length === 0) {
        // No main file found, delete orphaned thumbnail
        try {
          const thumbnailPath = path.join(POSTER_STORAGE_DIR, thumbnailFile);
          await fs.promises.unlink(thumbnailPath);
          cleanedCount++;
          logger.debug('Cleaned up orphaned thumbnail', { thumbnailFile });
        } catch (error) {
          logger.warn('Failed to clean up orphaned thumbnail', {
            thumbnailFile,
            error,
          });
        }
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} orphaned thumbnail files`);
    }

    return cleanedCount;
  } catch (error) {
    logger.error('Failed to cleanup orphaned thumbnails:', error);
    return 0;
  }
}
