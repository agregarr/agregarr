import type PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { ComingSoonItem } from '@server/entity/ComingSoonItem';
import { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import {
  findPlexItemsByTmdbIds,
  getCollectionMediaType,
  type LibraryItemsCache,
} from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  CollectionOperationResult,
  CollectionSyncOptions,
  ComingSoonSourceData,
  ComingSoonTemplateContext,
  MissingItem,
  PlexCollection,
  SyncResult,
} from '@server/lib/collections/core/types';
import { CollectionSyncErrorType } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import fs from 'fs/promises';
import { cleanupReleasedPlaceholders } from './comingsoon/comingSoonCleanup';
import {
  enrichWithTMDBReleaseDates,
  fetchMonitoredMovies,
  fetchMonitoredShows,
  fetchTmdbComingSoonMovies,
  fetchTmdbComingSoonShows,
  fetchTraktAnticipatedMovies,
  fetchTraktAnticipatedShows,
  markMonitoredStatus,
} from './comingsoon/comingSoonFetch';

/**
 * Coming Soon Collection Sync
 *
 * Creates collections of upcoming/unreleased content with placeholder files and overlay banners.
 *
 * Features:
 * - Fetches upcoming content from Radarr/Sonarr/Trakt
 * - Creates placeholder files for missing items
 * - Applies category-specific overlay banners (PREMIERES, EXPECTED, COMING SOON, REQUEST NEEDED)
 * - Cleans up placeholders when real files are added
 *
 * Supports:
 * - 'monitored' subtype: Items monitored in Radarr/Sonarr but not yet released
 * - 'trakt_anticipated' subtype: Most anticipated upcoming content from Trakt
 * - 'tmdb_anticipated' subtype: Upcoming releases from TMDB Discover (movies: digital/physical, TV: new & returning shows)
 */
export class ComingSoonCollectionSync extends BaseCollectionSync {
  constructor() {
    super('comingsoon');
  }

  /**
   * Validate that required services are configured
   */
  protected async validateConfiguration(): Promise<void> {
    const settings = getSettings();

    const hasRadarr = settings.radarr && settings.radarr.length > 0;
    const hasSonarr = settings.sonarr && settings.sonarr.length > 0;
    const hasTrakt = !!settings.trakt.apiKey;

    if (!hasRadarr && !hasSonarr && !hasTrakt) {
      throw this.createSyncError(
        CollectionSyncErrorType.CONFIGURATION_ERROR,
        'No supported services configured for Coming Soon (need Radarr, Sonarr, or Trakt)'
      );
    }
  }

