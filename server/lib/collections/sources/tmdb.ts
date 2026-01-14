import type PlexAPI from '@server/api/plexapi';
import TmdbAPI from '@server/api/themoviedb';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTmdbIds,
  getCollectionMediaType,
  processMissingItemsWithMode,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionSyncOptions,
  MissingItem,
  PlexCollection,
  SyncResult,
  TmdbFranchiseSourceData,
  TmdbSourceData,
  TmdbTemplateContext,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { syncCacheService } from '@server/lib/collections/services/SyncCacheService';
import { RandomListManager } from '@server/lib/collections/utils/RandomListManager';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

// TmdbSourceData interface is now imported from types.ts

/**
 * TMDB Collection Sync - Simple implementation for trending/popular/top-rated content
 */
export class TmdbCollectionSync extends BaseCollectionSync<'tmdb'> {
  private tmdbClient: TmdbAPI;
  private dynamicRandomTitle: string | null = null;

  constructor() {
    super('tmdb');
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    try {
      await this.tmdbClient.getMovieTrending({ page: 1, timeWindow: 'day' });
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'TMDB API is not accessible'
      );
    }
  }

  public async fetchSourceData(
    config: CollectionConfig,
    libraryCache?: LibraryItemsCache,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<TmdbSourceData[]> {
    const subtype = config.subtype || '';
    const statType = subtype.split('_')[0];
    const mediaType = getCollectionMediaType(config);
    const tmdbData: TmdbSourceData[] = [];

    switch (statType) {
      case 'trending': {
        const timeWindow = subtype.includes('week') ? 'week' : 'day';
        // Fetch pages in batches of 5 (100 items), check if we have enough Plex matches
        let currentPage = 1;
        let hasMorePages = true;
        const BATCH_SIZE = 5; // 5 pages = 100 items per batch

        while (hasMorePages) {
          // Fetch a batch of pages
          for (let i = 0; i < BATCH_SIZE && hasMorePages; i++) {
            if (mediaType === 'movie') {
              const data = await this.tmdbClient.getMovieTrending({
                page: currentPage,
                timeWindow,
              });

              if (!data.results || data.results.length === 0) {
                hasMorePages = false;
                break;
              }

              tmdbData.push(
                ...data.results.map((item) => ({
                  ...item,
                  media_type: 'movie' as const,
                }))
              );

              if (data.results.length < 20) {
                hasMorePages = false;
              }
            }
            if (mediaType === 'tv') {
              const data = await this.tmdbClient.getTvTrending({
                page: currentPage,
                timeWindow,
              });

              if (!data.results || data.results.length === 0) {
                hasMorePages = false;
                break;
              }

              tmdbData.push(
                ...data.results.map((item) => ({
                  ...item,
                  media_type: 'tv' as const,
                }))
              );

              if (data.results.length < 20) {
                hasMorePages = false;
              }
            }
            currentPage++;
          }

          // Check if we have enough data - stop if we have 10x maxItems (safety buffer)
          if (
            config.maxItems &&
            config.maxItems > 0 &&
            tmdbData.length >= config.maxItems * 10
          ) {
            break;
          }
        }
        break;
      }
      case 'popular': {
        // Fetch pages in batches of 5 (100 items), check if we have enough
        let currentPage = 1;
        let hasMorePages = true;
        const BATCH_SIZE = 5;

        while (hasMorePages) {
          for (let i = 0; i < BATCH_SIZE && hasMorePages; i++) {
            if (mediaType === 'movie') {
              const data = await this.tmdbClient.getDiscoverMovies({
                sortBy: 'popularity.desc',
                page: currentPage,
              });

              if (!data.results || data.results.length === 0) {
                hasMorePages = false;
                break;
              }

              tmdbData.push(
                ...data.results.map((item) => ({
                  ...item,
                  media_type: 'movie' as const,
                }))
              );

              if (data.results.length < 20) {
                hasMorePages = false;
              }
            }
            if (mediaType === 'tv') {
              const data = await this.tmdbClient.getDiscoverTv({
                sortBy: 'popularity.desc',
                page: currentPage,
              });

              if (!data.results || data.results.length === 0) {
                hasMorePages = false;
                break;
              }

              tmdbData.push(
                ...data.results.map((item) => ({
                  ...item,
                  media_type: 'tv' as const,
                }))
              );

              if (data.results.length < 20) {
                hasMorePages = false;
              }
            }
            currentPage++;
          }

          if (
            config.maxItems &&
            config.maxItems > 0 &&
            tmdbData.length >= config.maxItems * 10
          ) {
            break;
          }
        }
        break;
      }
      case 'top': {
        // Fetch pages in batches of 5 (100 items), check if we have enough
        let currentPage = 1;
        let hasMorePages = true;
        const BATCH_SIZE = 5;

        while (hasMorePages) {
          for (let i = 0; i < BATCH_SIZE && hasMorePages; i++) {
            if (mediaType === 'movie') {
              const data = await this.tmdbClient.getDiscoverMovies({
                sortBy: 'vote_average.desc',
                page: currentPage,
              });

              if (!data.results || data.results.length === 0) {
                hasMorePages = false;
                break;
              }

              tmdbData.push(
                ...data.results.map((item) => ({
                  ...item,
                  media_type: 'movie' as const,
                }))
              );

              if (data.results.length < 20) {
                hasMorePages = false;
              }
            }
            if (mediaType === 'tv') {
              const data = await this.tmdbClient.getDiscoverTv({
                sortBy: 'vote_average.desc',
                page: currentPage,
              });

              if (!data.results || data.results.length === 0) {
                hasMorePages = false;
                break;
              }

              tmdbData.push(
                ...data.results.map((item) => ({
                  ...item,
                  media_type: 'tv' as const,
                }))
              );

              if (data.results.length < 20) {
                hasMorePages = false;
              }
            }
            currentPage++;
          }

          if (
            config.maxItems &&
            config.maxItems > 0 &&
            tmdbData.length >= config.maxItems * 10
          ) {
            break;
          }
        }
        break;
      }
      case 'custom': {
        if (!config.tmdbCustomCollectionUrl) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Custom TMDB URL required'
          );
        }

        // Check if it's a collection URL
        const collectionMatch = config.tmdbCustomCollectionUrl.match(
          /themoviedb\.org\/collection\/(\d+)/
        );

        // Check if it's a list URL
        const listMatch = config.tmdbCustomCollectionUrl.match(
          /themoviedb\.org\/list\/(\d+)/
        );

        // Check if it's a network URL
        const networkMatch = config.tmdbCustomCollectionUrl.match(
          /themoviedb\.org\/network\/(\d+)/
        );

        // Check if it's a company URL (with movie or tv suffix)
        const companyMatch = config.tmdbCustomCollectionUrl.match(
          /themoviedb\.org\/company\/(\d+)(?:-[^/]+)?\/(movie|tv)/
        );

        if (collectionMatch) {
          // Handle TMDB Collection
          const collectionData = await this.tmdbClient.getCollection({
            collectionId: parseInt(collectionMatch[1], 10),
          });
          if (collectionData.parts) {
            tmdbData.push(
              ...collectionData.parts.map((item) => ({
                ...item,
                media_type: 'movie' as const,
              }))
            );
          }
        } else if (listMatch) {
          // Handle TMDB List with pagination (fetch ALL items like Trakt does)
          const listId = listMatch[1];
          let currentPage = 1;
          const allItems: TmdbSourceData[] = [];

          // Fetch ALL pages of the list (maxItems filtering happens later in applyFilteringToMappedItems)
          let hasMorePages = true;
          while (hasMorePages) {
            const listData = await this.tmdbClient.getList({
              listId,
              page: currentPage,
            });

            if (!listData.items || listData.items.length === 0) {
              hasMorePages = false;
              break; // No more items
            }

            // Add items from this page
            const normalizedItems = listData.items.map((item) => ({
              ...item,
              // Normalize media_type - lists can contain both movies and TV shows
              media_type:
                item.media_type === 'movie' || item.media_type === 'tv'
                  ? item.media_type
                  : ((item.title ? 'movie' : 'tv') as 'movie' | 'tv'),
            }));

            allItems.push(...normalizedItems);

            // Stop if this page had fewer items than expected (last page)
            if (listData.items.length < 20) {
              hasMorePages = false;
            }

            currentPage++;
          }

          tmdbData.push(...allItems);
        } else if (networkMatch) {
          // Handle TMDB Network - TV shows only
          const networkId = parseInt(networkMatch[1], 10);
          let currentPage = 1;
          let hasMorePages = true;
          const BATCH_SIZE = 5;

          while (hasMorePages) {
            for (let i = 0; i < BATCH_SIZE && hasMorePages; i++) {
              const data = await this.tmdbClient.getDiscoverTv({
                network: networkId,
                sortBy: 'popularity.desc',
                page: currentPage,
              });

              if (!data.results || data.results.length === 0) {
                hasMorePages = false;
                break;
              }

              tmdbData.push(
                ...data.results.map((item) => ({
                  ...item,
                  media_type: 'tv' as const,
                }))
              );

              if (data.results.length < 20) {
                hasMorePages = false;
              }

              currentPage++;
            }

            if (
              config.maxItems &&
              config.maxItems > 0 &&
              tmdbData.length >= config.maxItems * 10
            ) {
              break;
            }
          }
        } else if (companyMatch) {
          // Handle TMDB Company - movies or TV based on URL
          const companyId = parseInt(companyMatch[1], 10);
          const companyMediaType = companyMatch[2]; // 'movie' or 'tv'
          let currentPage = 1;
          let hasMorePages = true;
          const BATCH_SIZE = 5;

          while (hasMorePages) {
            for (let i = 0; i < BATCH_SIZE && hasMorePages; i++) {
              if (companyMediaType === 'movie') {
                const data = await this.tmdbClient.getDiscoverMovies({
                  studio: companyId.toString(),
                  sortBy: 'popularity.desc',
                  page: currentPage,
                });

                if (!data.results || data.results.length === 0) {
                  hasMorePages = false;
                  break;
                }

                tmdbData.push(
                  ...data.results.map((item) => ({
                    ...item,
                    media_type: 'movie' as const,
                  }))
                );

                if (data.results.length < 20) {
                  hasMorePages = false;
                }
              } else {
                // TV shows
                const data = await this.tmdbClient.getDiscoverTv({
                  network: companyId,
                  sortBy: 'popularity.desc',
                  page: currentPage,
                });

                if (!data.results || data.results.length === 0) {
                  hasMorePages = false;
                  break;
                }

                tmdbData.push(
                  ...data.results.map((item) => ({
                    ...item,
                    media_type: 'tv' as const,
                  }))
                );

                if (data.results.length < 20) {
                  hasMorePages = false;
                }
              }

              currentPage++;
            }

            if (
              config.maxItems &&
              config.maxItems > 0 &&
              tmdbData.length >= config.maxItems * 10
            ) {
              break;
            }
          }
        } else {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Invalid TMDB URL - must be a collection, list, network, or company URL'
          );
        }
        break;
      }
      case 'random': {
        // Get a random URL from RandomListManager with media type validation
        const mediaType = getCollectionMediaType(config);
        const randomResult = await RandomListManager.getRandomUrlWithTitle(
          'tmdb',
          9999,
          mediaType,
          libraryCache
        );
        if (!randomResult) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `No random TMDB collections available with ${mediaType} content`
          );
        }

        const { url: randomUrl, title: listTitle } = randomResult;

        // Store the dynamic title for use in generateCollectionNameWithCustom
        if (config.template === 'DYNAMIC_RANDOM_TITLE') {
          this.dynamicRandomTitle = listTitle;
          this.updateCollectionConfigField(config.id, { name: listTitle });
        }

        logger.info(`Using random TMDB collection: ${randomUrl}`, {
          label: 'TMDB Collections',
          collection: config.name,
          randomUrl,
          listTitle,
        });

        // Parse TMDB collection URL to get collection ID (same as custom)
        const urlMatch = randomUrl.match(/themoviedb\.org\/collection\/(\d+)/);
        if (!urlMatch) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `Invalid TMDB collection URL: ${randomUrl}`
          );
        }

        const collectionData = await this.tmdbClient.getCollection({
          collectionId: parseInt(urlMatch[1], 10),
        });
        if (collectionData.parts) {
          tmdbData.push(
            ...collectionData.parts.map((item) => ({
              ...item,
              media_type: 'movie' as const,
            }))
          );
        }
        break;
      }
    }

    return tmdbData;
  }

  public async mapSourceDataToItems(
    sourceData: TmdbSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ) {
    const mappedItems: CollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const tmdbLookups: {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      title: string;
      year?: number;
      originalPosition: number;
    }[] = [];
    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      const tmdbId = item.id;
      const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
      const title = item.title || item.name || 'Unknown';

      // Extract year from release_date (movies) or first_air_date (TV shows)
      let year: number | undefined;
      if (item.release_date) {
        year = parseInt(item.release_date.substring(0, 4));
      } else if (item.first_air_date) {
        year = parseInt(item.first_air_date.substring(0, 4));
      }

      tmdbLookups.push({
        tmdbId,
        mediaType,
        title,
        year,
        originalPosition: index + 1,
      });
    }

    if (tmdbLookups.length === 0) {
      const stats = this.createFilteringStats(sourceData.length, 0, {
        'invalid data': sourceData.length,
      });
      return { items: mappedItems, missingItems, stats };
    }

    // Use direct Plex queries instead of Media table
    let plexLookup: Map<
      string,
      {
        ratingKey: string;
        title: string;
        libraryKey: string;
        addedAt?: number;
        releaseDate?: number;
      }
    > = new Map();

    if (plexClient) {
      // Pass target library ID to limit search scope to only the collection's target library
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;
      plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        tmdbLookups,
        targetLibraryId,
        libraryCache, // OPTIMIZATION: Pass library cache to avoid repeated API calls
        false // Library-scoped search for collection creation
      );
    } else {
      logger.warn('No Plex client provided to mapSourceDataToItems', {
        label: 'TMDB Collections',
      });
    }

    // Process items using the Plex lookup map
    for (const lookup of tmdbLookups) {
      const key = `${lookup.tmdbId}-${lookup.mediaType}`;
      const plexItem = plexLookup.get(key);

      if (plexItem) {
        mappedItems.push({
          ratingKey: plexItem.ratingKey,
          title: lookup.title,
          type: lookup.mediaType,
          tmdbId: lookup.tmdbId,
          addedAt: plexItem.addedAt,
          releaseDate: plexItem.releaseDate,
          metadata: {
            libraryKey: plexItem.libraryKey,
            originalPosition: lookup.originalPosition, // CRITICAL: Preserve source order for multi-source interleaving
          },
        });
      } else {
        // Item exists in TMDB but not in Plex
        missingItems.push({
          tmdbId: lookup.tmdbId,
          mediaType: lookup.mediaType,
          title: lookup.title,
          year: lookup.year,
          originalPosition: lookup.originalPosition,
          source: this.source,
        });
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'invalid data': sourceData.length - tmdbLookups.length,
      }
    );

    return {
      items: mappedItems,
      missingItems,
      stats,
    };
  }

  public async generateCollectionNameWithCustom(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv',
    libraryCache?: LibraryItemsCache
  ): Promise<string> {
    // Handle DYNAMIC_RANDOM_TITLE using stored title from fetchSourceData
    if (config.template === 'DYNAMIC_RANDOM_TITLE' && this.dynamicRandomTitle) {
      return this.dynamicRandomTitle;
    }

    // Fall back to base implementation for other templates
    return super.generateCollectionNameWithCustom(
      config,
      mediaType,
      libraryCache
    );
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<TmdbTemplateContext> {
    return this.templateEngine.createTmdbContext(
      mediaType,
      config.subtype?.split('_')[0] || 'popular'
    ) as TmdbTemplateContext;
  }

  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    _options?: CollectionSyncOptions // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    // Route to franchise processing if subtype is auto_franchise
    if (config.subtype === 'auto_franchise') {
      return await this.processFranchiseCollections(
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        libraryCache
      );
    }

    const sourceData = await this.fetchSourceData(config, libraryCache);

    const mappedResult = await this.mapSourceDataToItems(
      sourceData,
      config,
      plexClient,
      libraryCache // OPTIMIZATION: Pass library cache to eliminate repeated API calls
    );
    const { items, missingItems, mappingStats, filteringStats } =
      await this.applyFilteringToMappedItems(mappedResult, config);

    // Log processing stats if available
    if (mappingStats || filteringStats) {
      logger.debug('TMDB collection processing stats', {
        label: 'TMDB Collections',
        collection: config.name,
        mappingStats,
        filteringStats,
      });
    }

    // Handle placeholder cleanup and process missing items
    const placeholderItems = await this.handlePlaceholdersAndMissingItems(
      items,
      missingItems,
      config,
      plexClient,
      libraryCache,
      missingItems && missingItems.length > 0
        ? () => this.handleAutoRequests(missingItems, config)
        : undefined
    );

    // Add placeholder items to the collection
    let finalItems = items;
    if (placeholderItems.length > 0) {
      finalItems = [...items, ...placeholderItems];
    }

    if (finalItems.length === 0) return { created: 0, updated: 0 };

    // Use the new media type processing strategy
    return await this.processWithMediaTypeStrategy(
      finalItems,
      config,
      plexClient,
      allCollections,
      processedCollectionKeys,
      undefined, // userInfo
      libraryCache,
      missingItems
    );
  }

  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ) {
    // Use the new standardized approach via BaseCollectionSync
    const result = await this.createOrUpdateCollectionStandardized(
      items,
      collectionName,
      mediaType,
      config,
      plexClient,
      allCollections,
      processedCollectionKeys
    );

    return result;
  }

  /**
   * Process franchise collections (1 config = many collections pattern)
   * Discovers all franchises in the library and creates a collection for each
   */
  private async processFranchiseCollections(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache
  ): Promise<SyncResult> {
    logger.info('Starting TMDB Auto Franchise Collections discovery', {
      label: 'TMDB Franchise',
      configId: config.id,
      library: config.libraryId,
    });

    // 1. Get all movies from target library via libraryCache
    const libraryMovies = await this.getLibraryMovies(
      config.libraryId,
      libraryCache,
      plexClient
    );

    if (libraryMovies.length === 0) {
      logger.warn('No movies found in library for franchise discovery', {
        label: 'TMDB Franchise',
        libraryId: config.libraryId,
      });
      return { created: 0, updated: 0 };
    }

    logger.debug(`Found ${libraryMovies.length} movies in library`, {
      label: 'TMDB Franchise',
    });

    // 2. Extract TMDB IDs from Plex library items
    const tmdbIds = this.extractTmdbIdsFromLibrary(libraryMovies);

    if (tmdbIds.length === 0) {
      logger.warn('No TMDB IDs found in library movies', {
        label: 'TMDB Franchise',
      });
      return { created: 0, updated: 0 };
    }

    logger.debug(`Extracted ${tmdbIds.length} TMDB IDs from library`, {
      label: 'TMDB Franchise',
    });

    // 3. Fetch TMDB movie details and extract franchise info
    const franchiseMap = await this.discoverFranchises(tmdbIds);

    logger.info(`Discovered ${franchiseMap.size} unique franchises`, {
      label: 'TMDB Franchise',
    });

    // 4. Filter franchises (min 2 movies in library)
    const validFranchises = this.filterFranchisesByMinItems(franchiseMap, 2);

    logger.info(
      `${validFranchises.size} franchises have 2+ movies in library`,
      {
        label: 'TMDB Franchise',
      }
    );

    if (validFranchises.size === 0) {
      logger.info('No franchises with 2+ movies found', {
        label: 'TMDB Franchise',
      });
      return { created: 0, updated: 0 };
    }

    // 5. Create Plex collection for each franchise
    let created = 0;
    let updated = 0;

    for (const [franchiseId, franchiseData] of validFranchises) {
      try {
        const result = await this.processSingleFranchise(
          franchiseData,
          config,
          plexClient,
          allCollections,
          processedCollectionKeys,
          libraryCache
        );
        created += result.created;
        updated += result.updated;
      } catch (error) {
        logger.error(
          `Error processing franchise ${franchiseData.franchiseName} (ID: ${franchiseId})`,
          {
            label: 'TMDB Franchise',
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    logger.info(
      `TMDB Auto Franchise Collections complete: ${created} created, ${updated} updated`,
      {
        label: 'TMDB Franchise',
      }
    );

    return { created, updated };
  }

  /**
   * Get all movies from the specified library
   */
  private async getLibraryMovies(
    libraryId: string,
    libraryCache: LibraryItemsCache | undefined,
    plexClient: PlexAPI
  ): Promise<CollectionItem[]> {
    if (libraryCache && libraryCache[libraryId]) {
      // Use cache if available - convert cached items to CollectionItem format
      // Note: No need to filter by type as library is already movie-specific
      const cachedLibrary = libraryCache[libraryId];
      return cachedLibrary.map((item) => ({
        ratingKey: item.ratingKey,
        title: item.title,
        type: 'movie' as const,
        tmdbId: this.extractTmdbIdFromGuid(item.Guid),
      }));
    }

    // Fetch from Plex if cache not available
    const library = await plexClient.getLibraryContents(libraryId);
    const movies = library.items
      .filter((item) => item.type === 'movie')
      .map((item) => ({
        ratingKey: item.ratingKey,
        title: item.title,
        type: 'movie' as const,
        year: item.year,
        tmdbId: this.extractTmdbIdFromGuid(item.Guid),
      }));

    return movies;
  }

  /**
   * Extract TMDB ID from Plex GUID array
   */
  private extractTmdbIdFromGuid(
    guids: { id: string }[] | undefined
  ): number | undefined {
    if (!guids || guids.length === 0) return undefined;

    for (const guid of guids) {
      if (guid.id.startsWith('tmdb://')) {
        const tmdbId = parseInt(guid.id.replace('tmdb://', ''), 10);
        if (!isNaN(tmdbId)) {
          return tmdbId;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract TMDB IDs from library items
   */
  private extractTmdbIdsFromLibrary(libraryMovies: CollectionItem[]): number[] {
    const tmdbIds: number[] = [];

    for (const movie of libraryMovies) {
      if (movie.tmdbId) {
        tmdbIds.push(movie.tmdbId);
      }
    }

    return tmdbIds;
  }

  /**
   * Discover franchises by fetching TMDB movie details
   * Uses caching to minimize API calls (48h TTL)
   */
  private async discoverFranchises(
    tmdbIds: number[]
  ): Promise<Map<number, TmdbFranchiseSourceData>> {
    const franchiseMap = new Map<number, TmdbFranchiseSourceData>();
    const processedTmdbIds = new Set<number>(); // Track which movies we've already handled
    let cacheHits = 0;
    let movieApiCalls = 0;
    let collectionApiCalls = 0;

    for (const tmdbId of tmdbIds) {
      // Skip if we've already processed this movie (from a franchise collection fetch)
      if (processedTmdbIds.has(tmdbId)) {
        continue;
      }

      try {
        // Check cache first (48h TTL)
        let movieDetails = syncCacheService.getTmdbMovieDetails(tmdbId);

        if (movieDetails) {
          cacheHits++;
        } else {
          // Fetch from TMDB API
          movieDetails = await this.tmdbClient.getMovie({ movieId: tmdbId });
          movieApiCalls++;

          // Cache the result with 48h TTL
          syncCacheService.setTmdbMovieDetails(tmdbId, movieDetails);
        }

        // Mark this movie as processed
        processedTmdbIds.add(tmdbId);

        // If this movie belongs to a franchise, fetch the entire collection immediately
        if (
          movieDetails.belongs_to_collection &&
          movieDetails.belongs_to_collection.id
        ) {
          const franchiseId = movieDetails.belongs_to_collection.id;

          // Skip if we've already fetched this franchise
          if (franchiseMap.has(franchiseId)) {
            continue;
          }

          // Fetch the complete collection (includes all movies in correct order)
          const collectionData = await this.tmdbClient.getCollection({
            collectionId: franchiseId,
          });
          collectionApiCalls++;

          // Extract movies from collection (already sorted by TMDB)
          const movies =
            collectionData.parts?.map((part) => ({
              tmdbId: part.id,
              title: part.title || 'Unknown',
              releaseDate: part.release_date,
            })) || [];

          // Mark all movies in this franchise as processed to avoid redundant API calls
          for (const movie of movies) {
            processedTmdbIds.add(movie.tmdbId);
          }

          franchiseMap.set(franchiseId, {
            franchiseId,
            franchiseName: collectionData.name,
            franchisePosterPath: collectionData.poster_path,
            franchiseBackdropPath: collectionData.backdrop_path,
            movies, // Already in TMDB's order (release order)
          });

          logger.debug(
            `Fetched franchise "${collectionData.name}" with ${movies.length} movies, marked ${movies.length} movie IDs as processed`,
            {
              label: 'TMDB Franchise',
              franchiseId,
            }
          );
        }
      } catch (error) {
        logger.warn(`Error processing TMDB movie ID ${tmdbId}`, {
          label: 'TMDB Franchise',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info(
      `TMDB franchise discovery complete: ${movieApiCalls} movie API calls, ${collectionApiCalls} collection API calls (${
        tmdbIds.length - processedTmdbIds.size
      } movies skipped)`,
      {
        label: 'TMDB Franchise',
        totalMovies: tmdbIds.length,
        processedMovies: processedTmdbIds.size,
        skippedMovies: tmdbIds.length - processedTmdbIds.size,
        cacheHits,
      }
    );

    return franchiseMap;
  }

  /**
   * Filter franchises to only include those with minimum number of movies
   */
  private filterFranchisesByMinItems(
    franchiseMap: Map<number, TmdbFranchiseSourceData>,
    minItems: number
  ): Map<number, TmdbFranchiseSourceData> {
    const filtered = new Map<number, TmdbFranchiseSourceData>();

    for (const [franchiseId, franchiseData] of franchiseMap) {
      if (franchiseData.movies.length >= minItems) {
        filtered.set(franchiseId, franchiseData);
      }
    }

    return filtered;
  }

  /**
   * Process a single franchise collection
   */
  private async processSingleFranchise(
    franchiseData: TmdbFranchiseSourceData,
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache
  ): Promise<SyncResult> {
    // Generate collection name using template engine
    const context = this.templateEngine.createFranchiseContext(franchiseData);

    // Handle custom template selection - franchise collections are movie-only
    const template = (() => {
      if (config.template === 'custom') {
        return config.customMovieTemplate || config.name || '{franchiseName}';
      }
      return config.template || '{franchiseName}';
    })();

    const collectionName = await this.templateEngine.processTemplate(
      template,
      context
    );

    // Create label for tracking auto-managed franchise collections
    // Format: AgregarrAutoFranchise-{configId}-{franchiseId}
    // This allows us to distinguish auto-managed from manually-created collections
    const customLabel = `AgregarrAutoFranchise-${config.id}-${franchiseData.franchiseId}`;

    logger.debug(`Processing franchise: ${collectionName}`, {
      label: 'TMDB Franchise',
      franchiseId: franchiseData.franchiseId,
      movieCount: franchiseData.movies.length,
      customLabel,
    });

    // Map franchise movies to Plex items
    const plexItems = await this.findPlexItemsForFranchise(
      franchiseData,
      config.libraryId,
      plexClient,
      libraryCache
    );

    if (plexItems.length < 2) {
      logger.debug(
        `Franchise ${collectionName} has fewer than 2 items in Plex library, skipping`,
        {
          label: 'TMDB Franchise',
          foundItems: plexItems.length,
        }
      );
      return { created: 0, updated: 0 };
    }

    logger.debug(
      `Found ${plexItems.length} Plex items for franchise ${collectionName}`,
      {
        label: 'TMDB Franchise',
      }
    );

    // Identify missing movies from the franchise
    const plexTmdbIds = new Set(plexItems.map((item) => item.tmdbId));
    const missingItems: MissingItem[] = [];

    for (let index = 0; index < franchiseData.movies.length; index++) {
      const movie = franchiseData.movies[index];
      if (!plexTmdbIds.has(movie.tmdbId)) {
        // Extract year from release date (format: YYYY-MM-DD)
        let year: number | undefined;
        if (movie.releaseDate) {
          year = parseInt(movie.releaseDate.substring(0, 4));
        }

        missingItems.push({
          tmdbId: movie.tmdbId,
          mediaType: 'movie',
          title: movie.title,
          year,
          originalPosition: index + 1,
          source: this.source,
        });
      }
    }

    if (missingItems.length > 0) {
      logger.info(
        `Franchise ${collectionName}: ${missingItems.length} missing movies identified`,
        {
          label: 'TMDB Franchise',
          foundInPlex: plexItems.length,
          missingCount: missingItems.length,
          totalFranchiseMovies: franchiseData.movies.length,
        }
      );
    }

    // Handle placeholder cleanup and process missing items
    const placeholderItems = await this.handlePlaceholdersAndMissingItems(
      plexItems,
      missingItems,
      config,
      plexClient,
      libraryCache,
      missingItems.length > 0
        ? () => this.handleAutoRequests(missingItems, config)
        : undefined
    );

    // Combine Plex items with any placeholder items
    let finalItems = plexItems;
    if (placeholderItems.length > 0) {
      finalItems = [...plexItems, ...placeholderItems];
      logger.debug(
        `Added ${placeholderItems.length} placeholder items to franchise ${collectionName}`,
        {
          label: 'TMDB Franchise',
          plexItems: plexItems.length,
          placeholderItems: placeholderItems.length,
          total: finalItems.length,
        }
      );
    }

    // Check if we should skip auto-poster generation
    // Only skip if useTmdbFranchisePoster is enabled AND the poster is actually available
    const shouldSkipAutoPoster =
      config.useTmdbFranchisePoster && !!franchiseData.franchisePosterPath;

    const configForProcessing = shouldSkipAutoPoster
      ? { ...config, autoPoster: false }
      : config;

    // Create or update collection with custom label for tracking
    // Label-based tracking is the primary method (like Overseerr),
    // with name as fallback for user-created collections
    const result = await this.createOrUpdateCollectionStandardized(
      finalItems,
      collectionName,
      'movie',
      configForProcessing,
      plexClient,
      allCollections,
      processedCollectionKeys,
      {
        customLabel, // Enables findExistingCollection() to track by label
      },
      missingItems // Enable Quick Sync for franchise collections
    );

    // Handle poster upload and collection mode
    const collectionRatingKey = result.collectionRatingKey;
    if (collectionRatingKey) {
      // Set collection mode if hideIndividualItems is enabled
      if (config.hideIndividualItems) {
        try {
          await plexClient.updateCollectionMode(collectionRatingKey, 1);
          logger.debug(
            `Set collectionMode=1 (hide items) for franchise: ${collectionName}`,
            {
              label: 'TMDB Franchise',
              collectionRatingKey,
            }
          );
        } catch (error) {
          logger.warn(
            `Failed to set collection mode for ${collectionName}, continuing`,
            {
              label: 'TMDB Franchise',
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      // Try to use TMDB franchise poster if enabled
      if (config.useTmdbFranchisePoster) {
        let tmdbPosterSuccess = false;

        if (franchiseData.franchisePosterPath) {
          try {
            const tmdbPosterUrl = `https://image.tmdb.org/t/p/original${franchiseData.franchisePosterPath}`;
            const posterManager = plexClient['posterManager'];

            logger.debug(
              `Uploading TMDB franchise poster for ${collectionName}`,
              {
                label: 'TMDB Franchise',
                tmdbPosterUrl,
                collectionRatingKey,
              }
            );

            await posterManager.uploadPosterFromUrl(
              collectionRatingKey,
              tmdbPosterUrl
            );
            await posterManager.lockPoster(collectionRatingKey);

            logger.info(
              `Successfully uploaded TMDB franchise poster for ${collectionName}`,
              {
                label: 'TMDB Franchise',
              }
            );
            tmdbPosterSuccess = true;
          } catch (error) {
            logger.error(
              `Error uploading TMDB franchise poster for ${collectionName}, will fallback to auto-poster`,
              {
                label: 'TMDB Franchise',
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        } else {
          logger.warn(
            `No TMDB franchise poster available for ${collectionName}, will fallback to auto-poster`,
            {
              label: 'TMDB Franchise',
              franchiseId: franchiseData.franchiseId,
            }
          );
        }

        // Fallback to auto-poster if TMDB poster failed or unavailable
        if (!tmdbPosterSuccess) {
          try {
            await this.generateAutoPoster(
              collectionName,
              config,
              collectionRatingKey,
              plexClient,
              finalItems,
              { customLabel }
            );
          } catch (error) {
            logger.error(
              `Error generating fallback auto-poster for ${collectionName}`,
              {
                label: 'TMDB Franchise',
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }
      // Use auto-poster by default if useTmdbFranchisePoster is not enabled
      // (This is already handled by createOrUpdateCollectionStandardized based on autoPoster config)
    }

    return result;
  }

  /**
   * Find Plex items for a franchise using TMDB IDs
   */
  private async findPlexItemsForFranchise(
    franchiseData: TmdbFranchiseSourceData,
    libraryId: string,
    plexClient: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<CollectionItem[]> {
    // Build TMDB lookup array
    const tmdbLookups = franchiseData.movies.map((movie) => ({
      tmdbId: movie.tmdbId,
      mediaType: 'movie' as const,
      title: movie.title,
    }));

    // Use existing utility to find Plex items by TMDB IDs
    const matchedItems = await findPlexItemsByTmdbIds(
      plexClient,
      tmdbLookups,
      libraryId,
      libraryCache,
      false
    );

    // Convert to CollectionItem array, preserving TMDB franchise order
    // CRITICAL: We must maintain the order from franchiseData.movies (release order)
    const items: CollectionItem[] = [];
    for (const movie of franchiseData.movies) {
      const key = `${movie.tmdbId}-movie`;
      const plexItem = matchedItems.get(key);

      if (plexItem) {
        items.push({
          ratingKey: plexItem.ratingKey,
          title: plexItem.title,
          type: 'movie',
          tmdbId: movie.tmdbId,
          addedAt: plexItem.addedAt,
          releaseDate: plexItem.releaseDate,
        });
      }
    }

    return items;
  }

  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the unified download service (routes to Overseerr or direct *arr based on config)
    await processMissingItemsWithMode(missingItems, config, 'tmdb');
  }
}

export default TmdbCollectionSync;
