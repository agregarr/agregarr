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
 * TMDb Collection Sync - Simple implementation for trending/popular/top-rated content
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
        'TMDb API is not accessible'
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
        if (mediaType === 'movie') {
          const data = await this.tmdbClient.getMovieTrending({
            page: 1,
            timeWindow,
          });
          tmdbData.push(
            ...data.results.map((item) => ({
              ...item,
              media_type: 'movie' as const,
            }))
          );
        }
        if (mediaType === 'tv') {
          const data = await this.tmdbClient.getTvTrending({
            page: 1,
            timeWindow,
          });
          tmdbData.push(
            ...data.results.map((item) => ({
              ...item,
              media_type: 'tv' as const,
            }))
          );
        }
        break;
      }
      case 'popular': {
        if (mediaType === 'movie') {
          const data = await this.tmdbClient.getDiscoverMovies({
            sortBy: 'popularity.desc',
            page: 1,
          });
          tmdbData.push(
            ...data.results.map((item) => ({
              ...item,
              media_type: 'movie' as const,
            }))
          );
        }
        if (mediaType === 'tv') {
          const data = await this.tmdbClient.getDiscoverTv({
            sortBy: 'popularity.desc',
            page: 1,
          });
          tmdbData.push(
            ...data.results.map((item) => ({
              ...item,
              media_type: 'tv' as const,
            }))
          );
        }
        break;
      }
      case 'top': {
        if (mediaType === 'movie') {
          const data = await this.tmdbClient.getDiscoverMovies({
            sortBy: 'vote_average.desc',
            page: 1,
          });
          tmdbData.push(
            ...data.results.map((item) => ({
              ...item,
              media_type: 'movie' as const,
            }))
          );
        }
        if (mediaType === 'tv') {
          const data = await this.tmdbClient.getDiscoverTv({
            sortBy: 'vote_average.desc',
            page: 1,
          });
          tmdbData.push(
            ...data.results.map((item) => ({
              ...item,
              media_type: 'tv' as const,
            }))
          );
        }
        break;
      }
      case 'custom': {
        if (!config.tmdbCustomListUrl) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Custom TMDb URL required'
          );
        }
        const urlMatch = config.tmdbCustomListUrl.match(
          /themoviedb\.org\/collection\/(\d+)/
        );
        if (!urlMatch) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'Invalid TMDb collection URL'
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
            `No random TMDb collections available with ${mediaType} content`
          );
        }

        const { url: randomUrl, title: listTitle } = randomResult;

        // Store the dynamic title for use in generateCollectionNameWithCustom
        if (config.template === 'DYNAMIC_RANDOM_TITLE') {
          this.dynamicRandomTitle = listTitle;
          this.updateCollectionConfigField(config.id, { name: listTitle });
        }

        logger.info(`Using random TMDb collection: ${randomUrl}`, {
          label: 'TMDb Collections',
          collection: config.name,
          randomUrl,
          listTitle,
        });

        // Parse TMDb collection URL to get collection ID (same as custom)
        const urlMatch = randomUrl.match(/themoviedb\.org\/collection\/(\d+)/);
        if (!urlMatch) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `Invalid TMDb collection URL: ${randomUrl}`
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
      originalPosition: number;
    }[] = [];
    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      const tmdbId = item.id;
      const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
      const title = item.title || item.name || 'Unknown';
      tmdbLookups.push({
        tmdbId,
        mediaType,
        title,
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
        label: 'TMDb Collections',
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
        // Item exists in TMDb but not in Plex
        missingItems.push({
          tmdbId: lookup.tmdbId,
          mediaType: lookup.mediaType,
          title: lookup.title,
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
      logger.debug('TMDb collection processing stats', {
        label: 'TMDb Collections',
        collection: config.name,
        mappingStats,
        filteringStats,
      });
    }

    if (missingItems && missingItems.length > 0) {
      await this.handleAutoRequests(missingItems, config);
    }

    if (items.length === 0) return { created: 0, updated: 0 };

    // Use the new media type processing strategy
    return await this.processWithMediaTypeStrategy(
      items,
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
