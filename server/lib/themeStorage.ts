import logger from '@server/logger';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const THEME_STORAGE_DIR = path.join(process.cwd(), 'config', 'themes');
const ALLOWED_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/flac',
  'audio/ogg',
  'audio/aac',
  'audio/x-m4a',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Initialize theme storage directory
 */
export function initializeThemeStorage(): void {
  try {
    if (!fs.existsSync(THEME_STORAGE_DIR)) {
      fs.mkdirSync(THEME_STORAGE_DIR, { recursive: true });
      logger.info(`Created theme storage directory: ${THEME_STORAGE_DIR}`);
    }
  } catch (error) {
    logger.error('Failed to initialize theme storage directory:', error);
    throw error;
  }
}

/**
 * Validate audio file buffer
 */
async function validateAudioBuffer(
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

  // Basic validation - check if buffer has content
  if (buffer.length === 0) {
    throw new Error('Empty audio file');
  }
}

/**
 * Get file extension from mime type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/flac': 'flac',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/x-m4a': 'm4a',
  };

  return extensions[mimeType] || 'mp3';
}

/**
 * Save theme file to storage
 * @param fileBuffer The file buffer to save
 * @param mimeType The MIME type of the file
 * @param originalName Optional original filename for logging
 * @returns The filename of the saved theme
 */
export async function saveThemeFile(
  fileBuffer: Buffer,
  mimeType: string,
  originalName?: string
): Promise<string> {
  // Validate the file
  await validateAudioBuffer(fileBuffer, mimeType);

  // Determine file extension
  const fileExtension = getExtensionFromMimeType(mimeType);

  // Generate unique filename
  const filename = `${randomUUID()}.${fileExtension}`;
  const filePath = path.join(THEME_STORAGE_DIR, filename);

  try {
    // Write to disk
    await fs.promises.writeFile(filePath, fileBuffer);

    logger.info('Theme saved successfully', {
      filename,
      originalName,
      size: fileBuffer.length,
    });

    return filename;
  } catch (error) {
    logger.error('Error saving theme:', error);
    // Clean up file if it was partially written
    if (fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath);
      } catch (unlinkError) {
        logger.error('Failed to clean up partial theme file:', unlinkError);
      }
    }
    throw error;
  }
}

/**
 * Check if theme file exists
 */
export function themeExists(filename: string): boolean {
  const filePath = path.join(THEME_STORAGE_DIR, filename);
  return fs.existsSync(filePath);
}

/**
 * Get theme URL for API response
 */
export function getThemeUrl(filename: string): string {
  return `/api/v1/collections/theme/${filename}`;
}

/**
 * Get theme file path
 */
export function getThemePath(filename: string): string {
  const filePath = path.join(THEME_STORAGE_DIR, filename);

  // Security: Ensure the resolved path is within the theme directory
  if (!filePath.startsWith(THEME_STORAGE_DIR)) {
    throw new Error('Invalid file path');
  }

  return filePath;
}

/**
 * Delete theme file
 */
export async function deleteThemeFile(filename: string): Promise<void> {
  try {
    const filePath = getThemePath(filename);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info('Theme deleted successfully', { filename });
    }
  } catch (error) {
    logger.error('Error deleting theme:', error);
    throw error;
  }
}

/**
 * List all theme files
 */
export async function listThemeFiles(): Promise<string[]> {
  try {
    if (!fs.existsSync(THEME_STORAGE_DIR)) {
      return [];
    }

    const files = await fs.promises.readdir(THEME_STORAGE_DIR);
    return files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a'].includes(ext);
    });
  } catch (error) {
    logger.error('Error listing theme files:', error);
    return [];
  }
}
