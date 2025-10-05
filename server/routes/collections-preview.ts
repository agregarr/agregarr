import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type {
  CollectionItem,
  FilteringStats,
  MissingItem,
  NetworksSourceData,
} from '@server/lib/collections/core/types';
import { libraryCacheService } from '@server/lib/collections/services/LibraryCacheService';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const collectionsPreviewRoutes = Router();

// Preview status tracking
interface PreviewStatus {
  running: boolean;
  currentStage: string;
  totalItems: number;
  processedItems: number;
  progress: number;
  error?: string;
  completed: boolean;
  result?: {
    items: unknown[];
    totalItems: number;
    matchedCount: number;
    missingCount: number;
  };
}

// Store preview status by session/request ID
const previewStatuses = new Map<string, PreviewStatus>();

// Cleanup old preview statuses after 5 minutes
setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  for (const [key, status] of previewStatuses.entries()) {
    if (
      status.completed &&
      (status as unknown as { timestamp?: number }).timestamp &&
      (status as unknown as { timestamp: number }).timestamp < fiveMinutesAgo
    ) {
      previewStatuses.delete(key);
    }
  }
}, 60000); // Check every minute

/**
 * GET /api/v1/collections/preview/status/:sessionId
 * Get preview progress status
 */
collectionsPreviewRoutes.get(
  '/status/:sessionId',
  isAuthenticated(),
  (req, res) => {
    const { sessionId } = req.params;
    const status = previewStatuses.get(sessionId);

    if (!status) {
      return res.status(404).json({
        error: 'Preview session not found',
      });
    }

    return res.status(200).json(status);
  }
);

/**
 * Helper function to update preview status
 */
function updatePreviewStatus(
  sessionId: string,
  update: Partial<PreviewStatus>
): void {
  const current = previewStatuses.get(sessionId) || {
    running: false,
    currentStage: '',
    totalItems: 0,
    processedItems: 0,
    progress: 0,
    completed: false,
  };

  previewStatuses.set(sessionId, {
    ...current,
    ...update,
  });
}

/**
 * Preview a collection before creating it
 * Fetches items from the source and matches against Plex library
 * Returns session ID immediately, client polls /status/:sessionId for progress
 */
