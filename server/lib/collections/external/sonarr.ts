import type PlexAPI from '@server/api/plexapi';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
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
  SonarrTagSourceData,
  SonarrTagTemplateContext,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

interface SonarrTagCollectionItem extends CollectionItem {
  tvdbId?: number;
  tmdbId?: number;
}

/**
 * Sonarr Tag Collection Sync
 *
 * Creates collections from Sonarr tags - fetches all TV shows that have a specific tag
 * in Sonarr and creates a Plex collection from them.
 */
export class SonarrTagCollectionSync extends BaseCollectionSync<'sonarrtag'> {
  private sonarrClients: Map<number, SonarrAPI> = new Map();

  constructor() {
    super('sonarrtag');
  }

  /**
   * Validate that at least one Sonarr instance is configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();
    if (!settings.sonarr || settings.sonarr.length === 0) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'No Sonarr instances configured'
      );
    }
  }

  /**
   * Process a single Sonarr Tag collection configuration
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
      if (!config.sonarrTagId) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Sonarr tag ID not specified for collection: ${config.name}`
        );
      }

      // Fetch TV shows with the specified tag from Sonarr
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

      // Clean up placeholders (released items, orphaned items, stale items)
      if (config.createPlaceholdersForMissing) {
        const { cleanupPlaceholdersForConfig } = await import(
          '@server/lib/collections/services/PlaceholderService'
        );
        const sourceTmdbIds = new Set([
          ...items
            .map((item) => item.tmdbId)
            .filter((id): id is number => typeof id === 'number'),
          ...(missingItems
            ?.map((item) => item.tmdbId)
            .filter((id): id is number => typeof id === 'number') || []),
        ]);
        await cleanupPlaceholdersForConfig(
          config,
          plexClient,
          libraryCache,
          sourceTmdbIds
        );
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

      if (finalItems.length === 0) {
        logger.warn('No items to create collection from', {
          label: 'Sonarr Tag Collections',
          configName: config.name,
          sonarrTagId: config.sonarrTagId,
          originalStatsCount: mappingStats?.original || 0,
          mappedCount: mappingStats?.filtered || 0,
          filteredCount: filteringStats?.filtered || 0,
          removedCount:
            (mappingStats?.removed || 0) + (filteringStats?.removed || 0),
        });
        return { created: 0, updated: 0 };
      }

      // Use the media type processing strategy (should always be 'tv' for Sonarr)
      return await this.processWithMediaTypeStrategy(
        finalItems,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined, // userInfo
        libraryCache
      );
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Sonarr Tag collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Sonarr Tag collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<SonarrTagTemplateContext> {
    return {
      ...this.templateEngine.getDefaultContext(),
      mediaType,
      source: 'sonarrtag' as const,
    };
  }

  /**
   * Fetch TV shows with the specified tag from Sonarr
   */
  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    libraryCache?: LibraryItemsCache
  ): Promise<SonarrTagSourceData[]> {
    try {
      if (!config.sonarrTagId) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          'Sonarr tag ID not specified'
        );
      }

      const settings = getSettings();

      // Use the selected Sonarr instance or fall back to default
      let sonarrSettings;
      if (config.sonarrInstanceId !== undefined) {
        sonarrSettings = settings.sonarr.find(
          (s) => s.id === config.sonarrInstanceId
        );
        if (!sonarrSettings) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            `Sonarr instance with ID ${config.sonarrInstanceId} not found`
          );
        }
      } else {
        // Fall back to default instance for backward compatibility
        sonarrSettings =
          settings.sonarr.find((s) => s.isDefault) || settings.sonarr[0];
        if (!sonarrSettings) {
          throw this.createSyncError(
            CollectionSyncErrorType.CONFIGURATION_ERROR,
            'No Sonarr instance available'
          );
        }
      }

      const sonarr = this.getSonarrClient(sonarrSettings.id);
      const allSeries = await sonarr.getSeries();

      // Get the tag details to log the label
      const tags = await sonarr.getTags();
      const tag = tags.find((t) => t.id === config.sonarrTagId);
      const tagLabel = tag?.label || `Tag ID ${config.sonarrTagId}`;

      // Filter TV shows that have the specified tag
      const sonarrTagId = config.sonarrTagId; // Already checked above, guaranteed to be defined
      if (!sonarrTagId) {
        throw new Error('Sonarr tag ID is undefined'); // This should never happen due to earlier check
      }
      const seriesWithTag = allSeries.filter((series) =>
        series.tags.includes(sonarrTagId)
      );

      logger.info(
        `Fetched ${seriesWithTag.length} TV shows with tag "${tagLabel}" from Sonarr`,
        {
          label: 'Sonarr Tag Collections',
          configName: config.name,
          tagId: config.sonarrTagId,
          tagLabel,
          totalSeries: allSeries.length,
          matchingSeries: seriesWithTag.length,
        }
      );

      if (options?.apiTimeout) {
        logger.debug(`API timeout set to ${options.apiTimeout}ms`, {
          label: 'Sonarr Tag Collections',
        });
      }

      return seriesWithTag.map((series) => ({
        series: {
          ids: {
            tvdb: series.tvdbId,
            tmdb: undefined, // Sonarr v3 API doesn't reliably provide TMDB IDs
          },
          title: series.title,
          year: series.year,
        },
        tagLabel,
      }));
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        `Failed to fetch TV shows from Sonarr`,
        { sonarrTagId: config.sonarrTagId },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Map Sonarr TV shows to standardized collection items
   */
  public async mapSourceDataToItems(
    sourceData: SonarrTagSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: SonarrTagCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: SonarrTagCollectionItem[] = [];
    const missingItems: MissingItem[] = [];

    // Extract all TVDB IDs and prepare lookup data
    const sonarrLookups: {
      tvdbId: number;
      tmdbId?: number;
      title: string;
      year?: number;
      originalPosition: number;
    }[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const { series } = sourceData[index];
      try {
        if (!series.ids.tvdb) {
          logger.warn(`TV show missing TVDB ID: ${series.title}`, {
            label: 'Sonarr Tag Collections',
            seriesTitle: series.title,
          });
          continue;
        }

        sonarrLookups.push({
          tvdbId: series.ids.tvdb,
          tmdbId: series.ids.tmdb,
          title: series.title,
          year: series.year,
          originalPosition: index + 1, // 1-based position
        });
      } catch (error) {
        logger.warn(`Failed to process Sonarr series: ${error}`, {
          label: 'Sonarr Tag Collections',
        });
      }
    }

    logger.info(
      `Extracted ${sonarrLookups.length} TVDB IDs from ${sourceData.length} Sonarr TV shows`,
      {
        label: 'Sonarr Tag Collections',
        configName: config.name,
        extracted: sonarrLookups.length,
        total: sourceData.length,
      }
    );

    // Look up missing TMDB IDs from TVDB IDs
    const lookupsWithoutTmdb = sonarrLookups.filter((l) => !l.tmdbId);
    if (lookupsWithoutTmdb.length > 0) {
      logger.info(
        `Looking up TMDB IDs for ${lookupsWithoutTmdb.length} TV shows using TVDB IDs`,
        {
          label: 'Sonarr Tag Collections',
          configName: config.name,
          lookupCount: lookupsWithoutTmdb.length,
        }
      );

      const tmdb = new TheMovieDb();
      let successCount = 0;
      let failCount = 0;

      for (const lookup of lookupsWithoutTmdb) {
        try {
          const externalIdResponse = await tmdb.getByExternalId({
            externalId: lookup.tvdbId,
            type: 'tvdb',
          });

          if (externalIdResponse.tv_results?.[0]?.id) {
            lookup.tmdbId = externalIdResponse.tv_results[0].id;
            successCount++;
            logger.debug(
              `Found TMDB ID ${lookup.tmdbId} for "${lookup.title}" (TVDB: ${lookup.tvdbId})`,
              {
                label: 'Sonarr Tag Collections',
                title: lookup.title,
                tvdbId: lookup.tvdbId,
                tmdbId: lookup.tmdbId,
              }
            );
          } else {
            failCount++;
            logger.debug(
              `No TMDB ID found for "${lookup.title}" (TVDB: ${lookup.tvdbId})`,
              {
                label: 'Sonarr Tag Collections',
                title: lookup.title,
                tvdbId: lookup.tvdbId,
              }
            );
          }
        } catch (error) {
          failCount++;
          logger.debug(
            `Failed to lookup TMDB ID for "${lookup.title}" (TVDB: ${lookup.tvdbId}): ${error}`,
            {
              label: 'Sonarr Tag Collections',
              title: lookup.title,
              tvdbId: lookup.tvdbId,
            }
          );
        }
      }

      logger.info(
        `TMDB ID lookup completed: ${successCount} found, ${failCount} not found`,
        {
          label: 'Sonarr Tag Collections',
          configName: config.name,
          successCount,
          failCount,
          totalLookups: lookupsWithoutTmdb.length,
        }
      );
    }

    // Use the existing Plex search with TMDB IDs
    // Note: For TV shows, Plex primarily uses TVDB IDs, but findPlexItemsByTmdbIds
    // can also find shows by TMDB ID if available in Plex metadata
    if (sonarrLookups.length > 0 && plexClient) {
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;

      // Filter to only shows that have TMDB IDs (now includes looked-up IDs)
      const lookupsWithTmdb = sonarrLookups.filter((l) => l.tmdbId);

      if (lookupsWithTmdb.length > 0) {
        const plexLookup = await findPlexItemsByTmdbIds(
          plexClient,
          lookupsWithTmdb.map((lookup) => ({
            tmdbId: lookup.tmdbId as number, // Safe cast since filtered by tmdbId existence
            mediaType: 'tv' as const,
            title: lookup.title,
            year: lookup.year,
          })),
          targetLibraryId,
          libraryCache,
          false // Library-scoped search for collection creation
        );

        // Process items using the Plex lookup map
        for (const lookup of lookupsWithTmdb) {
          const key = `${lookup.tmdbId}-tv`;
          const plexItem = plexLookup.get(key);

          if (plexItem) {
            mappedItems.push({
              ratingKey: plexItem.ratingKey,
              title: lookup.title,
              type: 'tv',
              tvdbId: lookup.tvdbId,
              tmdbId: lookup.tmdbId,
              year: lookup.year,
              metadata: {
                libraryKey: plexItem.libraryKey,
                tvdbId: lookup.tvdbId,
                tmdbId: lookup.tmdbId,
              },
            });
          } else if (lookup.tmdbId) {
            // Item exists in Sonarr but not in Plex - only add if we have TMDB ID for auto-download
            missingItems.push({
              tmdbId: lookup.tmdbId,
              tvdbId: lookup.tvdbId,
              mediaType: 'tv',
              title: lookup.title,
              year: lookup.year,
              originalPosition: lookup.originalPosition,
              source: this.source,
            });
          }
        }
      }

      // Log warning for series that still don't have TMDB IDs after lookup
      const stillWithoutTmdb = sonarrLookups.filter((l) => !l.tmdbId);
      if (stillWithoutTmdb.length > 0) {
        logger.warn(
          `${stillWithoutTmdb.length} TV shows could not be matched to TMDB and will be skipped`,
          {
            label: 'Sonarr Tag Collections',
            configName: config.name,
            skippedCount: stillWithoutTmdb.length,
            totalCount: sonarrLookups.length,
            skippedTitles: stillWithoutTmdb.map((l) => l.title).slice(0, 5), // Log first 5 titles
          }
        );
      }
    }

    const stats = this.createFilteringStats(
      sourceData.length,
      mappedItems.length,
      {
        'missing from plex': missingItems.length,
        'missing tvdb id': sourceData.length - sonarrLookups.length,
      }
    );

    logger.info(`Sonarr Tag mapping completed`, {
      label: 'Sonarr Tag Collections',
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
        `Failed to create Sonarr Tag collection ${collectionName}`,
        { collectionName, itemCount: items.length },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Private helper methods

  /**
   * Get or create a Sonarr client for the given server ID
   */
  private getSonarrClient(serverId: number): SonarrAPI {
    if (!this.sonarrClients.has(serverId)) {
      const settings = getSettings();
      const sonarrSettings = settings.sonarr.find((s) => s.id === serverId);

      if (!sonarrSettings) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Sonarr server with ID ${serverId} not found`
        );
      }

      this.sonarrClients.set(
        serverId,
        new SonarrAPI({
          apiKey: sonarrSettings.apiKey,
          url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
        })
      );
    }

    const client = this.sonarrClients.get(serverId);
    if (!client) {
      throw new Error('Failed to get Sonarr client');
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
      logger.debug('Skipping auto-requests for Sonarr Tag collection', {
        label: 'Sonarr Tag Collections',
        configName: config.name,
        missingCount: missingItems.length,
      });
    }
  }
}

export default SonarrTagCollectionSync;
