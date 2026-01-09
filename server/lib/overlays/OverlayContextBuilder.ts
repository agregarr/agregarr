import ImdbAPI from '@server/api/imdb';
import ImdbRatingsAPI from '@server/api/imdbRatings';
import type { MaintainerrCollection } from '@server/api/maintainerr';
import type { PlexLibraryItem } from '@server/api/plexapi';
import RottenTomatoes from '@server/api/rottentomatoes';
import type { RadarrMovie } from '@server/api/servarr/radarr';
import type { SonarrSeries } from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { OverlayRenderContext } from './OverlayTemplateRenderer';

/**
 * Shared IMDb client for reuse across overlay operations
 */
let sharedImdbClient: ImdbAPI | undefined;

/**
 * Get or create shared IMDb client
 */
function getImdbClient(): ImdbAPI {
  if (!sharedImdbClient) {
    sharedImdbClient = new ImdbAPI();
  }
  return sharedImdbClient;
}

/**
 * Get all movies from a Radarr instance (with optional caching)
 */
async function getRadarrMovies(
  radarrSettings: {
    hostname: string;
    port: number;
    useSsl: boolean;
    baseUrl?: string;
    apiKey: string;
  },
  cache?: Map<string, RadarrMovie[]>
): Promise<RadarrMovie[]> {
  const RadarrAPI = (await import('@server/api/servarr/radarr')).default;

  // Build URL manually (same pattern as buildUrl)
  const protocol = radarrSettings.useSsl ? 'https' : 'http';
  const url = `${protocol}://${radarrSettings.hostname}:${radarrSettings.port}${
    radarrSettings.baseUrl || ''
  }/api/v3`;
  const cacheKey = url;

  // Check cache if provided
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const radarr = new RadarrAPI({
    url,
    apiKey: radarrSettings.apiKey,
  });

  const movies = await radarr.getMovies();

  // Store in cache if provided
  if (cache) {
    cache.set(cacheKey, movies);
    logger.debug('Cached Radarr movies', {
      label: 'OverlayContextBuilder',
      url,
      movieCount: movies.length,
    });
  }

  return movies;
}

/**
 * Get all series from a Sonarr instance (with optional caching)
 */
async function getSonarrSeries(
  sonarrSettings: {
    hostname: string;
    port: number;
    useSsl: boolean;
    baseUrl?: string;
    apiKey: string;
  },
  cache?: Map<string, SonarrSeries[]>
): Promise<SonarrSeries[]> {
  const SonarrAPI = (await import('@server/api/servarr/sonarr')).default;

  // Build URL manually (same pattern as buildUrl)
  const protocol = sonarrSettings.useSsl ? 'https' : 'http';
  const url = `${protocol}://${sonarrSettings.hostname}:${sonarrSettings.port}${
    sonarrSettings.baseUrl || ''
  }/api/v3`;
  const cacheKey = url;

  // Check cache if provided
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const sonarr = new SonarrAPI({
    url,
    apiKey: sonarrSettings.apiKey,
  });

  const series = await sonarr.getSeries();

  // Store in cache if provided
  if (cache) {
    cache.set(cacheKey, series);
    logger.debug('Cached Sonarr series', {
      label: 'OverlayContextBuilder',
      url,
      seriesCount: series.length,
    });
  }

  return series;
}

/**
 * Get TVDB ID from TMDB ID for TV shows
 * Required for Sonarr lookups since Sonarr uses TVDB IDs
 */
