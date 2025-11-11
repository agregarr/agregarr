import OverseerrAPI, {
  type OverseerrMediaRequest,
} from '@server/api/overseerr';
import type PlexAPI from '@server/api/plexapi';
import type { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import type { SyncResult } from '@server/lib/collections/core/types';
import type {
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

    // Initialize the global sync cache service for use across all sync operations
    syncCacheService.initialize(overseerrRequestsCache, libraryCache);

    logger.info('Sync caches ready, starting collection processing', {
      label: 'Collection Sync Service',
      libraryCache: cachedLibraryCount,
      requestsCache: overseerrRequestsCache.length,
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
              mediaType: 'movie', // Default, should be set properly by caller
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
              excludedGenres: config.excludedGenres,
              excludedCountries: config.excludedCountries,
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
              smartCollectionRatingKey: config.smartCollectionRatingKey,
              smartCollectionSort: config.smartCollectionSort,
            };

            result = await orchestrator.processMultiSourceCollection(
              multiSourceConfig,
              plexClient,
              allCollections,
              processedCollectionKeys,
              libraryCache,
              undefined, // options
              config // Pass original config for smart collection operations
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

        // Mark collection as successfully synced
        settings.markCollectionSynced(config.id, 'collection');

        // Update progress count
        processedCount++;
        onProgress?.(processedCount);
      } catch (error) {
        logger.error(`Failed to process collection ${config.name}: ${error}`, {
          label: 'Collection Sync Service',
          configId: config.id,
          error: error instanceof Error ? error.message : String(error),
        });

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
  public async createSyncService(type: string): Promise<BaseCollectionSync> {
    switch (type) {
      case 'trakt': {
        const { TraktCollectionSync } = await import('../external/trakt');
        return new TraktCollectionSync();
      }
      case 'mdblist': {
        const { MDBListCollectionSync } = await import('../external/mdblist');
        return new MDBListCollectionSync();
      }
      case 'tmdb': {
        const { TmdbCollectionSync } = await import('../external/tmdb');
        return new TmdbCollectionSync();
      }
      case 'imdb': {
        const { ImdbCollectionSync } = await import('../external/imdb');
        return new ImdbCollectionSync();
      }
      case 'tautulli': {
        const { TautulliCollectionSync } = await import('../external/tautulli');
        return new TautulliCollectionSync();
      }
      case 'letterboxd': {
        const { LetterboxdCollectionSync } = await import(
          '../external/letterboxd'
        );
        return new LetterboxdCollectionSync();
      }
      case 'networks': {
        const { NetworksCollectionSync } = await import('../external/networks');
        return new NetworksCollectionSync();
      }
      case 'originals': {
        const { OriginalsCollectionSync } = await import(
          '../external/originals'
        );
        return new OriginalsCollectionSync();
      }
      case 'anilist': {
        const { AnilistCollectionSync } = await import('../external/anilist');
        return new AnilistCollectionSync();
      }
      case 'myanimelist': {
        const { MyAnimeListCollectionSync } = await import(
          '../external/myanimelist'
        );
        return new MyAnimeListCollectionSync();
      }
      case 'overseerr': {
        const { OverseerrCollectionSync } = await import(
          '../external/overseerrSync'
        );
        return new OverseerrCollectionSync();
      }
      case 'radarrtag': {
        const { RadarrTagCollectionSync } = await import(
          '../external/radarrtag'
        );
        return new RadarrTagCollectionSync();
      }
      case 'sonarrtag': {
        const { SonarrTagCollectionSync } = await import(
          '../external/sonarrtag'
        );
        return new SonarrTagCollectionSync();
      }
      case 'comingsoon': {
        const { ComingSoonCollectionSync } = await import(
          '../external/comingsoon'
        );
        return new ComingSoonCollectionSync();
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