collectionsPreviewRoutes.post('/', isAuthenticated(), async (req, res) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type, libraryId, ...rest } = req.body;

    // Validate required fields
    if (!type || !libraryId) {
      return res.status(400).json({
        error: 'Missing required fields: type and libraryId are required',
      });
    }

    // Generate session ID
    const sessionId = `preview-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Initialize status
    updatePreviewStatus(sessionId, {
      running: true,
      currentStage: 'Initializing...',
      totalItems: 0,
      processedItems: 0,
      progress: 0,
      completed: false,
    });

    // Return session ID immediately
    res.status(202).json({
      sessionId,
      message: 'Preview started, poll /status/:sessionId for progress',
    });

    // Start preview processing in background
    processPreviewAsync(sessionId, req.body).catch((error) => {
      logger.error('Preview processing failed', {
        label: 'Collections Preview API',
        error: error instanceof Error ? error.message : String(error),
      });

      updatePreviewStatus(sessionId, {
        running: false,
        completed: true,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  } catch (error) {
    logger.error('Failed to start preview', {
      label: 'Collections Preview API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to start preview',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Process preview asynchronously with progress updates
 */
async function processPreviewAsync(
  sessionId: string,
  requestBody: {
    type: string;
    subtype?: string;
    libraryId: string;
    customUrl?: string;
    maxItems?: number;
    timePeriod?: string;
    minimumPlays?: number;
    customDays?: number;
    network?: string;
    country?: string;
    provider?: string;
  }
): Promise<void> {
  try {
    const {
      type,
      subtype,
      libraryId,
      customUrl,
      maxItems,
      timePeriod,
      minimumPlays,
      customDays,
      network,
      country,
      provider,
    } = requestBody;

    logger.info(
      `Preview request for ${type} collection${subtype ? ` (${subtype})` : ''}`,
      {
        label: 'Collections Preview API',
        type,
        subtype,
        libraryId,
      }
    );

    updatePreviewStatus(sessionId, {
      currentStage: 'Connecting to Plex...',
      progress: 5,
    });

    // Get Plex client
    const userRepository = getRepository(User);
    const admin = await userRepository.findOne({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });

    if (!admin || !admin.plexToken) {
      throw new Error('Plex authentication not configured');
    }

    const plexClient = new PlexAPI({ plexToken: admin.plexToken });

    updatePreviewStatus(sessionId, {
      currentStage: 'Loading library information...',
      progress: 10,
    });

    // Get library info
    const libraries = await plexClient.getLibraries();
    const library = libraries.find((lib) => lib.key === libraryId);

    if (!library) {
      throw new Error(`Library not found: ${libraryId}`);
    }

    const mediaType = library.type === 'movie' ? 'movie' : 'tv';

    // Build a temporary config for preview using Record type for flexibility
    const previewConfigRecord: Record<string, unknown> = {
      id: String(-1),
      type,
      subtype: subtype || '',
      name: 'Preview',
      libraryId,
      libraryName: library.title,
      isActive: true,
      visibilityConfig: {
        usersHome: false,
        serverOwnerHome: false,
        libraryRecommended: false,
      },
      maxItems: maxItems || 50,
      template: '',
      isLibraryPromoted: false,
      everLibraryPromoted: false,
    };

    // Add type-specific fields
    if (customUrl) {
      if (type === 'trakt') previewConfigRecord.traktCustomListUrl = customUrl;
      else if (type === 'tmdb')
        previewConfigRecord.tmdbCustomListUrl = customUrl;
      else if (type === 'imdb')
        previewConfigRecord.imdbCustomListUrl = customUrl;
      else if (type === 'letterboxd')
        previewConfigRecord.letterboxdCustomListUrl = customUrl;
      else if (type === 'mdblist')
        previewConfigRecord.mdblistCustomListUrl = customUrl;
    }

    if (type === 'tautulli') {
      previewConfigRecord.timePeriod = timePeriod || 'all';
      previewConfigRecord.minimumPlays = minimumPlays;
      if (timePeriod === 'custom') {
        previewConfigRecord.customDays = customDays;
      }
    }

    if (type === 'networks') {
      // Extract network from subtype if not explicitly provided
      // e.g., "netflix_top_10" -> "netflix"
      const extractedNetwork =
        network || (subtype ? subtype.replace(/_top_10$/, '') : undefined);
      previewConfigRecord.network = extractedNetwork;
      previewConfigRecord.networksCountry = country;
    }

    if (type === 'originals') {
      previewConfigRecord.provider = provider;
    }

    const previewConfig = previewConfigRecord as unknown as CollectionConfig;

    logger.debug('Preview config built', {
      label: 'Collections Preview API',
      config: {
        type: previewConfig.type,
        subtype: previewConfig.subtype,
        libraryId: previewConfig.libraryId,
        network: previewConfigRecord.network,
        country: previewConfigRecord.country,
      },
    });

    // Get library cache for fast matching
    const libraryCache = await libraryCacheService.getCache(plexClient);

    // Create sync service and extract items
    const { collectionSyncService } = await import(
      '@server/lib/collections/services/CollectionSyncService'
    );
    const syncService = await collectionSyncService.createSyncService(type);

    updatePreviewStatus(sessionId, {
      currentStage: 'Fetching collection items...',
      progress: 20,
    });

    // Fetch source data
    const sourceData = await syncService.fetchSourceData(
      previewConfig,
      undefined,
      libraryCache
    );

    if (!sourceData || sourceData.length === 0) {
      updatePreviewStatus(sessionId, {
        running: false,
        completed: true,
        currentStage: 'Complete',
        progress: 100,
        result: {
          items: [],
          totalItems: 0,
          matchedCount: 0,
          missingCount: 0,
        },
      });
      return;
    }

    updatePreviewStatus(sessionId, {
      currentStage: 'Matching items with Plex library...',
      progress: 40,
    });

    // Map to collection items (this performs the Plex matching)
    // Networks collections require mediaType as 5th parameter
    type MapSourceDataResult = {
      items: CollectionItem[];
      missingItems?: MissingItem[];
      stats?: FilteringStats;
    };

    let mappedResult: MapSourceDataResult;

    if (type === 'networks') {
      // Networks sync service has extended signature with mediaType parameter
      const NetworksModule = await import(
        '@server/lib/collections/external/networks'
      );
      mappedResult = await (
        syncService as InstanceType<
          typeof NetworksModule.NetworksCollectionSync
        >
      ).mapSourceDataToItems(
        sourceData as NetworksSourceData[],
        previewConfig,
        plexClient,
        libraryCache,
        mediaType
      );
    } else {
      mappedResult = await syncService.mapSourceDataToItems(
        sourceData,
        previewConfig,
        plexClient,
        libraryCache
      );
    }

    // Filter items by mediaType BEFORE applying other filtering
    // This ensures movies only appear in movie libraries and TV in TV libraries
    const mediaFilteredResult = {
      ...mappedResult,
      items: mappedResult.items.filter((item) => item.type === mediaType),
      missingItems: (mappedResult.missingItems || []).filter(
        (item) => item.mediaType === mediaType
      ),
    };

    // Apply filtering
    const filteredResult = syncService.applyFilteringToMappedItems(
      mediaFilteredResult,
      previewConfig
    );

    // Enrich items with poster URLs and merge in original order
    // Missing items have originalPosition, matched items need position inferred
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();

    // Build position map from all items (missing items have explicit positions)
    const tmdbToPosition = new Map<number, number>();
    (filteredResult.missingItems || []).forEach((item) => {
      tmdbToPosition.set(item.tmdbId, item.originalPosition);
    });

    // Extract tmdbId from metadata if not directly available
    const itemsWithTmdbId = filteredResult.items.map((item) => {
      const tmdbId = item.tmdbId || (item.metadata?.tmdbId as number) || 0;
      return { ...item, tmdbId };
    });

    // Filter out items with invalid tmdbId (0 or undefined) - these can't have posters fetched
    const validMatchedItems = itemsWithTmdbId.filter((item) => {
      if (!item.tmdbId || item.tmdbId === 0) {
        logger.debug(`Filtering out matched item with invalid tmdbId`, {
          label: 'Collections Preview API',
          title: item.title,
          tmdbId: item.tmdbId,
          ratingKey: item.ratingKey,
        });
        return false;
      }
      return true;
    });

    // Assume matched items fill in the gaps - assign them sequential positions
    // This is a best-effort approach since CollectionItem doesn't track originalPosition
    let nextPosition = 1;
    const matchedItemsWithPosition = validMatchedItems.map((item) => {
      // If we know the position from missing items map, skip those positions
      while (Array.from(tmdbToPosition.values()).includes(nextPosition)) {
        nextPosition++;
      }
      const position =
        item.tmdbId && tmdbToPosition.has(item.tmdbId)
          ? tmdbToPosition.get(item.tmdbId) || nextPosition++
          : nextPosition++;

      return { ...item, originalPosition: position };
    });

    type EnrichedItem = {
      ratingKey?: string;
      tmdbId?: number;
      title: string;
      year?: number;
      mediaType?: 'movie' | 'tv';
      posterUrl: string;
      inLibrary: boolean;
      originalPosition: number;
      overview?: string;
      imdbId?: string;
      tmdbRating?: number;
    };

    const allItemsWithPosition: EnrichedItem[] = [];

    // Helper function to fetch TMDB data (poster, title, year, overview, imdbId, rating) with retry logic
    const fetchTmdbDataWithRetry = async (
      tmdbId: number,
      itemMediaType: 'movie' | 'tv',
      fallbackTitle: string,
      maxRetries = 3
    ): Promise<{
      posterUrl: string;
      title: string;
      year?: number;
      overview?: string;
      imdbId?: string;
      tmdbRating?: number;
    }> => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (itemMediaType === 'movie') {
            const movie = await tmdbClient.getMovie({ movieId: tmdbId });
            return {
              posterUrl: movie.poster_path
                ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
                : '',
              title: movie.title || fallbackTitle,
              year: movie.release_date
                ? new Date(movie.release_date).getFullYear()
                : undefined,
              overview: movie.overview,
              imdbId: movie.imdb_id,
              tmdbRating: movie.vote_average,
            };
          } else {
            const show = await tmdbClient.getTvShow({ tvId: tmdbId });
            return {
              posterUrl: show.poster_path
                ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
                : '',
              title: show.name || fallbackTitle,
              year: show.first_air_date
                ? new Date(show.first_air_date).getFullYear()
                : undefined,
              overview: show.overview,
              imdbId: show.external_ids?.imdb_id,
              tmdbRating: show.vote_average,
            };
          }
        } catch (error) {
          if (attempt < maxRetries) {
            // Exponential backoff: 100ms, 200ms, 400ms
            const delay = 100 * Math.pow(2, attempt - 1);
            logger.debug(
              `Retry ${attempt}/${maxRetries} for TMDB data: ${fallbackTitle} (waiting ${delay}ms)`,
              {
                label: 'Collections Preview API',
                tmdbId,
                mediaType: itemMediaType,
              }
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            logger.warn(
              `Failed to fetch TMDB data after ${maxRetries} attempts: ${fallbackTitle}`,
              {
                label: 'Collections Preview API',
                tmdbId,
                mediaType: itemMediaType,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }
        }
      }
      return {
        posterUrl: '',
        title: fallbackTitle,
        year: undefined,
        overview: undefined,
        imdbId: undefined,
        tmdbRating: undefined,
      };
    };

    const totalItemsToProcess =
      matchedItemsWithPosition.length +
      (filteredResult.missingItems || []).length;
    let processedItemsCount = 0;

    updatePreviewStatus(sessionId, {
      currentStage: `Fetching posters (0/${totalItemsToProcess})...`,
      progress: 50,
      totalItems: totalItemsToProcess,
      processedItems: 0,
    });

    // Process matched items with positions
    for (const item of matchedItemsWithPosition) {
      let tmdbData: {
        posterUrl: string;
        title: string;
        year?: number;
        overview?: string;
        imdbId?: string;
        tmdbRating?: number;
      } = {
        posterUrl: '',
        title: item.title,
        year: item.year,
        overview: undefined,
        imdbId: undefined,
        tmdbRating: undefined,
      };

      if (item.tmdbId && item.tmdbId !== 0 && item.type) {
        tmdbData = await fetchTmdbDataWithRetry(
          item.tmdbId,
          item.type,
          item.title
        );
      } else if (item.tmdbId === 0 || !item.tmdbId) {
        logger.debug(`Skipping TMDB fetch for item with invalid tmdbId`, {
          label: 'Collections Preview API',
          title: item.title,
          tmdbId: item.tmdbId,
        });
      }

      allItemsWithPosition.push({
        ratingKey: item.ratingKey,
        title: tmdbData.title,
        year: tmdbData.year,
        tmdbId: item.tmdbId,
        mediaType: item.type,
        posterUrl: tmdbData.posterUrl,
        inLibrary: true,
        originalPosition: item.originalPosition,
        overview: tmdbData.overview,
        imdbId: tmdbData.imdbId,
        tmdbRating: tmdbData.tmdbRating,
      });

      processedItemsCount++;
      const progress =
        50 + Math.floor((processedItemsCount / totalItemsToProcess) * 40);
      updatePreviewStatus(sessionId, {
        currentStage: `Fetching posters (${processedItemsCount}/${totalItemsToProcess})...`,
        progress,
        processedItems: processedItemsCount,
      });
    }

    // Process missing items
    for (const item of filteredResult.missingItems || []) {
      const tmdbData = await fetchTmdbDataWithRetry(
        item.tmdbId,
        item.mediaType,
        item.title
      );

      allItemsWithPosition.push({
        tmdbId: item.tmdbId,
        title: tmdbData.title,
        year: tmdbData.year,
        mediaType: item.mediaType,
        posterUrl: tmdbData.posterUrl,
        inLibrary: false,
        originalPosition: item.originalPosition,
        overview: tmdbData.overview,
        imdbId: tmdbData.imdbId,
        tmdbRating: tmdbData.tmdbRating,
      });

      processedItemsCount++;
      const progress =
        50 + Math.floor((processedItemsCount / totalItemsToProcess) * 40);
      updatePreviewStatus(sessionId, {
        currentStage: `Fetching posters (${processedItemsCount}/${totalItemsToProcess})...`,
        progress,
        processedItems: processedItemsCount,
      });
    }

    updatePreviewStatus(sessionId, {
      currentStage: 'Finalizing preview...',
      progress: 95,
    });

    // Sort all items by original position to maintain source list order
    const enrichedItems = allItemsWithPosition.sort(
      (a, b) => a.originalPosition - b.originalPosition
    );

    const matchedCount = enrichedItems.filter((i) => i.inLibrary).length;
    const missingCount = enrichedItems.filter((i) => !i.inLibrary).length;

    logger.info(
      `Preview complete: ${matchedCount} matched, ${missingCount} missing`,
      {
        label: 'Collections Preview API',
        type,
        subtype,
      }
    );

    updatePreviewStatus(sessionId, {
      running: false,
      completed: true,
      currentStage: 'Complete',
      progress: 100,
      result: {
        items: enrichedItems,
        totalItems: enrichedItems.length,
        matchedCount,
        missingCount,
      },
    });
  } catch (error) {
    logger.error('Failed to preview collection', {
      label: 'Collections Preview API',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Error already handled by the catch in POST route
    throw error;
  }
}

/**
 * Download a missing item from preview to Radarr/Sonarr/Overseerr
 */
collectionsPreviewRoutes.post(
  '/download',
  isAuthenticated(),
  async (req, res) => {
    try {
      const {
        tmdbId,
        mediaType,
        service,
        serverId,
        profileId,
        rootFolder,
        seasons,
        sourceType,
      } = req.body;

      if (!tmdbId || !mediaType || !service) {
        return res.status(400).json({
          error: 'Missing required fields: tmdbId, mediaType, and service',
        });
      }

      if (mediaType !== 'movie' && mediaType !== 'tv') {
        return res.status(400).json({
          error: 'Invalid mediaType, must be movie or tv',
        });
      }

      if (!['radarr', 'sonarr', 'overseerr'].includes(service)) {
        return res.status(400).json({
          error: 'Invalid service, must be radarr, sonarr, or overseerr',
        });
      }

      logger.info(
        `Download request for ${mediaType} (TMDB: ${tmdbId}) via ${service}`,
        {
          label: 'Collections Preview Download API',
          tmdbId,
          mediaType,
          service,
          serverId,
          seasons,
          sourceType,
        }
      );

      if (service === 'overseerr') {
        const OverseerrAPI = (await import('@server/api/overseerr')).default;
        const { ServiceUserManager } = await import(
          '@server/lib/collections/services/ServiceUserManager'
        );
        const settings = getSettings();

        if (!settings.overseerr?.hostname || !settings.overseerr?.apiKey) {
          return res.status(400).json({
            error: 'Overseerr is not configured',
          });
        }

        const overseerrClient = new OverseerrAPI(settings.overseerr);

        // Get the appropriate service user based on collection type and settings
        // Preview requests are always auto-approved since user is manually selecting items
        const serviceUserManager = new ServiceUserManager();
        const serviceUser =
          await serviceUserManager.getOrCreateServiceUserForRequest(
            sourceType || 'imdb', // Fallback to 'imdb' if not provided
            undefined, // No specific collection type for preview
            true // Always auto-approve for preview requests
          );

        logger.info('Creating Overseerr request with service user', {
          label: 'Collections Preview Download API',
          serviceUserId: serviceUser.id,
          externalOverseerrId: serviceUser.externalOverseerrId,
          serviceUserEmail: serviceUser.email,
          tmdbId,
          mediaType,
          seasons: mediaType === 'tv' ? seasons || 'all' : undefined,
        });

        const requestResult = await overseerrClient.createRequest({
          userId: serviceUser.externalOverseerrId || 1, // Use service user's Overseerr ID, fallback to admin
          mediaType,
          mediaId: tmdbId,
          ...(mediaType === 'tv' && { seasons: seasons || 'all' }), // TV shows need seasons
        });

        logger.info('Overseerr request created successfully', {
          label: 'Collections Preview Download API',
          requestId: requestResult.id,
          status: requestResult.status,
          tmdbId,
        });

        return res.status(200).json({
          success: true,
          service: 'overseerr',
          requestId: requestResult.id,
          status: requestResult.status,
        });
      } else if (service === 'radarr' && mediaType === 'movie') {
        const { DirectDownloadService } = await import(
          '@server/lib/collections/services/DirectDownloadService'
        );
        const downloadService = new DirectDownloadService();

        const missingItem = {
          tmdbId,
          mediaType: 'movie' as const,
          title: 'Unknown',
          originalPosition: 1,
        };

        const radarrDownloadConfigRecord: Record<string, unknown> = {
          id: String(-1),
          name: 'Preview Download',
          type: 'imdb',
          libraryId: '',
          libraryName: '',
          isActive: true,
          visibilityConfig: {
            usersHome: false,
            serverOwnerHome: false,
            libraryRecommended: false,
          },
          searchMissingMovies: true,
          searchMissingTV: false,
          radarrServerId: serverId,
          radarrProfileId: profileId,
          radarrRootFolder: rootFolder,
          isLibraryPromoted: false,
          everLibraryPromoted: false,
        };

        const result = await downloadService.processDirectDownloads(
          [missingItem],
          radarrDownloadConfigRecord as unknown as CollectionConfig,
          'imdb'
        );

        return res.status(200).json({
          success: true,
          service: 'radarr',
          autoApproved: result.autoApproved,
          serverId,
        });
      } else if (service === 'sonarr' && mediaType === 'tv') {
        const { DirectDownloadService } = await import(
          '@server/lib/collections/services/DirectDownloadService'
        );
        const downloadService = new DirectDownloadService();

        const missingItem = {
          tmdbId,
          mediaType: 'tv' as const,
          title: 'Unknown',
          originalPosition: 1,
        };

        const sonarrDownloadConfigRecord: Record<string, unknown> = {
          id: String(-1),
          name: 'Preview Download',
          type: 'imdb',
          libraryId: '',
          libraryName: '',
          isActive: true,
          visibilityConfig: {
            usersHome: false,
            serverOwnerHome: false,
            libraryRecommended: false,
          },
          searchMissingMovies: false,
          searchMissingTV: true,
          sonarrServerId: serverId,
          sonarrProfileId: profileId,
          sonarrRootFolder: rootFolder,
          seasonsToRequest: seasons || 'all',
          isLibraryPromoted: false,
          everLibraryPromoted: false,
        };

        const result = await downloadService.processDirectDownloads(
          [missingItem],
          sonarrDownloadConfigRecord as unknown as CollectionConfig,
          'imdb'
        );

        return res.status(200).json({
          success: true,
          service: 'sonarr',
          autoApproved: result.autoApproved,
          serverId,
        });
      } else {
        return res.status(400).json({
          error: `Service ${service} is not compatible with media type ${mediaType}`,
        });
      }
    } catch (error) {
      logger.error('Failed to download preview item', {
        label: 'Collections Preview Download API',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return res.status(500).json({
        error: 'Failed to download item',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default collectionsPreviewRoutes;
