import type PlexAPI from '@server/api/plexapi';
import RadarrAPI from '@server/api/servarr/radarr';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTmdbIds,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionSyncOptions,
  FilteringStats,
  MissingItem,
  PlexCollection,
  RadarrTagSourceData,
  RadarrTagTemplateContext,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface RadarrTagCollectionItem extends CollectionItem {
  tmdbId: number;
}

/**
 * Radarr Tag Collection Sync
 *
 * Creates collections from Radarr tags - fetches all movies that have a specific tag
 * in Radarr and creates a Plex collection from them.
 */
export class RadarrTagCollectionSync extends BaseCollectionSync<'radarrtag'> {
  private radarrClients: Map<number, RadarrAPI> = new Map();

  constructor() {
    super('radarrtag');
  }

  /**
   * Validate that at least one Radarr instance is configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.radarr || settings.radarr.length === 0) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'No Radarr instances configured'
      );
    }
  }

  /**
   * Process a single Radarr Tag collection configuration
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      // Validate configuration has required tag ID
      if (!config.radarrTagId) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Radarr tag ID not specified for collection: ${config.name}`
        );
      }

      // Fetch movies with the specified tag from Radarr
      const sourceData = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );

      // Map to standardized format
      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      // Apply filtering safety net
      const { items, missingItems, mappingStats, filteringStats } =
        await this.applyFilteringToMappedItems(mappedResult, config);

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

      if (finalItems.length === 0) {
        logger.warn('No items to create collection from', {
          label: 'Radarr Tag Collections',
          configName: config.name,
          radarrTagId: config.radarrTagId,
          originalStatsCount: mappingStats?.original || 0,
          mappedCount: mappingStats?.filtered || 0,
          filteredCount: filteringStats?.filtered || 0,
          removedCount:
            (mappingStats?.removed || 0) + (filteringStats?.removed || 0),
        });
        return { created: 0, updated: 0 };
      }

      // Use the media type processing strategy (should always be 'movie' for Radarr)
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
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Radarr Tag collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Radarr Tag collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<RadarrTagTemplateContext> {
    return {
      ...this.templateEngine.getDefaultContext(),
      mediaType,
      source: 'radarrtag' as const,
    };
  }

  /**
   * Fetch movies with the specified tag from Radarr
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    libraryCache?: LibraryItemsCache
  ): Promise<RadarrTagSourceData[]> {
    try {
      if (!config.radarrTagId) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Radarr tag ID not specified'
        );
      }

      const settings = getSettings();

      // Use the selected Radarr instance or fall back to default
      let radarrSettings;
      if (config.radarrInstanceId !== undefined) {
        radarrSettings = settings.radarr.find(
          (r) => r.id === config.radarrInstanceId
        );
        if (!radarrSettings) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `Radarr instance with ID ${config.radarrInstanceId} not found`
          );
        }
      } else {
        // Fall back to default instance for backward compatibility
        radarrSettings =
          settings.radarr.find((r) => r.isDefault) || settings.radarr[0];
        if (!radarrSettings) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'No Radarr instance available'
          );
        }
      }

      const radarr = this.getRadarrClient(radarrSettings.id);
      const allMovies = await radarr.getMovies();

      // Get the tag details to log the label
      const tags = await radarr.getTags();
      const tag = tags.find((t) => t.id === config.radarrTagId);
      const tagLabel = tag?.label || `Tag ID ${config.radarrTagId}`;

      // Filter movies that have the specified tag
      const radarrTagId = config.radarrTagId; // Already checked above, guaranteed to be defined
      if (!radarrTagId) {
        throw new Error('Radarr tag ID is undefined'); // This should never happen due to earlier check
      }
      const moviesWithTag = allMovies.filter((movie) =>
        movie.tags.includes(radarrTagId)
      );

      logger.info(
        `Fetched ${moviesWithTag.length} movies with tag "${tagLabel}" from Radarr`,
        {
          label: 'Radarr Tag Collections',
          configName: config.name,
          tagId: config.radarrTagId,
          tagLabel,
          totalMovies: allMovies.length,
          matchingMovies: moviesWithTag.length,
        }
      );

      if (options?.apiTimeout) {
        logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
          label: 'Radarr Tag Collections',
        });
      }

      return moviesWithTag.map((movie) => ({
        movie: {
          ids: { tmdb: movie.tmdbId },
          title: movie.title,
          year: undefined, // Radarr doesn't provide year in API response
        },
        tagLabel,
      }));
    } catch (error) {
      // Properly serialize error details for debugging
      let errorMessage = 'Unknown error';
      const errorDetails: Record<string, unknown> = {
        radarrTagId: config.radarrTagId,
      };

      if (error instanceof Error) {
        errorMessage = error.message;
        errorDetails.errorName = error.name;
        if (error.stack) {
          errorDetails.stack = error.stack;
        }
      }

      // Check for Axios errors
      if (typeof error === 'object' && error !== null) {
        const axiosError = error as {
          response?: { status?: number; statusText?: string; data?: unknown };
          request?: unknown;
          message?: string;
          code?: string;
        };

        if (axiosError.response) {
          errorDetails.httpStatus = axiosError.response.status;
          errorDetails.httpStatusText = axiosError.response.statusText;
          errorDetails.responseData = axiosError.response.data;
          errorMessage = `Radarr API error: ${axiosError.response.status} ${axiosError.response.statusText}`;
        } else if (axiosError.request) {
          errorMessage = 'No response from Radarr server';
          errorDetails.errorType = 'network';
        } else if (axiosError.message) {
          errorMessage = axiosError.message;
        }

        if (axiosError.code) {
          errorDetails.errorCode = axiosError.code;
        }
      }

      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch movies from Radarr: ${errorMessage}`,
        errorDetails,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }

  /**
   * Map Radarr movies to standardized collection items
   */
  public async mapSourceDataToItems(
    sourceData: RadarrTagSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: RadarrTagCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: RadarrTagCollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TMDB IDs and prepare lookup data
    const radarrLookups: {
      tmdbId: number;
      title: string;
      year?: number;
      originalPosition: number;
    }[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const { movie } = sourceData[index];
      try {
        if (!movie.ids.tmdb) {
          logger.warn(`Movie missing TMDB ID: ${movie.title}`, {
            label: 'Radarr Tag Collections',
            movieTitle: movie.title,
          });
          continue;
        }

        radarrLookups.push({
          tmdbId: movie.ids.tmdb,
          title: movie.title,
          year: movie.year,
          originalPosition: index + 1, // 1-based position
        });
      } catch (error) {
        logger.warn(`Failed to process Radarr movie: ${error}`, {
          label: 'Radarr Tag Collections',
        });
      }
    }

    logger.info(
      `Extracted ${radarrLookups.length} TMDB IDs from ${sourceData.length} Radarr movies`,
      {
        label: 'Radarr Tag Collections',
        configName: config.name,
        extracted: radarrLookups.length,
        total: sourceData.length,
      }
    );

    // Use the existing Plex search with TMDB IDs
    if (radarrLookups.length > 0 && plexClient) {
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;

      const plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        radarrLookups.map((lookup) => ({
          ...lookup,
          mediaType: 'movie' as const,
        })),
        targetLibraryId,
        libraryCache,
        false // Library-scoped search for collection creation
      );

      // Process items using the Plex lookup map
      for (const lookup of radarrLookups) {
        const key = `${lookup.tmdbId}-movie`;
        const plexItem = plexLookup.get(key);

        if (plexItem) {
          mappedItems.push({
            ratingKey: plexItem.ratingKey,
            title: lookup.title,
            type: 'movie',
            tmdbId: lookup.tmdbId,
            year: lookup.year,
            addedAt: plexItem.addedAt,
            releaseDate: plexItem.releaseDate,
            metadata: {
              libraryKey: plexItem.libraryKey,
              tmdbId: lookup.tmdbId,
            },
          });
        } else {
          // Item exists in Radarr but not in Plex
          missingItems.push({
            tmdbId: lookup.tmdbId,
            mediaType: 'movie',
            title: lookup.title,
            year: lookup.year,
            originalPosition: lookup.originalPosition,
            source: this.source,
          });
        }
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'missing tmdb id': sourceData.length - radarrLookups.length,
      }
    );

