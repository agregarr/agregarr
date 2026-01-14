import PlexAPI, { type PlexLibraryItem } from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { CollectionMissingItems } from '@server/entity/CollectionMissingItems';
import { ComingSoonItem } from '@server/entity/ComingSoonItem';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import path from 'path';

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
    let placeholdersDeleted = 0;
    const librariesNeedingScan = new Set<string>();

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

          // Fetch full metadata for each item to get external GUIDs (TMDB, IMDB, TVDB)
          // The recentlyAdded endpoint only returns internal Plex GUIDs
          // For TV shows, include children metadata so isPlaceholderItem() can check
          // if only Season 00 exists (placeholder detection)
          logger.debug('Fetching full metadata for external GUIDs...', {
            label: 'Collections Quick Sync',
            libraryName: library.name,
          });
          const itemsWithMetadata: PlexLibraryItem[] = [];
          const isShowLibrary = library.type === 'show';
          for (const item of recentItems) {
            try {
              const fullMetadata = await plexClient.getMetadata(
                item.ratingKey,
                { includeChildren: isShowLibrary }
              );
              itemsWithMetadata.push(fullMetadata);
            } catch (error) {
              logger.warn('Failed to fetch metadata for item, skipping', {
                label: 'Collections Quick Sync',
                ratingKey: item.ratingKey,
                title: item.title,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          // Clean up placeholders for recently added real items
          this.setStage(
            `Checking placeholders for library: ${library.name}...`
          );
          const cleanupResult = await this.cleanupPlaceholdersForRecentItems(
            itemsWithMetadata,
            library.key
          );

          placeholdersDeleted += cleanupResult.deletedCount;
          for (const libId of cleanupResult.affectedLibraries) {
            librariesNeedingScan.add(libId);
          }

          // Process these items (match and add to collections)
          const result = await this.processRecentItems(
            itemsWithMetadata,
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

      // Trigger Plex scans for libraries where placeholders were deleted
      if (librariesNeedingScan.size > 0) {
        this.setStage('Triggering Plex scans for placeholder cleanup...');
        for (const libraryId of librariesNeedingScan) {
          try {
            await plexClient.scanLibrary(libraryId);
            logger.info('Triggered Plex scan after placeholder deletion', {
              label: 'Collections Quick Sync',
              libraryId,
            });
          } catch (error) {
            logger.warn(
              'Failed to trigger Plex scan after placeholder deletion',
              {
                label: 'Collections Quick Sync',
                libraryId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
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
        placeholdersDeleted,
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
   * Check recently added Plex items against placeholders and delete placeholders for real items
   * This prevents placeholder accumulation when real content is added
   */
  private async cleanupPlaceholdersForRecentItems(
    recentItems: PlexLibraryItem[],
    libraryId: string
  ): Promise<{ deletedCount: number; affectedLibraries: Set<string> }> {
    const placeholderRepository = getRepository(ComingSoonItem);
    const { placeholderContextService } = await import(
      '@server/lib/placeholders/services/PlaceholderContextService'
    );
    const { removePlaceholder } = await import(
      '@server/lib/placeholders/placeholderManager'
    );

    let deletedCount = 0;
    const affectedLibraries = new Set<string>();

    // Get all placeholders for this library
    const settings = getSettings();
    const collectionsForLibrary = settings.plex.collectionConfigs?.filter(
      (c) => c.libraryId === libraryId && c.createPlaceholdersForMissing
    );

    if (!collectionsForLibrary || collectionsForLibrary.length === 0) {
      return { deletedCount: 0, affectedLibraries };
    }

    const configIds = collectionsForLibrary.map((c) => c.id);
    const placeholders = await placeholderRepository
      .createQueryBuilder('placeholder')
      .where('placeholder.configId IN (:...configIds)', { configIds })
      .getMany();

    if (placeholders.length === 0) {
      return { deletedCount: 0, affectedLibraries };
    }

    logger.info('Checking recently added items against placeholders', {
      label: 'Collections Quick Sync',
      recentItemsCount: recentItems.length,
      placeholdersCount: placeholders.length,
    });

    // Create lookup map of placeholders by TMDB ID
    const placeholdersByTmdbId = new Map<number, ComingSoonItem[]>();
    for (const placeholder of placeholders) {
      if (!placeholdersByTmdbId.has(placeholder.tmdbId)) {
        placeholdersByTmdbId.set(placeholder.tmdbId, []);
      }
      placeholdersByTmdbId.get(placeholder.tmdbId)?.push(placeholder);
    }

    // Check each recent item
    for (const recentItem of recentItems) {
      const tmdbId = this.extractTmdbId(recentItem);
      if (!tmdbId) continue;

      const matchedPlaceholders = placeholdersByTmdbId.get(tmdbId);
      if (!matchedPlaceholders || matchedPlaceholders.length === 0) continue;

      // Cast to extended type to access optional properties used by placeholder detection
      const itemExtended = recentItem as PlexLibraryItem & {
        childCount?: number;
        Children?: { Metadata?: unknown[] };
        seasonCount?: number;
        leafCount?: number;
      };

      // Verify this is real content and not still a placeholder
      const isStillPlaceholder = placeholderContextService.isPlaceholderItem({
        type: itemExtended.type,
        guid: itemExtended.guid,
        editionTitle: itemExtended.editionTitle,
        Guid: itemExtended.Guid,
        childCount: itemExtended.childCount,
        Children: itemExtended.Children,
        seasonCount: itemExtended.seasonCount,
        leafCount: itemExtended.leafCount,
      });

      if (isStillPlaceholder) {
        logger.debug(
          'Skipping placeholder cleanup - Plex item is still a placeholder',
          {
            label: 'Collections Quick Sync',
            title: recentItem.title,
            tmdbId,
          }
        );
        continue;
      }

      // Real content detected - delete placeholders for THIS LIBRARY only
      // Scope deletion to configIds to avoid cross-library deletion
      // Also filter by mediaType to prevent movie/TV ID collisions

      // Get placeholder records for this TMDB ID scoped to this library's configs
      const mediaType = recentItem.type === 'movie' ? 'movie' : 'tv';
      const scopedPlaceholderRecords = await placeholderRepository
        .createQueryBuilder('placeholder')
        .where('placeholder.tmdbId = :tmdbId', { tmdbId })
        .andWhere('placeholder.configId IN (:...configIds)', { configIds })
        .andWhere('placeholder.mediaType = :mediaType', { mediaType })
        .getMany();

      if (scopedPlaceholderRecords.length === 0) {
        logger.debug(
          'Real content detected but no placeholders to remove for this library',
          {
            label: 'Collections Quick Sync',
            title: recentItem.title,
            tmdbId,
            libraryId,
          }
        );
        continue;
      }

      logger.info('Real content detected - cleaning up placeholders', {
        label: 'Collections Quick Sync',
        title: recentItem.title,
        tmdbId,
        recordsToDelete: scopedPlaceholderRecords.length,
        configIds: scopedPlaceholderRecords.map((r) => r.configId),
      });

      // Get the placeholder file path
      const placeholderPath = scopedPlaceholderRecords[0].placeholderPath;

      // Check if other libraries/configs still need this placeholder file
      // Only delete the file if no other records exist for this TMDB ID
      const otherRecordsCount = await placeholderRepository
        .createQueryBuilder('placeholder')
        .where('placeholder.tmdbId = :tmdbId', { tmdbId })
        .andWhere('placeholder.mediaType = :mediaType', { mediaType })
        .andWhere('placeholder.configId NOT IN (:...configIds)', { configIds })
        .getCount();

      let fileDeleted = false;
      const shouldDeleteFile = otherRecordsCount === 0;

      if (placeholderPath && shouldDeleteFile) {
        const { getPlaceholderRootFolder } = await import(
          '@server/lib/placeholders/helpers/placeholderPathHelpers'
        );
        const libraryPath = getPlaceholderRootFolder(libraryId, mediaType);

        if (!libraryPath) {
          logger.warn('Library path not configured - skipping file deletion', {
            label: 'Collections Quick Sync',
            title: recentItem.title,
            mediaType,
            libraryId,
          });
          continue;
        }

        // Construct full path
        const fullPath = path.join(libraryPath, placeholderPath);

        try {
          await removePlaceholder(fullPath, mediaType);
          fileDeleted = true;
          affectedLibraries.add(libraryId);
          logger.info('Deleted placeholder file (real content exists)', {
            label: 'Collections Quick Sync',
            title: recentItem.title,
            path: placeholderPath,
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes('ENOENT')) {
            // File doesn't exist - that's fine, proceed with database cleanup
            fileDeleted = true;
            logger.debug('Placeholder file already deleted', {
              label: 'Collections Quick Sync',
              title: recentItem.title,
              path: fullPath,
            });
          } else {
            logger.error(
              'Failed to delete placeholder file - keeping all database records',
              {
                label: 'Collections Quick Sync',
                title: recentItem.title,
                path: fullPath,
                error: error instanceof Error ? error.message : String(error),
              }
            );
            continue; // Keep ALL database records if file deletion failed
          }
        }
      } else if (!shouldDeleteFile) {
        // File preserved for other libraries/configs
        fileDeleted = true; // Proceed with deleting DB records for this library only
        logger.debug('Keeping placeholder file for other libraries/configs', {
          label: 'Collections Quick Sync',
          title: recentItem.title,
          otherRecordsCount,
        });
      } else {
        fileDeleted = true; // No file to delete
      }

      // Delete database records for this library's configs only
      if (fileDeleted && scopedPlaceholderRecords.length > 0) {
        try {
          await placeholderRepository.remove(scopedPlaceholderRecords);
          deletedCount += scopedPlaceholderRecords.length;
          logger.info('Deleted placeholder records (real content exists)', {
            label: 'Collections Quick Sync',
            title: recentItem.title,
            tmdbId,
            recordsDeleted: scopedPlaceholderRecords.length,
            otherLibraryRecords: otherRecordsCount,
            deletedConfigIds: scopedPlaceholderRecords.map((r) => r.configId),
          });
        } catch (error) {
          logger.error('Failed to delete placeholder database records', {
            label: 'Collections Quick Sync',
            title: recentItem.title,
            tmdbId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (deletedCount > 0) {
      logger.info('Placeholder cleanup completed', {
        label: 'Collections Quick Sync',
        deletedCount,
        affectedLibraries: Array.from(affectedLibraries),
      });
    }

    return { deletedCount, affectedLibraries };
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
      const collectionRatingKey = match.missingItem.collectionRatingKey;
      if (!matchesByCollection.has(collectionRatingKey)) {
        matchesByCollection.set(collectionRatingKey, []);
      }
      matchesByCollection.get(collectionRatingKey)?.push(match);
    }

    // Process each collection
    for (const [
      collectionRatingKey,
      collectionMatches,
    ] of matchesByCollection) {
      if (this.cancelled) break;

      try {
        const added = await this.addItemsToCollection(
          collectionRatingKey,
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
          collectionRatingKey,
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
    collectionRatingKey: string,
    matches: MissingItemMatch[],
    plexClient: PlexAPI
  ): Promise<number> {
    // Optionally get collection config for logging (configId may be null for multi-collection patterns)
    const settings = getSettings();
    const firstMatch = matches[0]?.missingItem;
    const config = firstMatch?.configId
      ? settings.plex.collectionConfigs?.find(
          (c) => c.id === firstMatch.configId
        )
      : null;

    // Sort matches by original position for correct ordering
    const sortedMatches = matches.sort(
      (a, b) => a.missingItem.originalPosition - b.missingItem.originalPosition
    );

    // Add items to collection
    const newItems = sortedMatches.map((m) => ({
      ratingKey: m.plexItem.ratingKey,
      title: m.plexItem.title,
    }));

    await plexClient.addItemsToCollection(collectionRatingKey, newItems);

    logger.info('Added items to collection', {
      label: 'Collections Quick Sync',
      collectionName: config?.name || 'Unknown Collection',
      collectionRatingKey,
      configId: firstMatch?.configId,
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

    // Delete items for deleted configs (both single and multi-collection patterns)
    try {
      const settings = getSettings();
      const activeCollectionIds =
        settings.plex.collectionConfigs?.map((c) => c.id) || [];

      if (activeCollectionIds.length > 0) {
        const orphanResult = await repository
          .createQueryBuilder()
          .delete()
          .where('configId NOT IN (:...activeIds)', {
            activeIds: activeCollectionIds,
          })
          .execute();

        const orphanDeleted = orphanResult.affected || 0;
        totalDeleted += orphanDeleted;

        if (orphanDeleted > 0) {
          logger.info('Deleted orphaned missing items', {
            label: 'Collections Quick Sync',
            count: orphanDeleted,
            note: 'Removed items for deleted parent configs',
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
