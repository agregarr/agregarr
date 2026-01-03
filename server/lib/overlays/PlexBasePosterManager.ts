import type PlexAPI from '@server/api/plexapi';
import type { PlexLibraryItem } from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const BASE_POSTERS_DIR = path.join(
  process.cwd(),
  'config',
  'plex-base-posters'
);

const TMDB_POSTER_CACHE_DIR = path.join(
  process.cwd(),
  'config',
  'tmdb-poster-cache'
);

// TMDB poster cache TTL: 7 days
const TMDB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Simple file storage manager for base posters used in overlay application
 * All tracking is done via MediaItemMetadata database - NO JSON registry
 */
class PlexBasePosterManager {
  // Per-job cache for TMDB poster URLs (avoids repeated API calls within a single overlay run)
  // Key format: `${tmdbId}-${mediaType}-${language}`
  // Stores Promises to handle concurrent requests (request coalescing)
  // Uses null to indicate "no poster available" (negative caching)
  private tmdbUrlCache: Map<string, Promise<string | null>> = new Map();

  /**
   * Clear the per-job TMDB URL cache
   * Call this at the start of each overlay job
   */
  clearTmdbUrlCache(): void {
    const size = this.tmdbUrlCache.size;
    this.tmdbUrlCache.clear();
    if (size > 0) {
      logger.debug('Cleared TMDB URL cache', {
        label: 'PlexBasePosterManager',
        previousSize: size,
      });
    }
  }

  /**
   * Get TMDB poster URL with per-job caching
   * Avoids repeated API calls for the same item within a single overlay run
   * Uses Promise caching to handle concurrent requests (request coalescing)
   * Caches null for items without posters (negative caching)
   */
  private async getTmdbPosterUrl(
    tmdbId: number,
    mediaType: 'movie' | 'show',
    language: string
  ): Promise<string | undefined> {
    const cacheKey = `${tmdbId}-${mediaType}-${language}`;

    // Check cache first - returns Promise to handle concurrent requests
    const cachedPromise = this.tmdbUrlCache.get(cacheKey);
    if (cachedPromise) {
      logger.debug('TMDB URL cache hit', {
        label: 'PlexBasePosterManager',
        tmdbId,
        mediaType,
        language,
      });
      const result = await cachedPromise;
      return result ?? undefined; // Convert null back to undefined
    }

    // Cache miss - create Promise for TMDB API call
    // Store Promise immediately to coalesce concurrent requests
    // Wrap with error handling to remove failed entries from cache
    const fetchPromise = this.fetchTmdbPosterUrl(
      tmdbId,
      mediaType,
      language
    ).catch((error: unknown) => {
      // Remove failed entry so future calls can retry
      this.tmdbUrlCache.delete(cacheKey);
      throw error;
    });

    this.tmdbUrlCache.set(cacheKey, fetchPromise);

    logger.debug('TMDB URL cache miss - fetching', {
      label: 'PlexBasePosterManager',
      tmdbId,
      mediaType,
      language,
      cacheSize: this.tmdbUrlCache.size,
    });

    const result = await fetchPromise;
    return result ?? undefined; // Convert null back to undefined
  }

  /**
   * Fetch TMDB poster URL from API (internal helper)
   * Returns null if no poster available (for negative caching)
   */
  private async fetchTmdbPosterUrl(
    tmdbId: number,
    mediaType: 'movie' | 'show',
    language: string
  ): Promise<string | null> {
    const TheMovieDb = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TheMovieDb();

    let posterUrl: string | null = null;

    try {
      if (mediaType === 'movie') {
        const images = await tmdbClient.getMovieImages({
          movieId: tmdbId,
          language,
        });

        const poster = images.posters.find((p) => p.iso_639_1 === language);

        if (poster) {
          posterUrl = `https://image.tmdb.org/t/p/original${poster.file_path}`;
        } else {
          // Fallback to main poster from movie details
          const movie = await tmdbClient.getMovie({ movieId: tmdbId });
          posterUrl = movie.poster_path
            ? `https://image.tmdb.org/t/p/original${movie.poster_path}`
            : null;
        }
      } else {
        const images = await tmdbClient.getTvShowImages({
          tvId: tmdbId,
          language,
        });

        const poster = images.posters.find((p) => p.iso_639_1 === language);

        if (poster) {
          posterUrl = `https://image.tmdb.org/t/p/original${poster.file_path}`;
        } else {
          // Fallback to main poster from TV show details
          const tvShow = await tmdbClient.getTvShow({ tvId: tmdbId });
          posterUrl = tvShow.poster_path
            ? `https://image.tmdb.org/t/p/original${tvShow.poster_path}`
            : null;
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch TMDB poster URL', {
        label: 'PlexBasePosterManager',
        tmdbId,
        mediaType,
        language,
        error: error instanceof Error ? error.message : String(error),
      });
      // Return null to cache the failure (negative caching)
      return null;
    }

    return posterUrl;
  }

