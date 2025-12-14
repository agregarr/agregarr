import { getRepository } from '@server/datasource';
import { CollectionMetadata } from '@server/entity/CollectionMetadata';
import logger from '@server/logger';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  generatePosterBuffer,
  type PosterGenerationConfig,
} from './posterGeneration';

const POSTER_STORAGE_DIR = path.join(process.cwd(), 'config', 'posters');
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const POSTER_WIDTH = 1000; // Standard poster width
const POSTER_HEIGHT = 1500; // Standard poster height (2:3 ratio)

/**
 * Sanitize a string for use as a filename
 * Removes/replaces characters that are unsafe for filenames
 */
function sanitizeFilename(name: string): string {
  return (
    name
      // Replace path separators and other unsafe characters
      .replace(/[/\\:*?"<>|]/g, '_')
      // Replace multiple spaces/underscores with single underscore
      .replace(/[\s_]+/g, '_')
      // Remove leading/trailing underscores and dots
      .replace(/^[._]+|[._]+$/g, '')
      // Limit length to 100 characters (leaving room for extension and suffix)
      .substring(0, 100)
  );
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

  // Allow valid poster filenames:
  // - Friendly names: any safe characters + extension
  // - Legacy UUID format
  // - Generated patterns (for auto-generated posters)
  const friendlyPattern = /^[a-zA-Z0-9_\-\s.()]+\.(jpg|jpeg|png|webp)$/i;
  const uuidPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|jpeg|png|webp)$/i;
  const generatedPattern = /^generated_[a-z0-9]+\.(jpg|jpeg|png|webp)$/i;
  const tempGeneratedPattern =
    /^temp_generated_[a-z0-9]+\.(jpg|jpeg|png|webp)$/i;

  return (
    friendlyPattern.test(filename) ||
    uuidPattern.test(filename) ||
    generatedPattern.test(filename) ||
    tempGeneratedPattern.test(filename)
  );
}

interface LegacyPosterHashEntry {
  uploadedAt: string;
  type: 'plex-poster' | 'auto-generated-poster';
  isActive: boolean;
  filename?: string;
  originalName?: string;
  plexUrl?: string;
  collectionIdentifier?: string;
}

interface LegacyPosterHashRegistry {
  [hash: string]: LegacyPosterHashEntry;
}

/**
 * Migrate poster-hashes.json data to database
 * Creates CollectionMetadata records with posterLocalPath
 * Other fields will be populated naturally when collection services run
 */
async function migratePosterHashesToDatabase(): Promise<void> {
  const legacyHashFile = path.join(POSTER_STORAGE_DIR, 'poster-hashes.json');

  if (!fs.existsSync(legacyHashFile)) {
    return; // Already migrated or no file to migrate
  }

  try {
    const hashData: LegacyPosterHashRegistry = JSON.parse(
      fs.readFileSync(legacyHashFile, 'utf8')
    );
    const repo = getRepository(CollectionMetadata);
    let createdCount = 0;
    let updatedCount = 0;

    for (const [, entry] of Object.entries(hashData)) {
      // Only migrate active plex-poster entries that have a filename
      // isActive: true means this is the current poster for the collection
      if (
        entry.type !== 'plex-poster' ||
        !entry.filename ||
        !entry.plexUrl ||
        !entry.isActive
      ) {
        continue;
      }

      // Extract rating key from plexUrl (e.g., http://.../library/metadata/3593/thumb/...)
      const ratingKeyMatch = entry.plexUrl.match(/\/metadata\/(\d+)\//);
      if (!ratingKeyMatch) {
        continue;
      }

      const ratingKey = ratingKeyMatch[1];
      let metadata = await repo.findOne({
        where: { plexCollectionRatingKey: ratingKey },
      });

      if (metadata) {
        // Record exists - update if no posterLocalPath set
        if (!metadata.posterLocalPath) {
          metadata.posterLocalPath = entry.filename;
          await repo.save(metadata);
          updatedCount++;
          logger.debug('Updated existing metadata with poster path', {
            label: 'Poster Migration',
            ratingKey,
            filename: entry.filename,
          });
        }
      } else {
        // Record doesn't exist - create new one
        // Other fields will be populated when collection services run
        metadata = new CollectionMetadata({
          plexCollectionRatingKey: ratingKey,
          posterLocalPath: entry.filename,
        });
        await repo.save(metadata);
        createdCount++;
        logger.debug('Created new metadata record with poster path', {
          label: 'Poster Migration',
          ratingKey,
          filename: entry.filename,
        });
      }
    }

    if (createdCount > 0 || updatedCount > 0) {
      logger.info(
        `Poster migration complete: ${createdCount} created, ${updatedCount} updated`,
        { label: 'Poster Migration' }
      );
    }

    // Delete the file after successful migration
    fs.unlinkSync(legacyHashFile);
    logger.info(
      'Removed legacy poster-hashes.json file (migrated to database)',
      {
        label: 'Poster Migration',
      }
    );
  } catch (error) {
    logger.error('Failed to migrate poster-hashes.json to database:', error);
    // Don't throw - allow app to continue even if migration fails
  }
}

/**
 * Initialize poster storage directory
 */
export async function initializePosterStorage(): Promise<void> {
  try {
    if (!fs.existsSync(POSTER_STORAGE_DIR)) {
      fs.mkdirSync(POSTER_STORAGE_DIR, { recursive: true });
      logger.info(`Created poster storage directory: ${POSTER_STORAGE_DIR}`);
    }

    // Migrate legacy poster-hashes.json to database before deletion
    await migratePosterHashesToDatabase();
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

  // Generate friendly filename from originalName if provided, otherwise use UUID
  let baseFilename: string;
  if (originalName) {
    // Sanitize the original name for filesystem safety
    baseFilename = sanitizeFilename(originalName);
    // If sanitization resulted in empty string, fall back to UUID
    if (!baseFilename) {
      baseFilename = randomUUID();
    }
  } else {
    baseFilename = randomUUID();
  }

  const filename = `${baseFilename}.${fileExtension}`;
  const filePath = path.join(POSTER_STORAGE_DIR, filename);

  // Check for filename collision and add suffix if needed
  let finalFilename = filename;
  let finalFilePath = filePath;
  let counter = 1;
  while (fs.existsSync(finalFilePath)) {
    finalFilename = `${baseFilename}_${counter}.${fileExtension}`;
    finalFilePath = path.join(POSTER_STORAGE_DIR, finalFilename);
    counter++;
  }

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
    await fs.promises.writeFile(finalFilePath, processedBuffer);

    logger.info(
      `Saved poster file: ${finalFilename}${
        originalName ? ` (from: ${originalName})` : ''
      }`
    );
    return finalFilename;
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
 * Check which collections are using a specific poster file
 * Returns array of collections using the poster
 */
export async function getPosterUsage(filename: string): Promise<
  {
    type: 'collection' | 'preExisting';
    id: string;
    name: string;
    libraryName: string;
  }[]
> {
  const { getSettings } = await import('@server/lib/settings');
  const settings = getSettings();
  const usedBy: {
    type: 'collection' | 'preExisting';
    id: string;
    name: string;
    libraryName: string;
  }[] = [];

  // Check user-created collection configs
  const collectionConfigs = settings.plex.collectionConfigs || [];
  for (const config of collectionConfigs) {
    // Check both single poster and per-library poster formats
    const usesThisPoster =
      config.customPoster === filename ||
      (typeof config.customPoster === 'object' &&
        Object.values(config.customPoster).includes(filename));

    if (usesThisPoster) {
      usedBy.push({
        type: 'collection',
        id: config.id,
        name: config.name,
        libraryName: config.libraryName || 'Unknown Library',
      });
    }
  }

  // Check pre-existing collection configs
  const preExistingConfigs = settings.plex.preExistingCollectionConfigs || [];
  for (const config of preExistingConfigs) {
    if (config.customPoster === filename) {
      usedBy.push({
        type: 'preExisting',
        id: config.id,
        name: config.name,
        libraryName: config.libraryName || 'Unknown Library',
      });
    }
  }

  return usedBy;
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

    // Save the poster
    const filename = await savePosterFile(buffer, contentType, originalName);

    logger.info(`Downloaded and saved poster from URL`, {
      url: originalName ? `${originalName} (${url})` : url,
      filename,
      size: buffer.length,
      contentType,
    });

    return filename;
  } catch (error) {
    logger.error('Failed to download poster from URL', {
      url: originalName ? `${originalName} (${url})` : url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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

/**
 * Generate and save a temporary poster based on collection configuration
 * The temp file is created in system temp directory and will be deleted after upload to Plex
 * @param config Configuration for poster generation
 * @param originalName Optional original name for logging
 * @param collectionIdentifier Collection identifier for logging only
 * @returns The full path to the temporary file
 */
export async function generatePoster(
  config: PosterGenerationConfig,
  originalName?: string,
  collectionIdentifier?: string
): Promise<string> {
  logger.debug('generatePoster called with:', {
    templateId: config.autoPosterTemplate,
    collectionName: config.collectionName,
    originalName,
    collectionIdentifier,
  });

  try {
    // Generate the poster buffer
    const posterBuffer = await generatePosterBuffer(config);

    // Create temporary file in system temp directory (NOT in config/posters/)
    // This ensures auto-generated posters never appear in the posters list
    const tempFilename = `agregarr_poster_${randomUUID()}_${Date.now()}.jpg`;
    const tempPath = path.join(os.tmpdir(), tempFilename);

    // Save temporarily for upload to Plex
    const processedBuffer = await sharp(posterBuffer)
      .resize(POSTER_WIDTH, POSTER_HEIGHT, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    await fs.promises.writeFile(tempPath, processedBuffer);

    logger.info(
      `Generated temporary poster in system temp for upload: ${tempFilename}${
        originalName ? ` (${originalName})` : ''
      }`,
      {
        collectionName: config.collectionName,
        collectionType: config.collectionType,
        size: processedBuffer.length,
        tempPath,
      }
    );

    return tempPath; // Return full path since it's in system temp
  } catch (error) {
    logger.error('Failed to generate poster:', error);
    throw new Error('Failed to generate poster');
  }
}

/**
 * Complete the auto-generated poster workflow after upload to Plex
 * Downloads the poster back from Plex to get the recompressed version,
 * stores only the hash registry entry (no file), and cleans up the temporary file.
 */
export async function completeAutoGeneratedPosterWorkflow(
  tempFilename: string,
  plexPosterUrl: string,
  collectionIdentifier?: string,
  originalName?: string
): Promise<void> {
  try {
    const tempPath = path.join(POSTER_STORAGE_DIR, tempFilename);

    // Metadata tracking is handled by MetadataTrackingService in BaseCollectionSync
    // This function just cleans up the temporary file

    if (
      await fs.promises
        .access(tempPath)
        .then(() => true)
        .catch(() => false)
    ) {
      await fs.promises.unlink(tempPath);
      logger.info(`Cleaned up temporary poster file: ${tempFilename}`);
    }

    logger.info('Completed auto-generated poster workflow', {
      originalName,
      collectionIdentifier,
      plexUrl: plexPosterUrl,
    });
  } catch (error) {
    logger.error('Failed to complete auto-generated poster workflow:', error);
  }
}
