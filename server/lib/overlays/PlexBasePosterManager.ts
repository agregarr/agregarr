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

/**
 * Simple file storage manager for base posters used in overlay application
 * All tracking is done via MediaItemMetadata database - NO JSON registry
 */
class PlexBasePosterManager {
  /**
   * Initialize base poster storage directory
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(BASE_POSTERS_DIR, { recursive: true });
      logger.info('Initialized base poster storage', {
        label: 'PlexBasePosterManager',
        directory: BASE_POSTERS_DIR,
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
   * Check if base poster has changed WITHOUT downloading it
   * Returns true if poster needs to be re-downloaded (URL changed or source switched)
   * Much faster than full download - only makes lightweight API calls
   */
  async hasBasePosterChanged(
    plexApi: PlexAPI,
    item: PlexLibraryItem,
    posterSource: 'tmdb' | 'plex',
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
      const TheMovieDb = (await import('@server/api/themoviedb')).default;
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

      // Get TMDB poster URL (lightweight - no download)
      const language = getTmdbLanguage();
      const tmdbClient = new TheMovieDb();

      let posterUrl: string | undefined;

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
            : undefined;
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
            : undefined;
        }
      }

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
    configuredLibraryType: 'movie' | 'show',
    posterSource: 'tmdb' | 'plex',
    metadata: {
      basePosterSource?: 'tmdb' | 'plex';
      originalPlexPosterUrl?: string;
      ourOverlayPosterUrl?: string;
      basePosterFilename?: string;
    }
  ): Promise<{
    posterBuffer: Buffer;
    basePosterChanged: boolean;
    sourceUrl: string;
    filename: string;
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
      };
    } else {
      // ===== TMDB SOURCE =====
      const TheMovieDb = (await import('@server/api/themoviedb')).default;
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

      // Log TMDB fetch details for debugging wrong poster issues
      logger.info('Fetching TMDB poster', {
        label: 'PlexBasePosterManager',
        itemTitle: item.title,
        ratingKey: item.ratingKey,
        itemType: item.type,
        tmdbId,
        mediaType,
        endpoint: mediaType === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`,
      });

      // Get TMDB poster URL (lightweight - no download yet)
      const language = getTmdbLanguage();
      const tmdbClient = new TheMovieDb();

      let posterUrl: string | undefined;

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
            : undefined;
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
            : undefined;
        }
      }

      if (!posterUrl) {
        throw new Error('No TMDB poster available');
      }

      // Check if TMDB URL changed (for deduplication)
      // We don't cache TMDB posters - always download fresh
      const tmdbUrlChanged = metadata.originalPlexPosterUrl !== posterUrl;

      // ALWAYS download fresh from TMDB (no caching)
      logger.info('Downloading TMDB poster', {
        label: 'PlexBasePosterManager',
        libraryId,
        ratingKey: item.ratingKey,
        tmdbUrl: posterUrl,
        urlChanged: tmdbUrlChanged,
      });

      const posterBuffer = await this.downloadFromTMDB(posterUrl);

      return {
        posterBuffer,
        basePosterChanged: tmdbUrlChanged, // Only changed if URL is different
        sourceUrl: posterUrl,
        filename: '', // NO LOCAL CACHE for TMDB
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
      const currentRatingKeys = new Set<string>();

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