  /**
   * Initialize base poster storage directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(BASE_POSTERS_DIR, { recursive: true });
      await fs.mkdir(TMDB_POSTER_CACHE_DIR, { recursive: true });
      logger.info('Initialized base poster storage', {
        label: 'PlexBasePosterManager',
        directory: BASE_POSTERS_DIR,
        tmdbCacheDirectory: TMDB_POSTER_CACHE_DIR,
      });
    } catch (error) {
      logger.error('Failed to initialize base poster storage', {
        label: 'PlexBasePosterManager',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Extract cache filename from TMDB poster URL
   * TMDB URLs have clean filenames that are filesystem-safe (e.g., /abc123.jpg)
   */
  private getTmdbCacheFilename(posterUrl: string): string {
    // Extract the file path from URL (e.g., /abc123.jpg from https://image.tmdb.org/t/p/original/abc123.jpg)
    const urlPath = new URL(posterUrl).pathname;
    const filename = path.basename(urlPath);
    return filename;
  }

  /**
   * Get cached TMDB poster if valid (exists and not expired)
   */
  private async getTmdbCachedPoster(posterUrl: string): Promise<Buffer | null> {
    const filename = this.getTmdbCacheFilename(posterUrl);
    const cachePath = path.join(TMDB_POSTER_CACHE_DIR, filename);

    try {
      const stats = await fs.stat(cachePath);
      const age = Date.now() - stats.mtimeMs;

      if (age > TMDB_CACHE_TTL_MS) {
        logger.debug('TMDB poster cache expired', {
          label: 'PlexBasePosterManager',
          filename,
          ageHours: Math.round(age / (60 * 60 * 1000)),
        });
        // Delete expired file to free disk space
        try {
          await fs.unlink(cachePath);
        } catch {
          // Ignore deletion errors
        }
        return null;
      }

      const buffer = await fs.readFile(cachePath);
      logger.debug('TMDB poster cache hit', {
        label: 'PlexBasePosterManager',
        filename,
        ageHours: Math.round(age / (60 * 60 * 1000)),
      });
      return buffer;
    } catch (error) {
      // File doesn't exist is expected - only log unexpected errors
      if (error instanceof Error && !error.message.includes('ENOENT')) {
        logger.debug('TMDB poster cache read error', {
          label: 'PlexBasePosterManager',
          filename,
          error: error.message,
        });
      }
      return null;
    }
  }