    logger.info(`Radarr Tag mapping completed`, {
      label: 'Radarr Tag Collections',
      configName: config.name,
      found: mappedItems.length,
      missing: missingItems.length,
      total: sourceData.length,
    });

    return {
      items: mappedItems,
      missingItems,
      stats,
    };
  }

  /**
   * Create collection in Plex
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ) {
    try {
      // Use the standardized approach via BaseCollectionSync
      const result = await this.createOrUpdateCollectionStandardized(
        items,
        collectionName,
        mediaType,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys
      );

      // Update config with rating key if we got one
      this.updateConfigWithRatingKey(config, result.collectionRatingKey);

      return {
        created: result.created,
        updated: result.updated,
        collectionRatingKey: result.collectionRatingKey,
        itemCount: result.itemCount || items.length,
        stats: result.stats,
      };
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to create Radarr Tag collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  /**
   * Get or create a Radarr client for the given server ID
   */
  private getRadarrClient(serverId: number): RadarrAPI {
    if (!this.radarrClients.has(serverId)) {
      const settings = getSettings();
      const radarrSettings = settings.radarr.find((r) => r.id === serverId);

      if (!radarrSettings) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Radarr server with ID ${serverId} not found`
        );
      }

      this.radarrClients.set(
        serverId,
        new RadarrAPI({
          apiKey: radarrSettings.apiKey,
          url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
        })
      );
    }

    const client = this.radarrClients.get(serverId);
    if (!client) {
      throw new Error('Failed to get Radarr client');
    }
    return client;
  }

  /**
   * Handle auto-requests for missing items
   */
  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    if (missingItems.length > 0) {
      logger.debug('Skipping auto-requests for Radarr Tag collection', {
        label: 'Radarr Tag Collections',
        configName: config.name,
        missingCount: missingItems.length,
      });
    }
  }
}

export default RadarrTagCollectionSync;
