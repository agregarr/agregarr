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
  TmdbSourceData,
  TmdbTemplateContext,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import { RandomListManager } from '@server/lib/collections/utils/RandomListManager';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

// TmdbSourceData interface is now imported from types.ts

/**
 * TMDB Collection Sync - Simple implementation for trending/popular/top-rated content
 */
export class TmdbCollectionSync extends BaseCollectionSync {
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
      { ratingKey: string; title: string; libraryKey: string }
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
          metadata: {
            libraryKey: plexItem.libraryKey,
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
    const sourceData = await this.fetchSourceData(config, libraryCache);
    const mappedResult = await this.mapSourceDataToItems(
      sourceData,
      config,
      plexClient,
      libraryCache // OPTIMIZATION: Pass library cache to eliminate repeated API calls
    );
    const { items, missingItems, mappingStats, filteringStats } =
      this.applyFilteringToMappedItems(mappedResult, config);

    // Log processing stats if available
    if (mappingStats || filteringStats) {
      logger.debug('TMDB collection processing stats', {
        label: 'TMDB Collections',
        collection: config.name,
        mappingStats,
        filteringStats,
      });
    }

    // Process missing items - creates placeholders and/or sends to auto-requests
    let finalItems = items;
    if (missingItems && missingItems.length > 0) {
      const placeholderItems = await this.processMissingItems(
        missingItems,
        config,
        plexClient,
        () => this.handleAutoRequests(missingItems, config)
      );
      if (placeholderItems.length > 0) {
        finalItems = [...items, ...placeholderItems];
      }
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
      libraryCache
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

  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    // Use the unified download service (routes to Overseerr or direct *arr based on config)
    await processMissingItemsWithMode(missingItems, config, 'tmdb');
  }
}

export default TmdbCollectionSync;