  /**
   * Process a single Coming Soon collection configuration
   */
  protected async processConfiguration(
    config: CollectionConfig,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    processedCollectionKeys?: Set<string>,
    libraryCache?: LibraryItemsCache,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: CollectionSyncOptions
  ): Promise<SyncResult> {
    try {
      // Fetch upcoming content
      let sourceData = await this.fetchSourceData(config);

      // Filter out Trakt items that are past the released window (cleanup old non-monitored items)
      const { calculateDaysSince } = await import('@server/utils/dateHelpers');
      const releasedWindowDays =
        config.placeholderReleasedDays || config.comingSoonReleasedDays || 14;
      const originalCount = sourceData.length;
      sourceData = sourceData.filter((item) => {
        // Only filter Trakt items that are NOT monitored
        if (item.source === 'trakt' && !item.monitored) {
          const releaseDate = item.releaseDate || item.airDate;
          if (releaseDate) {
            const daysSinceRelease = calculateDaysSince(releaseDate);
            // Exclude items released more than the configured window
            if (daysSinceRelease > releasedWindowDays) {
              logger.debug(
                `Excluding Trakt item released >${releasedWindowDays} days ago`,
                {
                  label: 'Coming Soon Collections',
                  title: item.title,
                  releaseDate,
                  daysSinceRelease,
                  releasedWindowDays,
                }
              );
              return false;
            }
          }
        }
        return true;
      });

      if (sourceData.length < originalCount) {
        logger.info('Filtered out old Trakt items', {
          label: 'Coming Soon Collections',
          originalCount,
          filteredCount: sourceData.length,
          removed: originalCount - sourceData.length,
        });
      }

      // Clean up placeholders (released items, orphaned items, stale items)
      await cleanupReleasedPlaceholders(
        config,
        plexClient,
        libraryCache,
        sourceData
      );

      if (sourceData.length === 0) {
        logger.warn('No upcoming content found', {
          label: 'Coming Soon Collections',
          configName: config.name,
          subtype: config.subtype,
        });
        return { created: 0, updated: 0 };
      }

      // Map to standardized format
      // Note: sourceData is already filtered by 360-day window during fetch
      const mappedResult = await this.mapSourceDataToItems(
        sourceData,
        config,
        plexClient,
        libraryCache
      );

      // Apply filtering (placeholderItems in mappedResult are ignored - overlays handled by overlay sync job)
      const { items, missingItems, mappingStats } =
        await this.applyFilteringToMappedItems(mappedResult, config);

      // Handle placeholder creation for missing items using unified flow
      // This respects the createPlaceholdersForMissing checkbox (which should be force-enabled for Coming Soon)
      if (missingItems && missingItems.length > 0) {
        const newlyCreatedItems = await this.processMissingItems(
          missingItems,
          config,
          plexClient
        );

        // Add newly created placeholder items to the collection
        items.push(...newlyCreatedItems);
      }

      // Add released items to collection (overlays will be applied by overlay sync)
      const releasedItems = await this.getReleasedItemsWithinWindow(
        config,
        sourceData,
        libraryCache
      );
      if (releasedItems.length > 0) {
        logger.info(
          'Adding released items to collection (overlays handled by overlay sync)',
          {
            label: 'Coming Soon Collections',
            count: releasedItems.length,
            releasedWindowDays:
              config.placeholderReleasedDays ||
              config.comingSoonReleasedDays ||
              7,
          }
        );

        // Add released items to the collection
        items.push(...releasedItems);
      }

      // Sort items by release date (closest first)
      const sortedItems = this.sortByReleaseDate(items, sourceData);

      if (sortedItems.length === 0) {
        logger.warn('No items to create collection from after filtering', {
          label: 'Coming Soon Collections',
          configName: config.name,
          originalCount: mappingStats?.original || 0,
          matched: mappingStats?.filtered || 0,
        });
        return { created: 0, updated: 0 };
      }

      // Use the media type processing strategy
      return await this.processWithMediaTypeStrategy(
        sortedItems,
        config,
        plexClient,
        allCollections,
        processedCollectionKeys,
        undefined,
        libraryCache
      );
    } catch (error) {
      logger.error('Coming Soon collection processing failed', {
        label: 'Coming Soon Collections',
        configId: config.id,
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw this.createSyncError(
        CollectionSyncErrorType.COLLECTION_ERROR,
        `Failed to process Coming Soon collection ${config.name}`,
        { configId: config.id, configName: config.name },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create template context for Coming Soon collections
   */
  protected async createTemplateContext(
    config: CollectionConfig,
    mediaType: 'movie' | 'tv'
  ): Promise<ComingSoonTemplateContext> {
    const subtype = config.subtype as
      | 'monitored'
      | 'trakt_anticipated'
      | 'tmdb_anticipated';

    return {
      ...this.templateEngine.getDefaultContext(),
      mediaType,
      source: 'comingsoon' as const,
      statType: subtype,
      subtype,
    };
  }

  /**
   * Create or update a collection in Plex
   * Required by BaseCollectionSync
   */
  protected async createCollection(
    items: CollectionItem[],
    mediaType: 'movie' | 'tv',
    collectionName: string,
    plexClient: PlexAPI,
    allCollections: PlexCollection[],
    config: CollectionConfig,
    processedCollectionKeys?: Set<string>
  ): Promise<CollectionOperationResult> {
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
      logger.error('Failed to create Coming Soon collection', {
        label: 'Coming Soon Collections',
        configName: config.name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch upcoming content from configured sources
   */
  public async fetchSourceData(
    config: CollectionConfig
  ): Promise<ComingSoonSourceData[]> {
    const subtype = config.subtype || '';
    const mediaType = getCollectionMediaType(config);
    const upcomingItems: ComingSoonSourceData[] = [];

    logger.info('Fetching Coming Soon content', {
      label: 'Coming Soon Collections',
      subtype,
      mediaType,
      configName: config.name,
    });

    switch (subtype) {
      case 'monitored': {
        if (mediaType === 'movie') {
          logger.debug('Fetching monitored movies', {
            label: 'Coming Soon Collections',
          });
          const items = await fetchMonitoredMovies(config);
          upcomingItems.push(...items);
        }
        if (mediaType === 'tv') {
          logger.debug('Fetching monitored TV shows', {
            label: 'Coming Soon Collections',
          });
          const items = await fetchMonitoredShows(config);
          logger.debug('fetchMonitoredShows returned', {
            label: 'Coming Soon Collections',
            count: items.length,
          });
          upcomingItems.push(...items);
        }

        // Enrich monitored items with TMDB release dates (adds 3-month estimate for theatrical-only releases)
        await enrichWithTMDBReleaseDates(
          upcomingItems,
          config.placeholderDaysAhead || config.comingSoonDays || 360
        );
        break;
      }

      case 'trakt_anticipated': {
        // maxItems is required for Trakt anticipated collections
        const maxItems = config.maxItems || 50; // Default to 50 if not set

        if (mediaType === 'movie') {
          const items = await fetchTraktAnticipatedMovies(maxItems);
          upcomingItems.push(...items);
        }
        if (mediaType === 'tv') {
          const items = await fetchTraktAnticipatedShows(maxItems);
          upcomingItems.push(...items);
        }

        // Cross-reference with Radarr/Sonarr to mark monitored status
        await markMonitoredStatus(
          upcomingItems,
          config.placeholderDaysAhead || config.comingSoonDays || 360
        );
        break;
      }

      case 'tmdb_anticipated': {
        // maxItems is required for TMDB anticipated collections
        const maxItems = config.maxItems || 50; // Default to 50 if not set

        if (mediaType === 'movie') {
          const items = await fetchTmdbComingSoonMovies(maxItems, config);
          upcomingItems.push(...items);
        }
        if (mediaType === 'tv') {
          const items = await fetchTmdbComingSoonShows(maxItems, config);
          upcomingItems.push(...items);
        }

        // Cross-reference with Radarr/Sonarr to mark monitored status
        await markMonitoredStatus(
          upcomingItems,
          config.placeholderDaysAhead || config.comingSoonDays || 360
        );
        break;
      }

      default:
        throw this.createSyncError(
          CollectionSyncErrorType.CONFIGURATION_ERROR,
          `Unknown Coming Soon subtype: ${subtype}`
        );
    }

    logger.info('Fetched Coming Soon content', {
      label: 'Coming Soon Collections',
      subtype,
      mediaType,
      count: upcomingItems.length,
    });

    // Attach releaseDateSortValue to each item for multi-source orchestrator sorting
    // This uses the same priority logic as sortByReleaseDate: Digital > Physical > Generic
    const enrichedItems = upcomingItems.map((item) => {
      let sortDate: Date | null = null;

      if (item.mediaType === 'movie') {
        // Priority: Digital > Physical > Generic (actual availability, not theatrical)
        // Do NOT use inCinemas - theatrical release doesn't mean content is available for Plex
        if (item.digitalRelease) {
          sortDate = new Date(item.digitalRelease);
        } else if (item.physicalRelease) {
          sortDate = new Date(item.physicalRelease);
        } else if (item.releaseDate) {
          sortDate = new Date(item.releaseDate);
        }
        // inCinemas deliberately excluded - we care about home availability, not theatrical
      } else if (item.mediaType === 'tv') {
        // For TV: use airDate
        if (item.airDate) {
          sortDate = new Date(item.airDate);
        }
      }

      return {
        ...item,
        releaseDateSortValue: sortDate ? sortDate.toISOString() : undefined,
      };
    });

    return enrichedItems;
  }

  /**
   * Check if a movie is truly upcoming (not already released/available)
   */
  private isMovieUpcoming(movie: {
    status?: string;
    releaseDate?: string;
    digitalRelease?: string;
    physicalRelease?: string;
    inCinemas?: string;
  }): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If status is announced, it's definitely upcoming
    if (movie.status === 'announced') {
      return true;
    }

    // If status is released but movie has no file, check if any release date is in the future
    // This handles cases where Radarr marks it as "released" but it's not actually available yet
    const releaseDates = [
      movie.releaseDate,
      movie.digitalRelease,
      movie.physicalRelease,
      movie.inCinemas,
    ].filter(Boolean);

    for (const dateStr of releaseDates) {
      if (dateStr) {
        const releaseDate = new Date(dateStr);
        releaseDate.setHours(0, 0, 0, 0);
        if (releaseDate > today) {
          return true;
        }
      }
    }

    // If status is "released" and all dates are in the past, not upcoming
    if (movie.status === 'released') {
      return false;
    }

    // If status is inCinemas/tba/etc, consider it upcoming
    return true;
  }

  /**
   * Check if a Plex item is one of our Coming Soon placeholders
   */
  private async isPlaceholderItem(
    ratingKey: string,
    mediaType: 'movie' | 'tv',
    plexClient: PlexAPI
  ): Promise<boolean> {
    try {
      const metadata = await plexClient.getMetadata(ratingKey);

      if (mediaType === 'movie') {
        // Check for placeholder edition tags (supports both old and new format)
        const editionTitle = (metadata as unknown as Record<string, unknown>)
          .editionTitle;
        if (
          editionTitle &&
          typeof editionTitle === 'string' &&
          (editionTitle.includes('Placeholder') ||
            editionTitle.includes('Coming Soon'))
        ) {
          return true;
        }

        // Check media file path
        if (metadata.Media && metadata.Media.length > 0) {
          const media = metadata.Media[0] as unknown as Record<string, unknown>;
          const parts = media.Part as { file?: string }[] | undefined;
          if (parts && parts.length > 0) {
            const filePath = parts[0].file;
            if (
              filePath &&
              (filePath.includes('{edition-Placeholder}') ||
                filePath.includes('{edition-Coming Soon}'))
            ) {
              return true;
            }
          }
        }
      } else {
        // For TV shows, check if it only has Season 00
        const childCount = (metadata as unknown as Record<string, unknown>)
          .childCount;
        if (childCount === 1) {
          // Fetch seasons to check if it's only Season 00
          const seasons = await plexClient.getChildrenMetadata(ratingKey);
          if (seasons.length === 1 && seasons[0].index === 0) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      logger.debug('Error checking if item is placeholder', {
        label: 'Coming Soon Collections',
        ratingKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Map source data to CollectionItem format
   * Identifies both real Plex items and our placeholder files, treating placeholders as "missing"
   */
  public async mapSourceDataToItems(
    sourceData: ComingSoonSourceData[],
    config: CollectionConfig,
    plexClient: PlexAPI,
    libraryCache?: LibraryItemsCache
  ): Promise<{
    items: CollectionItem[];
    missingItems: MissingItem[];
    placeholderItems: { ratingKey: string; sourceItem: ComingSoonSourceData }[];
    mappingStats: {
      total: number;
      matched: number;
      unmatched: number;
      placeholders: number;
    };
  }> {
    const items: CollectionItem[] = [];
    const missingItems: MissingItem[] = [];
    const placeholderItems: {
      ratingKey: string;
      sourceItem: ComingSoonSourceData;
    }[] = [];

    logger.info('Mapping Coming Soon items', {
      label: 'Coming Soon Collections',
      sourceCount: sourceData.length,
    });

    // Check for existing items in Plex
    const tmdbLookups = sourceData
      .filter((item) => item.tmdbId > 0)
      .map((item) => ({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
      }));

    const matchedItemsMap = await findPlexItemsByTmdbIds(
      plexClient,
      tmdbLookups,
      config.libraryId,
      libraryCache
    );

    const tmdbToSource = new Map(sourceData.map((s) => [s.tmdbId, s]));
    const matchedTmdbIds = new Set<number>();

    // Check matched items - separate real items from our placeholders
    for (const [tmdbKey, itemData] of matchedItemsMap) {
      const tmdbId = parseInt(tmdbKey.replace('tmdb-', ''), 10);
      const sourceItem = tmdbToSource.get(tmdbId);

      if (!sourceItem) continue;

      // Check if item still exists in Plex and if it's a placeholder
      let itemExists = true;
      let isPlaceholder = false;

      try {
        await plexClient.getMetadata(itemData.ratingKey);
        // If we got here, item exists - now check if it's a placeholder
        isPlaceholder = await this.isPlaceholderItem(
          itemData.ratingKey,
          sourceItem.mediaType,
          plexClient
        );
      } catch (error) {
        // Item doesn't exist anymore (404) - treat as missing and recreate placeholder
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('404')) {
          logger.info('Item was deleted, will recreate placeholder', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            ratingKey: itemData.ratingKey,
          });
          itemExists = false;
        } else {
          // Other error - log and treat as existing to be safe
          logger.warn('Error checking item existence, assuming it exists', {
            label: 'Coming Soon Collections',
            title: sourceItem.title,
            ratingKey: itemData.ratingKey,
            error: errorMessage,
          });
        }
      }

      if (!itemExists) {
        // Item was deleted - don't mark as matched so it will be recreated
        continue;
      }

      matchedTmdbIds.add(tmdbId);

      if (isPlaceholder) {
        // Track placeholder items separately - they need overlays
        placeholderItems.push({
          ratingKey: itemData.ratingKey,
          sourceItem,
        });

        logger.debug('Identified existing placeholder in Plex', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          ratingKey: itemData.ratingKey,
        });

        // Ensure placeholder has the correct label for Recently Added filtering
        // This fixes placeholders that may have been created without the label
        if (sourceItem.mediaType === 'movie') {
          try {
            await plexClient.addLabelToItem(
              itemData.ratingKey,
              'trailer-placeholder'
            );
            logger.debug('Ensured placeholder label exists', {
              label: 'Coming Soon Collections',
              title: sourceItem.title,
              ratingKey: itemData.ratingKey,
            });
          } catch (labelError) {
            logger.warn('Failed to ensure placeholder label', {
              label: 'Coming Soon Collections',
              title: sourceItem.title,
              ratingKey: itemData.ratingKey,
              error:
                labelError instanceof Error
                  ? labelError.message
                  : String(labelError),
            });
          }
        }
      }

      // Add to collection items regardless (both real and placeholders go in collection)
      // Include releaseDateSortValue for multi-source orchestrator sorting
      items.push({
        ratingKey: itemData.ratingKey,
        title: itemData.title,
        type: sourceItem.mediaType || 'movie',
        tmdbId: tmdbId,
        releaseDateSortValue: sourceItem.releaseDateSortValue,
      } as CollectionItem & { releaseDateSortValue?: string });
    }

    // Add missing items (not yet in Plex at all)
    for (const sourceItem of sourceData) {
      if (sourceItem.tmdbId > 0 && !matchedTmdbIds.has(sourceItem.tmdbId)) {
        // isReturning was already set in fetchMonitoredShows based on season number
        missingItems.push({
          tmdbId: sourceItem.tmdbId,
          tvdbId: sourceItem.tvdbId,
          mediaType: sourceItem.mediaType,
          title: sourceItem.title,
          year: sourceItem.year,
          originalPosition: missingItems.length + 1,
          // Placeholder-related fields (needed for createPlaceholdersForMissing)
          releaseDate: sourceItem.releaseDate,
          digitalRelease: sourceItem.digitalRelease,
          physicalRelease: sourceItem.physicalRelease,
          inCinemas: sourceItem.inCinemas,
          airDate: sourceItem.airDate,
          isEstimatedDate: sourceItem.isEstimatedDate,
          seasonNumber: sourceItem.seasonNumber,
          episodeNumber: sourceItem.episodeNumber,
          monitored: sourceItem.monitored,
          source: sourceItem.source,
        });
      }
    }

    logger.info('Mapped Coming Soon items', {
      label: 'Coming Soon Collections',
      total: sourceData.length,
      matched: items.length,
      missing: missingItems.length,
      existingPlaceholders: placeholderItems.length,
    });

    return {
      items,
      missingItems,
      placeholderItems,
      mappingStats: {
        total: sourceData.length,
        matched: items.length,
        unmatched: missingItems.length,
        placeholders: placeholderItems.length,
      },
    };
  }

  /**
   * Retry downloading a trailer if the current file is the fallback placeholder
   * Returns true if the file was replaced, false otherwise
   */
  private async retryTrailerDownload(
    dbItem: ComingSoonItem,
    fallbackPlaceholderSize: number,
    sourceItem: ComingSoonSourceData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    config: CollectionConfig
  ): Promise<boolean> {
    try {
      // Check if the current file size matches the fallback placeholder
      const stats = await fs.stat(dbItem.placeholderPath);

      if (stats.size !== fallbackPlaceholderSize) {
        // File size doesn't match fallback - this is a real trailer
        return false;
      }

      logger.info(
        'Detected fallback placeholder, attempting to download real trailer',
        {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          tmdbId: sourceItem.tmdbId,
        }
      );

      // Attempt to download a real trailer
      const { downloadTrailer } = await import(
        '@server/lib/comingsoon/trailerDownload'
      );
      const trailerPath = await downloadTrailer(
        sourceItem.title,
        sourceItem.year,
        sourceItem.mediaType
      );

      // Check if the downloaded trailer is different from the fallback
      const newStats = await fs.stat(trailerPath);
      if (newStats.size === fallbackPlaceholderSize) {
        // Still the fallback, no real trailer available yet
        logger.debug('No real trailer available yet, keeping fallback', {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
        });
        // Clean up temp file
        try {
          await fs.unlink(trailerPath);
        } catch {
          // Ignore cleanup errors
        }
        return false;
      }

      // We have a real trailer! Replace the placeholder file
      logger.info(
        'Successfully downloaded real trailer, replacing placeholder',
        {
          label: 'Coming Soon Collections',
          title: sourceItem.title,
          oldSize: stats.size,
          newSize: newStats.size,
        }
      );

      await fs.copyFile(trailerPath, dbItem.placeholderPath);

      // Clean up temp file
      try {
        await fs.unlink(trailerPath);
      } catch (error) {
        logger.warn('Failed to clean up temp trailer file', {
          label: 'Coming Soon Collections',
          path: trailerPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return true; // File was replaced
    } catch (error) {
      logger.debug('Failed to retry trailer download', {
        label: 'Coming Soon Collections',
        title: sourceItem.title,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get released items that are within the configured post-release window (default: 7 days)
   * These are items that now have real files in Plex
   */
  private async getReleasedItemsWithinWindow(
    config: CollectionConfig,
    sourceData: ComingSoonSourceData[],
    libraryCache: LibraryItemsCache | undefined
  ): Promise<CollectionItem[]> {
    const { calculateDaysSince } = await import('@server/utils/dateHelpers');
    const releasedItems: CollectionItem[] = [];

    // Get released items from database
    let repository;
    let dbReleasedItems: ComingSoonItem[];
    try {
      repository = getRepository(ComingSoonItem);
      dbReleasedItems = await repository.find({
        where: { configId: config.id },
      });
    } catch {
      // If table doesn't exist yet, return empty
      return [];
    }

    // Filter for items that are released and within configured window from RELEASE DATE
    const releasedWindowDays =
      config.placeholderReleasedDays || config.comingSoonReleasedDays || 7;
    const itemsWithinWindow = dbReleasedItems.filter((item) => {
      // Must have been marked as released (real file detected)
      if (!item.releasedAt) return false;
      // Must have release date to calculate window
      if (!item.releaseDate) return false;
      // Check if release date is within configured window
      const daysSinceReleaseDate = calculateDaysSince(item.releaseDate);
      return (
        daysSinceReleaseDate >= 0 && daysSinceReleaseDate <= releasedWindowDays
      );
    });

    if (itemsWithinWindow.length === 0) {
      return [];
    }

    logger.info(
      `Found released items within ${releasedWindowDays}-day window`,
      {
        label: 'Coming Soon Collections',
        count: itemsWithinWindow.length,
        releasedWindowDays,
      }
    );

    // Find these items in Plex library cache
    for (const dbItem of itemsWithinWindow) {
      try {
        let ratingKey: string | undefined;

        if (libraryCache) {
          // Search library cache for the real item
          const allLibraries = Object.values(libraryCache);
          for (const library of allLibraries) {
            const plexItem = library.find((item) => {
              const tmdbGuid = item.Guid?.find((guid) =>
                guid.id.startsWith('tmdb://')
              );
              const tmdbMatch = tmdbGuid?.id.match(/tmdb:\/\/(\d+)/);
              const itemTmdbId = tmdbMatch ? parseInt(tmdbMatch[1], 10) : null;

              if (dbItem.mediaType === 'movie') {
                return itemTmdbId === dbItem.tmdbId;
              }

              // For TV shows, also check TVDB
              const tvdbGuid = item.Guid?.find((guid) =>
                guid.id.startsWith('tvdb://')
              );
              const tvdbMatch = tvdbGuid?.id.match(/tvdb:\/\/(\d+)/);
              const itemTvdbId = tvdbMatch ? parseInt(tvdbMatch[1], 10) : null;

              return (
                itemTmdbId === dbItem.tmdbId ||
                (dbItem.tvdbId && itemTvdbId === dbItem.tvdbId)
              );
            });

            if (plexItem) {
              ratingKey = plexItem.ratingKey;
              break;
            }
          }
        } else if (dbItem.plexRatingKey) {
          // Use stored rating key
          ratingKey = dbItem.plexRatingKey;
        }

        if (ratingKey) {
          releasedItems.push({
            ratingKey,
            title: dbItem.title,
            type: dbItem.mediaType,
            tmdbId: dbItem.tmdbId,
            releasedAt: dbItem.releasedAt,
          } as CollectionItem & { releasedAt: Date });

          logger.debug('Added released item to collection', {
            label: 'Coming Soon Collections',
            title: dbItem.title,
            tmdbId: dbItem.tmdbId,
            ratingKey,
            daysSinceReleaseDate: dbItem.releaseDate
              ? calculateDaysSince(dbItem.releaseDate)
              : 0,
            releaseDate: dbItem.releaseDate,
          });
        }
      } catch (error) {
        logger.warn('Failed to find released item in Plex', {
          label: 'Coming Soon Collections',
          title: dbItem.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return releasedItems;
  }

  /**
   * Filter source data by date range
   * Only include items within maxDaysAway from today
   */
  private filterSourceDataByDateRange(
    sourceData: ComingSoonSourceData[],
    maxDaysAway: number
  ): ComingSoonSourceData[] {
    const now = new Date();
    const maxDate = new Date(now.getTime() + maxDaysAway * 24 * 60 * 60 * 1000);

    const filteredData = sourceData.filter((item) => {
      let releaseDate: Date | null = null;

      if (item.mediaType === 'movie') {
        // Priority: Digital > Physical > Generic (actual availability, not theatrical)
        if (item.digitalRelease) {
          releaseDate = new Date(item.digitalRelease);
        } else if (item.physicalRelease) {
          releaseDate = new Date(item.physicalRelease);
        } else if (item.releaseDate) {
          releaseDate = new Date(item.releaseDate);
        }
        // inCinemas deliberately excluded - filter by availability date, not theatrical
      } else {
        if (item.airDate) {
          releaseDate = new Date(item.airDate);
        }
      }

      if (!releaseDate) return true; // Keep items without release date

      const isWithinRange = releaseDate <= maxDate;

      if (!isWithinRange) {
        logger.debug('Filtered out Coming Soon item (too far away)', {
          label: 'Coming Soon Collections',
          title: item.title,
          releaseDate: releaseDate.toISOString(),
          daysAway: Math.round(
            (releaseDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
          ),
        });
      }

      return isWithinRange;
    });

    logger.info('Filtered Coming Soon items by date range', {
      label: 'Coming Soon Collections',
      originalCount: sourceData.length,
      filteredCount: filteredData.length,
      excludedCount: sourceData.length - filteredData.length,
      maxDaysAway,
    });

    return filteredData;
  }

  /**
   * Sort collection items by release date (closest first)
   * Items without release dates are placed at the end
   */
  private sortByReleaseDate(
    items: CollectionItem[],
    sourceData: ComingSoonSourceData[]
  ): CollectionItem[] {
    // Create a map of tmdbId to release date
    const releaseDateMap = new Map<number, Date | null>();

    for (const source of sourceData) {
      if (!source.tmdbId) continue;

      // Get the earliest available release date
      let releaseDate: Date | null = null;

      if (source.mediaType === 'movie') {
        // For movies: prioritize actual availability dates (Digital > Physical > Generic)
        // Do NOT use theatrical/cinema dates - content isn't available for Plex until home release
        if (source.digitalRelease) {
          releaseDate = new Date(source.digitalRelease);
        } else if (source.physicalRelease) {
          releaseDate = new Date(source.physicalRelease);
        } else if (source.releaseDate) {
          releaseDate = new Date(source.releaseDate);
        }
        // inCinemas deliberately excluded - theatrical release doesn't mean content is available
      } else {
        // For TV: use airDate
        if (source.airDate) {
          releaseDate = new Date(source.airDate);
        }
      }

      releaseDateMap.set(source.tmdbId, releaseDate);
    }

    logger.debug('Release date map created', {
      label: 'Coming Soon Collections',
      totalSourceItems: sourceData.length,
      itemsWithDates: Array.from(releaseDateMap.values()).filter(
        (d) => d !== null
      ).length,
      sampleTmdbIds: Array.from(releaseDateMap.keys()).slice(0, 5),
    });

    logger.debug('Items to sort', {
      label: 'Coming Soon Collections',
      totalItems: items.length,
      sampleItemTmdbIds: items.slice(0, 5).map((i) => i.tmdbId),
    });

    // Attach release dates to items for multi-source orchestrator sorting
    // This metadata is used when Coming Soon items are combined with other sources
    const itemsWithMetadata = items.map((item) => {
      const date = item.tmdbId ? releaseDateMap.get(item.tmdbId) : null;
      return {
        ...item,
        releaseDateSortValue: date ? date.toISOString() : undefined,
      } as CollectionItem & { releaseDateSortValue?: string };
    });

    // Sort items by release date
    const sortedItems = [...itemsWithMetadata].sort((a, b) => {
      const dateA = a.releaseDateSortValue
        ? new Date(a.releaseDateSortValue)
        : null;
      const dateB = b.releaseDateSortValue
        ? new Date(b.releaseDateSortValue)
        : null;

      // Debug logging for items without dates
      if (!dateA && a.tmdbId) {
        logger.warn('Item has tmdbId but no date in map', {
          label: 'Coming Soon Collections',
          title: a.title,
          tmdbId: a.tmdbId,
          mapHasKey: releaseDateMap.has(a.tmdbId),
        });
      }
      if (!dateB && b.tmdbId) {
        logger.warn('Item has tmdbId but no date in map', {
          label: 'Coming Soon Collections',
          title: b.title,
          tmdbId: b.tmdbId,
          mapHasKey: releaseDateMap.has(b.tmdbId),
        });
      }

      // Items without dates go to the end
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;

      // Sort by closest date first
      return dateA.getTime() - dateB.getTime();
    });

    const firstItemTmdbId = sortedItems[0]?.tmdbId;
    const lastItemTmdbId = sortedItems[sortedItems.length - 1]?.tmdbId;

    // Count how many items have dates vs don't
    const itemsWithDates = sortedItems.filter(
      (item) => item.tmdbId && releaseDateMap.get(item.tmdbId)
    ).length;
    const itemsWithoutDates = sortedItems.length - itemsWithDates;

    logger.debug('Sorted Coming Soon items by release date', {
      label: 'Coming Soon Collections',
      totalItems: sortedItems.length,
      itemsWithDates,
      itemsWithoutDates,
      firstItemDate:
        firstItemTmdbId !== undefined
          ? releaseDateMap.get(firstItemTmdbId)
          : null,
      lastItemDate:
        lastItemTmdbId !== undefined
          ? releaseDateMap.get(lastItemTmdbId)
          : null,
      fullSortedOrder: sortedItems.map((item) => ({
        title: item.title,
        tmdbId: item.tmdbId,
        releaseDate: item.tmdbId ? releaseDateMap.get(item.tmdbId) : null,
      })),
    });

    return sortedItems;
  }
}
