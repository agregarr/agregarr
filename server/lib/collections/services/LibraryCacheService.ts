import type PlexAPI from '@server/api/plexapi';
import {
  prefetchAllLibraryItems,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import logger from '@server/logger';

/**
 * Centralized Library Cache Service
 *
 * Provides a shared cache for library items across all sync operations.
 * Prevents multiple memory-intensive cache loads and improves performance.
 */
class LibraryCacheService {
  private cache: LibraryItemsCache | null = null;
  private cacheTimestamp = 0;
  private isLoading = false;
  private loadingPromise: Promise<LibraryItemsCache> | null = null;

  // Cache TTL: 5 minutes - only refreshes when services actually request it
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  /**
   * Get library cache, loading it if necessary
   * Multiple concurrent calls will share the same loading promise
   */
  public async getCache(plexClient: PlexAPI): Promise<LibraryItemsCache> {
    const now = Date.now();

    // If cache is fresh, return it immediately
    if (this.cache && now - this.cacheTimestamp < this.CACHE_TTL) {
      logger.debug('Using fresh library cache', {
        label: 'Library Cache Service',
        libraries: Object.keys(this.cache).length,
      });
      return this.cache;
    }

    // If already loading, wait for existing load to complete
    if (this.isLoading && this.loadingPromise) {
      logger.debug('Waiting for in-progress cache load', {
        label: 'Library Cache Service',
      });
      return this.loadingPromise;
    }

    // Start new cache load
    this.isLoading = true;
    this.loadingPromise = this.loadCache(plexClient);

    try {
      this.cache = await this.loadingPromise;
      this.cacheTimestamp = now;

      logger.info('Library cache loaded successfully', {
        label: 'Library Cache Service',
        libraries: Object.keys(this.cache).length,
      });

      return this.cache;
    } finally {
      this.isLoading = false;
      this.loadingPromise = null;
    }
  }

  /**
   * Clear the cache (for memory cleanup)
   */
  public clearCache(): void {
    if (this.cache) {
      const libraries = Object.keys(this.cache).length;
      this.cache = null;
      this.cacheTimestamp = 0;

      logger.info('Library cache cleared', {
        label: 'Library Cache Service',
        clearedLibraries: libraries,
      });
    }
  }

  /**
   * Get cache status for debugging
   */
  public getStatus(): {
    hasCached: boolean;
    isLoading: boolean;
    libraryCount: number;
  } {
    return {
      hasCached: !!this.cache,
      isLoading: this.isLoading,
      libraryCount: this.cache ? Object.keys(this.cache).length : 0,
    };
  }

  /**
   * Load cache from Plex API
   */
  private async loadCache(plexClient: PlexAPI): Promise<LibraryItemsCache> {
    logger.info('Loading library cache from Plex API', {
      label: 'Library Cache Service',
    });

    const cache = await prefetchAllLibraryItems(plexClient);

    logger.info('Library cache load completed', {
      label: 'Library Cache Service',
      libraries: Object.keys(cache).length,
    });

    return cache;
  }
}

// Export singleton instance
export const libraryCacheService = new LibraryCacheService();
export default libraryCacheService;
