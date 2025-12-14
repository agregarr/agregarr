import PlexAPI, { type PlexLibraryItem } from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { CollectionMissingItems } from '@server/entity/CollectionMissingItems';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Match between a recently added Plex item and a stored missing item
 */
interface MissingItemMatch {
  plexItem: PlexLibraryItem;
  missingItem: CollectionMissingItems;
}

/**
 * Collections Quick Sync Job
 * Efficiently adds recently downloaded items to collections without full sync
 *
 * Process:
 * 1. Get items recently added to Plex (since last run)
 * 2. Match against stored missing items from previous full sync
 * 3. Add matched items to collections at correct position
 * 4. Cleanup old missing items data (>30 days)
 */
class CollectionsQuickSync {
  public running = false;
  private cancelled = false;
  private currentStage = '';

  /**
   * Get current status for UI display
   */
  public get status() {
    return {
      running: this.running,
      cancelled: this.cancelled,
      currentStage: this.currentStage,
    };
  }

  /**
   * Cancel the currently running job
   */
  public cancel(): void {
    this.cancelled = true;
    logger.info('Collections Quick Sync cancellation requested', {
      label: 'Collections Quick Sync',
    });
  }

  /**
   * Set current stage for progress tracking
   */
  private setStage(stage: string): void {
    this.currentStage = stage;
    logger.debug(stage, { label: 'Collections Quick Sync' });
  }

  /**
   * Get Plex client with admin token
   */
  private async getPlexClient(): Promise<PlexAPI> {
    const { getAdminUser } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );
    const localAdmin = await getAdminUser();

    if (!localAdmin?.plexToken) {
      throw new Error('No local admin Plex token found');
    }

