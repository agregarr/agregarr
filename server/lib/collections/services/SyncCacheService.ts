import type { OverseerrMediaRequest } from '@server/api/overseerr';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';

/**
 * Centralized cache service for sharing data across sync operations
 * Eliminates repeated API calls during sync by pre-fetching and caching data
 */
export class SyncCacheService {
  private static instance: SyncCacheService;

  private overseerrRequestsCache: OverseerrMediaRequest[] = [];
  private libraryItemsCache: LibraryItemsCache = {};
  private isInitialized = false;

  public static getInstance(): SyncCacheService {
    if (!SyncCacheService.instance) {
      SyncCacheService.instance = new SyncCacheService();
    }
    return SyncCacheService.instance;
  }

  /**
   * Initialize the cache with pre-fetched data
   */
  public initialize(
    overseerrRequests: OverseerrMediaRequest[],
    libraryItems: LibraryItemsCache
  ): void {
    this.overseerrRequestsCache = overseerrRequests;
    this.libraryItemsCache = libraryItems;
    this.isInitialized = true;
  }

  /**
   * Clear all cached data
   */
  public clear(): void {
    this.overseerrRequestsCache = [];
    this.libraryItemsCache = {};
    this.isInitialized = false;
  }

  /**
   * Get cached Overseerr requests
   */
  public getOverseerrRequests(): OverseerrMediaRequest[] {
    return this.overseerrRequestsCache;
  }

  /**
   * Get cached library items
   */
  public getLibraryItems(): LibraryItemsCache {
    return this.libraryItemsCache;
  }

  /**
   * Check if cache is initialized
   */
  public getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get cache status for logging
   */
  public getCacheStatus(): {
    requestsCount: number;
    librariesCount: number;
    isInitialized: boolean;
  } {
    return {
      requestsCount: this.overseerrRequestsCache.length,
      librariesCount: Object.keys(this.libraryItemsCache).length,
      isInitialized: this.isInitialized,
    };
  }
}

// Export singleton instance
export const syncCacheService = SyncCacheService.getInstance();
