import logger from '@server/logger';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const WALLPAPER_STORAGE_DIR = path.join(process.cwd(), 'config', 'wallpapers');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const WALLPAPER_WIDTH = 1920; // Standard wallpaper width (landscape)
const WALLPAPER_HEIGHT = 1080; // Standard wallpaper height (16:9 ratio)

/**
 * Initialize wallpaper storage directory
 */
export function initializeWallpaperStorage(): void {
  try {
    if (!fs.existsSync(WALLPAPER_STORAGE_DIR)) {
      fs.mkdirSync(WALLPAPER_STORAGE_DIR, { recursive: true });
      logger.info(
        `Created wallpaper storage directory: ${WALLPAPER_STORAGE_DIR}`
      );
    }
  } catch (error) {
    logger.error('Failed to initialize wallpaper storage directory:', error);
    throw error;
  }
}

/**
 * Validate file buffer is a valid image
 */
async function validateImageBuffer(
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  // Validate mime type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(
      `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
  }

  // Validate file size
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds maximum allowed size of ${
        MAX_FILE_SIZE / 1024 / 1024
      }MB`
    );
  }

  // Validate it's actually an image using Sharp
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.format || !metadata.width || !metadata.height) {
      throw new Error('Invalid image file');
    }
  } catch (error) {
    throw new Error(
      `Invalid image file: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

/**
 * Save wallpaper file to storage
 * @param fileBuffer The file buffer to save
 * @param mimeType The MIME type of the file
 * @param originalName Optional original filename for logging
 * @returns The filename of the saved wallpaper
 */
export async function saveWallpaperFile(
  fileBuffer: Buffer,
  mimeType: string,
  originalName?: string
): Promise<string> {
  // Validate the file
  await validateImageBuffer(fileBuffer, mimeType);

  // Determine file extension
  const fileExtension = mimeType.split('/')[1] || 'jpg';

  // Generate unique filename
  const filename = `${randomUUID()}.${fileExtension}`;
  const filePath = path.join(WALLPAPER_STORAGE_DIR, filename);

  let image: sharp.Sharp | null = null;
  try {
    // Security: Validate the image buffer with Sharp (this also prevents malicious files)
    image = sharp(fileBuffer);
    const metadata = await image.metadata();

    // Process and optimize the wallpaper (landscape format)
    let processedImage = image;

    // Resize if larger than standard wallpaper dimensions (maintain aspect ratio)
    if (
      metadata.width &&
      metadata.height &&
      (metadata.width > WALLPAPER_WIDTH || metadata.height > WALLPAPER_HEIGHT)
    ) {
      processedImage = processedImage.resize(
        WALLPAPER_WIDTH,
        WALLPAPER_HEIGHT,
        {
          fit: 'inside',
          withoutEnlargement: true,
        }
      );
    }

    // Convert to JPEG for consistency and smaller file size
    const outputBuffer = await processedImage
      .jpeg({ quality: 90, progressive: true })
      .toBuffer();

    // Write to disk
    await fs.promises.writeFile(filePath, outputBuffer);

    logger.info('Wallpaper saved successfully', {
      filename,
      originalName,
      size: outputBuffer.length,
    });

    return filename;
  } catch (error) {
    logger.error('Error saving wallpaper:', error);
    // Clean up file if it was partially written
    if (fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath);
      } catch (unlinkError) {
        logger.error('Failed to clean up partial wallpaper file:', unlinkError);
      }
    }
    throw error;
  }
}

/**
 * Check if wallpaper file exists
 */
export function wallpaperExists(filename: string): boolean {
  const filePath = path.join(WALLPAPER_STORAGE_DIR, filename);
  return fs.existsSync(filePath);
}

/**
 * Get wallpaper URL for API response
 */
export function getWallpaperUrl(filename: string): string {
  return `/api/v1/collections/wallpaper/${filename}`;
}

/**
 * Get wallpaper file path
 */
export function getWallpaperPath(filename: string): string {
  const filePath = path.join(WALLPAPER_STORAGE_DIR, filename);

  // Security: Ensure the resolved path is within the wallpaper directory
  if (!filePath.startsWith(WALLPAPER_STORAGE_DIR)) {
    throw new Error('Invalid file path');
  }

  return filePath;
}

/**
 * Delete wallpaper file
 */
export async function deleteWallpaperFile(filename: string): Promise<void> {
  try {
    const filePath = getWallpaperPath(filename);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info('Wallpaper deleted successfully', { filename });
    }
  } catch (error) {
    logger.error('Error deleting wallpaper:', error);
    throw error;
  }
}

/**
 * List all wallpaper files
 */
export async function listWallpaperFiles(): Promise<string[]> {
  try {
    if (!fs.existsSync(WALLPAPER_STORAGE_DIR)) {
      return [];
    }

    const files = await fs.promises.readdir(WALLPAPER_STORAGE_DIR);
    return files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
    });
  } catch (error) {
    logger.error('Error listing wallpaper files:', error);
    return [];
  }
}