  /**
   * Clean up TMDB cache files
   * - If caching is enabled: Deletes expired files (7-day TTL)
   * - If caching is disabled: Deletes ALL cached files to free disk space
   * Call this periodically or at job start
   */
  async cleanTmdbCache(): Promise<{ deleted: number; errors: number }> {
    const settings = getSettings();
    const cacheEnabled = settings.main.enableTmdbPosterCache ?? true;

    let deleted = 0;
    let errors = 0;

    try {
      const files = await fs.readdir(TMDB_POSTER_CACHE_DIR);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(TMDB_POSTER_CACHE_DIR, file);
        try {
          if (cacheEnabled) {
            // Cache enabled - only delete expired files
            const stats = await fs.stat(filePath);
            if (now - stats.mtimeMs > TMDB_CACHE_TTL_MS) {
              await fs.unlink(filePath);
              deleted++;
            }
          } else {
            // Cache disabled - delete ALL files to free disk space
            await fs.unlink(filePath);
            deleted++;
          }
        } catch {
          errors++;
        }
      }

      if (deleted > 0) {
        logger.info(
          cacheEnabled
            ? 'Cleaned expired TMDB poster cache files'
            : 'Cleared all TMDB poster cache files (caching disabled)',
          {
            label: 'PlexBasePosterManager',
            deleted,
            errors,
            cacheEnabled,
          }
        );
      }
    } catch (error) {
      logger.warn('Failed to clean TMDB cache', {
        label: 'PlexBasePosterManager',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { deleted, errors };
  }

  /**
   * Store TMDB poster in cache
   */
  private async storeTmdbCachedPoster(
    posterUrl: string,
    buffer: Buffer
  ): Promise<void> {
    const filename = this.getTmdbCacheFilename(posterUrl);
    const cachePath = path.join(TMDB_POSTER_CACHE_DIR, filename);

    try {
      await fs.writeFile(cachePath, buffer);
      logger.debug('Stored TMDB poster in cache', {
        label: 'PlexBasePosterManager',
        filename,
        size: buffer.length,
      });
    } catch (error) {
      logger.warn('Failed to cache TMDB poster', {
        label: 'PlexBasePosterManager',
        filename,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generate base poster filename (single current version per item)
   */
  private generateFilename(libraryId: string, ratingKey: string): string {
    return `${libraryId}_${ratingKey}.jpg`;
  }

  /**
   * Get file path for base poster
   */
  private getFilePath(libraryId: string, ratingKey: string): string {
    const filename = this.generateFilename(libraryId, ratingKey);
    return path.join(BASE_POSTERS_DIR, filename);
  }

  /**
   * Convert upload:// URL to downloadable path
   */
  private async convertUploadUrlToPath(
    plexApi: PlexAPI,
    uploadUrl: string,
    ratingKey: string
  ): Promise<string> {
    // If it's already a path, return it
    if (uploadUrl.startsWith('/')) {
      return uploadUrl;
    }

    // If it's upload://posters/{id}, convert to /library/metadata/{ratingKey}/thumb/{id}
    if (uploadUrl.startsWith('upload://posters/')) {
      const uploadId = uploadUrl.replace('upload://posters/', '');
      return `/library/metadata/${ratingKey}/thumb/${uploadId}`;
    }

    // Unknown format - try to get fresh metadata
    logger.warn('Unknown poster URL format, fetching fresh metadata', {
      label: 'PlexBasePosterManager',
      uploadUrl,
      ratingKey,
    });

    const metadata = await plexApi.getMetadata(ratingKey);
    const thumb = (metadata as { thumb?: string }).thumb;
    if (thumb && thumb.startsWith('/')) {
      return thumb;
    }

    throw new Error(`Cannot convert poster URL: ${uploadUrl}`);
  }

  /**
   * Download poster from Plex
   */
  private async downloadFromPlex(
    plexApi: PlexAPI,
    thumbUrl: string,
    ratingKey?: string
  ): Promise<Buffer> {
    let downloadPath = thumbUrl;

    // Convert upload:// URLs to downloadable paths
    if (thumbUrl.startsWith('upload://') && ratingKey) {
      downloadPath = await this.convertUploadUrlToPath(
        plexApi,
        thumbUrl,
        ratingKey
      );
    }

    let fullUrl: string;

    // If thumbUrl is already a full URL (starts with http:// or https://), use it directly
    if (
      downloadPath.startsWith('http://') ||
      downloadPath.startsWith('https://')
    ) {
      fullUrl = downloadPath;
    } else {
      // Otherwise, build full URL from relative path
      const settings = getSettings();
      const baseUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
        settings.plex.ip
      }:${settings.plex.port}`;

      // Build full URL with token
      fullUrl = `${baseUrl}${downloadPath}?X-Plex-Token=${plexApi['plexToken']}`;
    }

    const response = await axios.get(fullUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    return Buffer.from(response.data);
  }

  /**
   * Download poster from TMDB
   */
  private async downloadFromTMDB(tmdbUrl: string): Promise<Buffer> {
    const response = await axios.get(tmdbUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    return Buffer.from(response.data);
  }

  /**
   * Store base poster (overwrites existing)
   */
  async storeBasePoster(
    posterBuffer: Buffer,
    libraryId: string,
    ratingKey: string
  ): Promise<string> {
    const filepath = this.getFilePath(libraryId, ratingKey);
    const filename = this.generateFilename(libraryId, ratingKey);

    await fs.writeFile(filepath, posterBuffer);

    logger.debug('Stored base poster', {
      label: 'PlexBasePosterManager',
      libraryId,
      ratingKey,
      filename,
    });

    return filename;
  }

  /**
   * Get stored base poster
   */
  async getStoredBasePoster(
    libraryId: string,
    ratingKey: string
  ): Promise<Buffer | null> {
    const filepath = this.getFilePath(libraryId, ratingKey);

    try {
      return await fs.readFile(filepath);
    } catch (error) {
      logger.debug('Stored base poster file not found', {
        label: 'PlexBasePosterManager',
        libraryId,
        ratingKey,
      });
      return null;
    }
  }

  /**
   * Build folder path for local poster storage
   * Format: /config/plex-base-posters/{libraryName}-{libraryId}/{title} ({year}) tmdb-{tmdbId}/
   */
  private async buildLocalPosterPath(
    libraryId: string,
    libraryName: string,
    itemTitle: string,
    itemYear: number | undefined,
    tmdbId: number
  ): Promise<string> {
    const { sanitizeForFilename } = await import(
      '@server/utils/fileSystemHelpers'
    );

    // Sanitize components
    const safeName = sanitizeForFilename(libraryName);
    const safeTitle = sanitizeForFilename(itemTitle);

    // Build folder name
    const yearPart = itemYear ? ` (${itemYear})` : '';
    const folderName = `${safeTitle}${yearPart} tmdb-${tmdbId}`;

    return path.join(BASE_POSTERS_DIR, `${safeName}-${libraryId}`, folderName);
  }

  /**
   * Scan for local poster file and check if it changed
   * Returns poster buffer if found and valid, null if missing/invalid
   * Also returns whether the file changed since last check
   * Automatically creates folder if it doesn't exist
   */
  private async scanLocalPoster(
    localPosterPath: string,
    previousModTime: number | undefined
  ): Promise<{
    posterBuffer: Buffer | null;
    fileModTime: number | null;
    fileChanged: boolean;
  }> {
    const { findImageFile, getFileModTime, validateImageFile } = await import(
      '@server/utils/fileSystemHelpers'
    );

    // Automatically create folder if it doesn't exist
    try {
      await fs.access(localPosterPath);
    } catch {
      // Folder doesn't exist, create it
      try {
        await fs.mkdir(localPosterPath, { recursive: true });
        logger.debug('Auto-created local poster folder', {
          label: 'PlexBasePosterManager',
          folderPath: localPosterPath,
        });
      } catch (error) {
        logger.warn('Failed to auto-create local poster folder', {
          label: 'PlexBasePosterManager',
          folderPath: localPosterPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Find image file in directory
    const imageFilePath = await findImageFile(localPosterPath);

    if (!imageFilePath) {
      logger.debug('No local poster file found', {
        label: 'PlexBasePosterManager',
        searchPath: localPosterPath,
      });
      return { posterBuffer: null, fileModTime: null, fileChanged: false };
    }

    // Validate image file
    const isValid = await validateImageFile(imageFilePath);
    if (!isValid) {
      logger.warn('Local poster file invalid or unreadable', {
        label: 'PlexBasePosterManager',
        filePath: imageFilePath,
      });
      return { posterBuffer: null, fileModTime: null, fileChanged: false };
    }

    // Get file modification time
    const fileModTime = await getFileModTime(imageFilePath);

    // Check if file changed
    const fileChanged = !previousModTime || previousModTime !== fileModTime;

    // Read file
    const posterBuffer = await fs.readFile(imageFilePath);

    logger.info('Found local poster file', {
      label: 'PlexBasePosterManager',
      filePath: imageFilePath,
      fileSize: posterBuffer.length,
      fileModTime,
      fileChanged,
    });

    return { posterBuffer, fileModTime, fileChanged };
  }

  /**
   * Check if base poster has changed WITHOUT downloading it
   * Returns true if poster needs to be re-downloaded (URL changed or source switched)
   * Much faster than full download - only makes lightweight API calls
   */
  async hasBasePosterChanged(
    plexApi: PlexAPI,
    item: PlexLibraryItem,
    posterSource: 'tmdb' | 'plex',
    libraryId: string,
    metadata: {
      basePosterSource?: 'tmdb' | 'plex';
      originalPlexPosterUrl?: string;
    }
  ): Promise<boolean> {
    // Check if source switched (TMDB ↔ Plex)
    if (
      metadata.basePosterSource &&
      metadata.basePosterSource !== posterSource
    ) {
      return true; // Source changed - need new poster
    }

    // First time - no metadata
    if (!metadata.basePosterSource) {
      return true;
    }

    if (posterSource === 'plex') {
      // ===== PLEX SOURCE =====
      const currentPlexPosterUrl = await plexApi.getCurrentPosterUrl(
        item.ratingKey
      );

      if (!currentPlexPosterUrl) {
        throw new Error('Item has no poster in Plex');
      }

      // Check if current URL is different from what we stored
      const urlChanged =
        currentPlexPosterUrl !== metadata.originalPlexPosterUrl;
      return urlChanged;
    } else {
      // ===== TMDB SOURCE =====
      const { getTmdbLanguage } = await import('@server/lib/settings');

      // Extract TMDB ID
      let tmdbId: number | undefined;
      if (item.Guid) {
        const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
        if (tmdbGuid) {
          const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
          if (match) {
            tmdbId = parseInt(match[1]);
          }
        }
      }

      if (!tmdbId) {
        throw new Error('No TMDB ID found for item');
      }

      // Determine media type from item.type
      const mediaType: 'movie' | 'show' =
        item.type === 'movie' ? 'movie' : 'show';

      // Get TMDB poster URL using cached lookup
      const language = await getTmdbLanguage(libraryId);
      const posterUrl = await this.getTmdbPosterUrl(
        tmdbId,
        mediaType,
        language
      );

      if (!posterUrl) {
        throw new Error('No TMDB poster available');
      }

      // Check if TMDB URL changed
      const tmdbUrlChanged = metadata.originalPlexPosterUrl !== posterUrl;
      return tmdbUrlChanged;
    }
  }

  /**
   * Get base poster for overlay application
   * Handles both TMDB and Plex sources with proper change detection
   * ALL tracking is done via MediaItemMetadata database passed in
   *
   * CRITICAL: Uses item.type to determine media type for TMDB API calls
   * This prevents fetching wrong posters due to TMDB's separate ID namespaces
   */
  async getBasePosterForOverlay(
    plexApi: PlexAPI,
    item: PlexLibraryItem,
    libraryId: string,
    libraryName: string,
    configuredLibraryType: 'movie' | 'show',
    posterSource: 'tmdb' | 'plex' | 'local',
    metadata: {
      basePosterSource?: 'tmdb' | 'plex' | 'local';
      originalPlexPosterUrl?: string;
      ourOverlayPosterUrl?: string;
      basePosterFilename?: string;
      localPosterModifiedTime?: number;
    },
    tmdbId?: number
  ): Promise<{
    posterBuffer: Buffer;
    basePosterChanged: boolean;
    sourceUrl: string;
    filename: string;
    fileModTime?: number | null;
  }> {
    // CRITICAL FIX: Use item.type from Plex API, not library config type!
    // - item.type comes from Plex's metadata and is authoritative
    // - TMDB has separate ID namespaces for movies vs TV shows (same ID = different items!)
    // - Using wrong type fetches completely different media item's poster
    // - Example: Movie ID 1421 ≠ TV Show ID 1421 in TMDB
    const mediaType: 'movie' | 'show' =
      item.type === 'movie' ? 'movie' : 'show';

    // Warn if library config doesn't match item type
    if (mediaType !== configuredLibraryType) {
      logger.warn('Media type mismatch between item and library config', {
        label: 'PlexBasePosterManager',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        itemType: item.type,
        libraryConfigType: configuredLibraryType,
        usingType: mediaType,
      });
    }

    if (posterSource === 'local') {
      // ===== LOCAL SOURCE =====

      // Validate required parameters
      if (!tmdbId) {
        throw new Error('TMDB ID required for local poster source');
      }

      // Build local poster path
      const localPosterPath = await this.buildLocalPosterPath(
        libraryId,
        libraryName,
        item.title,
        item.year,
        tmdbId
      );

      // Check if source switched from different source
      const switchedFromDifferentSource =
        metadata.basePosterSource && metadata.basePosterSource !== 'local';
      const firstTime = !metadata.basePosterSource;

      // Scan for local poster
      const localPosterResult = await this.scanLocalPoster(
        localPosterPath,
        metadata.localPosterModifiedTime
      );

      if (localPosterResult.posterBuffer) {
        // Local poster found
        return {
          posterBuffer: localPosterResult.posterBuffer,
          basePosterChanged:
            localPosterResult.fileChanged ||
            switchedFromDifferentSource ||
            firstTime,
          sourceUrl: `local://${localPosterPath}`, // Custom URL scheme for tracking
          filename: '', // No caching for local posters
          fileModTime: localPosterResult.fileModTime,
        };
      }

      // No local poster found - fallback to TMDB
      logger.info('No local poster found, falling back to TMDB', {
        label: 'PlexBasePosterManager',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        localPosterPath,
      });

      // Fall through to TMDB logic below (change posterSource temporarily)
      posterSource = 'tmdb';
    }

    if (posterSource === 'plex') {
      // ===== PLEX SOURCE =====
      const currentPlexPosterUrl = await plexApi.getCurrentPosterUrl(
        item.ratingKey
      );

      if (!currentPlexPosterUrl) {
        throw new Error('Item has no poster in Plex');
      }

      // Check if we switched from a different source (e.g., TMDB → Plex) OR first time
      const switchedFromDifferentSource =
        metadata.basePosterSource && metadata.basePosterSource !== 'plex';
      const firstTime = !metadata.basePosterSource;

      if (switchedFromDifferentSource || firstTime) {
        // Source switched or first time - try to use cached poster from bulk download
        const cachedPoster = await this.getStoredBasePoster(
          libraryId,
          item.ratingKey
        );
        if (cachedPoster) {
          logger.info('Using cached Plex poster', {
            label: 'PlexBasePosterManager',
            libraryId,
            ratingKey: item.ratingKey,
            reason: firstTime ? 'first_time' : 'source_switch',
            previousSource: metadata.basePosterSource || 'none',
            currentSource: 'plex',
          });

          return {
            posterBuffer: cachedPoster,
            basePosterChanged: true, // Force TRUE - source changed or first time
            sourceUrl: currentPlexPosterUrl,
            filename: this.generateFilename(libraryId, item.ratingKey),
            fileModTime: undefined,
          };
        }
        // No cache - fall through to download
      }

      // Check if poster changed using normalized URL comparison
      const { posterUrlsMatch } = await import(
        '@server/utils/posterUrlHelpers'
      );

      if (posterUrlsMatch(currentPlexPosterUrl, metadata.ourOverlayPosterUrl)) {
        // Plex still has our overlaid poster - use cached base
        const cachedPoster = await this.getStoredBasePoster(
          libraryId,
          item.ratingKey
        );
        if (cachedPoster) {
          return {
            posterBuffer: cachedPoster,
            basePosterChanged: false,
            sourceUrl: metadata.originalPlexPosterUrl || currentPlexPosterUrl,
            filename: metadata.basePosterFilename || '',
            fileModTime: undefined,
          };
        }
        // Cache missing but current poster is our overlay - DON'T download it as base!
        throw new Error(
          'Cannot use overlaid poster as base - cache missing. Please re-download base posters.'
        );
      }

      if (
        posterUrlsMatch(currentPlexPosterUrl, metadata.originalPlexPosterUrl)
      ) {
        // Plex reverted to original - use cached base
        const cachedPoster = await this.getStoredBasePoster(
          libraryId,
          item.ratingKey
        );
        if (cachedPoster) {
          return {
            posterBuffer: cachedPoster,
            basePosterChanged: false,
            sourceUrl: metadata.originalPlexPosterUrl || currentPlexPosterUrl,
            filename: metadata.basePosterFilename || '',
            fileModTime: undefined,
          };
        }
        // Cache missing but we can safely re-download the original
        logger.warn('Cache missing, re-downloading original poster from Plex', {
          label: 'PlexBasePosterManager',
          libraryId,
          ratingKey: item.ratingKey,
        });
      }

      // Current URL is different - user uploaded new poster or first time
      logger.info('Downloading new Plex base poster', {
        label: 'PlexBasePosterManager',
        libraryId,
        ratingKey: item.ratingKey,
        currentUrl: currentPlexPosterUrl,
        previousUrl: metadata.originalPlexPosterUrl,
      });

      const posterBuffer = await this.downloadFromPlex(
        plexApi,
        currentPlexPosterUrl,
        item.ratingKey
      );
      const filename = await this.storeBasePoster(
        posterBuffer,
        libraryId,
        item.ratingKey
      );

      return {
        posterBuffer,
        basePosterChanged: true,
        sourceUrl: currentPlexPosterUrl,
        filename,
        fileModTime: undefined,
      };
    } else {
      // ===== TMDB SOURCE =====
      const { getTmdbLanguage } = await import('@server/lib/settings');

      // Use passed tmdbId if available, otherwise extract from item
      let resolvedTmdbId = tmdbId;
      if (!resolvedTmdbId && item.Guid) {
        const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
        if (tmdbGuid) {
          const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
          if (match) {
            resolvedTmdbId = parseInt(match[1]);
          }
        }
      }

      if (!resolvedTmdbId) {
        throw new Error('No TMDB ID found for item');
      }

      // Log TMDB fetch details for debugging wrong poster issues
      logger.debug('Fetching TMDB poster', {
        label: 'PlexBasePosterManager',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        itemType: item.type,
        tmdbId: resolvedTmdbId,
        mediaType,
        endpoint:
          mediaType === 'movie'
            ? `/movie/${resolvedTmdbId}`
            : `/tv/${resolvedTmdbId}`,
      });

      // Get TMDB poster URL using cached lookup
      const language = await getTmdbLanguage(libraryId);
      const posterUrl = await this.getTmdbPosterUrl(
        resolvedTmdbId,
        mediaType,
        language
      );

      if (!posterUrl) {
        throw new Error('No TMDB poster available');
      }

      // Check if TMDB URL changed (for deduplication)
      const tmdbUrlChanged = metadata.originalPlexPosterUrl !== posterUrl;

      // Check if file caching is enabled (defaults to true)
      const settings = getSettings();
      const cacheEnabled = settings.main.enableTmdbPosterCache ?? true;

      let posterBuffer: Buffer;

      if (cacheEnabled) {
        // Try to get from cache first (7-day TTL)
        const cachedPoster = await this.getTmdbCachedPoster(posterUrl);

        if (cachedPoster) {
          logger.debug('Using cached TMDB poster', {
            label: 'PlexBasePosterManager',
            libraryId,
            ratingKey: item.ratingKey,
            tmdbUrl: posterUrl,
            urlChanged: tmdbUrlChanged,
          });
          posterBuffer = cachedPoster;
        } else {
          // Cache miss - download from TMDB
          logger.info('Downloading TMDB poster (cache miss)', {
            label: 'PlexBasePosterManager',
            libraryId,
            ratingKey: item.ratingKey,
            tmdbUrl: posterUrl,
            urlChanged: tmdbUrlChanged,
          });

          posterBuffer = await this.downloadFromTMDB(posterUrl);

          // Store in cache for future use
          await this.storeTmdbCachedPoster(posterUrl, posterBuffer);
        }
      } else {
        // Cache disabled - always download fresh from TMDB
        logger.debug('Downloading TMDB poster (cache disabled)', {
          label: 'PlexBasePosterManager',
          libraryId,
          ratingKey: item.ratingKey,
          tmdbUrl: posterUrl,
        });

        posterBuffer = await this.downloadFromTMDB(posterUrl);
      }

      return {
        posterBuffer,
        basePosterChanged: tmdbUrlChanged, // Only changed if URL is different
        sourceUrl: posterUrl,
        filename: this.getTmdbCacheFilename(posterUrl), // Now we cache TMDB posters
        fileModTime: undefined,
      };
    }
  }

  /**
   * Download all base posters for a library (initial setup for Plex source)
   */
  async downloadAllBasePosterForLibrary(
    plexApi: PlexAPI,
    libraryId: string,
    onProgress?: (current: number, total: number, failed: number) => void
  ): Promise<{ success: number; failed: number }> {
    logger.info('Starting bulk base poster download', {
      label: 'PlexBasePosterManager',
      libraryId,
    });

    // Fetch all items in library
    let allItems: { ratingKey: string; title: string; thumb?: string }[] = [];
    let offset = 0;
    const pageSize = 50;
    let hasMore = true;

    while (hasMore) {
      const response = await plexApi.getLibraryContents(libraryId, {
        offset,
        size: pageSize,
      });

      allItems = allItems.concat(response.items);

      if (offset + pageSize >= response.totalSize) {
        hasMore = false;
      }
      offset += pageSize;
    }

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];

      try {
        if (!item.thumb) {
          logger.debug('Item has no poster, skipping', {
            label: 'PlexBasePosterManager',
            title: item.title,
            ratingKey: item.ratingKey,
          });
          failedCount++;
          continue;
        }

        const posterBuffer = await this.downloadFromPlex(
          plexApi,
          item.thumb,
          item.ratingKey
        );
        await this.storeBasePoster(posterBuffer, libraryId, item.ratingKey);

        successCount++;
      } catch (error) {
        logger.error('Failed to download base poster', {
          label: 'PlexBasePosterManager',
          title: item.title,
          ratingKey: item.ratingKey,
          error: error instanceof Error ? error.message : String(error),
        });
        failedCount++;
      }

      if (onProgress) {
        onProgress(i + 1, allItems.length, failedCount);
      }
    }

    logger.info('Completed bulk base poster download', {
      label: 'PlexBasePosterManager',
      libraryId,
      successCount,
      failedCount,
    });

    return { success: successCount, failed: failedCount };
  }

  /**
   * Move orphaned posters to orphaned subfolder
   * Called during bulk download to clean up old files from Plex Dance
   */
  async moveOrphanedPosters(
    plexApi: PlexAPI,
    libraryIds: string[]
  ): Promise<number> {
    try {
      const orphanedDir = path.join(BASE_POSTERS_DIR, 'orphaned');
      await fs.mkdir(orphanedDir, { recursive: true });

      // Get all current rating keys from Plex for configured libraries
      const currentRatingKeys = new Set();

      for (const libraryId of libraryIds) {
        let offset = 0;
        const pageSize = 50;
        let hasMore = true;

        while (hasMore) {
          const response = await plexApi.getLibraryContents(libraryId, {
            offset,
            size: pageSize,
          });

          for (const item of response.items) {
            currentRatingKeys.add(`${libraryId}_${item.ratingKey}`);
          }

          if (offset + pageSize >= response.totalSize) {
            hasMore = false;
          }
          offset += pageSize;
        }
      }

      // Check all poster files
      const files = await fs.readdir(BASE_POSTERS_DIR);
      let movedCount = 0;

      for (const file of files) {
        // Skip non-poster files and orphaned directory
        if (
          file === 'orphaned' ||
          file === '.mapping.json' ||
          file.startsWith('.')
        ) {
          continue;
        }

        // Parse filename: {libraryId}_{ratingKey}.{ext}
        const match = file.match(/^(\d+_\d+)\.(jpg|jpeg|png|webp)$/);
        if (!match) {
          continue;
        }

        const fileKey = match[1]; // e.g., "1_12345"

        // Check if this rating key still exists
        if (!currentRatingKeys.has(fileKey)) {
          // Orphaned - move to subfolder
          const oldPath = path.join(BASE_POSTERS_DIR, file);
          const newPath = path.join(orphanedDir, file);

          await fs.rename(oldPath, newPath);
          movedCount++;

          logger.debug('Moved orphaned poster', {
            label: 'PlexBasePosterManager',
            file,
            from: oldPath,
            to: newPath,
          });
        }
      }

      return movedCount;
    } catch (error) {
      logger.error('Failed to move orphaned posters', {
        label: 'PlexBasePosterManager',
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}

export const plexBasePosterManager = new PlexBasePosterManager();