export async function getTvdbIdFromTmdb(
  tmdbId: number
): Promise<number | undefined> {
  try {
    const tmdbClient = new TheMovieDb();
    const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });

    return showDetails.external_ids?.tvdb_id;
  } catch (error) {
    logger.debug('Failed to get TVDB ID from TMDB', {
      label: 'OverlayContextBuilder',
      tmdbId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Build context for dynamic field replacement
 */
export async function buildRenderContext(
  item: PlexLibraryItem,
  mediaType: 'movie' | 'show',
  isPlaceholder = false,
  maintainerrCollections?: MaintainerrCollection[]
): Promise<OverlayRenderContext> {
  const context: OverlayRenderContext = {
    title: item.title,
    year: item.year,
    isPlaceholder,
    mediaType,
    downloaded: !isPlaceholder, // Real items in Plex are downloaded, placeholders are not
  };

  // Extract Plex user rating if available
  if (item.userRating !== undefined) {
    context.plexUserRating = item.userRating;
  }

  // Extract TMDb ID from GUID
  let tmdbId: number | undefined;

  if (item.Guid && Array.isArray(item.Guid)) {
    const tmdbGuid = item.Guid.find((g) => g.id?.includes('tmdb://'));
    if (tmdbGuid) {
      const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
      if (match) {
        tmdbId = parseInt(match[1]);
      }
    }
  }

  if (tmdbId) {
    try {
      // Fetch TMDb data
      const tmdbClient = new TheMovieDb();
      const tmdbData =
        mediaType === 'movie'
          ? await tmdbClient.getMovie({ movieId: tmdbId })
          : await tmdbClient.getTvShow({ tvId: tmdbId });

      // Get IMDb ID
      const imdbId = tmdbData.external_ids?.imdb_id;

      // Fetch ratings
      if (imdbId) {
        // IMDb rating
        try {
          const imdbApi = new ImdbRatingsAPI();
          const imdbRatings = await imdbApi.getRatings(imdbId);
          if (imdbRatings.length > 0 && imdbRatings[0].rating !== null) {
            context.imdbRating = imdbRatings[0].rating;
          }
        } catch (error) {
          logger.debug('Failed to fetch IMDb rating', {
            label: 'OverlayContextBuilder',
            imdbId,
          });
        }

        // IMDb Top 250 check
        try {
          const imdbClient = getImdbClient();
          const imdbMediaType: 'movie' | 'tv' =
            mediaType === 'show' ? 'tv' : 'movie';
          const top250Result = await imdbClient.checkTop250(
            imdbId,
            imdbMediaType
          );

          if (top250Result.isTop250) {
            context.isImdbTop250 = true;
            context.imdbTop250Rank = top250Result.rank;
          }
        } catch (error) {
          logger.debug('Failed to check IMDb Top 250', {
            label: 'OverlayContextBuilder',
            imdbId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Rotten Tomatoes ratings
        try {
          const rtClient = new RottenTomatoes();
          const rtRating =
            mediaType === 'movie'
              ? await rtClient.getMovieRatings(
                  context.title || '',
                  context.year || 0
                )
              : await rtClient.getTVRatings(context.title || '', context.year);

          if (rtRating) {
            context.rtCriticsScore = rtRating.criticsScore;
            context.rtAudienceScore = rtRating.audienceScore;
            logger.debug('Fetched RT ratings', {
              label: 'OverlayContextBuilder',
              title: context.title,
              criticsScore: rtRating.criticsScore,
              audienceScore: rtRating.audienceScore,
            });
          } else {
            logger.debug('RT rating not found', {
              label: 'OverlayContextBuilder',
              title: context.title,
              year: context.year,
            });
          }
        } catch (error) {
          logger.debug('Failed to fetch RT rating', {
            label: 'OverlayContextBuilder',
            title: context.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Movie-specific metadata
      if (mediaType === 'movie' && 'credits' in tmdbData) {
        const director = tmdbData.credits?.crew?.find(
          (c) => c.job === 'Director'
        );
        if (director) {
          context.director = director.name;
        }
      }

      // Studio/Network
      if (
        'production_companies' in tmdbData &&
        tmdbData.production_companies?.[0]
      ) {
        context.studio = tmdbData.production_companies[0].name;
      }

      // Genre (concatenate all genres for matching)
      if (
        'genres' in tmdbData &&
        tmdbData.genres &&
        tmdbData.genres.length > 0
      ) {
        context.genre = tmdbData.genres
          .map((g: { name: string }) => g.name)
          .join(', ');
      }

      // Runtime
      if (mediaType === 'movie' && 'runtime' in tmdbData) {
        context.runtime = tmdbData.runtime;
      } else if (
        mediaType === 'show' &&
        'episode_run_time' in tmdbData &&
        tmdbData.episode_run_time?.[0]
      ) {
        context.runtime = tmdbData.episode_run_time[0];
      }

      // TMDB Status (TV shows only) - using Kometa's user-friendly mapping
      if (mediaType === 'show' && 'status' in tmdbData) {
        const rawStatus = tmdbData.status;

        // Map TMDB status to user-friendly names (based on Kometa)
        let mappedStatus: string;
        switch (rawStatus) {
          case 'Returning Series':
            mappedStatus = 'RETURNING';
            break;
          case 'Ended':
            mappedStatus = 'ENDED';
            break;
          case 'Canceled':
            mappedStatus = 'CANCELLED';
            break;
          case 'Planned':
            mappedStatus = 'PLANNED';
            break;
          case 'In Production':
            mappedStatus = 'IN PRODUCTION';
            break;
          case 'Pilot':
            mappedStatus = 'PILOT';
            break;
          default:
            mappedStatus = rawStatus.toUpperCase();
        }

        // Check if an episode aired in last 15 days to determine "AIRING" status
        // Only override to AIRING if status is "Returning Series"
        // Use last_episode_to_air.air_date for accuracy (more reliable than last_air_date)
        if (
          rawStatus === 'Returning Series' &&
          'last_episode_to_air' in tmdbData &&
          tmdbData.last_episode_to_air?.air_date
        ) {
          const lastAired = new Date(tmdbData.last_episode_to_air.air_date);
          const daysSinceAired = Math.floor(
            (Date.now() - lastAired.getTime()) / (1000 * 60 * 60 * 24)
          );

          logger.debug('Checking AIRING status', {
            label: 'OverlayContextBuilder',
            title: context.title,
            lastEpisodeAirDate: tmdbData.last_episode_to_air.air_date,
            daysSinceAired,
            threshold: 15,
          });

          if (daysSinceAired <= 15) {
            mappedStatus = 'AIRING';
          }
        }

        context.tmdbStatus = mappedStatus;
      }
    } catch (error) {
      logger.debug('Failed to fetch external metadata', {
        label: 'OverlayContextBuilder',
        tmdbId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Plex-specific metadata from Media (skip for placeholder items)
  if (!isPlaceholder && item.Media?.[0]) {
    const media = item.Media[0];

    // Resolution - use raw value from Plex (e.g., "720", "1080", "4k")
    if (media.videoResolution) {
      context.resolution = media.videoResolution;
    }

    // Dimensions
    context.width = media.width;
    context.height = media.height;
    context.aspectRatio = media.aspectRatio;

    // Video specs (from Media level)
    context.videoCodec = media.videoCodec;
    context.videoProfile = media.videoProfile;
    context.videoFrameRate = media.videoFrameRate;

    // Audio specs (from Media level)
    context.audioCodec = media.audioCodec;
    context.audioChannels = media.audioChannels;

    // File info
    context.container = media.container;
    context.bitrate = media.bitrate;

    // Extract detailed info from Streams
    if (media.Part?.[0]?.Stream) {
      const streams = media.Part[0].Stream;

      // Find video stream (streamType 1)
      const videoStream = streams.find((s) => s.streamType === 1);
      if (videoStream) {
        // HDR/Dolby Vision detection
        context.dolbyVision = videoStream.DOVIPresent || false;

        // Dolby Vision Profile (5, 7, 8, etc.)
        if (videoStream.DOVIProfile !== undefined) {
          context.dolbyVisionProfile = videoStream.DOVIProfile;
        }

        // Check for HDR in color transfer characteristic
        context.hdr =
          videoStream.colorTrc?.toLowerCase().includes('smpte2084') ||
          videoStream.colorTrc?.toLowerCase().includes('arib') ||
          false;

        // Color transfer characteristic (for distinguishing HDR10 vs HLG, etc.)
        if (videoStream.colorTrc) {
          context.colorTrc = videoStream.colorTrc;
        }

        // Parse bitDepth as number (Plex returns it as string)
        if (videoStream.bitDepth) {
          context.bitDepth = parseInt(String(videoStream.bitDepth), 10);
        }
      }
      // Find audio stream (streamType 2) - prefer first one
      const audioStream = streams.find((s) => s.streamType === 2);
      if (audioStream) {
        // Detailed audio format from displayTitle
        if (audioStream.displayTitle) {
          context.audioFormat = audioStream.displayTitle;
        }
        // Audio channel layout
        if (audioStream.audioChannelLayout) {
          context.audioChannelLayout = audioStream.audioChannelLayout;
        }
        if (audioStream.channels) {
          context.audioChannels = audioStream.channels;
        }
      }

      // Get file path from Part
      if (media.Part[0].file) {
        context.filePath = media.Part[0].file;
      }
      // Get file size
      if (media.Part[0].size) {
        context.fileSize = media.Part[0].size;
      }
    }
  }

  // Playback stats and dates
  if (item.viewCount !== undefined) {
    context.viewCount = item.viewCount;
  }
  if (item.lastViewedAt) {
    context.lastPlayed = new Date(item.lastViewedAt * 1000);
    // Calculate days since last played
    const daysSinceLastPlayed = Math.floor(
      (Date.now() - item.lastViewedAt * 1000) / (1000 * 60 * 60 * 24)
    );
    context.daysSinceLastPlayed = daysSinceLastPlayed;
  }
  if (item.addedAt) {
    context.dateAdded = new Date(item.addedAt * 1000);
    // Calculate days since added
    const daysSinceAdded = Math.floor(
      (Date.now() - item.addedAt * 1000) / (1000 * 60 * 60 * 24)
    );
    context.daysSinceAdded = daysSinceAdded;
  }

  // TV-specific
  if (mediaType === 'show') {
    // For episode-level items, use parentIndex for season
    // For show-level items (placeholders/shows), parentIndex is undefined
    if (item.parentIndex !== undefined) {
      context.seasonNumber = item.parentIndex;
    }

    if (item.index !== undefined) {
      context.episodeNumber = item.index;
    }
  }

  // Maintainerr integration - calculate daysUntilAction
  // Use cached collections if provided, otherwise fetch them
  if (
    item.ratingKey &&
    maintainerrCollections &&
    maintainerrCollections.length > 0
  ) {
    try {
      // Find ALL collections containing this item
      const matchingCollections: {
        collection: MaintainerrCollection;
        daysUntilAction: number;
      }[] = [];

      for (const collection of maintainerrCollections) {
        const mediaItem = collection.media.find(
          (m) => m.plexId === Number(item.ratingKey)
        );

        if (mediaItem && collection.deleteAfterDays) {
          // Calculate days since item was added to collection
          const addedDate = new Date(mediaItem.addDate);
          const now = new Date();
          const daysSinceAdded = Math.floor(
            (now.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Calculate days until action: deleteAfterDays - daysSinceAdded
          // Positive = days remaining, negative = overdue
          const daysUntilAction = collection.deleteAfterDays - daysSinceAdded;

          matchingCollections.push({ collection, daysUntilAction });
        }
      }

      // If item is in multiple collections, use the one with LOWEST daysUntilAction
      if (matchingCollections.length > 0) {
        const selected = matchingCollections.reduce((min, curr) =>
          curr.daysUntilAction < min.daysUntilAction ? curr : min
        );

        context.daysUntilAction = selected.daysUntilAction;

        logger.debug('Calculated Maintainerr daysUntilAction', {
          label: 'OverlayContextBuilder',
          ratingKey: item.ratingKey,
          title: item.title,
          matchingCollections: matchingCollections.length,
          selectedCollection: selected.collection.title,
          daysUntilAction: selected.daysUntilAction,
        });
      }
    } catch (error) {
      logger.debug('Failed to calculate Maintainerr daysUntilAction', {
        label: 'OverlayContextBuilder',
        ratingKey: item.ratingKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return context;
}

/**
 * Fetch release date information from TMDB
 * For movies: Gets digital/physical/theatrical release dates
 * For TV: Gets next episode air date
 */
export async function fetchReleaseDateInfo(
  tmdbId: number,
  mediaType: 'movie' | 'show'
): Promise<
  | {
      releaseDate?: string;
      nextEpisodeAirDate?: string;
      nextSeasonAirDate?: string;
      seasonNumber?: number;
      episodeNumber?: number;
    }
  | undefined
> {
  try {
    const tmdbClient = new TheMovieDb();

    if (mediaType === 'movie') {
      const movieDetails = await tmdbClient.getMovie({ movieId: tmdbId });

      // For movies, use proper release date calculation (digital > physical > theatrical+90)
      // This matches PlaceholderContextService implementation
      if (movieDetails.release_dates?.results) {
        const { extractReleaseDates, determineReleaseDate } = await import(
          '@server/utils/dateHelpers'
        );
        const extracted = extractReleaseDates(
          movieDetails.release_dates.results
        );

        const determined = determineReleaseDate(
          extracted.digitalRelease,
          extracted.physicalRelease,
          extracted.inCinemas
        );

        if (determined) {
          return {
            releaseDate: determined.releaseDate,
          };
        }
      }

      // Fallback to simple release_date if release_dates not available
      if (movieDetails.release_date) {
        return {
          releaseDate: movieDetails.release_date,
        };
      }
    } else {
      // For TV shows
      const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });

      // Get next episode info
      const nextEpisode = showDetails.next_episode_to_air;
      if (nextEpisode?.air_date) {
        const seasonNumber = nextEpisode.season_number;
        const episodeNumber = nextEpisode.episode_number;

        // nextSeasonAirDate is ONLY for season premieres (episode 1)
        const nextSeasonAirDate =
          episodeNumber === 1 ? nextEpisode.air_date : undefined;

        return {
          releaseDate: showDetails.first_air_date || nextEpisode.air_date,
          nextEpisodeAirDate: nextEpisode.air_date,
          nextSeasonAirDate,
          seasonNumber,
          episodeNumber,
        };
      }

      // No next episode, use first_air_date if available
      if (showDetails.first_air_date) {
        return {
          releaseDate: showDetails.first_air_date,
        };
      }
    }

    return undefined;
  } catch (error) {
    logger.debug('Failed to fetch release date info', {
      label: 'OverlayContextBuilder',
      tmdbId,
      mediaType,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Check monitoring status in Radarr/Sonarr
 * Returns whether item exists in *arr and if it's monitored (series-level)
 *
 * @param tmdbId - TMDB ID of the item
 * @param mediaType - Media type ('movie' or 'show')
 * @param radarrCache - Optional cache for Radarr movie data
 * @param sonarrCache - Optional cache for Sonarr series data
 */
export async function checkMonitoringStatus(
  tmdbId: number,
  mediaType: 'movie' | 'show',
  radarrCache?: Map<string, RadarrMovie[]>,
  sonarrCache?: Map<string, SonarrSeries[]>
): Promise<{
  inRadarr?: boolean;
  inSonarr?: boolean;
  isMonitored?: boolean;
  hasFile?: boolean;
  radarrTags?: string[];
  sonarrTags?: string[];
}> {
  try {
    const settings = getSettings();

    if (
      mediaType === 'movie' &&
      settings.radarr &&
      settings.radarr.length > 0
    ) {
      // Check Radarr for movies
      for (const radarrSettings of settings.radarr) {
        if (!radarrSettings.hostname) {
          continue;
        }

        try {
          const movies = await getRadarrMovies(radarrSettings, radarrCache);
          const movie = movies.find((m) => m.tmdbId === tmdbId);

          if (movie) {
            // Fetch tags if movie has any
            let tagNames: string[] = [];
            if (movie.tags && movie.tags.length > 0) {
              try {
                const RadarrAPI = (await import('@server/api/servarr/radarr'))
                  .default;
                const radarr = new RadarrAPI({
                  url: `${radarrSettings.useSsl ? 'https' : 'http'}://${
                    radarrSettings.hostname
                  }:${radarrSettings.port}${
                    radarrSettings.baseUrl || ''
                  }/api/v3`,
                  apiKey: radarrSettings.apiKey,
                });
                const allTags = await radarr.getTags();
                tagNames = movie.tags
                  .map((tagId) => allTags.find((t) => t.id === tagId)?.label)
                  .filter((label): label is string => label !== undefined);
              } catch (tagError) {
                logger.debug('Failed to fetch Radarr tags', {
                  label: 'OverlayContextBuilder',
                  error:
                    tagError instanceof Error
                      ? tagError.message
                      : String(tagError),
                });
              }
            }

            logger.debug('Found movie in Radarr', {
              label: 'OverlayContextBuilder',
              tmdbId,
              monitored: movie.monitored,
              hasFile: movie.hasFile,
              tags: tagNames,
            });
            return {
              inRadarr: true,
              isMonitored: movie.monitored,
              hasFile: movie.hasFile,
              radarrTags: tagNames.length > 0 ? tagNames : undefined,
            };
          }
        } catch (error) {
          logger.debug('Failed to check Radarr instance', {
            label: 'OverlayContextBuilder',
            hostname: radarrSettings.hostname,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      return { inRadarr: false, isMonitored: false };
    } else if (
      mediaType === 'show' &&
      settings.sonarr &&
      settings.sonarr.length > 0
    ) {
      // Check Sonarr for TV shows - prefer TVDB ID, fallback to title match
      const tvdbId = await getTvdbIdFromTmdb(tmdbId);

      // Get title from TMDB for fallback matching
      let tmdbTitle: string | undefined;
      if (!tvdbId) {
        try {
          const tmdbClient = new TheMovieDb();
          const showDetails = await tmdbClient.getTvShow({ tvId: tmdbId });
          tmdbTitle = showDetails.name || showDetails.original_name;
        } catch {
          // Ignore errors, just won't have title fallback
        }
      }

      for (const sonarrSettings of settings.sonarr) {
        if (!sonarrSettings.hostname) {
          continue;
        }

        try {
          const allSeries = await getSonarrSeries(sonarrSettings, sonarrCache);
          let series;

          // Try TVDB ID first if available
          if (tvdbId) {
            series = allSeries.find((s) => s.tvdbId === tvdbId);
          }

          // Fallback to title match if no TVDB ID or not found
          if (!series && tmdbTitle) {
            const normalizedTmdbTitle = tmdbTitle.toLowerCase();
            const normalizedTmdbTitleNoSpecial = normalizedTmdbTitle.replace(
              /[^\w\s]/g,
              ''
            );
            series = allSeries.find(
              (s) =>
                s.title.toLowerCase() === normalizedTmdbTitle ||
                s.title.toLowerCase().replace(/[^\w\s]/g, '') ===
                  normalizedTmdbTitleNoSpecial
            );
          }

          if (series) {
            const hasFile = (series.statistics?.episodeFileCount || 0) > 0;

            // Fetch tags if series has any
            let tagNames: string[] = [];
            if (series.tags && series.tags.length > 0) {
              try {
                const SonarrAPI = (await import('@server/api/servarr/sonarr'))
                  .default;
                const sonarr = new SonarrAPI({
                  url: `${sonarrSettings.useSsl ? 'https' : 'http'}://${
                    sonarrSettings.hostname
                  }:${sonarrSettings.port}${
                    sonarrSettings.baseUrl || ''
                  }/api/v3`,
                  apiKey: sonarrSettings.apiKey,
                });
                const allTags = await sonarr.getTags();
                tagNames = series.tags
                  .map((tagId) => allTags.find((t) => t.id === tagId)?.label)
                  .filter((label): label is string => label !== undefined);
              } catch (tagError) {
                logger.debug('Failed to fetch Sonarr tags', {
                  label: 'OverlayContextBuilder',
                  error:
                    tagError instanceof Error
                      ? tagError.message
                      : String(tagError),
                });
              }
            }

            logger.debug('Found series in Sonarr', {
              label: 'OverlayContextBuilder',
              tmdbId,
              tvdbId,
              tmdbTitle,
              sonarrTitle: series.title,
              matchedBy:
                tvdbId && series.tvdbId === tvdbId ? 'tvdbId' : 'title',
              monitored: series.monitored,
              episodeFileCount: series.statistics?.episodeFileCount,
              hasFile,
              tags: tagNames,
            });

            return {
              inSonarr: true,
              isMonitored: series.monitored,
              hasFile,
              sonarrTags: tagNames.length > 0 ? tagNames : undefined,
            };
          }
        } catch (error) {
          logger.debug('Failed to check Sonarr instance', {
            label: 'OverlayContextBuilder',
            hostname: sonarrSettings.hostname,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      return { inSonarr: false, isMonitored: false };
    }

    return {};
  } catch (error) {
    logger.debug('Failed to check monitoring status', {
      label: 'OverlayContextBuilder',
      mediaType,
      tmdbId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
