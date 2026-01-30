import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TraktAPI from '@server/api/trakt';
import type { ComingSoonSourceData } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  buildTraktRedirectUri,
  persistTraktTokens,
} from '@server/utils/traktAuth';

/**
 * Check if a movie is truly upcoming (not already released/available)
 */
async function isMovieUpcoming(movie: {
  status?: string;
  releaseDate?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  inCinemas?: string;
}): Promise<boolean> {
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

  // Check if any release date is in the future (timezone-aware)
  const { isDateInFuture } = await import('@server/utils/dateHelpers');

  for (const dateStr of releaseDates) {
    if (dateStr && isDateInFuture(dateStr)) {
      return true;
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
 * Fetch monitored but unreleased movies from Radarr
 * Filters by configurable release window during fetch (default: 360 days)
 */
export async function fetchMonitoredMovies(
  config: CollectionConfig
): Promise<ComingSoonSourceData[]> {
  const settings = getSettings();
  const items: ComingSoonSourceData[] = [];

  if (!settings.radarr || settings.radarr.length === 0) {
    return items;
  }

  const { getFutureDateFromToday } = await import('@server/utils/dateHelpers');
  const maxDaysAway =
    config.placeholderDaysAhead || config.comingSoonDays || 360;
  const maxDate = getFutureDateFromToday(maxDaysAway);

  // Filter to specific server if configured
  const radarrInstances = config.comingSoonRadarrServerId
    ? settings.radarr.filter((r) => r.id === config.comingSoonRadarrServerId)
    : settings.radarr;

  for (const radarrInstance of radarrInstances) {
    try {
      const radarrClient = new RadarrAPI({
        url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
          radarrInstance.hostname
        }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
        apiKey: radarrInstance.apiKey,
      });

      const allMovies = await radarrClient.getMovies();

      logger.debug('Processing Radarr movies for Coming Soon', {
        label: 'Coming Soon Collections',
        instance: radarrInstance.name,
        totalMovies: allMovies.length,
      });

      // Log first movie structure for debugging
      if (allMovies.length > 0) {
        logger.debug('Sample Radarr movie structure', {
          label: 'Coming Soon Collections',
          sampleMovie: {
            title: allMovies[0].title,
            monitored: allMovies[0].monitored,
            hasFile: allMovies[0].hasFile,
            monitoredType: typeof allMovies[0].monitored,
            hasFileType: typeof allMovies[0].hasFile,
          },
        });
      }

      // Filter for monitored movies without files that are upcoming
      let monitoredCount = 0;
      let withFilesCount = 0;
      let upcomingCount = 0;

      for (const movie of allMovies) {
        if (movie.monitored) {
          monitoredCount++;
        }

        if (movie.hasFile) {
          withFilesCount++;
        }

        if (!movie.monitored || movie.hasFile) {
          continue;
        }

        // Apply tag filtering if configured
        if (
          config.comingSoonFilterByTags &&
          config.comingSoonRadarrTagIds &&
          config.comingSoonRadarrTagIds.length > 0
        ) {
          const movieTags = movie.tags || [];
          const hasMatchingTag = config.comingSoonRadarrTagIds.some((tagId) =>
            movieTags.includes(tagId)
          );
          if (config.comingSoonTagMode === 'exclude') {
            if (hasMatchingTag) continue; // Exclude movies with any selected tag
          } else {
            // 'include' mode (default)
            if (!hasMatchingTag) continue; // Only include movies with at least one selected tag
          }
        }

        // Check if movie is actually upcoming (not already released/available)
        const isUpcoming = await isMovieUpcoming(movie);
        if (!isUpcoming) {
          continue;
        }

        // Skip movies without any release date information
        const hasReleaseDate = Boolean(
          movie.releaseDate ||
            movie.digitalRelease ||
            movie.physicalRelease ||
            movie.inCinemas
        );

        if (!hasReleaseDate) {
          logger.debug('Skipping movie without release date', {
            label: 'Coming Soon Collections',
            title: movie.title,
            tmdbId: movie.tmdbId,
          });
          continue;
        }

        // Check if release date is within configured window
        // CRITICAL: Apply +3 month estimate for theatrical-only releases BEFORE filtering
        // BUT only if Radarr hasn't already estimated a digital release date
        let releaseDate: Date | null = null;
        let isEstimated = false;

        if (movie.digitalRelease) {
          releaseDate = new Date(movie.digitalRelease);
        } else if (movie.physicalRelease) {
          releaseDate = new Date(movie.physicalRelease);
        } else if (movie.releaseDate) {
          const baseDate = new Date(movie.releaseDate);

          // Check if Radarr has already estimated a digital release date
          // If releaseDate is significantly after inCinemas (30+ days), Radarr has already
          // added an estimate - don't double-add 90 days
          const inCinemasDate = movie.inCinemas
            ? new Date(movie.inCinemas)
            : null;
          const daysDifference = inCinemasDate
            ? Math.round(
                (baseDate.getTime() - inCinemasDate.getTime()) /
                  (24 * 60 * 60 * 1000)
              )
            : 0;

          if (daysDifference >= 30) {
            // Radarr has already estimated digital release, use as-is
            releaseDate = baseDate;
            isEstimated = false;
          } else {
            // releaseDate is same as or close to inCinemas - add 3 month estimate
            baseDate.setDate(baseDate.getDate() + 90);
            releaseDate = baseDate;
            isEstimated = true;
          }
        }

        if (releaseDate && releaseDate > maxDate) {
          logger.debug('Filtered out movie (too far away)', {
            label: 'Coming Soon Collections',
            title: movie.title,
            releaseDate: releaseDate.toISOString(),
            isEstimated,
            daysAway: Math.round(
              (releaseDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
            ),
          });
          continue;
        }

        upcomingCount++;

        // Pass raw release dates - enrichWithTMDBReleaseDates will fetch fresh TMDB data and calculate final date
        items.push({
          tmdbId: movie.tmdbId,
          title: movie.title,
          mediaType: 'movie',
          source: 'radarr',
          monitored: true,
          // Pass Radarr dates (likely stale/incomplete) - TMDB enrichment will override these
          releaseDate: movie.releaseDate,
          digitalRelease: movie.digitalRelease,
          physicalRelease: movie.physicalRelease,
          inCinemas: movie.inCinemas,
          year: movie.year,
          hasFile: false, // We already filtered for !hasFile
        });
      }

      logger.debug('Fetched monitored movies from Radarr', {
        label: 'Coming Soon Collections',
        instance: radarrInstance.name,
        totalMovies: allMovies.length,
        monitoredMovies: monitoredCount,
        moviesWithFiles: withFilesCount,
        upcomingMovies: upcomingCount,
        comingSoonItems: items.length,
      });
    } catch (error) {
      logger.error('Failed to fetch from Radarr instance', {
        label: 'Coming Soon Collections',
        instance: radarrInstance.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return items;
}

/**
 * Fetch monitored but unreleased TV shows from Sonarr
 * Check S01E01 air date and file status for new series
 * Check next monitored season premiere for returning shows (regardless of file status)
 * Filters by configurable release window during fetch (default: 360 days)
 */
export async function fetchMonitoredShows(
  config: CollectionConfig
): Promise<ComingSoonSourceData[]> {
  const settings = getSettings();
  const items: ComingSoonSourceData[] = [];

  logger.debug('fetchMonitoredShows called', {
    label: 'Coming Soon Collections',
    hasSonarr: !!settings.sonarr,
    sonarrCount: settings.sonarr?.length || 0,
  });

  if (!settings.sonarr || settings.sonarr.length === 0) {
    logger.warn('No Sonarr instances configured, skipping TV show fetch', {
      label: 'Coming Soon Collections',
    });
    return items;
  }

  const maxDaysAway =
    config.placeholderDaysAhead || config.comingSoonDays || 360;

  // Filter to specific server if configured
  const sonarrInstances = config.comingSoonSonarrServerId
    ? settings.sonarr.filter((s) => s.id === config.comingSoonSonarrServerId)
    : settings.sonarr;

  for (const sonarrInstance of sonarrInstances) {
    try {
      const sonarrClient = new SonarrAPI({
        url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
          sonarrInstance.hostname
        }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
        apiKey: sonarrInstance.apiKey,
      });

      const allSeries = await sonarrClient.getSeries();

      logger.debug('Processing Sonarr series for Coming Soon', {
        label: 'Coming Soon Collections',
        instance: sonarrInstance.name,
        totalSeries: allSeries.length,
      });

      for (const series of allSeries) {
        if (!series.monitored) {
          continue;
        }

        // Apply tag filtering if configured
        if (
          config.comingSoonFilterByTags &&
          config.comingSoonSonarrTagIds &&
          config.comingSoonSonarrTagIds.length > 0
        ) {
          const seriesTags = series.tags || [];
          const hasMatchingTag = config.comingSoonSonarrTagIds.some((tagId) =>
            seriesTags.includes(tagId)
          );
          if (config.comingSoonTagMode === 'exclude') {
            if (hasMatchingTag) continue;
          } else {
            if (!hasMatchingTag) continue;
          }
        }

        // Skip daily shows (soaps, talk shows) - they always have "upcoming" episodes
        // which pollutes Coming Soon collections with irrelevant content
        if (series.seriesType === 'daily') {
          logger.debug('Skipping daily show from Coming Soon', {
            label: 'Coming Soon Collections',
            title: series.title,
            seriesType: series.seriesType,
          });
          continue;
        }

        if (!series.id) {
          // Series doesn't have an ID yet (not added to Sonarr), skip
          continue;
        }

        try {
          // Get all episodes for this series
          const episodes = await sonarrClient.getEpisodesBySeries(series.id);

          // Find all season premieres (episode 1 of each season, excluding specials)
          const seasonPremieres = episodes.filter(
            (ep) => ep.episodeNumber === 1 && ep.seasonNumber > 0
          );

          logger.debug('Checking series for upcoming premiere', {
            label: 'Coming Soon Collections',
            seriesTitle: series.title,
            totalEpisodes: episodes.length,
            seasonPremieres: seasonPremieres.length,
            seriesMonitored: series.monitored,
          });

          // Find the next unaired monitored season premiere
          // Import timezone-aware helper to convert UTC air dates to server timezone calendar dates
          const { isDateInFuture } = await import('@server/utils/dateHelpers');

          const nextPremiere = seasonPremieres.find((ep) => {
            if (!ep.airDateUtc || !ep.monitored) {
              return false;
            }
            const hasFile = ep.episodeFileId > 0;
            // Convert UTC air date to calendar date in server timezone
            const isFuture = isDateInFuture(new Date(ep.airDateUtc));

            logger.debug('Evaluating season premiere', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
              season: ep.seasonNumber,
              episode: ep.episodeNumber,
              airDate: ep.airDateUtc,
              monitored: ep.monitored,
              hasFile,
              isFuture,
              episodeFileId: ep.episodeFileId,
            });

            // Next premiere must be in the future and not downloaded yet
            return isFuture && !hasFile;
          });

          if (!nextPremiere || !nextPremiere.airDateUtc) {
            // No upcoming season premiere for this series
            logger.debug('No upcoming premiere found for series', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
            });
            continue;
          }

          // Check if air date is within 360-day window (using timezone-aware comparison)
          const { isDateWithinDays } = await import(
            '@server/utils/dateHelpers'
          );
          if (
            !isDateWithinDays(new Date(nextPremiere.airDateUtc), maxDaysAway)
          ) {
            logger.debug('Filtered out show (too far away)', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
              season: nextPremiere.seasonNumber,
              airDate: nextPremiere.airDateUtc,
              maxDaysAway,
            });
            continue;
          }

          logger.info('Found upcoming season premiere', {
            label: 'Coming Soon Collections',
            seriesTitle: series.title,
            season: nextPremiere.seasonNumber,
            episode: nextPremiere.episodeNumber,
            airDate: nextPremiere.airDateUtc,
          });

          // Convert TVDB ID to TMDB ID
          let tmdbId = 0;
          try {
            const TmdbAPI = (await import('@server/api/themoviedb')).default;
            const tmdbClient = new TmdbAPI();
            const externalIdResult = await tmdbClient.getByExternalId({
              externalId: series.tvdbId,
              type: 'tvdb',
            });

            if (
              externalIdResult.tv_results &&
              externalIdResult.tv_results.length > 0
            ) {
              tmdbId = externalIdResult.tv_results[0].id;
              logger.debug('Converted TVDB ID to TMDB ID', {
                label: 'Coming Soon Collections',
                seriesTitle: series.title,
                tvdbId: series.tvdbId,
                tmdbId,
              });
            } else {
              logger.warn('Could not find TMDB ID for TVDB ID', {
                label: 'Coming Soon Collections',
                seriesTitle: series.title,
                tvdbId: series.tvdbId,
              });
            }
          } catch (error) {
            logger.error('Failed to convert TVDB ID to TMDB ID', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
              tvdbId: series.tvdbId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          // Determine if has file and when it was downloaded (for the premiere episode)
          const hasFile = nextPremiere.episodeFileId > 0;
          let downloadedDate: string | undefined;

          if (hasFile) {
            try {
              // Get the actual episode file to get the real dateAdded
              const episodeFile = await sonarrClient.getEpisodeFile(
                nextPremiere.episodeFileId
              );
              downloadedDate = episodeFile.dateAdded;
            } catch (error) {
              logger.debug(
                'Could not get episode file date, using series added date as fallback',
                {
                  label: 'Coming Soon Collections',
                  seriesTitle: series.title,
                  episodeFileId: nextPremiere.episodeFileId,
                }
              );
              // Fallback to series added date if we can't get episode file
              downloadedDate = series.added;
            }
          }

          items.push({
            tmdbId, // Converted from TVDB ID
            tvdbId: series.tvdbId,
            title: series.title,
            year: series.year,
            mediaType: 'tv',
            source: 'sonarr',
            monitored: true,
            airDate: nextPremiere.airDateUtc,
            hasFile,
            downloadedDate,
            // isReturning based purely on season number
            // Season 1 = new show (PREMIERES), Season > 1 = returning show (RETURNING)
            isReturning: nextPremiere.seasonNumber > 1,
            seasonNumber: nextPremiere.seasonNumber,
            episodeNumber: nextPremiere.episodeNumber,
          });
        } catch (error) {
          logger.warn('Failed to get episodes for series', {
            label: 'Coming Soon Collections',
            seriesTitle: series.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      logger.debug('Fetched monitored shows from Sonarr', {
        label: 'Coming Soon Collections',
        instance: sonarrInstance.name,
        count: items.length,
      });
    } catch (error) {
      logger.error('Failed to fetch from Sonarr instance', {
        label: 'Coming Soon Collections',
        instance: sonarrInstance.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return items;
}

/**
 * Fetch anticipated movies from Trakt
 * Returns candidates - filtering happens in enrichWithTMDBReleaseDates
 */
export async function fetchTraktAnticipatedMovies(
  maxItems: number
): Promise<ComingSoonSourceData[]> {
  const settings = getSettings();
  const items: ComingSoonSourceData[] = [];

  const clientId = settings.trakt.clientId || settings.trakt.apiKey;
  if (!clientId) {
    return items;
  }

  try {
    const traktClient = new TraktAPI({
      clientId,
      accessToken: settings.trakt.accessToken,
      clientSecret: settings.trakt.clientSecret,
      refreshToken: settings.trakt.refreshToken,
      tokenExpiresAt: settings.trakt.tokenExpiresAt,
      redirectUri: buildTraktRedirectUri(settings),
      onTokenRefreshed: (tokens) => persistTraktTokens(settings, tokens),
    });

    const perPage = 100; // Fetch 100 per page (Trakt max)

    let currentPage = 1;
    let hasMorePages = true;
    let totalFetched = 0;

    // Fetch more candidates than maxItems since some will be filtered out
    const candidateMultiplier = 3;
    const maxCandidates = maxItems * candidateMultiplier;

    while (hasMorePages && items.length < maxCandidates) {
      const anticipatedMovies = await traktClient.getAnticipated(
        'movies',
        perPage,
        currentPage
      );

      if (!anticipatedMovies || anticipatedMovies.length === 0) {
        hasMorePages = false;
        break;
      }

      totalFetched += anticipatedMovies.length;

      // Process each movie
      for (const item of anticipatedMovies) {
        const movie = item.movie;
        if (!movie || !movie.ids?.tmdb) {
          continue;
        }

        // Add to items as candidate
        items.push({
          tmdbId: movie.ids.tmdb,
          title: movie.title,
          year: movie.year,
          mediaType: 'movie',
          source: 'trakt',
          monitored: false, // Will be updated by markMonitoredStatus
        });

        // Stop if we've reached max candidates
        if (items.length >= maxCandidates) {
          break;
        }
      }

      currentPage++;

      // Check if we should stop pagination
      if (anticipatedMovies.length < perPage) {
        hasMorePages = false; // Last page
      }
    }

    logger.info('Fetched candidate movies from Trakt Anticipated', {
      label: 'Coming Soon Collections',
      totalFetched,
      candidates: items.length,
      pagesFetched: currentPage - 1,
      maxItems,
    });
  } catch (error) {
    logger.error('Failed to fetch anticipated movies from Trakt', {
      label: 'Coming Soon Collections',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return items;
}

/**
 * Fetch anticipated TV shows from Trakt
 * Returns candidates - filtering happens in enrichWithTMDBReleaseDates
 */
export async function fetchTraktAnticipatedShows(
  maxItems: number
): Promise<ComingSoonSourceData[]> {
  const settings = getSettings();
  const items: ComingSoonSourceData[] = [];

  const clientId = settings.trakt.clientId || settings.trakt.apiKey;
  if (!clientId) {
    return items;
  }

  try {
    const traktClient = new TraktAPI({
      clientId,
      accessToken: settings.trakt.accessToken,
      clientSecret: settings.trakt.clientSecret,
      refreshToken: settings.trakt.refreshToken,
      tokenExpiresAt: settings.trakt.tokenExpiresAt,
      redirectUri: buildTraktRedirectUri(settings),
      onTokenRefreshed: (tokens) => persistTraktTokens(settings, tokens),
    });

    const perPage = 100; // Fetch 100 per page (Trakt max)

    let currentPage = 1;
    let hasMorePages = true;
    let totalFetched = 0;

    // Fetch more candidates than maxItems since some will be filtered out
    const candidateMultiplier = 3;
    const maxCandidates = maxItems * candidateMultiplier;

    while (hasMorePages && items.length < maxCandidates) {
      const anticipatedShows = await traktClient.getAnticipated(
        'shows',
        perPage,
        currentPage
      );

      if (!anticipatedShows || anticipatedShows.length === 0) {
        hasMorePages = false;
        break;
      }

      totalFetched += anticipatedShows.length;

      // Process each show
      for (const item of anticipatedShows) {
        const show = item.show;
        if (!show || !show.ids?.tmdb) {
          continue;
        }

        // Add to items as candidate
        items.push({
          tmdbId: show.ids.tmdb,
          tvdbId: show.ids.tvdb,
          title: show.title,
          year: show.year,
          mediaType: 'tv',
          source: 'trakt',
          monitored: false, // Will be updated by markMonitoredStatus
        });

        // Stop if we've reached max candidates
        if (items.length >= maxCandidates) {
          break;
        }
      }

      currentPage++;

      // Check if we should stop pagination
      if (anticipatedShows.length < perPage) {
        hasMorePages = false; // Last page
      }
    }

    logger.info('Fetched candidate shows from Trakt Anticipated', {
      label: 'Coming Soon Collections',
      totalFetched,
      candidates: items.length,
      pagesFetched: currentPage - 1,
      maxItems,
    });
  } catch (error) {
    logger.error('Failed to fetch anticipated shows from Trakt', {
      label: 'Coming Soon Collections',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return items;
}

/**
 * Fetch anticipated movies from TMDB Discover API
 * Uses release type filter for Digital (4) and Physical (5) releases
 * Returns candidates - filtering happens in enrichWithTMDBReleaseDates
 * Sorted by popularity to get most anticipated upcoming content
 */
export async function fetchTmdbComingSoonMovies(
  maxItems: number,
  config: CollectionConfig
): Promise<ComingSoonSourceData[]> {
  const validItems: ComingSoonSourceData[] = [];

  try {
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();

    const perPage = 20; // TMDB returns 20 per page
    const maxDaysAway =
      config.placeholderDaysAhead || config.comingSoonDays || 360;

    // Calculate date range for upcoming releases
    const { getToday, getFutureDateFromToday, extractReleaseDates } =
      await import('@server/utils/dateHelpers');
    const today = getToday();
    const todayStr = today.toISOString().split('T')[0];
    const maxDate = getFutureDateFromToday(maxDaysAway);
    const maxDateStr = maxDate.toISOString().split('T')[0];

    let currentPage = 1;
    let hasMorePages = true;
    let totalFetched = 0;
    let totalFiltered = 0;

    // Keep fetching until we have enough valid items that pass release date filters
    while (hasMorePages && validItems.length < maxItems) {
      // Use TMDB Discover with release type filter for Digital (4) or Physical (5)
      const discoverResult = await tmdbClient.getDiscoverMovies({
        sortBy: 'popularity.desc',
        page: currentPage,
        releaseDateGte: todayStr,
        releaseDateLte: maxDateStr,
        withReleaseType: '4|5', // Digital (4) OR Physical (5)
      });

      if (!discoverResult.results || discoverResult.results.length === 0) {
        hasMorePages = false;
        break;
      }

      totalFetched += discoverResult.results.length;

      // Process each movie and enrich with release dates
      for (const movie of discoverResult.results) {
        if (!movie.id) {
          continue;
        }

        // Fetch detailed release information from TMDB
        try {
          const movieDetails = await tmdbClient.getMovie({
            movieId: movie.id,
          });

          // Extract digital/physical/theatrical release dates using shared helper
          // This checks ALL countries, not just US, to catch anniversary re-releases
          const extracted = movieDetails.release_dates?.results
            ? extractReleaseDates(movieDetails.release_dates.results)
            : {};

          const digitalRelease = extracted.digitalRelease;
          const physicalRelease = extracted.physicalRelease;
          const inCinemas = extracted.inCinemas;
          let earliestReleaseDate = extracted.earliestReleaseDate || null;

          // Determine release date: earliest of (Digital, Physical) > Theatrical (+3 months)
          let releaseDate: string | undefined;
          let isEstimatedDate = false;

          if (digitalRelease && physicalRelease) {
            // Both exist - use earliest
            const digitalDate = new Date(digitalRelease);
            const physicalDate = new Date(physicalRelease);
            releaseDate =
              digitalDate < physicalDate
                ? digitalRelease.split('T')[0]
                : physicalRelease.split('T')[0];
          } else if (digitalRelease) {
            releaseDate = digitalRelease.split('T')[0];
          } else if (physicalRelease) {
            releaseDate = physicalRelease.split('T')[0];
          } else if (movieDetails.release_date) {
            // No digital/physical - use theatrical + 3 months estimate
            const baseDate = new Date(movieDetails.release_date);
            baseDate.setDate(baseDate.getDate() + 90);
            releaseDate = baseDate.toISOString().split('T')[0];
            isEstimatedDate = true;
            earliestReleaseDate = baseDate;
          }

          // Filter: only include if earliest release date is in the future and within window
          if (
            !earliestReleaseDate ||
            earliestReleaseDate < today ||
            earliestReleaseDate > maxDate
          ) {
            totalFiltered++;
            continue;
          }

          // Valid item - add it
          validItems.push({
            tmdbId: movie.id,
            title: movie.title,
            year: movie.release_date
              ? parseInt(movie.release_date.split('-')[0])
              : undefined,
            mediaType: 'movie',
            source: 'tmdb',
            monitored: false,
            releaseDate,
            digitalRelease,
            physicalRelease,
            inCinemas,
            isEstimatedDate,
          });

          // Stop if we've reached maxItems
          if (validItems.length >= maxItems) {
            break;
          }
        } catch (error) {
          logger.warn('Failed to fetch TMDB details for movie', {
            label: 'Coming Soon Collections',
            title: movie.title,
            tmdbId: movie.id,
            error: error instanceof Error ? error.message : String(error),
          });
          totalFiltered++;
        }
      }

      currentPage++;

      // Check if we should stop pagination
      if (
        discoverResult.results.length < perPage ||
        currentPage > discoverResult.total_pages
      ) {
        hasMorePages = false;
      }
    }

    logger.info(
      'Fetched candidate movies from TMDB Discover (Digital/Physical)',
      {
        label: 'Coming Soon Collections',
        totalFetched,
        candidates: validItems.length,
        pagesFetched: currentPage - 1,
        filteredOut: totalFiltered,
        maxItems,
        dateRange: `${todayStr} to ${maxDateStr}`,
      }
    );
  } catch (error) {
    logger.error('Failed to fetch anticipated movies from TMDB Discover', {
      label: 'Coming Soon Collections',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return validItems;
}

/**
 * Fetch anticipated TV shows from TMDB Discover API
 * Fetches both new shows (first_air_date) AND returning shows (air_date)
 * Enriches with air dates and filters inline - keeps fetching until maxItems valid items found
 * Sorted by popularity to get most anticipated upcoming content
 */
export async function fetchTmdbComingSoonShows(
  maxItems: number,
  config: CollectionConfig
): Promise<ComingSoonSourceData[]> {
  const validItems: ComingSoonSourceData[] = [];

  try {
    const TmdbAPI = (await import('@server/api/themoviedb')).default;
    const tmdbClient = new TmdbAPI();

    const perPage = 20; // TMDB returns 20 per page
    const maxDaysAway =
      config.placeholderDaysAhead || config.comingSoonDays || 360;

    // Calculate date range for upcoming air dates
    const { getToday, getFutureDateFromToday } = await import(
      '@server/utils/dateHelpers'
    );
    const today = getToday();
    const todayStr = today.toISOString().split('T')[0];
    const maxDate = getFutureDateFromToday(maxDaysAway);
    const maxDateStr = maxDate.toISOString().split('T')[0];

    // Track unique show IDs to avoid duplicates
    const seenIds = new Set<number>();
    let newShowsFetched = 0;
    let returningShowsFetched = 0;
    let totalFiltered = 0;

    // Helper function to enrich and validate a show
    const enrichShow = async (
      showId: number,
      showTitle: string,
      firstAirDate: string | undefined
    ): Promise<ComingSoonSourceData | null> => {
      try {
        const showDetails = await tmdbClient.getTvShow({ tvId: showId });

        // Find the next upcoming season
        let nextSeasonNumber: number | undefined;
        let nextSeasonAirDate: string | undefined;

        // Import timezone helper for date conversion
        const { isDateWithinDays: checkDateWithinDays } = await import(
          '@server/utils/dateHelpers'
        );

        if (showDetails.seasons) {
          for (const season of showDetails.seasons) {
            if (season.air_date && season.season_number !== undefined) {
              // Check if season air date is within the configured window (timezone-aware)
              if (checkDateWithinDays(season.air_date, maxDaysAway)) {
                nextSeasonNumber = season.season_number;
                nextSeasonAirDate = season.air_date;
                break;
              }
            }
          }
        }

        // If no upcoming season found, use first_air_date for new shows
        if (!nextSeasonAirDate && showDetails.first_air_date) {
          nextSeasonAirDate = showDetails.first_air_date;
          nextSeasonNumber = 1;
        }

        // Filter: must have air date within window
        if (!nextSeasonAirDate) {
          return null;
        }

        // Verify the final air date is within the window (timezone-aware)
        if (!checkDateWithinDays(nextSeasonAirDate, maxDaysAway)) {
          return null;
        }

        return {
          tmdbId: showId,
          title: showTitle,
          year: firstAirDate ? parseInt(firstAirDate.split('-')[0]) : undefined,
          mediaType: 'tv',
          source: 'tmdb',
          monitored: false,
          airDate: nextSeasonAirDate,
          seasonNumber: nextSeasonNumber,
          isReturning: nextSeasonNumber ? nextSeasonNumber > 1 : false,
        };
      } catch (error) {
        logger.warn('Failed to fetch TMDB details for TV show', {
          label: 'Coming Soon Collections',
          title: showTitle,
          tmdbId: showId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };

    // Fetch new shows (first_air_date.gte/lte)
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages && validItems.length < maxItems) {
      const discoverResult = await tmdbClient.getDiscoverTv({
        sortBy: 'popularity.desc',
        page: currentPage,
        firstAirDateGte: todayStr,
        firstAirDateLte: maxDateStr,
      });

      if (!discoverResult.results || discoverResult.results.length === 0) {
        break;
      }

      newShowsFetched += discoverResult.results.length;

      for (const show of discoverResult.results) {
        if (!show.id || seenIds.has(show.id)) {
          continue;
        }

        seenIds.add(show.id);
        const enrichedShow = await enrichShow(
          show.id,
          show.name,
          show.first_air_date
        );

        if (enrichedShow) {
          validItems.push(enrichedShow);
          if (validItems.length >= maxItems) {
            break;
          }
        } else {
          totalFiltered++;
        }
      }

      if (validItems.length >= maxItems) {
        break;
      }

      currentPage++;

      if (
        discoverResult.results.length < perPage ||
        currentPage > discoverResult.total_pages
      ) {
        hasMorePages = false;
      }
    }

    // Fetch returning shows (air_date.gte/lte) if we still need more items
    if (validItems.length < maxItems) {
      currentPage = 1;
      hasMorePages = true;

      while (hasMorePages && validItems.length < maxItems) {
        const discoverResult = await tmdbClient.getDiscoverTv({
          sortBy: 'popularity.desc',
          page: currentPage,
          airDateGte: todayStr,
          airDateLte: maxDateStr,
        });

        if (!discoverResult.results || discoverResult.results.length === 0) {
          break;
        }

        returningShowsFetched += discoverResult.results.length;

        for (const show of discoverResult.results) {
          if (!show.id || seenIds.has(show.id)) {
            continue;
          }

          seenIds.add(show.id);
          const enrichedShow = await enrichShow(
            show.id,
            show.name,
            show.first_air_date
          );

          if (enrichedShow) {
            validItems.push(enrichedShow);
            if (validItems.length >= maxItems) {
              break;
            }
          } else {
            totalFiltered++;
          }
        }

        if (validItems.length >= maxItems) {
          break;
        }

        currentPage++;

        if (
          discoverResult.results.length < perPage ||
          currentPage > discoverResult.total_pages
        ) {
          hasMorePages = false;
        }
      }
    }

    logger.info(
      'Fetched candidate TV shows from TMDB Discover (new and returning)',
      {
        label: 'Coming Soon Collections',
        newShowsFetched,
        returningShowsFetched,
        uniqueCandidates: validItems.length,
        filteredOut: totalFiltered,
        maxItems,
        dateRange: `${todayStr} to ${maxDateStr}`,
      }
    );
  } catch (error) {
    logger.error('Failed to fetch anticipated TV shows from TMDB Discover', {
      label: 'Coming Soon Collections',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return validItems;
}

/**
 * Enrich items with TMDB release dates and optionally filter by date window
 * Adds 3-month estimate for items with only theatrical releases
 * When skipDateFilter is false (default), filters out items outside the date window
 * Modifies the array in place
 *
 * @param items - Array of items to enrich
 * @param maxDaysAway - Maximum days in future to include (default 360)
 * @param releasedDays - Days in past to include (default 0)
 * @param skipDateFilter - When true, only enrich metadata without filtering (for non-Coming-Soon with includeAllReleasedItems)
 */
export async function enrichWithTMDBReleaseDates(
  items: ComingSoonSourceData[],
  maxDaysAway = 360,
  releasedDays = 0,
  skipDateFilter = false
): Promise<void> {
  const TmdbAPI = (await import('@server/api/themoviedb')).default;
  const tmdbClient = new TmdbAPI();

  const { getToday, getFutureDateFromToday } = await import(
    '@server/utils/dateHelpers'
  );
  const today = getToday();
  const minDate = new Date(
    today.getTime() - releasedDays * 24 * 60 * 60 * 1000
  );
  const maxDate = getFutureDateFromToday(maxDaysAway);

  logger.debug('Starting TMDB release date enrichment (parallel)', {
    label: 'PlaceholderService',
    itemCount: items.length,
    maxDaysAway,
    releasedDays,
    skipDateFilter,
  });

  // Use SHARED helper functions - import once at the top
  const {
    extractReleaseDates,
    determineReleaseDate,
    isDateInFuture,
    isDateWithinDays,
  } = await import('@server/utils/dateHelpers');

  // Process all items in parallel and track which should be filtered
  const enrichmentResults = await Promise.all(
    items.map(async (item, index) => {
      logger.debug('Enriching item with fresh TMDB data', {
        label: 'PlaceholderService',
        title: item.title,
        source: item.source,
        tmdbId: item.tmdbId,
        currentReleaseDate: item.releaseDate,
      });

      try {
        if (item.mediaType === 'movie') {
          // Fetch movie details from TMDB (includes release_dates in append_to_response)
          const movieDetails = await tmdbClient.getMovie({
            movieId: item.tmdbId,
          });

          // Extract release dates using shared helper (checks ALL countries, not just US)
          const extracted = movieDetails.release_dates?.results
            ? extractReleaseDates(movieDetails.release_dates.results)
            : {};

          // Set extracted dates on item
          item.digitalRelease = extracted.digitalRelease;
          item.physicalRelease = extracted.physicalRelease;
          item.inCinemas = extracted.inCinemas;

          // Fallback to generic release_date if no specific theatrical date (same as overlays)
          const inCinemas =
            extracted.inCinemas || movieDetails.release_date || undefined;

          // Use shared priority logic: earliest of (Digital, Physical) > Theatrical (+90 days)
          const releaseDateResult = determineReleaseDate(
            extracted.digitalRelease,
            extracted.physicalRelease,
            inCinemas
          );

          if (releaseDateResult) {
            const oldReleaseDate = item.releaseDate;
            item.releaseDate = releaseDateResult.releaseDate;
            item.isEstimatedDate = releaseDateResult.isEstimated;

            logger.debug('Updated release date from TMDB enrichment', {
              label: 'PlaceholderService',
              title: item.title,
              source: item.source,
              oldReleaseDate,
              newReleaseDate: item.releaseDate,
              isEstimated: releaseDateResult.isEstimated,
              digitalRelease: item.digitalRelease,
              physicalRelease: item.physicalRelease,
              inCinemas: item.inCinemas,
            });

            if (releaseDateResult.isEstimated) {
              logger.debug(
                'Using estimated release date (theatrical + 90 days)',
                {
                  label: 'PlaceholderService',
                  title: item.title,
                  estimatedDate: item.releaseDate,
                }
              );
            }
          }

          // Filter: only include if release date is within window (past to future)
          // Skip filtering when skipDateFilter is true (non-Coming-Soon with includeAllReleasedItems)
          if (!skipDateFilter) {
            const earliestReleaseDate = releaseDateResult
              ? new Date(releaseDateResult.releaseDate)
              : extracted.earliestReleaseDate || null;

            if (
              !earliestReleaseDate ||
              earliestReleaseDate < minDate ||
              earliestReleaseDate > maxDate
            ) {
              logger.debug(
                'Filtering out movie (no date, too old, or too far away)',
                {
                  label: 'PlaceholderService',
                  title: item.title,
                  earliestReleaseDate: earliestReleaseDate?.toISOString(),
                  reason: !earliestReleaseDate
                    ? 'no date'
                    : earliestReleaseDate < minDate
                    ? 'too old (beyond releasedDays window)'
                    : 'too far away (beyond daysAhead window)',
                }
              );
              return { index, shouldRemove: true };
            }
          }
        } else if (item.mediaType === 'tv') {
          // Only enrich airDate if not already set (Sonarr already provides season-specific dates)
          if (!item.airDate) {
            // Fetch TV show details from TMDB
            const showDetails = await tmdbClient.getTvShow({
              tvId: item.tmdbId,
            });

            // Find the next upcoming season premiere
            let nextSeasonAirDate: string | null = null;
            let nextSeasonNumber = 0;

            if (showDetails.seasons && showDetails.seasons.length > 0) {
              // Sort seasons by season number
              const seasons = showDetails.seasons
                .filter((s) => s.season_number > 0) // Exclude specials (season 0)
                .sort((a, b) => a.season_number - b.season_number);

              // Find the next season that hasn't aired yet (timezone-aware)
              for (const season of seasons) {
                if (season.air_date && isDateInFuture(season.air_date)) {
                  nextSeasonAirDate = season.air_date;
                  nextSeasonNumber = season.season_number;
                  break;
                }
              }
            }

            if (nextSeasonAirDate) {
              item.airDate = nextSeasonAirDate;
              item.seasonNumber = nextSeasonNumber;
              item.isReturning = nextSeasonNumber > 1;

              logger.debug('Found upcoming season from TMDB for Trakt item', {
                label: 'PlaceholderService',
                title: item.title,
                seasonNumber: nextSeasonNumber,
                airDate: nextSeasonAirDate,
              });
            } else if (showDetails.first_air_date) {
              // Fallback to first_air_date if no future seasons found
              item.airDate = showDetails.first_air_date;
              item.seasonNumber = 1;
              item.isReturning = false;
            }
          }

          // Filter TV shows: check if air date is within window (past to future, timezone-aware)
          // Skip filtering when skipDateFilter is true (non-Coming-Soon with includeAllReleasedItems)
          if (!skipDateFilter) {
            if (item.airDate) {
              if (!isDateWithinDays(item.airDate, maxDaysAway, releasedDays)) {
                logger.debug(
                  'Filtering out TV show (too old or too far away)',
                  {
                    label: 'PlaceholderService',
                    title: item.title,
                    airDate: item.airDate,
                  }
                );
                return { index, shouldRemove: true };
              }
            } else {
              // No air date found, filter out
              logger.debug('Filtering out TV show (no air date)', {
                label: 'PlaceholderService',
                title: item.title,
              });
              return { index, shouldRemove: true };
            }
          }
        }

        logger.debug('Enriched item with TMDB release date', {
          label: 'PlaceholderService',
          title: item.title,
          mediaType: item.mediaType,
          releaseDate: item.releaseDate || item.airDate,
        });

        return { index, shouldRemove: false };
      } catch (error) {
        logger.warn('Failed to fetch TMDB release date for item', {
          label: 'PlaceholderService',
          title: item.title,
          tmdbId: item.tmdbId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Remove items that fail to fetch, unless skipDateFilter is true (fail-open for non-Coming-Soon)
        return { index, shouldRemove: !skipDateFilter };
      }
    })
  );

  // Collect indices to remove and filter items (in reverse order to avoid index shifting)
  const indicesToRemove = enrichmentResults
    .filter((result) => result.shouldRemove)
    .map((result) => result.index)
    .sort((a, b) => b - a); // Sort descending for safe removal

  for (const index of indicesToRemove) {
    items.splice(index, 1);
  }

  logger.debug(
    'Completed TMDB release date enrichment and filtering (parallel)',
    {
      label: 'PlaceholderService',
      originalCount: enrichmentResults.length,
      filteredOut: indicesToRemove.length,
      remainingCount: items.length,
    }
  );
}

/**
 * Cross-reference Trakt items with Radarr/Sonarr to mark monitored status
 * and enrich with release dates and file status
 */
export async function markMonitoredStatus(
  items: ComingSoonSourceData[],
  maxDaysAway = 360,
  releasedDays = 0
): Promise<void> {
  const settings = getSettings();

  // Build maps of movie data from Radarr (keyed by TMDB ID)
  const radarrMovieMap = new Map<
    number,
    {
      monitored: boolean;
      hasFile: boolean;
      releaseDate?: string;
      digitalRelease?: string;
      physicalRelease?: string;
      inCinemas?: string;
    }
  >();

  // Build maps of show data from Sonarr (keyed by TVDB ID)
  const sonarrShowMap = new Map<
    number,
    {
      monitored: boolean;
      hasFile: boolean;
      airDate?: string;
      downloadedDate?: string;
    }
  >();

  // Fetch movie data from Radarr
  if (settings.radarr && settings.radarr.length > 0) {
    for (const radarrInstance of settings.radarr) {
      try {
        const radarrClient = new RadarrAPI({
          url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
            radarrInstance.hostname
          }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
          apiKey: radarrInstance.apiKey,
        });

        const movies = await radarrClient.getMovies();
        for (const movie of movies) {
          radarrMovieMap.set(movie.tmdbId, {
            monitored: movie.monitored,
            hasFile: movie.hasFile,
            releaseDate: movie.releaseDate,
            digitalRelease: movie.digitalRelease,
            physicalRelease: movie.physicalRelease,
            inCinemas: movie.inCinemas,
          });
        }
      } catch (error) {
        logger.warn('Failed to fetch movies for cross-reference', {
          label: 'Coming Soon Collections',
          instance: radarrInstance.name,
        });
      }
    }
  }

  // Fetch show data from Sonarr
  if (settings.sonarr && settings.sonarr.length > 0) {
    for (const sonarrInstance of settings.sonarr) {
      try {
        const sonarrClient = new SonarrAPI({
          url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
            sonarrInstance.hostname
          }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
          apiKey: sonarrInstance.apiKey,
        });

        const allSeries = await sonarrClient.getSeries();
        for (const series of allSeries) {
          if (!series.id) continue;

          try {
            // Get S01E01 details
            const episodes = await sonarrClient.getEpisodesBySeries(series.id);
            const s01e01 = episodes.find(
              (ep) => ep.seasonNumber === 1 && ep.episodeNumber === 1
            );

            if (s01e01 && s01e01.monitored) {
              const hasFile = s01e01.episodeFileId > 0;
              let downloadedDate: string | undefined;

              if (hasFile) {
                try {
                  const episodeFile = await sonarrClient.getEpisodeFile(
                    s01e01.episodeFileId
                  );
                  downloadedDate = episodeFile.dateAdded;
                } catch {
                  downloadedDate = series.added;
                }
              }

              sonarrShowMap.set(series.tvdbId, {
                monitored: series.monitored,
                hasFile,
                airDate: s01e01.airDateUtc,
                downloadedDate,
              });
            }
          } catch (error) {
            // Skip series if we can't get episode data
            logger.debug('Could not get episode data for series', {
              label: 'Coming Soon Collections',
              seriesTitle: series.title,
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to fetch shows for cross-reference', {
          label: 'Coming Soon Collections',
          instance: sonarrInstance.name,
        });
      }
    }
  }

  // Cross-reference items with Radarr/Sonarr to add monitoring/file status
  // DO NOT overwrite release dates - items from TMDB already have fresh dates
  for (const item of items) {
    if (item.mediaType === 'movie') {
      const radarrData = radarrMovieMap.get(item.tmdbId);
      if (radarrData) {
        item.monitored = radarrData.monitored;
        item.hasFile = radarrData.hasFile;
        // Only use Radarr dates if item doesn't have them yet (from TMDB source)
        // This preserves fresh TMDB dates from fetchTmdbComingSoonMovies()
        if (!item.releaseDate) item.releaseDate = radarrData.releaseDate;
        if (!item.digitalRelease)
          item.digitalRelease = radarrData.digitalRelease;
        if (!item.physicalRelease)
          item.physicalRelease = radarrData.physicalRelease;
        if (!item.inCinemas) item.inCinemas = radarrData.inCinemas;
      } else {
        // Not in Radarr
        item.monitored = false;
        item.hasFile = false;
      }
    } else if (item.tvdbId) {
      const sonarrData = sonarrShowMap.get(item.tvdbId);
      if (sonarrData) {
        item.monitored = sonarrData.monitored;
        item.hasFile = sonarrData.hasFile;
        // Only use Sonarr airDate if not already set
        if (!item.airDate) item.airDate = sonarrData.airDate;
        item.downloadedDate = sonarrData.downloadedDate;
      } else {
        // Not in Sonarr
        item.monitored = false;
        item.hasFile = false;
      }
    }
  }

  // Fetch fresh TMDB release dates for all items (except those already enriched by fetchTmdbComingSoon*)
  // This ensures monitored Radarr/Sonarr items get fresh TMDB data instead of stale *arr dates
  // Also filters out items outside the configured date window
  await enrichWithTMDBReleaseDates(items, maxDaysAway, releasedDays);

  logger.debug('Enriched Trakt items with Radarr/Sonarr data', {
    label: 'Coming Soon Collections',
    totalItems: items.length,
    monitored: items.filter((i) => i.monitored).length,
    needsRequest: items.filter((i) => !i.monitored).length,
    withReleaseData: items.filter((i) => i.releaseDate || i.airDate).length,
  });
}
