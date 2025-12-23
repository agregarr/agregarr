import type { OverseerrMediaRequest } from '@server/api/overseerr';
import type { TmdbMovieDetails } from '@server/api/themoviedb/interfaces';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import type {
  DiscoveredMoviePlaceholder,
  DiscoveredPlaceholder,
} from '@server/lib/placeholders/services/PlaceholderDiscovery';

interface CacheEntry<T> {
  data: T;
  expires: number;
}

/**
 * Centralized cache service for sharing data across sync operations
 * Eliminates repeated API calls during sync by pre-fetching and caching data
 */
export class SyncCacheService {
  private static instance: SyncCacheService;

  private overseerrRequestsCache: OverseerrMediaRequest[] = [];
  private libraryItemsCache: LibraryItemsCache = {};
  private tmdbFranchiseCache: Map<number, CacheEntry<TmdbMovieDetails>> =
    new Map();
  private placeholderDiscoveryCacheTv: DiscoveredPlaceholder[] = [];
  private placeholderDiscoveryCacheMovies: DiscoveredMoviePlaceholder[] = [];
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
   * Initialize placeholder discovery cache
   */
  public setPlaceholderDiscoveryCache(
    tv: DiscoveredPlaceholder[],
    movies: DiscoveredMoviePlaceholder[]
  ): void {
    this.placeholderDiscoveryCacheTv = tv;
    this.placeholderDiscoveryCacheMovies = movies;
  }

  /**
   * Get cached TV placeholder discoveries
   */
  public getPlaceholderDiscoveryCacheTv(): DiscoveredPlaceholder[] {
    return this.placeholderDiscoveryCacheTv;
  }

  /**
   * Get cached movie placeholder discoveries
   */
  public getPlaceholderDiscoveryCacheMovies(): DiscoveredMoviePlaceholder[] {
    return this.placeholderDiscoveryCacheMovies;
  }

  /**
   * Clear all cached data
   */
  public clear(): void {
    this.overseerrRequestsCache = [];
    this.libraryItemsCache = {};
    this.tmdbFranchiseCache.clear();
    this.placeholderDiscoveryCacheTv = [];
    this.placeholderDiscoveryCacheMovies = [];
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

  /**
   * Get TMDB movie details from cache
   * @param tmdbId TMDB movie ID
   * @returns Cached movie details if valid, null if not cached or expired
   */
  public getTmdbMovieDetails(tmdbId: number): TmdbMovieDetails | null {
    const cached = this.tmdbFranchiseCache.get(tmdbId);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    // Clean up expired entry
    if (cached) {
      this.tmdbFranchiseCache.delete(tmdbId);
    }
    return null;
  }

  /**
   * Cache TMDB movie details with TTL
   * @param tmdbId TMDB movie ID
   * @param data Movie details to cache
   * @param ttlMs Time to live in milliseconds (default: 48 hours)
   */
  public setTmdbMovieDetails(
    tmdbId: number,
    data: TmdbMovieDetails,
    ttlMs: number = 48 * 60 * 60 * 1000 // 48 hours default
  ): void {
    this.tmdbFranchiseCache.set(tmdbId, {
      data,
      expires: Date.now() + ttlMs,
    });
  }

  /**
   * Clear expired TMDB cache entries
   */
  public cleanExpiredTmdbCache(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [tmdbId, entry] of this.tmdbFranchiseCache) {
      if (entry.expires <= now) {
        this.tmdbFranchiseCache.delete(tmdbId);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Export singleton instance
export const syncCacheService = SyncCacheService.getInstance();