    const settings = getSettings().load();
    return new PlexAPI({
      plexToken: localAdmin.plexToken,
      plexSettings: settings.plex,
    });
  }

  /**
   * Main job execution
   */
  public async run(): Promise<void> {
    if (this.running) {
      logger.warn('Collections Quick Sync is already running', {
        label: 'Collections Quick Sync',
      });
      return;
    }

    // Skip if full collections sync is running to prevent conflicts
    const collectionsSync = (await import('@server/lib/collectionsSync'))
      .default;
    if (collectionsSync.status.running) {
      logger.info(
        'Full Collections Sync is currently running, skipping Quick Sync',
        {
          label: 'Collections Quick Sync',
        }
      );
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.currentStage = '';

    const startTime = Date.now();
    let itemsMatched = 0;
    let collectionsUpdated = 0;
    let itemsAdded = 0;

    try {
      logger.info('Starting Collections Quick Sync', {
        label: 'Collections Quick Sync',
      });

      // Get last run timestamp (or default to 24 hours ago)
      const settings = getSettings();
      const lastRunStr = settings.main.lastCollectionsQuickSyncAt;
      const cutoffTime = lastRunStr
        ? new Date(lastRunStr).getTime()
        : Date.now() - 24 * 60 * 60 * 1000; // 24 hours default

      logger.info('Checking for items added since last run', {
        label: 'Collections Quick Sync',
        cutoffTime: new Date(cutoffTime).toISOString(),
        isFirstRun: !lastRunStr,
      });

      // Get Plex client
      this.setStage('Connecting to Plex...');
      const plexClient = await this.getPlexClient();

      // Test connection
      const isConnected = await plexClient.getStatus();
      if (!isConnected) {
        throw new Error('Could not connect to Plex server');
      }

      // Get libraries from settings
      const libraries = settings.plex.libraries;

      if (!libraries || libraries.length === 0) {
        logger.warn('No libraries configured', {
          label: 'Collections Quick Sync',
        });
        return;
      }

      // Process each library
      for (const library of libraries) {
        if (this.cancelled) {
          logger.info('Collections Quick Sync cancelled by user', {
            label: 'Collections Quick Sync',
          });
          break;
        }

        this.setStage(`Checking library: ${library.name}...`);

        try {
          // Get recently added items for this library
          const mediaType = library.type === 'show' ? 'show' : 'movie';
          const recentItems = await plexClient.getRecentlyAdded(
            library.key,
            { addedAt: cutoffTime },
            mediaType
          );

          if (!recentItems || recentItems.length === 0) {
            logger.debug('No recently added items in library', {
              label: 'Collections Quick Sync',
              libraryName: library.name,
              libraryKey: library.key,
            });
            continue;
          }

          logger.info('Found recently added items', {
            label: 'Collections Quick Sync',
            libraryName: library.name,
            itemCount: recentItems.length,
          });

          // Process these items (match and add to collections)
          const result = await this.processRecentItems(
            recentItems,
            library.key,
            plexClient
          );

          itemsMatched += result.matched;
          collectionsUpdated += result.collectionsUpdated;
          itemsAdded += result.itemsAdded;
        } catch (error) {
          logger.error('Failed to process library', {
            label: 'Collections Quick Sync',
            libraryName: library.name,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue with next library
        }
      }

      // Cleanup old missing items (>30 days)
      this.setStage('Cleaning up old missing items...');
      const cleanedCount = await this.cleanupOldMissingItems();

      // Update last run timestamp
      settings.main.lastCollectionsQuickSyncAt = new Date().toISOString();
      settings.save();

      const duration = Date.now() - startTime;
      logger.info('Collections Quick Sync completed', {
        label: 'Collections Quick Sync',
        duration: `${Math.round(duration / 1000)}s`,
        itemsMatched,
        collectionsUpdated,
        itemsAdded,
        oldItemsCleaned: cleanedCount,
      });

      this.setStage('Quick sync completed');
    } catch (error) {
      logger.error('Collections Quick Sync failed', {
        label: 'Collections Quick Sync',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.running = false;
      this.cancelled = false;
      this.currentStage = '';
    }
  }

  /**
   * Process recently added items - match and add to collections
   */
  private async processRecentItems(
    recentItems: PlexLibraryItem[],
    libraryId: string,
    plexClient: PlexAPI
  ): Promise<{
    matched: number;
    collectionsUpdated: number;
    itemsAdded: number;
  }> {
    let matched = 0;
    let collectionsUpdated = 0;
    let itemsAdded = 0;

    // Match recent items against missing items database
    const matches = await this.matchAgainstMissingItems(recentItems, libraryId);

    if (matches.length === 0) {
      logger.debug('No matches found for recently added items', {
        label: 'Collections Quick Sync',
        libraryId,
        recentItemCount: recentItems.length,
      });
      return { matched, collectionsUpdated, itemsAdded };
    }

    logger.info('Matched recently added items to collections', {
      label: 'Collections Quick Sync',
      libraryId,
      matchCount: matches.length,
    });

    matched = matches.length;

    // Group matches by collection for efficient processing
    const matchesByCollection = new Map<string, MissingItemMatch[]>();
    for (const match of matches) {
      const collectionId = match.missingItem.collectionId;
      if (!matchesByCollection.has(collectionId)) {
        matchesByCollection.set(collectionId, []);
      }
      matchesByCollection.get(collectionId)?.push(match);
    }

    // Process each collection
    for (const [collectionId, collectionMatches] of matchesByCollection) {
      if (this.cancelled) break;

      try {
        const added = await this.addItemsToCollection(
          collectionId,
          collectionMatches,
          plexClient
        );

        if (added > 0) {
          collectionsUpdated++;
          itemsAdded += added;
        }
      } catch (error) {
        logger.error('Failed to add items to collection', {
          label: 'Collections Quick Sync',
          collectionId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with next collection
      }
    }

    return { matched, collectionsUpdated, itemsAdded };
  }

  /**
   * Match recent Plex items against stored missing items
   */
  private async matchAgainstMissingItems(
    recentItems: PlexLibraryItem[],
    libraryId: string
  ): Promise<MissingItemMatch[]> {
    const repository = getRepository(CollectionMissingItems);
    const matches: MissingItemMatch[] = [];

    // Get all missing items for this library
    const missingItems = await repository.find({
      where: { libraryId },
    });

    if (missingItems.length === 0) {
      return matches;
    }

    // Create lookup maps for efficient matching
    const missingByTmdbId = new Map<number, CollectionMissingItems[]>();
    const missingByTvdbId = new Map<number, CollectionMissingItems[]>();

    for (const missing of missingItems) {
      if (missing.tmdbId) {
        if (!missingByTmdbId.has(missing.tmdbId)) {
          missingByTmdbId.set(missing.tmdbId, []);
        }
        missingByTmdbId.get(missing.tmdbId)?.push(missing);
      }

      if (missing.tvdbId) {
        if (!missingByTvdbId.has(missing.tvdbId)) {
          missingByTvdbId.set(missing.tvdbId, []);
        }
        missingByTvdbId.get(missing.tvdbId)?.push(missing);
      }
    }

    // Match each recent item
    for (const plexItem of recentItems) {
      // Extract TMDB/TVDB IDs from Plex item GUIDs
      const tmdbId = this.extractTmdbId(plexItem);
      const tvdbId = this.extractTvdbId(plexItem);

      let matchedMissingItems: CollectionMissingItems[] = [];

      // Try matching by TMDB ID first
      if (tmdbId && missingByTmdbId.has(tmdbId)) {
        matchedMissingItems = missingByTmdbId.get(tmdbId) || [];
      }
      // Fallback to TVDB ID (for anime)
      else if (tvdbId && missingByTvdbId.has(tvdbId)) {
        matchedMissingItems = missingByTvdbId.get(tvdbId) || [];
      }

      // Create matches for all collections that were missing this item
      for (const missingItem of matchedMissingItems) {
        matches.push({
          plexItem,
          missingItem,
        });
      }
    }

    return matches;
  }

  /**
   * Extract TMDB ID from Plex item GUIDs
   */
  private extractTmdbId(plexItem: PlexLibraryItem): number | undefined {
    if (!plexItem.Guid) return undefined;

    for (const guid of plexItem.Guid) {
      if (guid.id.startsWith('tmdb://')) {
        const match = guid.id.match(/tmdb:\/\/(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    }

    return undefined;
  }

  /**
   * Extract TVDB ID from Plex item GUIDs
   */
  private extractTvdbId(plexItem: PlexLibraryItem): number | undefined {
    if (!plexItem.Guid) return undefined;

    for (const guid of plexItem.Guid) {
      if (guid.id.startsWith('tvdb://')) {
        const match = guid.id.match(/tvdb:\/\/(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
    }

    return undefined;
  }

  /**
   * Add matched items to a collection at correct position
   */
  private async addItemsToCollection(
    collectionId: string,
    matches: MissingItemMatch[],
    plexClient: PlexAPI
  ): Promise<number> {
    // Get collection config
    const settings = getSettings();
    const config = settings.plex.collectionConfigs?.find(
      (c) => c.id === collectionId
    );

    if (!config) {
      logger.warn('Collection config not found, skipping', {
        label: 'Collections Quick Sync',
        collectionId,
      });
      return 0;
    }

    if (!config.collectionRatingKey) {
      logger.warn('Collection has no rating key, skipping', {
        label: 'Collections Quick Sync',
        collectionName: config.name,
        collectionId,
      });
      return 0;
    }

    // Sort matches by original position for correct ordering
    const sortedMatches = matches.sort(
      (a, b) => a.missingItem.originalPosition - b.missingItem.originalPosition
    );

    // Add items to collection
    const newItems = sortedMatches.map((m) => ({
      ratingKey: m.plexItem.ratingKey,
      title: m.plexItem.title,
    }));

    await plexClient.addItemsToCollection(config.collectionRatingKey, newItems);

    logger.info('Added items to collection', {
      label: 'Collections Quick Sync',
      collectionName: config.name,
      collectionId,
      itemsAdded: newItems.length,
      titles: sortedMatches.map((m) => m.missingItem.title),
    });

    // Delete matched missing items from database (they're no longer missing)
    const repository = getRepository(CollectionMissingItems);
    const missingItemIds = matches.map((m) => m.missingItem.id);
    await repository.delete(missingItemIds);

    return newItems.length;
  }

  /**
   * Cleanup old missing items (>30 days) and orphaned items
   */
  private async cleanupOldMissingItems(): Promise<number> {
    const repository = getRepository(CollectionMissingItems);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let totalDeleted = 0;

    // Delete items older than 30 days
    try {
      const oldResult = await repository
        .createQueryBuilder()
        .delete()
        .where('fullSyncTimestamp < :cutoff', { cutoff: thirtyDaysAgo })
        .execute();

      const oldDeleted = oldResult.affected || 0;
      totalDeleted += oldDeleted;

      if (oldDeleted > 0) {
        logger.info('Deleted old missing items', {
          label: 'Collections Quick Sync',
          count: oldDeleted,
          olderThan: '30 days',
        });
      }
    } catch (error) {
      logger.warn('Failed to delete old missing items', {
        label: 'Collections Quick Sync',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Delete items for collections that no longer exist
    try {
      const settings = getSettings();
      const activeCollectionIds =
        settings.plex.collectionConfigs?.map((c) => c.id) || [];

      if (activeCollectionIds.length > 0) {
        const orphanResult = await repository
          .createQueryBuilder()
          .delete()
          .where('collectionId NOT IN (:...activeIds)', {
            activeIds: activeCollectionIds,
          })
          .execute();

        const orphanDeleted = orphanResult.affected || 0;
        totalDeleted += orphanDeleted;

        if (orphanDeleted > 0) {
          logger.info('Deleted orphaned missing items', {
            label: 'Collections Quick Sync',
            count: orphanDeleted,
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to delete orphaned missing items', {
        label: 'Collections Quick Sync',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return totalDeleted;
  }
}

// Export singleton instance
const collectionsQuickSync = new CollectionsQuickSync();
export default collectionsQuickSync;
