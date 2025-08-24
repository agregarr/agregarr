import OverseerrAPI, {
  type OverseerrMediaRequest,
} from '@server/api/overseerr';
import type PlexAPI from '@server/api/plexapi';
import type { BaseCollectionSync } from '@server/lib/collections/core/BaseCollectionSync';
import { prefetchAllLibraryItems } from '@server/lib/collections/core/CollectionUtilities';
import type { SyncResult } from '@server/lib/collections/core/types';
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
    plexClient: PlexAPI
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
    } else {
      // No Overseerr user configs exist - clean up any existing user filter labels
      logger.info(
        'No Overseerr user collections detected - cleaning up user filter labels',
        {
          label: 'Collection Sync Service',
        }
      );

      try {
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
    }

    // OPTIMIZATION: Pre-fetch all library content and Overseerr requests once at the start of sync
    // This eliminates repeated API calls across all collection sources
    logger.info('Pre-fetching all library content for sync optimization', {
      label: 'Collection Sync Service',
    });

    const libraryCache = await prefetchAllLibraryItems(plexClient);
    const cachedLibraryCount = Object.keys(libraryCache).length;

    logger.info(
      `Library content cache ready (${cachedLibraryCount} libraries cached)`,
      {
        label: 'Collection Sync Service',
        cachedLibraries: cachedLibraryCount,
      }
    );

    // Pre-fetch Overseerr requests cache
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

    // Process each collection config directly
    for (const config of collectionConfigs) {
      if (this.cancelled) break;

      try {
        let created = 0;
        let updated = 0;

        // Get the sync service for this config type and process it
        const syncService = await this.createSyncService(config.type);
        const allCollections = await plexClient.getAllCollections();
        const result = await syncService.processCollections(
          [config],
          plexClient,
          allCollections,
          processedCollectionKeys,
          libraryCache
        );

        created += result.created || 0;
        updated += result.updated || 0;

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
      } catch (error) {
        logger.error(`Failed to process collection ${config.name}: ${error}`, {
          label: 'Collection Sync Service',
          configId: config.id,
          error: error instanceof Error ? error.message : String(error),
        });
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
  private async createSyncService(type: string): Promise<BaseCollectionSync> {
    switch (type) {
      case 'trakt': {
        const { TraktCollectionSync } = await import('../external/trakt');
        return new TraktCollectionSync();
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
      case 'overseerr': {
        const { OverseerrCollectionSync } = await import(
          '../external/overseerrSync'
        );
        return new OverseerrCollectionSync();
      }
      default:
        throw new Error(`Unknown collection type: ${type}`);
    }
  }
}

// Create and export singleton instance
export const collectionSyncService = new CollectionSyncService();
export default collectionSyncService;
