import PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';
import type {
  CollectionItem,
  ItemProducingSource,
  MissingItem,
} from '@server/lib/collections/core/types';
import { libraryCacheService } from '@server/lib/collections/services/LibraryCacheService';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings, getTmdbLanguage } from '@server/lib/settings';
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
    const { type, libraryId, forceRefresh, ...rest } = req.body;

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
        error:
          error instanceof Error
            ? error.message
            : JSON.stringify(error) || String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
      });

      updatePreviewStatus(sessionId, {
        running: false,
        completed: true,
        error:
          error instanceof Error
            ? error.message
            : JSON.stringify(error) || 'Unknown error',
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
 * Generate a user-friendly display name for a source
 */
function getSourceDisplayName(source: {
  type: string;
  subtype?: string;
  customUrl?: string;
  timePeriod?: string;
  customDays?: number;
  minimumPlays?: number;
  networksCountry?: string;
}): string {
  const { type, subtype, customUrl, timePeriod, customDays, networksCountry } =
    source;

  // Handle custom URLs
  if (customUrl) {
    const sourceNames: Record<string, string> = {
      trakt: 'Trakt',
      tmdb: 'TMDb',
      imdb: 'IMDb',
      letterboxd: 'Letterboxd',
      mdblist: 'MDBList',
      anilist: 'AniList',
    };
    return `${sourceNames[type] || type} Custom List`;
  }

  // Handle specific source types
  switch (type) {
    case 'imdb': {
      const subtypeNames: Record<string, string> = {
        top_250: 'Top 250',
        popular_movies: 'Popular Movies',
        popular_shows: 'Popular Shows',
      };
      return `IMDb ${subtypeNames[subtype || ''] || subtype || 'List'}`;
    }

    case 'trakt': {
      const subtypeNames: Record<string, string> = {
        trending: 'Trending',
        popular: 'Popular',
        anticipated: 'Anticipated',
        boxoffice: 'Box Office',
        watched: 'Most Watched',
        collected: 'Most Collected',
      };
      const baseName = `Trakt ${
        subtypeNames[subtype || ''] || subtype || 'List'
      }`;
      if (timePeriod && timePeriod !== 'all') {
        const periods: Record<string, string> = {
          daily: 'Daily',
          weekly: 'Weekly',
          monthly: 'Monthly',
        };
        return `${baseName} (${periods[timePeriod] || timePeriod})`;
      }
      return baseName;
    }

    case 'tmdb': {
      const subtypeNames: Record<string, string> = {
        popular: 'Popular',
        top_rated: 'Top Rated',
        upcoming: 'Upcoming',
        now_playing: 'Now Playing',
        airing_today: 'Airing Today',
        on_the_air: 'On The Air',
      };
      return `TMDb ${subtypeNames[subtype || ''] || subtype || 'List'}`;
    }

    case 'letterboxd':
      return 'Letterboxd List';

    case 'mdblist':
      return 'MDBList';

    case 'networks': {
      // Extract network name from subtype (e.g., "netflix_top_10" -> "Netflix")
      const networkName =
        subtype
          ?.replace(/_top_10$/, '')
          .split('_')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ') || 'Network';
      const country = networksCountry?.toUpperCase() || '';
      return `${networkName} Top 10${country ? ` (${country})` : ''}`;
    }

    case 'originals': {
      const providerName =
        subtype
          ?.split('_')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ') || 'Provider';
      return `${providerName} Originals`;
    }

    case 'tautulli': {
      const subtypeNames: Record<string, string> = {
        most_popular_plays: 'Most Popular (Plays)',
        most_popular_duration: 'Most Popular (Duration)',
        most_watched_plays: 'Most Watched (Plays)',
        most_watched_duration: 'Most Watched (Duration)',
      };
      const baseName = `Tautulli ${
        subtypeNames[subtype || ''] || subtype || 'Stats'
      }`;
      if (timePeriod === 'custom' && customDays) {
        return `${baseName} (${customDays} days)`;
      }
      const periods: Record<string, string> = {
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly',
        all: 'All Time',
      };
      return `${baseName} (${periods[timePeriod || 'all'] || timePeriod})`;
    }

    case 'overseerr': {
      const subtypeNames: Record<string, string> = {
        requests: 'All Requests',
        users: 'User Requests',
      };
      return `Overseerr ${subtypeNames[subtype || ''] || 'Requests'}`;
    }

    case 'anilist':
      return subtype
        ? `AniList ${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`
        : 'AniList';

    case 'myanimelist':
      return subtype
        ? `MyAnimeList ${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`
        : 'MyAnimeList';

    case 'comingsoon':
      return 'Coming Soon';

    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

/**
 * Process multi-source preview - fetches from multiple sources and combines them
 */
async function processMultiSourcePreview(
  sessionId: string,
  sources: {
    id: string;
    type: string;
    subtype?: string;
    customUrl?: string;
    timePeriod?: string;
    priority: number;
    customDays?: number;
    minimumPlays?: number;
    networksCountry?: string;
  }[],
  combineMode: 'interleaved' | 'list_order' | 'randomised' | 'cycle_lists',
  maxItems: number,
  libraryId: string,
  libraryName: string,
  mediaType: 'movie' | 'tv',
  plexClient: PlexAPI,
  libraryCache: LibraryItemsCache,
  cycleIndex: number,
  forceRefresh = false
): Promise<void> {
  const { collectionSyncService } = await import(
    '@server/lib/collections/services/CollectionSyncService'
  );
  const TmdbAPI = (await import('@server/api/themoviedb')).default;
  const tmdbClient = new TmdbAPI();

  // For cycle_lists mode, only fetch from the selected source
  // For other modes, fetch from all sources
  const sourcesToFetch =
    combineMode === 'cycle_lists'
      ? [sources[cycleIndex % sources.length]]
      : sources;

  // Generate initial status message
  const initialStage =
    combineMode === 'cycle_lists'
      ? `Loading ${getSourceDisplayName(sourcesToFetch[0])}...`
      : `Fetching from ${sourcesToFetch.length} source(s)...`;

  updatePreviewStatus(sessionId, {
    currentStage: initialStage,
    progress: 20,
  });

  const allItemGroups: CollectionItem[][] = [];
  const allMissingItemGroups: MissingItem[][] = [];

  // Fetch items from each source
  for (let i = 0; i < sourcesToFetch.length; i++) {
    const source = sourcesToFetch[i];
    const sourceDisplayName = getSourceDisplayName(source);

    try {
      updatePreviewStatus(sessionId, {
        currentStage: `Fetching from ${sourceDisplayName}...`,
        progress: 20 + (i / sourcesToFetch.length) * 20,
      });

      // Build temp config for this source
      const sourceConfigRecord: Record<string, unknown> = {
        id: `preview-${source.id}`,
        type: source.type,
        subtype: source.subtype || '',
        name: `Preview Source ${i + 1}`,
        libraryId,
        libraryName,
        isActive: true,
        visibilityConfig: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
        maxItems: 0, // Don't limit per-source, we'll limit the combined result
        template: '',
        isLibraryPromoted: false,
        everLibraryPromoted: false,
      };

      // Add type-specific fields
      if (source.customUrl) {
        if (source.type === 'trakt')
          sourceConfigRecord.traktCustomListUrl = source.customUrl;
        else if (source.type === 'tmdb')
          sourceConfigRecord.tmdbCustomCollectionUrl = source.customUrl;
        else if (source.type === 'imdb')
          sourceConfigRecord.imdbCustomListUrl = source.customUrl;
        else if (source.type === 'letterboxd')
          sourceConfigRecord.letterboxdCustomListUrl = source.customUrl;
        else if (source.type === 'mdblist')
          sourceConfigRecord.mdblistCustomListUrl = source.customUrl;
        else if (source.type === 'anilist')
          sourceConfigRecord.anilistCustomListUrl = source.customUrl;
      }

      if (source.type === 'tautulli') {
        sourceConfigRecord.timePeriod = source.timePeriod || 'all';
        sourceConfigRecord.minimumPlays = source.minimumPlays;
        if (source.timePeriod === 'custom') {
          sourceConfigRecord.customDays = source.customDays;
        }
      }

      if (source.type === 'networks') {
        const extractedNetwork =
          source.subtype?.replace(/_top_10$/, '') || undefined;
        sourceConfigRecord.network = extractedNetwork;
        sourceConfigRecord.networksCountry = source.networksCountry;
      }

      const sourceConfig = sourceConfigRecord as unknown as CollectionConfig;

      // Fetch items from this source
      const syncService = await collectionSyncService.createSyncService(
        source.type
      );
      // Use cached data unless forceRefresh is true
      const sourceData = await syncService.fetchSourceDataWithCache(
        sourceConfig,
        { useCache: !forceRefresh },
        libraryCache
      );

      if (sourceData && sourceData.length > 0) {
        // Map to collection items
        const mappedResult = await syncService.mapSourceDataToItems(
          sourceData,
          sourceConfig,
          plexClient,
          libraryCache
        );

        // Filter by media type
        const mediaFilteredResult = {
          ...mappedResult,
          items: mappedResult.items.filter((item) => item.type === mediaType),
          missingItems: (mappedResult.missingItems || []).filter(
            (item) => item.mediaType === mediaType
          ),
        };

        // Apply filtering
        const filteredResult = await syncService.applyFilteringToMappedItems(
          mediaFilteredResult,
          sourceConfig
        );

        // For Coming Soon sources, add monitored status to items
        if (source.type === 'comingsoon' && filteredResult.items.length > 0) {
          filteredResult.items.forEach((item) => {
            const sourceItem = (
              sourceData as { tmdbId: number; monitored?: boolean }[]
            )?.find((s) => s.tmdbId === item.tmdbId);
            if (sourceItem?.monitored !== undefined) {
              // Store monitored status in metadata
              item.metadata = {
                ...item.metadata,
                monitored: sourceItem.monitored,
              };
            }
          });
        }

        if (filteredResult.items.length > 0) {
          allItemGroups.push(filteredResult.items);
        }
        if (
          filteredResult.missingItems &&
          filteredResult.missingItems.length > 0
        ) {
          allMissingItemGroups.push(filteredResult.missingItems);
        }

        logger.debug(
          `Fetched ${filteredResult.items.length} items from ${sourceDisplayName}`,
          {
            label: 'Collections Preview API - Multi-Source',
            sourceId: source.id,
            sourceType: source.type,
            sourceDisplayName,
          }
        );
      }
    } catch (error) {
      logger.error(`Failed to fetch from ${sourceDisplayName}:`, {
        label: 'Collections Preview API - Multi-Source',
        sourceId: source.id,
        sourceType: source.type,
        sourceDisplayName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with other sources
    }
  }

  updatePreviewStatus(sessionId, {
    currentStage: 'Combining items from all sources...',
    progress: 40,
  });

  // Combine items according to mode
  let combinedItems: CollectionItem[] = [];
  switch (combineMode) {
    case 'interleaved': {
      // Interleave items from all sources
      const maxLength = Math.max(
        ...allItemGroups.map((group) => group.length),
        0
      );
      for (let i = 0; i < maxLength; i++) {
        for (const group of allItemGroups) {
          if (i < group.length) {
            combinedItems.push(group[i]);
          }
        }
      }
      break;
    }
    case 'list_order':
      // Concatenate all sources in order
      combinedItems = allItemGroups.flat();
      break;
    case 'randomised': {
      // Shuffle all items
      const allItems = allItemGroups.flat();
      for (let i = allItems.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allItems[i], allItems[j]] = [allItems[j], allItems[i]];
      }
      combinedItems = allItems;
      break;
    }
    case 'cycle_lists':
      // For cycle_lists, we only fetched from one source (at cycleIndex)
      // So just use that one source's items
      combinedItems = allItemGroups.flat();
      break;
  }

  // Remove duplicates based on ratingKey or tmdbId
  const seen = new Set<string>();
  const uniqueItems = combinedItems.filter((item) => {
    const key = item.ratingKey || `tmdb-${item.tmdbId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  // Combine missing items (remove duplicates)
  const allMissingItems = allMissingItemGroups.flat();
  const seenMissing = new Set<string>();
  const uniqueMissingItems = allMissingItems.filter((item) => {
    const key = `${item.tmdbId}-${item.mediaType}`;
    if (seenMissing.has(key)) {
      return false;
    }
    seenMissing.add(key);
    return true;
  });

  // Apply maxItems limit to combined items
  const limitedItems =
    maxItems > 0 ? uniqueItems.slice(0, maxItems) : uniqueItems;
  const limitedMissingItems =
    maxItems > 0
      ? uniqueMissingItems.slice(0, Math.max(0, maxItems - limitedItems.length))
      : uniqueMissingItems;

  // Now process the combined items for preview display (enrich with TMDB data)
  // This is the same logic as single-source preview
  updatePreviewStatus(sessionId, {
    currentStage: 'Matching items with Plex library...',
    progress: 50,
  });

  // Build position map from missing items
  const tmdbToPosition = new Map<number, number>();
  limitedMissingItems.forEach((item, index) => {
    tmdbToPosition.set(item.tmdbId, item.originalPosition || index + 1);
  });

  // Assign positions to matched items
  let nextPosition = 1;
  const matchedItemsWithPosition = limitedItems.map((item) => {
    const tmdbId = item.tmdbId || (item.metadata?.tmdbId as number) || 0;
    while (Array.from(tmdbToPosition.values()).includes(nextPosition)) {
      nextPosition++;
    }
    const position = tmdbToPosition.has(tmdbId)
      ? tmdbToPosition.get(tmdbId) || nextPosition++
      : nextPosition++;

    return { ...item, tmdbId, originalPosition: position };
  });

  type EnrichedItem = {
    ratingKey?: string;
    tmdbId?: number;
    title: string;
    year?: number;
    mediaType?: 'movie' | 'tv';
    posterUrl: string;
    backdropPath?: string;
    inLibrary: boolean;
    isPlaceholder?: boolean;
    monitored?: boolean;
    originalPosition: number;
    overview?: string;
    imdbId?: string;
    tmdbRating?: number;
  };

  const allItemsWithPosition: EnrichedItem[] = [];

  // For Coming Soon multi-source collections, check if matched items are placeholders
  let placeholderRatingKeys: Set<string> | undefined;
  const hasComingSoonSource = sources.some((s) => s.type === 'comingsoon');
  if (hasComingSoonSource) {
    const { getRepository } = await import('@server/datasource');
    const { ComingSoonItem } = await import('@server/entity/ComingSoonItem');
    const comingSoonRepository = getRepository(ComingSoonItem);
    const allPlaceholders = await comingSoonRepository.find({
      select: { plexRatingKey: true, placeholderPath: true },
    });
    // Only consider items with placeholderPath as actual placeholders
    placeholderRatingKeys = new Set(
      allPlaceholders
        .filter((p) => p.placeholderPath)
        .map((p) => p.plexRatingKey)
        .filter((key): key is string => !!key)
    );

    logger.debug(
      'Loaded placeholder rating keys for Coming Soon multi-source preview',
      {
        label: 'Collections Preview API - Multi-Source',
        placeholderCount: placeholderRatingKeys.size,
      }
    );
  }

  const totalItemsToProcess =
    matchedItemsWithPosition.length + limitedMissingItems.length;

  updatePreviewStatus(sessionId, {
    currentStage: `Fetching posters (0/${totalItemsToProcess})...`,
    progress: 60,
    totalItems: totalItemsToProcess,
    processedItems: 0,
  });

  // Helper function to fetch TMDB data with retry logic (same as single-source)
  const fetchTmdbDataWithRetry = async (
    tmdbId: number,
    itemMediaType: 'movie' | 'tv',
    fallbackTitle: string,
    maxRetries = 3
  ): Promise<{
    posterUrl: string;
    backdropPath?: string;
    title: string;
    year?: number;
    overview?: string;
    imdbId?: string;
    tmdbRating?: number;
  }> => {
    const language = await getTmdbLanguage(libraryId);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (itemMediaType === 'movie') {
          const movie = await tmdbClient.getMovie({ movieId: tmdbId });
          const images = await tmdbClient.getMovieImages({
            movieId: tmdbId,
            language,
          });

          // Find poster in selected language, fallback to main poster from movie details
          const poster = images.posters.find((p) => p.iso_639_1 === language);

          return {
            posterUrl: poster
              ? `https://image.tmdb.org/t/p/w300_and_h450_face${poster.file_path}`
              : movie.poster_path
              ? `https://image.tmdb.org/t/p/w300_and_h450_face${movie.poster_path}`
              : '',
            backdropPath: movie.backdrop_path || undefined,
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
          const images = await tmdbClient.getTvShowImages({
            tvId: tmdbId,
            language,
          });

          const poster = images.posters.find((p) => p.iso_639_1 === language);

          return {
            posterUrl: poster
              ? `https://image.tmdb.org/t/p/w300_and_h450_face${poster.file_path}`
              : show.poster_path
              ? `https://image.tmdb.org/t/p/w300_and_h450_face${show.poster_path}`
              : '',
            backdropPath: show.backdrop_path || undefined,
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
          const delay = 100 * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          logger.warn(
            `Failed to fetch TMDB data after ${maxRetries} attempts: ${fallbackTitle}`,
            {
              label: 'Collections Preview API - Multi-Source',
              tmdbId,
              mediaType: itemMediaType,
            }
          );
        }
      }
    }
    return {
      posterUrl: '',
      backdropPath: undefined,
      title: fallbackTitle,
      year: undefined,
      overview: undefined,
      imdbId: undefined,
      tmdbRating: undefined,
    };
  };

  // Fetch all TMDB data in parallel - TMDB client handles rate limiting automatically
  updatePreviewStatus(sessionId, {
    currentStage: 'Fetching posters...',
    progress: 60,
  });

  // Fetch matched items
  const matchedTmdbDataResults = await Promise.all(
    matchedItemsWithPosition.map(async (item) => {
      if (item.tmdbId && item.tmdbId !== 0 && item.type) {
        return fetchTmdbDataWithRetry(item.tmdbId, item.type, item.title);
      }
      return {
        posterUrl: '',
        backdropPath: undefined,
        title: item.title,
        year: item.year,
        overview: undefined,
        imdbId: undefined,
        tmdbRating: undefined,
      };
    })
  );

  // Process matched items
  matchedItemsWithPosition.forEach((item, index) => {
    const tmdbData = matchedTmdbDataResults[index];

    // Check if this is a Coming Soon placeholder
    let isPlaceholder = false;
    if (
      placeholderRatingKeys &&
      item.ratingKey &&
      placeholderRatingKeys.has(item.ratingKey)
    ) {
      isPlaceholder = true;
    }

    // Get monitored status from metadata (set during Coming Soon source fetch)
    const monitored = item.metadata?.monitored as boolean | undefined;

    allItemsWithPosition.push({
      ratingKey: item.ratingKey,
      title: tmdbData.title,
      year: tmdbData.year,
      tmdbId: item.tmdbId,
      mediaType: item.type,
      posterUrl: tmdbData.posterUrl,
      backdropPath: tmdbData.backdropPath,
      inLibrary: true,
      isPlaceholder,
      monitored,
      originalPosition: item.originalPosition,
      overview: tmdbData.overview,
      imdbId: tmdbData.imdbId,
      tmdbRating: tmdbData.tmdbRating,
    });
  });

  updatePreviewStatus(sessionId, {
    currentStage: 'Fetching posters...',
    progress: 75,
  });

  // Fetch missing items
  const missingTmdbDataResults = await Promise.all(
    limitedMissingItems.map((item) =>
      fetchTmdbDataWithRetry(item.tmdbId, item.mediaType, item.title)
    )
  );

  // Process missing items
  limitedMissingItems.forEach((item, index) => {
    const tmdbData = missingTmdbDataResults[index];
    allItemsWithPosition.push({
      tmdbId: item.tmdbId,
      title: tmdbData.title,
      year: tmdbData.year,
      mediaType: item.mediaType,
      posterUrl: tmdbData.posterUrl,
      backdropPath: tmdbData.backdropPath,
      inLibrary: false,
      originalPosition: item.originalPosition,
      overview: tmdbData.overview,
      imdbId: tmdbData.imdbId,
      tmdbRating: tmdbData.tmdbRating,
    });
  });

  // Sort by original position
  const enrichedItems = allItemsWithPosition.sort(
    (a, b) => a.originalPosition - b.originalPosition
  );

  const matchedCount = enrichedItems.filter((i) => i.inLibrary).length;
  const missingCount = enrichedItems.filter((i) => !i.inLibrary).length;

  logger.info(
    `Multi-source preview complete: ${matchedCount} matched, ${missingCount} missing`,
    {
      label: 'Collections Preview API - Multi-Source',
      sourceCount: sources.length,
      combineMode,
      ...(combineMode === 'cycle_lists' && {
        cycleIndex,
        activeSource: sources[cycleIndex % sources.length]?.type,
      }),
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
}

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
    // TMDB advanced discover filters
    tmdbAdvancedFilters?: CollectionConfig['tmdbAdvancedFilters'];
    tmdbMovieSortBy?: string;
    tmdbTvSortBy?: string;
    tmdbOnlyIncludeAvailableOnPlex?: boolean;
    maxItems?: number;
    timePeriod?: string;
    minimumPlays?: number;
    customDays?: number;
    network?: string;
    country?: string;
    provider?: string;
    // Radarr/Sonarr tag specific fields
    radarrTagId?: number;
    sonarrTagId?: number;
    radarrInstanceId?: number;
    sonarrInstanceId?: number;
    forceRefresh?: boolean; // If true, bypass cache and fetch fresh data
    // Multi-source specific fields
    isMultiSource?: boolean;
    sources?: {
      id: string;
      type: string;
      subtype?: string;
      customUrl?: string;
      timePeriod?: string;
      priority: number;
      customDays?: number;
      minimumPlays?: number;
      networksCountry?: string;
    }[];
    combineMode?: 'interleaved' | 'list_order' | 'randomised' | 'cycle_lists';
    cycleIndex?: number; // For cycle_lists mode, which source to show
  }
): Promise<void> {
  try {
    const {
      type,
      subtype,
      libraryId,
      customUrl,
      tmdbAdvancedFilters,
      tmdbMovieSortBy,
      tmdbTvSortBy,
      tmdbOnlyIncludeAvailableOnPlex,
      maxItems,
      timePeriod,
      minimumPlays,
      customDays,
      network,
      country,
      provider,
      radarrTagId,
      radarrInstanceId,
      sonarrTagId,
      sonarrInstanceId,
      forceRefresh,
      isMultiSource,
      sources,
      combineMode,
      cycleIndex,
    } = requestBody;

    logger.info(
      `Preview request for ${type} collection${subtype ? ` (${subtype})` : ''}`,
      {
        label: 'Collections Preview API',
        type,
        subtype,
        libraryId,
        customUrl,
        hasCustomUrl: !!customUrl,
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

    // Get library info - filter to only movie and show libraries
    const allLibraries = await plexClient.getLibraries();
    const libraries = allLibraries.filter(
      (lib) => lib.type === 'movie' || lib.type === 'show'
    );
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
        previewConfigRecord.tmdbCustomCollectionUrl = customUrl;
      else if (type === 'imdb')
        previewConfigRecord.imdbCustomListUrl = customUrl;
      else if (type === 'letterboxd')
        previewConfigRecord.letterboxdCustomListUrl = customUrl;
      else if (type === 'mdblist')
        previewConfigRecord.mdblistCustomListUrl = customUrl;
      else if (type === 'anilist')
        previewConfigRecord.anilistCustomListUrl = customUrl;
      else if (type === 'myanimelist')
        previewConfigRecord.myanilistCustomListUrl = customUrl;
    }

    if (type === 'radarrtag') {
      previewConfigRecord.radarrTagId = radarrTagId;
      previewConfigRecord.radarrInstanceId = radarrInstanceId;
    }

    if (type === 'sonarrtag') {
      previewConfigRecord.sonarrTagId = sonarrTagId;
      previewConfigRecord.sonarrInstanceId = sonarrInstanceId;
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

    if (type === 'tmdb' && subtype === 'advanced_custom_tmdb') {
      // Handle TMDB Custom Advanced Filters collections
      previewConfigRecord.tmdbAdvancedFilters = tmdbAdvancedFilters;
      previewConfigRecord.tmdbMovieSortBy = tmdbMovieSortBy;
      previewConfigRecord.tmdbTvSortBy = tmdbTvSortBy;
      previewConfigRecord.tmdbOnlyIncludeAvailableOnPlex =
        tmdbOnlyIncludeAvailableOnPlex;
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
        hasAdvancedFilters: !!previewConfigRecord.tmdbAdvancedFilters,
      },
    });

    // Get library cache for fast matching
    const libraryCache = await libraryCacheService.getCache(plexClient);

    // Handle multi-source collections differently
    if (isMultiSource || type === 'multi-source') {
      if (!sources || sources.length === 0) {
        throw new Error('Multi-source collection requires at least one source');
      }

      return await processMultiSourcePreview(
        sessionId,
        sources,
        combineMode || 'interleaved',
        maxItems || 50,
        libraryId,
        library.title,
        mediaType,
        plexClient,
        libraryCache,
        cycleIndex || 0,
        forceRefresh || false
      );
    }

    // Create sync service and extract items (single source)
    const { collectionSyncService } = await import(
      '@server/lib/collections/services/CollectionSyncService'
    );
    const syncService = await collectionSyncService.createSyncService(type);

    updatePreviewStatus(sessionId, {
      currentStage: forceRefresh
        ? 'Fetching fresh collection items...'
        : 'Loading collection items...',
      progress: 20,
    });

    // Fetch source data - use cached data unless forceRefresh is true
    const sourceData = await syncService.fetchSourceDataWithCache(
      previewConfig,
      { useCache: !forceRefresh },
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
    const mappedResult = await syncService.mapSourceDataToItems(
      sourceData,
      previewConfig,
      plexClient,
      libraryCache
    );

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
    const filteredResult = await syncService.applyFilteringToMappedItems(
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

    // Keep all matched items
    // Only missing items need TMDB IDs for poster fetching
    const validMatchedItems = itemsWithTmdbId;

    // Extract originalPosition from metadata (AniList and other sources provide this)
    const matchedItemsWithPosition = validMatchedItems.map((item) => {
      const originalPosition = (item.metadata?.originalPosition as number) || 0;
      return { ...item, originalPosition };
    });

    type EnrichedItem = {
      ratingKey?: string;
      tmdbId?: number;
      tvdbId?: number;
      title: string;
      year?: number;
      mediaType?: 'movie' | 'tv';
      posterUrl: string;
      backdropPath?: string;
      inLibrary: boolean;
      isPlaceholder?: boolean;
      monitored?: boolean;
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
      backdropPath?: string;
      title: string;
      year?: number;
      overview?: string;
      imdbId?: string;
      tmdbRating?: number;
    }> => {
      const language = await getTmdbLanguage(requestBody.libraryId);

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (itemMediaType === 'movie') {
            const movie = await tmdbClient.getMovie({ movieId: tmdbId });
            const images = await tmdbClient.getMovieImages({
              movieId: tmdbId,
              language,
            });

            // Find poster in selected language, fallback to main poster from movie details
            const poster = images.posters.find((p) => p.iso_639_1 === language);

            return {
              posterUrl: poster
                ? `https://image.tmdb.org/t/p/w300_and_h450_face${poster.file_path}`
                : movie.poster_path
                ? `https://image.tmdb.org/t/p/w300_and_h450_face${movie.poster_path}`
                : '',
              backdropPath: movie.backdrop_path || undefined,
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
            const images = await tmdbClient.getTvShowImages({
              tvId: tmdbId,
              language,
            });

            const poster = images.posters.find((p) => p.iso_639_1 === language);

            return {
              posterUrl: poster
                ? `https://image.tmdb.org/t/p/w300_and_h450_face${poster.file_path}`
                : show.poster_path
                ? `https://image.tmdb.org/t/p/w300_and_h450_face${show.poster_path}`
                : '',
              backdropPath: show.backdrop_path || undefined,
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
        backdropPath: undefined,
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

    updatePreviewStatus(sessionId, {
      currentStage: `Fetching posters (0/${totalItemsToProcess})...`,
      progress: 50,
      totalItems: totalItemsToProcess,
      processedItems: 0,
    });

    // Fetch all TMDB data in parallel - TMDB client handles rate limiting automatically
    updatePreviewStatus(sessionId, {
      currentStage: 'Fetching posters...',
      progress: 50,
    });

    // Fetch matched items
    const matchedTmdbDataResults = await Promise.all(
      matchedItemsWithPosition.map(async (item) => {
        if (item.tmdbId && item.tmdbId !== 0 && item.type) {
          return fetchTmdbDataWithRetry(item.tmdbId, item.type, item.title);
        }
        return {
          posterUrl: '',
          title: item.title,
          year: item.year,
          overview: undefined,
          imdbId: undefined,
          tmdbRating: undefined,
        };
      })
    );

    // For Coming Soon collections, check if matched items are placeholders
    let placeholderRatingKeys: Set<string> | undefined;
    if (type === 'comingsoon') {
      const { getRepository } = await import('@server/datasource');
      const { ComingSoonItem } = await import('@server/entity/ComingSoonItem');
      const comingSoonRepository = getRepository(ComingSoonItem);
      const allPlaceholders = await comingSoonRepository.find({
        select: { plexRatingKey: true, placeholderPath: true },
      });
      // Only consider items with placeholderPath as actual placeholders
      // Items without placeholderPath are regular items (like returning shows)
      placeholderRatingKeys = new Set(
        allPlaceholders
          .filter((p) => p.placeholderPath) // Has placeholder file
          .map((p) => p.plexRatingKey)
          .filter((key): key is string => !!key)
      );

      logger.debug('Loaded placeholder rating keys for Coming Soon preview', {
        label: 'Collections Preview API',
        placeholderCount: placeholderRatingKeys.size,
      });
    }

    // Process matched items
    matchedItemsWithPosition.forEach((item, index) => {
      const tmdbData = matchedTmdbDataResults[index];

      // For Coming Soon, check if this is a placeholder by ratingKey
      let isPlaceholder = false;
      if (
        type === 'comingsoon' &&
        placeholderRatingKeys &&
        item.ratingKey &&
        placeholderRatingKeys.has(item.ratingKey)
      ) {
        isPlaceholder = true;
      }

      // Get monitored status from source data for Coming Soon
      let monitored: boolean | undefined;
      if (type === 'comingsoon' && item.tmdbId) {
        // Find this item in sourceData to get monitored status
        const sourceItem = (
          sourceData as { tmdbId: number; monitored?: boolean }[]
        )?.find((s) => s.tmdbId === item.tmdbId);
        monitored = sourceItem?.monitored;
      }

      allItemsWithPosition.push({
        ratingKey: item.ratingKey,
        title: tmdbData.title,
        year: tmdbData.year,
        tmdbId: item.tmdbId,
        mediaType: item.type,
        posterUrl: tmdbData.posterUrl,
        inLibrary: true,
        isPlaceholder,
        monitored,
        originalPosition: item.originalPosition,
        overview: tmdbData.overview,
        imdbId: tmdbData.imdbId,
        tmdbRating: tmdbData.tmdbRating,
      });
    });

    updatePreviewStatus(sessionId, {
      currentStage: 'Fetching posters...',
      progress: 70,
    });

    // Fetch missing items
    const missingItems = filteredResult.missingItems || [];
    const missingTmdbDataResults = await Promise.all(
      missingItems.map((item) =>
        // Skip TMDB fetch if tmdbId is 0 or missing (item couldn't be matched)
        item.tmdbId && item.tmdbId > 0
          ? fetchTmdbDataWithRetry(item.tmdbId, item.mediaType, item.title)
          : Promise.resolve({
              posterUrl: '',
              backdropPath: undefined,
              title: item.title,
              year: undefined,
              overview: undefined,
              imdbId: undefined,
              tmdbRating: undefined,
            })
      )
    );

    // Process missing items
    missingItems.forEach((item, index) => {
      const tmdbData = missingTmdbDataResults[index];
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
    });

    updatePreviewStatus(sessionId, {
      currentStage: 'Finalizing preview...',
      progress: 95,
    });

    // Sort all items by original position to maintain source list order
    const sortedItems = allItemsWithPosition.sort(
      (a, b) => a.originalPosition - b.originalPosition
    );

    // Deduplicate by TMDB ID - keep first occurrence (earliest position)
    // This prevents multiple seasons/variants of the same show from appearing
    const seenTmdbIds = new Set<number>();
    const seenRatingKeys = new Set<string>();
    const enrichedItems = sortedItems.filter((item) => {
      // For matched items, deduplicate by ratingKey
      if (item.ratingKey) {
        if (seenRatingKeys.has(item.ratingKey)) return false;
        seenRatingKeys.add(item.ratingKey);
        return true;
      }
      // For missing items, deduplicate by tmdbId
      if (item.tmdbId && item.tmdbId > 0) {
        if (seenTmdbIds.has(item.tmdbId)) return false;
        seenTmdbIds.add(item.tmdbId);
        return true;
      }
      return true;
    });

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

    logger.debug('Preview final item list', {
      label: 'Collections Preview API',
      items: enrichedItems.map((item) => ({
        title: item.title,
        tmdbId: item.tmdbId,
        tvdbId: item.tvdbId,
        ratingKey: item.ratingKey,
        inLibrary: item.inLibrary,
        mediaType: item.mediaType,
        position: item.originalPosition,
      })),
    });

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
        collectionName,
        subtype,
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
          collectionName,
          subtype,
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
          ...(serverId !== undefined && { serverId }),
          ...(profileId !== undefined && { profileId }),
          ...(rootFolder !== undefined && { rootFolder }),
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
          source: (sourceType || 'imdb') as ItemProducingSource,
        };

        const radarrDownloadConfigRecord: Record<string, unknown> = {
          id: String(-1),
          name: collectionName || 'Preview Download',
          type: sourceType || 'imdb',
          subtype,
          downloadMode: 'direct',
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
          directDownloadRadarrServerId: serverId,
          directDownloadRadarrProfileId: profileId,
          directDownloadRadarrRootFolder: rootFolder,
          isLibraryPromoted: false,
          everLibraryPromoted: false,
        };

        const result = await downloadService.processDirectDownloads(
          [missingItem],
          radarrDownloadConfigRecord as unknown as CollectionConfig,
          sourceType || 'imdb'
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
          source: (sourceType || 'imdb') as ItemProducingSource,
        };

        const sonarrDownloadConfigRecord: Record<string, unknown> = {
          id: String(-1),
          name: collectionName || 'Preview Download',
          type: sourceType || 'imdb',
          subtype,
          downloadMode: 'direct',
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
          directDownloadSonarrServerId: serverId,
          directDownloadSonarrProfileId: profileId,
          directDownloadSonarrRootFolder: rootFolder,
          isLibraryPromoted: false,
          everLibraryPromoted: false,
        };

        const result = await downloadService.processDirectDownloads(
          [missingItem],
          sonarrDownloadConfigRecord as unknown as CollectionConfig,
          sourceType || 'imdb'
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
