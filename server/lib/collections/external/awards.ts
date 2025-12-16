import type PlexAPI from '@server/api/plexapi';
import TmdbAPI from '@server/api/themoviedb';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTmdbIds,
  processMissingItemsWithMode,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  AwardsSourceData,
  AwardsTemplateContext,
  CollectionItem,
  CollectionSyncOptions,
  FilteringStats,
  MissingItem,
  PlexCollection,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import YAML from 'yamljs';

interface AwardsCollectionItem extends CollectionItem {
  tmdbId: number;
}

/**
 * Awards Collection Sync
 *
 * Fetches Academy Awards Best Picture winners from Kometa's IMDb Awards lists.
 */
export class AwardsCollectionSync extends BaseCollectionSync {
  private tmdbClient: TmdbAPI;
  private static readonly AWARDS_URL =
    'https://raw.githubusercontent.com/Kometa-Team/IMDb-Awards/refs/heads/master/events/ev0000003.yml';

  constructor() {
    super('awards');
    this.tmdbClient = new TmdbAPI();
  }

  protected async validateConfiguration(): Promise<void> {
    // No external API keys required; TMDB client is bundled.
    return;
  }

  private isValidAwardsSubtype(subtype?: string): boolean {
    return subtype === 'academy_awards_best_picture_winners';
  }

  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      if (!this.isValidAwardsSubtype(config.subtype)) {
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Invalid Awards subtype: ${config.subtype}`
        );
      }

      const sourceData = await this.fetchSourceData(
        config,
        options,
        libraryCache
      );

      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      const { items, missingItems, mappingStats, filteringStats } =
        await this.applyFilteringToMappedItems(mappedResult, config);

      if (config.createPlaceholdersForMissing) {
        const { cleanupPlaceholdersForConfig } = await import(
          '@server/lib/collections/services/PlaceholderService'
        );
        const sourceTmdbIds = new Set([
          ...items
            .map((item) => (item as AwardsCollectionItem).tmdbId)
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
        logger.warn('No items to create awards collection from', {
          label: 'Awards Collections',
          configName: config.name,
          originalStatsCount: mappingStats?.original || 0,
          mappedCount: mappingStats?.filtered || 0,
          filteredCount: filteringStats?.filtered || 0,
          removedCount:
            (mappingStats?.removed || 0) + (filteringStats?.removed || 0),
        });
        return { created: 0, updated: 0 };
      }

      return await this.processWithMediaTypeStrategy(
        finalItems,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined,
        libraryCache
      );
    } catch (error) {
      logger.error(
        `Failed to process Awards collection ${config.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          label: 'Awards Collections',
          configName: config.name,
          errorStack: error instanceof Error ? error.stack : undefined,
        }
      );

      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Awards collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<AwardsTemplateContext> {
    return this.templateEngine.createAwardsContext(
      mediaType,
      config.subtype || 'Academy Awards'
    ) as AwardsTemplateContext;
  }

  public async fetchSourceData(
    config: CollectionConfig,
    options?: CollectionSyncOptions,
    libraryCache?: LibraryItemsCache // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<AwardsSourceData[]> {
    try {
      const response = await axios.get(AwardsCollectionSync.AWARDS_URL, {
        timeout: options?.apiTimeout ?? 15000,
      });
      const awardsData = YAML.parse(response.data);

      if (!awardsData || typeof awardsData !== 'object') {
        throw this.createSyncError(
          CollectionSyncErrorType.API_ERROR,
          'Unexpected awards data format'
        );
      }

      // Sort years descending so newest winners appear first
      const years = Object.keys(awardsData)
        .filter((year) => /^\d{4}$/.test(year))
        .sort((a, b) => Number(b) - Number(a));

      const winners: { imdbId: string; year?: number }[] = [];
      const seen = new Set<string>();

      for (const yearKey of years) {
        const yearData = awardsData[yearKey];
        if (!yearData || typeof yearData !== 'object') continue;

        const categoryContainers = [
          yearData.oscar,
          yearData, // fallback in case categories are nested directly
        ].filter((c) => c && typeof c === 'object');

        for (const container of categoryContainers) {
          for (const [categoryName, categoryData] of Object.entries(
            container
          )) {
            if (
              categoryName.toLowerCase() !== 'best motion picture of the year'
            ) {
              continue;
            }

            const winnerField = (categoryData as { winner?: unknown }).winner;
            const winnerIds: unknown[] = Array.isArray(winnerField)
              ? winnerField
              : winnerField
              ? [winnerField]
              : [];

            for (const rawId of winnerIds) {
              if (typeof rawId !== 'string') continue;
              const imdbId = rawId.trim();
              if (!imdbId || seen.has(imdbId)) continue;

              seen.add(imdbId);
              const numericYear = Number.parseInt(yearKey, 10);
              winners.push({
                imdbId,
                year: Number.isNaN(numericYear) ? undefined : numericYear,
              });
            }
          }
        }
      }

      if (winners.length === 0) {
        throw this.createSyncError(
          CollectionSyncErrorType.API_ERROR,
          'No winners found in awards data'
        );
      }

      logger.info(`Found ${winners.length} Best Picture winners`, {
        label: 'Awards Collections',
        configName: config.name,
      });

      // Resolve TMDB IDs in small batches
      const resolvedData: AwardsSourceData[] = [];
      const batchSize = 20;

      for (let i = 0; i < winners.length; i += batchSize) {
        const batch = winners.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (winner, batchIndex) => {
            const originalPosition = i + batchIndex + 1;
            try {
              const resolved = await this.resolveTmdbId(winner.imdbId);
              return {
                imdbId: winner.imdbId,
                tmdbId: resolved.tmdbId,
                title: resolved.title,
                year: resolved.year ?? winner.year,
                type: 'movie' as const,
                originalPosition,
              };
            } catch (error) {
              logger.warn(
                `Failed to resolve TMDB ID for IMDb ${winner.imdbId}`,
                {
                  label: 'Awards Collections',
                  error: error instanceof Error ? error.message : String(error),
                }
              );
              return {
                imdbId: winner.imdbId,
                type: 'movie' as const,
                year: winner.year,
                originalPosition,
              };
            }
          })
        );

        resolvedData.push(...batchResults);
      }

