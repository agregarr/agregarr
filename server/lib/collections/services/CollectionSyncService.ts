import OverseerrAPI, {
  type OverseerrMediaRequest,
} from '@server/api/overseerr';
import type PlexAPI from '@server/api/plexapi';
import type { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import { getCollectionMediaType } from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionSource,
  SyncResult,
} from '@server/lib/collections/core/types';
import type {
  DiscoveredMoviePlaceholder,
  DiscoveredPlaceholder,
} from '@server/lib/placeholders/services/PlaceholderDiscovery';
import type {
  CollectionConfig,
  MultiSourceCollectionConfig,
  MultiSourceCombineMode,
  MultiSourceType,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { syncCacheService } from './SyncCacheService';

/**
 * Service for orchestrating collection synchronization across all sources
 * Replaces the large switch statement in collectionsSync.ts with clean service calls
 */
export class CollectionSyncService {
  private cancelled = false;

  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Pre-fetch all Overseerr requests to avoid repeated API calls during sync
   * OPTIMIZATION: Call this ONCE and share the cache across all services
   */
  private async prefetchOverseerrRequests(): Promise<OverseerrMediaRequest[]> {
    try {
      const settings = getSettings();
      const overseerrSettings = settings.overseerr;

      // Only fetch if Overseerr is configured
      if (!overseerrSettings?.hostname || !overseerrSettings?.apiKey) {
        logger.debug('Overseerr not configured, skipping requests cache', {
          label: 'Collection Sync Service',
        });
        return [];
      }

      const overseerrAPI = new OverseerrAPI(overseerrSettings);

      logger.info('Pre-fetching all Overseerr requests for sync optimization', {
        label: 'Collection Sync Service',
      });

      // Fetch with a generous limit to get all requests
      const response = await overseerrAPI.getRequests({ take: 5000 });
      const requestCount = response.results.length;

      logger.info(
        `Overseerr requests cache ready (${requestCount} requests cached)`,
        {
          label: 'Collection Sync Service',
          cachedRequests: requestCount,
        }
      );

      return response.results;
    } catch (error) {
      logger.warn(
        `Failed to pre-fetch Overseerr requests, services will fall back to individual API calls: ${error}`,
        {
          label: 'Collection Sync Service',
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return []; // Return empty array on error, services will handle fallback
    }
  }

  /**
   * Pre-fetch placeholder discovery to avoid repeated filesystem scans during sync
   * OPTIMIZATION: Run discovery ONCE per library and share results across all collections
   */
  private async prefetchPlaceholderDiscovery(
    plexClient: PlexAPI,
    collectionConfigs: CollectionConfig[]
  ): Promise<{
    tv: DiscoveredPlaceholder[];
    movies: DiscoveredMoviePlaceholder[];
  }> {
    const { getPlaceholderRootFolder } = await import(
      '@server/lib/placeholders/helpers/placeholderPathHelpers'
    );

    let tv: DiscoveredPlaceholder[] = [];
    let movies: DiscoveredMoviePlaceholder[] = [];

    // Only run discovery if there are collections with placeholders enabled
    const hasPlaceholderCollections = collectionConfigs.some(
      (c) => c.createPlaceholdersForMissing
    );

    if (!hasPlaceholderCollections) {
      logger.debug('No placeholder-enabled collections, skipping discovery', {
        label: 'Collection Sync Service',
      });
      return { tv, movies };
    }

    // Import discovery functions
    const {
      discoverPlaceholdersFromMarkers,
      discoverMoviePlaceholdersFromFilenames,
    } = await import('@server/lib/placeholders/services/PlaceholderDiscovery');

    // Find the first TV library ID from placeholder-enabled collections
    const tvLibraryId = collectionConfigs.find(
      (c) =>
        c.createPlaceholdersForMissing && getCollectionMediaType(c) === 'tv'
    )?.libraryId;

    // Discover TV placeholders
    const tvLibraryPath = tvLibraryId
      ? getPlaceholderRootFolder(tvLibraryId, 'tv')
      : undefined;
    if (tvLibraryPath && tvLibraryId) {
      try {
        logger.info('Running global TV placeholder discovery', {
          label: 'Collection Sync Service',
          libraryId: tvLibraryId,
          libraryPath: tvLibraryPath,
        });

        tv = await discoverPlaceholdersFromMarkers(
          plexClient,
          tvLibraryId,
          tvLibraryPath
        );

        logger.info('Global TV placeholder discovery complete', {
          label: 'Collection Sync Service',
          discovered: tv.length,
        });

        // Process discovered placeholders immediately: fix titles, cleanup real content
        const { cleanupPlaceholderForRealContent } = await import(
          '@server/lib/placeholders/services/PlaceholderCleanup'
        );
        const { ensurePlaceholderEpisodeTitle } = await import(
          '@server/lib/placeholders/services/PlaceholderTitleFixer'
        );

        let cleanedUp = 0;
        let titlesFixes = 0;

        for (const { plexItem, needsTitleFix, marker } of tv) {
          if (!plexItem) {
            continue; // Not found in Plex
          }

          if (!needsTitleFix && marker.tmdbId) {
            // Real content detected - clean up placeholder
            await cleanupPlaceholderForRealContent(
              marker.tmdbId,
              marker.placeholderPath,
              'tv'
            );
            cleanedUp++;
          } else if (needsTitleFix) {
            // Still a placeholder - fix episode title
            await ensurePlaceholderEpisodeTitle(
              plexClient,
              plexItem.ratingKey,
              marker.title
            );
            titlesFixes++;
          }
        }

        logger.info('Global TV placeholder processing complete', {
          label: 'Collection Sync Service',
          cleanedUp,
          titlesFixes,
        });

        // Trigger Plex library scan + empty trash to remove ghost entries (fire-and-forget)
        if (cleanedUp > 0 && tvLibraryId) {
          const libraryId = tvLibraryId;
          logger.info(
            'Triggering Plex scan to clean up deleted TV placeholders',
            {
              label: 'Collection Sync Service',
              libraryId,
              placeholdersDeleted: cleanedUp,
            }
          );
          // Fire-and-forget: don't block sync while Plex processes
          const autoEmptyTrash = getSettings().plex.autoEmptyTrash !== false;
          void (async () => {
            try {
              await plexClient.scanLibrary(libraryId);
              if (autoEmptyTrash) {
                // Brief delay for scan to detect missing files
                await new Promise((resolve) => setTimeout(resolve, 3000));
                await plexClient.emptyTrash(libraryId);
              }
              logger.info('Plex placeholder cleanup complete', {
                label: 'Collection Sync Service',
                libraryId,
                trashedEmptied: autoEmptyTrash,
              });
            } catch (cleanupError) {
              logger.warn('Failed to complete Plex placeholder cleanup', {
                label: 'Collection Sync Service',
                libraryId,
                error:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError),
              });
            }
          })();
        }
      } catch (error) {
        logger.warn('Failed to run global TV placeholder discovery', {
          label: 'Collection Sync Service',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Find the first movie library ID from placeholder-enabled collections
    const movieLibraryId = collectionConfigs.find(
      (c) =>
        c.createPlaceholdersForMissing && getCollectionMediaType(c) === 'movie'
    )?.libraryId;

    // Discover movie placeholders
    const movieLibraryPath = movieLibraryId
      ? getPlaceholderRootFolder(movieLibraryId, 'movie')
      : undefined;
    if (movieLibraryPath && movieLibraryId) {
      try {
        logger.info('Running global movie placeholder discovery', {
          label: 'Collection Sync Service',
          libraryId: movieLibraryId,
          libraryPath: movieLibraryPath,
        });

        movies = await discoverMoviePlaceholdersFromFilenames(
          plexClient,
          movieLibraryId,
          movieLibraryPath
        );

        logger.info('Global movie placeholder discovery complete', {
          label: 'Collection Sync Service',
          discovered: movies.length,
        });

        // Process discovered movie placeholders: cleanup real content
        const { cleanupPlaceholderForRealContent } = await import(
          '@server/lib/placeholders/services/PlaceholderCleanup'
        );

        let moviesCleanedUp = 0;

        for (const { plexItem, needsCleanup, movie } of movies) {
          if (plexItem && needsCleanup) {
            // Real content detected - clean up placeholder
            await cleanupPlaceholderForRealContent(
              movie.tmdbId,
              movie.placeholderPath,
              'movie'
            );
            moviesCleanedUp++;
          }
        }

        logger.info('Global movie placeholder processing complete', {
          label: 'Collection Sync Service',
          cleanedUp: moviesCleanedUp,
        });

        // Trigger Plex library scan + empty trash to remove ghost entries (fire-and-forget)
        if (moviesCleanedUp > 0 && movieLibraryId) {
          const libraryId = movieLibraryId;
          logger.info(
            'Triggering Plex scan to clean up deleted movie placeholders',
            {
              label: 'Collection Sync Service',
              libraryId,
              placeholdersDeleted: moviesCleanedUp,
            }
          );
          // Fire-and-forget: don't block sync while Plex processes
          const autoEmptyTrash = getSettings().plex.autoEmptyTrash !== false;
          void (async () => {
            try {
              await plexClient.scanLibrary(libraryId);
              if (autoEmptyTrash) {
                // Brief delay for scan to detect missing files
                await new Promise((resolve) => setTimeout(resolve, 3000));
                await plexClient.emptyTrash(libraryId);
              }
              logger.info('Plex placeholder cleanup complete', {
                label: 'Collection Sync Service',
                libraryId,
                trashedEmptied: autoEmptyTrash,
              });
            } catch (cleanupError) {
              logger.warn('Failed to complete Plex placeholder cleanup', {
                label: 'Collection Sync Service',
                libraryId,
                error:
                  cleanupError instanceof Error
                    ? cleanupError.message
                    : String(cleanupError),
              });
            }
          })();
        }
      } catch (error) {
        logger.warn('Failed to run global movie placeholder discovery', {
          label: 'Collection Sync Service',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { tv, movies };
  }

  /**
   * Sync all collection configurations using their respective sync services
   * This replaces the 84-line switch statement with clean, maintainable code
   */
  public async syncAllConfigurations(
    plexClient: PlexAPI,
    onProgress?: (processed: number, currentCollectionName?: string) => void
  ): Promise<SyncResult & { processedCollectionKeys: Set<string> }> {
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];

    logger.info(
      `Starting collections sync (${collectionConfigs.length} configs)`,
      {
        label: 'Collection Sync Service',
      }
    );

    // Check which specific Overseerr collection types are active
    const hasUsersConfig = collectionConfigs.some(
      (config) => config.type === 'overseerr' && config.subtype === 'users'
    );
    const hasServerOwnerConfig = collectionConfigs.some(
      (config) =>
        config.type === 'overseerr' && config.subtype === 'server_owner'
    );

    if (hasUsersConfig || hasServerOwnerConfig) {
      logger.info(
        `Detected Overseerr collections - applying pre-sync user restrictions (users: ${hasUsersConfig}, server_owner: ${hasServerOwnerConfig})`,
        {
          label: 'Collection Sync Service',
          hasUsersConfig,
          hasServerOwnerConfig,
        }
      );

      try {
        onProgress?.(0, 'Applying Overseerr user restrictions...');
        await this.applyPreSyncUserRestrictions(
          hasUsersConfig,
          hasServerOwnerConfig
        );
        logger.info('Pre-sync user restrictions applied successfully', {
          label: 'Collection Sync Service',
        });
      } catch (error) {
        logger.error(
          'Failed to apply pre-sync user restrictions - continuing with sync',
          {
            label: 'Collection Sync Service',
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    } else if (settings.main.overseerrLabelsApplied !== false) {
      // No Overseerr user configs exist but labels might be applied - clean them up
      // This handles: true (labels known to be applied) and undefined (unknown state, be safe for existing users)
      logger.info(
        'No Overseerr user collections detected but labels might exist - cleaning up user filter labels',
        {
          label: 'Collection Sync Service',
          labelState: settings.main.overseerrLabelsApplied,
        }
      );

      try {
        onProgress?.(0, 'Cleaning up user filter labels...');
        await this.cleanupUserFilterLabels();
        logger.info('User filter labels cleanup completed successfully', {
          label: 'Collection Sync Service',
        });
      } catch (error) {
        logger.warn(
          'Failed to cleanup user filter labels - continuing with sync',
          {
            label: 'Collection Sync Service',
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    } else {
      // No Overseerr user configs and labels confirmed not applied - skip cleanup entirely
      logger.debug(
        'No Overseerr user collections detected and labels confirmed not applied - skipping cleanup',
        {
          label: 'Collection Sync Service',
        }
      );
    }

    // OPTIMIZATION: Use shared library cache for sync optimization
    // This eliminates repeated API calls across all collection sources
    onProgress?.(0, 'Loading shared library cache...');

    const { libraryCacheService } = await import('./LibraryCacheService');
    const libraryCache = await libraryCacheService.getCache(plexClient);
    const cachedLibraryCount = Object.keys(libraryCache).length;

    logger.info(
      `Shared library cache ready (${cachedLibraryCount} libraries cached)`,
      {
        label: 'Collection Sync Service',
        cachedLibraries: cachedLibraryCount,
      }
    );

    // Pre-fetch Overseerr requests cache
    onProgress?.(0, 'Pre-fetching Overseerr requests...');
    const overseerrRequestsCache = await this.prefetchOverseerrRequests();

    // Pre-fetch placeholder discovery cache
    onProgress?.(0, 'Discovering placeholders...');
    const placeholderDiscovery = await this.prefetchPlaceholderDiscovery(
      plexClient,
      collectionConfigs
    );

    // Initialize the global sync cache service for use across all sync operations
    syncCacheService.initialize(overseerrRequestsCache, libraryCache);
    syncCacheService.setPlaceholderDiscoveryCache(
      placeholderDiscovery.tv,
      placeholderDiscovery.movies
    );

    logger.info('Sync caches ready, starting collection processing', {
      label: 'Collection Sync Service',
      libraryCache: cachedLibraryCount,
      requestsCache: overseerrRequestsCache.length,
      placeholderDiscoveryTv: placeholderDiscovery.tv.length,
      placeholderDiscoveryMovies: placeholderDiscovery.movies.length,
    });

    let totalCreated = 0;
    let totalUpdated = 0;
    const processedCollectionKeys = new Set<string>();
    let processedCount = 0;

    // Process each collection config directly
    for (const config of collectionConfigs) {
      if (this.cancelled) break;

      try {
        let created = 0;
        let updated = 0;

        // Report collection processing start
        onProgress?.(processedCount, `Processing "${config.name}"...`);

        // Wait for API access for this collection type to prevent concurrent access
        const { IndividualCollectionScheduler } = await import(
          './IndividualCollectionScheduler'
        );
        await IndividualCollectionScheduler.waitForApiAccess(
          config.type,
          config.id,
          config.name,
          config.libraryId
        );

        // Check if this collection has custom scheduling enabled
        const hasCustomSchedule = config.customSyncSchedule?.enabled;

        if (hasCustomSchedule) {
          // Skip content sync for custom scheduled collections - just ensure it's tracked
          onProgress?.(
            processedCount,
            `Skipping content sync for "${config.name}" (custom scheduled)...`
          );

          const collectionKey = `${config.libraryId}-${config.name}`;
          processedCollectionKeys.add(collectionKey);

          logger.debug(
            `Skipped content sync for custom scheduled collection: ${config.name}`,
            {
              label: 'Collection Sync Service',
              configId: config.id,
            }
          );
        } else {
          // Get the sync service for this config type and process it normally
          const allCollections = await plexClient.getAllCollections();

          let result: SyncResult;
          if (config.type === 'multi-source') {
            // Use new multi-source orchestrator for distinct multi-source collections
            const { MultiSourceOrchestrator } = await import(
              './MultiSourceOrchestrator'
            );
            const orchestrator = new MultiSourceOrchestrator();

            // Convert CollectionConfig to MultiSourceCollectionConfig format
            const multiSourceConfig: MultiSourceCollectionConfig = {
              id: config.id,
              name: config.name,
              type: 'multi-source',
              visibilityConfig: config.visibilityConfig,
              mediaType: getCollectionMediaType(config),
              libraryId: config.libraryId,
              libraryName: config.libraryName,
              maxItems: config.maxItems ?? 50, // Provide default for multi-source
              template: config.template || '', // Provide default for multi-source
              sources:
                config.sources?.map((source) => ({
                  id: source.id,
                  type: source.type as MultiSourceType,
                  subtype: source.subtype || '',
                  customUrl: source.customUrl,
                  timePeriod: source.timePeriod as
                    | 'daily'
                    | 'weekly'
                    | 'monthly'
                    | 'all'
                    | undefined,
                  customDays: source.customDays,
                  minimumPlays: source.minimumPlays,
                  priority: source.priority,
                  networksCountry: source.networksCountry,
                  radarrTagServerId: source.radarrTagServerId,
                  radarrTagId: source.radarrTagId,
                  radarrTagLabel: source.radarrTagLabel,
                  sonarrTagServerId: source.sonarrTagServerId,
                  sonarrTagId: source.sonarrTagId,
                  sonarrTagLabel: source.sonarrTagLabel,
                })) || [],
              combineMode:
                (config.combineMode as MultiSourceCombineMode) || 'list_order',
              isActive: config.isActive,
              sortOrderHome: config.sortOrderHome,
              sortOrderLibrary: config.sortOrderLibrary,
              isLibraryPromoted: config.isLibraryPromoted,
              timeRestriction: config.timeRestriction,
              customPoster: config.customPoster,
              autoPoster: config.autoPoster,
              autoPosterTemplate: config.autoPosterTemplate,
              // Wallpaper, summary, and theme settings
              customWallpaper: config.customWallpaper,
              customSummary: config.customSummary,
              customTheme: config.customTheme,
              enableCustomWallpaper: config.enableCustomWallpaper,
              enableCustomSummary: config.enableCustomSummary,
              enableCustomTheme: config.enableCustomTheme,
              // Missing items / auto-download settings
              downloadMode: config.downloadMode,
              searchMissingMovies: config.searchMissingMovies,
              searchMissingTV: config.searchMissingTV,
              autoApproveMovies: config.autoApproveMovies,
              autoApproveTV: config.autoApproveTV,
              maxSeasonsToRequest: config.maxSeasonsToRequest,
              seasonsPerShowLimit: config.seasonsPerShowLimit,
              maxPositionToProcess: config.maxPositionToProcess,
              minimumYear: config.minimumYear,
              filterSettings: config.filterSettings,
              directDownloadRadarrServerId: config.directDownloadRadarrServerId,
              directDownloadRadarrProfileId:
                config.directDownloadRadarrProfileId,
              directDownloadRadarrRootFolder:
                config.directDownloadRadarrRootFolder,
              directDownloadSonarrServerId: config.directDownloadSonarrServerId,
              directDownloadSonarrProfileId:
                config.directDownloadSonarrProfileId,
              directDownloadSonarrRootFolder:
                config.directDownloadSonarrRootFolder,
              // Smart collection settings (unwatched filter feature)
              showUnwatchedOnly: config.showUnwatchedOnly,
              smartCollectionSort: config.smartCollectionSort,
              // Placeholder creation settings
              createPlaceholdersForMissing: config.createPlaceholdersForMissing,
              placeholderDaysAhead: config.placeholderDaysAhead,
              placeholderReleasedDays: config.placeholderReleasedDays,
              includeAllReleasedItems: config.includeAllReleasedItems,
              applyOverlaysDuringSync: config.applyOverlaysDuringSync,
            };

            result = await orchestrator.processMultiSourceCollection(
              multiSourceConfig,
              plexClient,
              allCollections,
              processedCollectionKeys,
              libraryCache,
              undefined // options
            );
          } else {
            // Use normal single-source sync
            const syncService = await this.createSyncService(config.type);
            result = await syncService.processCollections(
              [config],
              plexClient,
              allCollections,
              processedCollectionKeys,
              libraryCache
            );
          }

          created += result.created || 0;
          updated += result.updated || 0;

          // Check if the sync returned an error (e.g., from multi-source orchestrator)
          if (result.error) {
            logger.warn(
              `Collection sync returned error for ${config.name}: ${result.error}`,
              {
                label: 'Collection Sync Service',
                configId: config.id,
              }
            );
            // Persist error for UI display
            settings.setCollectionSyncError(config.id, result.error);
          } else {
            // Mark collection as successfully synced (clears any previous error)
            settings.markCollectionSynced(config.id, 'collection');
          }
        }

        totalCreated += created;
        totalUpdated += updated;

        if (created > 0 || updated > 0) {
          logger.info(
            `Collection processed: ${config.name} (created: ${created}, updated: ${updated})`,
            {
              label: 'Collection Sync Service',
            }
          );
        }

        // Update progress count
        processedCount++;
        onProgress?.(processedCount);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Failed to process collection ${config.name}: ${error}`, {
          label: 'Collection Sync Service',
          configId: config.id,
          error: errorMessage,
        });

        // Persist error for UI display
        settings.setCollectionSyncError(config.id, errorMessage);

        // Still increment counter to avoid getting stuck
        processedCount++;
        onProgress?.(processedCount);
      } finally {
        // Always release the API, regardless of success or failure
        const { IndividualCollectionScheduler } = await import(
          './IndividualCollectionScheduler'
        );
        IndividualCollectionScheduler.releaseApiAccess(config.type);
      }
    }

    // Clear the sync cache after completion to free memory
    syncCacheService.clear();

    logger.debug('Sync caches cleared after completion', {
      label: 'Collection Sync Service',
    });

    return {
      created: totalCreated,
      updated: totalUpdated,
      processedCollectionKeys,
    };
  }

  /**
   * Apply user filter restrictions before sync to prevent visibility window
   * This ensures users can't see each other's collections during the sync process
   */
  private async applyPreSyncUserRestrictions(
    hasUsersConfig: boolean,
    hasServerOwnerConfig: boolean
  ): Promise<void> {
    try {
      // Import the user management functions
      const { applySelectivePreSyncUserRestrictions } = await import(
        '@server/lib/collections/plex/PlexUserManager'
      );

      // Apply restrictions only for the specific collection types that are active
      await applySelectivePreSyncUserRestrictions(
        hasUsersConfig,
        hasServerOwnerConfig
      );

      // Mark labels as applied
      const settings = getSettings();
      settings.setOverseerrLabelsApplied(true);
    } catch (error) {
      throw new Error(
        `Failed to apply pre-sync user restrictions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Clean up user filter labels when no Overseerr user configs exist
   * Removes AgregarrOverseerr* labels from all users' filter settings
   */
  private async cleanupUserFilterLabels(): Promise<void> {
    try {
      // Import user management functions
      const { getAllPlexUserIds, updateUserFilterSettings } = await import(
        '@server/lib/collections/plex/PlexUserManager'
      );

      // Get all Plex users
      const allPlexUserIds = await getAllPlexUserIds();
      if (allPlexUserIds.length === 0) {
        logger.debug('No Plex users found - skipping user filter cleanup', {
          label: 'Collection Sync Service',
        });
        return;
      }

      // Clean up each user's filter settings to remove Agregarr labels
      for (const userId of allPlexUserIds) {
        try {
          // Pass empty array for activeOverseerrUserIds to remove all Agregarr labels
          await updateUserFilterSettings(userId, allPlexUserIds, []);
        } catch (error) {
          logger.warn(
            `Failed to cleanup user filter labels for user ${userId}`,
            {
              label: 'Collection Sync Service',
              userId,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      logger.info(
        `Cleaned up user filter labels for ${allPlexUserIds.length} users`,
        {
          label: 'Collection Sync Service',
          usersProcessed: allPlexUserIds.length,
        }
      );

      // Mark labels as removed
      const settings = getSettings();
      settings.setOverseerrLabelsApplied(false);
    } catch (error) {
      throw new Error(
        `Failed to cleanup user filter labels: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Create the appropriate sync service for a given collection type
   * Simple factory method without over-engineering
   */
  public async createSyncService(
    type: string
  ): Promise<BaseCollectionSync<CollectionSource>> {
    switch (type) {
      case 'trakt': {
        const { TraktCollectionSync } = await import('../sources/trakt');
        return new TraktCollectionSync();
      }
      case 'mdblist': {
        const { MDBListCollectionSync } = await import('../sources/mdblist');
        return new MDBListCollectionSync();
      }
      case 'tmdb': {
        const { TmdbCollectionSync } = await import('../sources/tmdb');
        return new TmdbCollectionSync();
      }
      case 'imdb': {
        const { ImdbCollectionSync } = await import('../sources/imdb');
        return new ImdbCollectionSync();
      }
      case 'tautulli': {
        const { TautulliCollectionSync } = await import('../sources/tautulli');
        return new TautulliCollectionSync();
      }
      case 'letterboxd': {
        const { LetterboxdCollectionSync } = await import(
          '../sources/letterboxd'
        );
        return new LetterboxdCollectionSync();
      }
      case 'networks': {
        const { NetworksCollectionSync } = await import('../sources/networks');
        return new NetworksCollectionSync();
      }
      case 'originals': {
        const { OriginalsCollectionSync } = await import(
          '../sources/originals'
        );
        return new OriginalsCollectionSync();
      }
      case 'anilist': {
        const { AnilistCollectionSync } = await import('../sources/anilist');
        return new AnilistCollectionSync();
      }
      case 'myanimelist': {
        const { MyAnimeListCollectionSync } = await import(
          '../sources/myanimelist'
        );
        return new MyAnimeListCollectionSync();
      }
      case 'overseerr': {
        const { OverseerrCollectionSync } = await import(
          '../sources/overseerrSync'
        );
        return new OverseerrCollectionSync();
      }
      case 'radarrtag': {
        const { RadarrTagCollectionSync } = await import('../sources/radarr');
        return new RadarrTagCollectionSync();
      }
      case 'sonarrtag': {
        const { SonarrTagCollectionSync } = await import('../sources/sonarr');
        return new SonarrTagCollectionSync();
      }
      case 'comingsoon': {
        const { ComingSoonCollectionSync } = await import(
          '../sources/comingsoon'
        );
        return new ComingSoonCollectionSync();
      }
      case 'filtered_hub': {
        const { FilteredHubCollectionSync } = await import(
          '../sources/recentlyadded'
        );
        return new FilteredHubCollectionSync();
      }
      case 'plex': {
        const { PlexLibraryCollectionSync } = await import(
          '../sources/plexlibrary'
        );
        return new PlexLibraryCollectionSync();
      }
      case 'multi-source':
        throw new Error(
          'Multi-source collections should be handled by MultiSourceOrchestrator, not individual sync services'
        );
      default:
        throw new Error(`Unknown collection type: ${type}`);
    }
  }
}

// Create and export singleton instance
export const collectionSyncService = new CollectionSyncService();
export default collectionSyncService;
