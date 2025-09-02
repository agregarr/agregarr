import logger from '@server/logger';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  generatePosterBuffer,
  type PosterGenerationConfig,
} from './posterGeneration';

const POSTER_STORAGE_DIR = path.join(process.cwd(), 'config', 'posters');
const POSTER_HASHES_FILE = path.join(POSTER_STORAGE_DIR, 'poster-hashes.json');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const POSTER_WIDTH = 500; // Standard poster width
const POSTER_HEIGHT = 750; // Standard poster height (2:3 ratio)

interface PosterHashRegistry {
  [hash: string]: {
    filename: string;
    originalName?: string;
    uploadedAt: string;
    type: 'uploaded' | 'generated' | 'imported';
  };
}

/**
 * Calculate SHA-256 hash of a buffer
 */
function calculatePosterHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Load poster hash registry from disk
 */
function loadPosterHashRegistry(): PosterHashRegistry {
  try {
    if (fs.existsSync(POSTER_HASHES_FILE)) {
      const data = fs.readFileSync(POSTER_HASHES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.warn('Failed to load poster hash registry:', error);
  }
  return {};
}

/**
 * Save poster hash registry to disk
 */
function savePosterHashRegistry(registry: PosterHashRegistry): void {
  try {
    fs.writeFileSync(POSTER_HASHES_FILE, JSON.stringify(registry, null, 2));
  } catch (error) {
    logger.error('Failed to save poster hash registry:', error);
  }
}

/**
 * Add poster to hash registry
 */
function addPosterToRegistry(
  hash: string,
  filename: string,
  type: 'uploaded' | 'generated' | 'imported',
  originalName?: string
): void {
  const registry = loadPosterHashRegistry();
  registry[hash] = {
    filename,
    originalName,
    uploadedAt: new Date().toISOString(),
    type,
  };
  savePosterHashRegistry(registry);
}

/**
 * Find existing poster by hash
 */
function findPosterByHash(hash: string): string | null {
  const registry = loadPosterHashRegistry();
  const entry = registry[hash];
  if (entry && posterExists(entry.filename)) {
    return entry.filename;
  }
  // Clean up invalid entry if file doesn't exist
  if (entry && !posterExists(entry.filename)) {
    delete registry[hash];
    savePosterHashRegistry(registry);
  }
  return null;
}

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

  // Allow valid poster filenames (UUID + extension or generated_ prefix)
  const uuidPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i;
  const generatedPattern = /^generated_[a-z0-9]+\.(jpg|jpeg|png|webp)$/i;

  return uuidPattern.test(filename) || generatedPattern.test(filename);
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

  // Calculate hash to check for duplicates
  const fileHash = calculatePosterHash(fileBuffer);
  const existingFilename = findPosterByHash(fileHash);

  if (existingFilename) {
    logger.info(
      `Duplicate poster detected, reusing existing file: ${existingFilename}`,
      {
        hash: fileHash,
        originalName,
      }
    );
    return existingFilename;
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

    // Add to hash registry
    addPosterToRegistry(fileHash, filename, 'uploaded', originalName);

    logger.info(
      `Saved poster file: ${filename}${
        originalName ? ` (original: ${originalName})` : ''
      }`,
      {
        hash: fileHash,
      }
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
 * Download and save a poster from a URL
 * @param url The URL to download the poster from
 * @param originalName Optional original name for logging
 * @returns The saved filename or null if failed
 */
export async function downloadAndSavePoster(
  url: string,
  originalName?: string
): Promise<string | null> {
  try {
    const axios = await import('axios');

    // Download the image
    const response = await axios.default.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: MAX_FILE_SIZE,
      headers: {
        'User-Agent': 'Agregarr/1.0.0',
      },
    });

    // Get content type
    const contentType = response.headers['content-type'] || 'image/jpeg';

    // Validate content type
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      logger.warn(`Unsupported content type for poster URL: ${contentType}`, {
        url: originalName ? `${originalName} (${url})` : url,
      });
      return null;
    }

    // Convert to buffer
    const buffer = Buffer.from(response.data);

    // Calculate hash to check for duplicates before processing
    const fileHash = calculatePosterHash(buffer);
    const existingFilename = findPosterByHash(fileHash);

    if (existingFilename) {
      logger.info(
        `Duplicate poster detected during download, reusing existing file: ${existingFilename}`,
        {
          hash: fileHash,
          url: originalName ? `${originalName} (${url})` : url,
        }
      );
      return existingFilename;
    }

    // Save the poster
    const filename = await savePosterFile(buffer, contentType, originalName);

    // Update registry to mark as imported rather than uploaded
    const registry = loadPosterHashRegistry();
    if (registry[fileHash]) {
      registry[fileHash].type = 'imported';
      savePosterHashRegistry(registry);
    }

    logger.info(`Downloaded and saved poster from URL`, {
      url: originalName ? `${originalName} (${url})` : url,
      filename,
      size: buffer.length,
      contentType,
    });

    return filename;
  } catch (error) {
    // Handle 401 errors specifically (poster not accessible/doesn't exist)
    if (error instanceof Error && error.message.includes('401')) {
      logger.debug(`Poster not accessible (401) for URL`, {
        url: originalName ? `${originalName} (${url})` : url,
        error: 'Poster not found or not accessible',
      });
      return null;
    }

    logger.error(`Failed to download poster from URL`, {
      url: originalName ? `${originalName} (${url})` : url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Export hash management functions for external use
 */
export { calculatePosterHash, findPosterByHash, loadPosterHashRegistry };

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

/**
 * Generate and save a poster based on collection configuration
 * @param config Configuration for poster generation
 * @param originalName Optional original name for logging
 * @returns The saved filename
 */
export async function generatePoster(
  config: PosterGenerationConfig,
  originalName?: string
): Promise<string> {
  try {
    // Always generate the poster buffer first
    const posterBuffer = await generatePosterBuffer(config);

    // Calculate hash to check for duplicates
    const posterHash = calculatePosterHash(posterBuffer);
    const existingFilename = findPosterByHash(posterHash);

    if (existingFilename) {
      logger.info('Poster content unchanged, reusing existing file', {
        config: config.collectionName,
        existingFilename,
        hash: posterHash,
      });
      return existingFilename;
    }

    // Generate a new filename based on hash instead of cache key with version
    const newFilename = `generated_${posterHash.substring(0, 8)}.jpg`;
    const newPath = path.join(POSTER_STORAGE_DIR, newFilename);

    // Save the generated poster using the hash-based filename
    const processedBuffer = await sharp(posterBuffer)
      .resize(POSTER_WIDTH, POSTER_HEIGHT, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    await fs.promises.writeFile(newPath, processedBuffer);

    // Add to hash registry
    addPosterToRegistry(posterHash, newFilename, 'generated', originalName);

    logger.info(
      `Generated and saved new poster: ${newFilename}${
        originalName ? ` (${originalName})` : ''
      }`,
      {
        collectionName: config.collectionName,
        collectionType: config.collectionType,
        size: processedBuffer.length,
        hash: posterHash.substring(0, 8),
      }
    );

    return newFilename;
  } catch (error) {
    logger.error('Failed to generate poster:', error);
    throw new Error('Failed to generate poster');
  }
}