      return resolvedData;
    } catch (error) {
      throw this.createSyncError(
        CollectionSyncErrorType.API_ERROR,
        'Failed to fetch awards data',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  private async resolveTmdbId(
    imdbId: string
  ): Promise<{ tmdbId?: number; title?: string; year?: number }> {
    const response = await this.tmdbClient.getByExternalId({
      externalId: imdbId,
      type: 'imdb',
    });

    if (response.movie_results && response.movie_results.length > 0) {
      const movie = response.movie_results[0];
      return {
        tmdbId: movie.id,
        title: movie.title || movie.original_title,
        year: movie.release_date
          ? Number.parseInt(movie.release_date.substring(0, 4))
          : undefined,
      };
    }

    if (response.tv_results && response.tv_results.length > 0) {
      const show = response.tv_results[0];
      return {
        tmdbId: show.id,
        title: show.name || show.original_name,
        year: show.first_air_date
          ? Number.parseInt(show.first_air_date.substring(0, 4))
          : undefined,
      };
    }

    return {};
  }

  public async mapSourceDataToItems(
    sourceData: AwardsSourceData[],
    config: CollectionConfig,
    plexClient?: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: AwardsCollectionItem[];
    missingItems?: MissingItem[];
    stats?: FilteringStats;
  }> {
    const mappedItems: AwardsCollectionItem[] = [];
    const missingItems: MissingItem[] = [];
    const tmdbLookups: {
      tmdbId: number;
      imdbId: string;
      title: string;
      year?: number;
      originalPosition: number;
      mediaType: 'movie';
    }[] = [];
    const skipped: string[] = [];

    for (let index = 0; index < sourceData.length; index++) {
      const item = sourceData[index];
      if (!item.tmdbId) {
        skipped.push(item.imdbId);
        continue;
      }

      tmdbLookups.push({
        tmdbId: item.tmdbId,
        imdbId: item.imdbId,
        title: item.title || item.imdbId,
        year: item.year,
        originalPosition: item.originalPosition ?? index + 1,
        mediaType: 'movie',
      });
    }

    if (skipped.length > 0) {
      logger.info(`Awards items skipped due to missing TMDB IDs`, {
        label: 'Awards Collections',
        configName: config.name,
        count: skipped.length,
        items: skipped.slice(0, 5),
      });
    }

    if (tmdbLookups.length === 0) {
      const stats = this.createFilteringStats(sourceData.length, 0, {
        'no tmdb id': sourceData.length,
      });
      return { items: mappedItems, missingItems, stats };
    }

    let plexLookup: Map<
      string,
      { ratingKey: string; title: string; libraryKey: string }
    > = new Map();

    if (plexClient) {
      const targetLibraryId = Array.isArray(config.libraryId)
        ? config.libraryId[0]
        : config.libraryId;
      plexLookup = await findPlexItemsByTmdbIds(
        plexClient,
        tmdbLookups,
        targetLibraryId,
        libraryCache,
        false
      );
    } else {
      logger.warn('No Plex client provided to map awards items', {
        label: 'Awards Collections',
      });
    }

    for (const lookup of tmdbLookups) {
      const key = `${lookup.tmdbId}-${lookup.mediaType}`;
      const plexItem = plexLookup.get(key);

      if (plexItem) {
        mappedItems.push({
          ratingKey: plexItem.ratingKey,
          title: lookup.title,
          type: 'movie',
          tmdbId: lookup.tmdbId,
          imdbId: lookup.imdbId,
          year: lookup.year,
          metadata: {
            libraryKey: plexItem.libraryKey,
          },
        });
      } else {
        missingItems.push({
          tmdbId: lookup.tmdbId,
          mediaType: 'movie',
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
        'no tmdb id': sourceData.length - tmdbLookups.length,
      }
    );

    return {
      items: mappedItems,
      missingItems,
      stats,
    };
  }

  private async handleAutoRequests(
    missingItems: MissingItem[],
    config: CollectionConfig
  ): Promise<void> {
    await processMissingItemsWithMode(missingItems, config, 'awards');
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
    const result = await this.createOrUpdateCollectionStandardized(
      items,
      collectionName,
      mediaType,
      config,
      plexClient,
      allCollections,
      processedCollectionKeys
    );

    this.updateConfigWithRatingKey(config, result.collectionRatingKey);

    return {
      created: result.created,
      updated: result.updated,
      collectionRatingKey: result.collectionRatingKey,
      itemCount: result.itemCount || items.length,
      stats: result.stats,
    };
  }
}

export default AwardsCollectionSync;
