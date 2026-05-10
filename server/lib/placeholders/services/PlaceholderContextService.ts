import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import type { PlaceholderItem } from '@server/entity/PlaceholderItem';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { determineReleaseDate } from '@server/utils/dateHelpers';

/**
 * Context data for placeholder items fetched from live sources
 */
export interface PlaceholderContext {
  // Core identifiers
  tmdbId: number;
  tvdbId?: number;
  plexRatingKey?: string;

  // Live data (always fresh)
  isPlaceholder: boolean; // From Plex metadata inspection
  releaseDate?: string; // PRIMARY RELEASE DATE - Movies: digital/physical/theatrical+90, TV: first_air_date (series premiere)
  isEstimatedDate: boolean; // From TMDB calculation
  seasonNumber?: number; // From Sonarr or TMDB
  nextEpisodeAirDate?: string; // TV ONLY - Next episode air date (any episode including mid-season)
  nextSeasonAirDate?: string; // TV ONLY - Next SEASON premiere (only episode 1 of new season)

  // Monitoring status (from *arr)
  inRadarr: boolean;
  inSonarr: boolean;
  isMonitored: boolean;
  downloaded: boolean; // Inverse of isPlaceholder
}

interface ReleaseInfo {
  releaseDate?: string;
  isEstimated: boolean;
  seasonNumber?: number;
  nextEpisodeAirDate?: string; // For TV shows - next episode air date (any episode)
  nextSeasonAirDate?: string; // For TV shows - next SEASON premiere only (episode 1 of new season)
}

interface MonitoringStatus {
  inRadarr: boolean;
  inSonarr: boolean;
  isMonitored: boolean;
  downloaded: boolean;
  seasonNumber?: number;
}

/**
 * Service for fetching fresh placeholder context data from live sources
 * This service never caches data in the database - it always fetches from:
 * - Plex API (for placeholder detection)
 * - TMDB API (for release dates)
 * - Radarr/Sonarr APIs (for monitoring status)
 */
export class PlaceholderContextService {
  private tmdbCache = new Map<
    string,
    {
      data: ReleaseInfo;
      fetchedAt: Date;
    }
  >();

  /**
   * Get complete context for a placeholder item
   * Fetches all data from live sources (Plex, TMDB, Sonarr/Radarr)
   */
  async getPlaceholderContext(
    item: PlaceholderItem,
    plexMetadata?: {
      type: string;
      guid?: string;
      editionTitle?: string;
      Guid?: { id: string }[];
      childCount?: number;
      Children?: { Metadata?: unknown[]; Directory?: unknown[] };
      seasonCount?: number;
      leafCount?: number;
    }
  ): Promise<PlaceholderContext> {
    // 1. Detect placeholder status from Plex metadata
    const isPlaceholder = plexMetadata
      ? this.isPlaceholderItem(plexMetadata)
      : true;

    // 2. Fetch fresh release date from TMDB
    const releaseInfo = await this.fetchReleaseDate(
      item.tmdbId,
      item.mediaType
    );

    // 3. Check monitoring status in Radarr/Sonarr
    const monitoringStatus = await this.checkMonitoringStatus(
      item.tmdbId,
      item.tvdbId,
      item.mediaType
    );

    return {
      tmdbId: item.tmdbId,
      tvdbId: item.tvdbId,
      plexRatingKey: item.plexRatingKey,
      isPlaceholder,
      releaseDate: releaseInfo.releaseDate,
      isEstimatedDate: releaseInfo.isEstimated,
      seasonNumber: releaseInfo.seasonNumber || monitoringStatus.seasonNumber,
      nextEpisodeAirDate: releaseInfo.nextEpisodeAirDate, // Any next episode
      nextSeasonAirDate: releaseInfo.nextSeasonAirDate, // Only season premieres
      inRadarr: monitoringStatus.inRadarr,
      inSonarr: monitoringStatus.inSonarr,
      isMonitored: monitoringStatus.isMonitored,
      downloaded: monitoringStatus.downloaded,
    };
  }

  /**
   * Check if a Plex item is a placeholder based on metadata inspection
   * Movies: Check editionTitle for "Trailer", "Placeholder", or "Coming Soon"
   * TV: Check if only Season 00 exists (trailer season)
   */
  /**
   * Check if a Plex item is a placeholder (Coming Soon item with only trailer)
   * Phase 1: Quick check using basic metadata
   * Phase 2: Detailed check with API call for suspicious items (async version)
   */
  isPlaceholderItem(plexMetadata: {
    type: string;
    guid?: string;
    editionTitle?: string;
    Guid?: { id: string }[];
    childCount?: number;
    Children?: { Metadata?: unknown[]; Directory?: unknown[] };
    seasonCount?: number;
    leafCount?: number;
  }): boolean {
    if (plexMetadata.type === 'movie') {
      // Check edition title for placeholder markers
      const editionTitle = plexMetadata.editionTitle?.toLowerCase() || '';
      if (
        editionTitle.includes('trailer') ||
        editionTitle.includes('placeholder') ||
        editionTitle.includes('coming soon')
      ) {
        return true;
      }

      // Check GUID for tmdb-placeholder pattern
      const guids = plexMetadata.Guid || [];
      for (const guid of guids) {
        if (
          guid.id &&
          (guid.id.includes('trailer') ||
            guid.id.includes('placeholder') ||
            guid.id.includes('coming-soon'))
        ) {
          return true;
        }
      }

      // Check main guid
      if (plexMetadata.guid) {
        const guidLower = plexMetadata.guid.toLowerCase();
        if (
          guidLower.includes('trailer') ||
          guidLower.includes('placeholder') ||
          guidLower.includes('coming-soon')
        ) {
          return true;
        }
      }

      return false;
    } else if (plexMetadata.type === 'show') {
      // TV shows: Check if only Season 00 exists (our trailer placeholder pattern)
      // Real shows will have Season 01+ when content arrives

      // Merge both child arrays (Plex may populate either or both)
      const childSeasons = [
        ...(plexMetadata.Children?.Metadata || []),
        ...(plexMetadata.Children?.Directory || []),
      ];
      if (childSeasons.length > 0) {
        const seasons = childSeasons as {
          index?: number;
        }[];

        const nonZeroSeasons = seasons.filter(
          (s) => s.index !== undefined && s.index > 0
        ).length;

        return nonZeroSeasons === 0;
      }

      // If no children metadata provided, use leafCount as a heuristic
      // BUT: leafCount alone is unreliable - a show with 1 real episode looks the same as a placeholder with 1 trailer
      // We need to actually check if the only season is Season 00
      const leafCount = plexMetadata.leafCount || 0;

      // If multiple episodes, definitely not a placeholder
      if (leafCount > 1) {
        return false;
      }

      // If 0 or 1 episodes AND no children metadata, we can't reliably determine
      // This should be handled by the caller using isPlaceholderItemAsync() for a detailed check
      // For now, conservatively assume it's NOT a placeholder
      return false;
    }

    return false;
  }

  /**
   * Async version of isPlaceholderItem that fetches full metadata for suspicious items
   * Use this for definitive placeholder detection when you have PlexAPI access
   */
  async isPlaceholderItemAsync(
    plexMetadata: {
      type: string;
      guid?: string;
      editionTitle?: string;
      Guid?: { id: string }[];
      childCount?: number;
      Children?: { Metadata?: unknown[]; Directory?: unknown[] };
      seasonCount?: number;
      leafCount?: number;
      ratingKey?: string;
    },
    plexApi?: {
      query: (path: string) => Promise<{
        MediaContainer?: { Directory?: unknown[]; Metadata?: unknown[] };
      }>;
    }
  ): Promise<boolean> {
    // Phase 1: Quick check using basic metadata
    if (plexMetadata.type === 'movie') {
      // Movies: Check edition title
      const editionTitle = plexMetadata.editionTitle?.toLowerCase() || '';
      if (
        editionTitle.includes('trailer') ||
        editionTitle.includes('placeholder') ||
        editionTitle.includes('coming soon')
      ) {
        return true;
      }

      // Check GUID for placeholder pattern
      const guids = plexMetadata.Guid || [];
      for (const guid of guids) {
        if (
          guid.id &&
          (guid.id.includes('trailer') ||
            guid.id.includes('placeholder') ||
            guid.id.includes('coming-soon'))
        ) {
          return true;
        }
      }

      if (plexMetadata.guid) {
        const guidLower = plexMetadata.guid.toLowerCase();
        if (
          guidLower.includes('trailer') ||
          guidLower.includes('placeholder') ||
          guidLower.includes('coming-soon')
        ) {
          return true;
        }
      }

      return false;
    } else if (plexMetadata.type === 'show') {
      // TV shows: Check seasons

      // If Children metadata is already provided, use it
      const childSeasons =
        plexMetadata.Children?.Metadata || plexMetadata.Children?.Directory;
      if (childSeasons) {
        const seasons = childSeasons as {
          index?: number;
        }[];

        if (seasons.length === 0) {
          return false;
        }

        const nonZeroSeasons = seasons.filter(
          (s) => s.index && s.index > 0
        ).length;

        return nonZeroSeasons === 0 && seasons.length > 0;
      }

      // Phase 2: Detailed check for suspicious items
      const leafCount = plexMetadata.leafCount || 0;

      // If multiple episodes, definitely not a placeholder
      if (leafCount > 1) {
        return false;
      }

      // If 0 or 1 episodes AND we have API access, fetch full metadata
      if (leafCount <= 1 && plexApi && plexMetadata.ratingKey) {
        try {
          logger.debug('Fetching full metadata for placeholder detection', {
            label: 'PlaceholderContextService',
            ratingKey: plexMetadata.ratingKey,
            leafCount,
          });

          const response = await plexApi.query(
            `/library/metadata/${plexMetadata.ratingKey}/children`
          );

          logger.debug('Placeholder detection - raw API response', {
            label: 'PlaceholderContextService',
            ratingKey: plexMetadata.ratingKey,
            hasMediaContainer: !!response?.MediaContainer,
            hasDirectory: !!response?.MediaContainer?.Directory,
            hasMetadata: !!response?.MediaContainer?.Metadata,
            responseKeys: Object.keys(response || {}),
            mediaContainerKeys: Object.keys(response?.MediaContainer || {}),
          });

          // Seasons may be in Metadata or Directory depending on Plex version/endpoint
          const seasons = (response?.MediaContainer?.Metadata ||
            response?.MediaContainer?.Directory ||
            []) as {
            index?: number;
          }[];

          logger.debug('Placeholder detection - seasons found', {
            label: 'PlaceholderContextService',
            ratingKey: plexMetadata.ratingKey,
            seasonCount: seasons.length,
            seasonIndexes: seasons.map((s) => s.index),
          });

          if (seasons.length === 0) {
            return false; // No seasons at all, assume not a placeholder
          }

          // Check if all seasons are Season 00
          const nonZeroSeasons = seasons.filter(
            (s) => s.index && s.index > 0
          ).length;

          const isPlaceholder = nonZeroSeasons === 0 && seasons.length > 0;

          logger.debug('Placeholder detection result', {
            label: 'PlaceholderContextService',
            ratingKey: plexMetadata.ratingKey,
            isPlaceholder,
            nonZeroSeasons,
          });

          return isPlaceholder;
        } catch (error) {
          logger.warn('Failed to fetch metadata for placeholder detection', {
            label: 'PlaceholderContextService',
            ratingKey: plexMetadata.ratingKey,
            error: error instanceof Error ? error.message : String(error),
          });
          // If API call fails, fall back to conservative assumption
          return false;
        }
      }

      // Can't determine without more info, assume not a placeholder
      return false;
    }

    return false;
  }

  /**
   * Fetch fresh release date from TMDB
   * Uses 24-hour in-memory cache with fallback for TMDB downtime
   */
  async fetchReleaseDate(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<ReleaseInfo> {
    const cacheKey = `${mediaType}-${tmdbId}`;
    const cached = this.tmdbCache.get(cacheKey);

    // Use cache if less than 24 hours old
    if (
      cached &&
      Date.now() - cached.fetchedAt.getTime() < 24 * 60 * 60 * 1000
    ) {
      logger.debug('Using cached TMDB release date', {
        label: 'PlaceholderContextService',
        tmdbId,
        mediaType,
        cacheAge: Math.floor(
          (Date.now() - cached.fetchedAt.getTime()) / (1000 * 60)
        ),
      });
      return cached.data;
    }

    // Fetch fresh data from TMDB
    try {
      const tmdb = new TheMovieDb();
      let releaseInfo: ReleaseInfo = {
        isEstimated: false,
      };

      if (mediaType === 'movie') {
        const movie = await tmdb.getMovie({ movieId: tmdbId });

        if (movie.release_dates?.results) {
          const { extractReleaseDates } = await import(
            '@server/utils/dateHelpers'
          );
          const extracted = extractReleaseDates(movie.release_dates.results);

          const determined = determineReleaseDate(
            extracted.digitalRelease,
            extracted.physicalRelease,
            extracted.inCinemas
          );

          if (determined) {
            releaseInfo = {
              releaseDate: determined.releaseDate,
              isEstimated: determined.isEstimated,
            };
          }
        }
      } else {
        // TV show
        const show = await tmdb.getTvShow({ tvId: tmdbId });

        // Store next episode air date separately for countdown overlays
        // TMDB returns null, convert to undefined
        const nextEpisodeAirDate =
          show.next_episode_to_air?.air_date ?? undefined;
        const nextSeasonNumber = show.next_episode_to_air?.season_number;
        const nextEpisodeNumber = show.next_episode_to_air?.episode_number;

        // Detect if next episode is a SEASON PREMIERE (episode 1 of a new season)
        // This is ONLY for season premieres, not mid-season episodes
        const nextSeasonAirDate =
          nextEpisodeNumber === 1 ? nextEpisodeAirDate : undefined;

        // PRIMARY releaseDate for TV = first_air_date (series premiere)
        // This matches the new design: Movies use digital/physical/theatrical+90, TV uses series premiere
        releaseInfo = {
          releaseDate: show.first_air_date ?? undefined, // Series premiere date, convert null to undefined
          isEstimated: false,
          seasonNumber: nextSeasonNumber,
          nextEpisodeAirDate, // Separate field for ANY next episode countdowns
          nextSeasonAirDate, // ONLY set for season premieres (episode 1)
        };
      }

      // Cache the result
      this.tmdbCache.set(cacheKey, {
        data: releaseInfo,
        fetchedAt: new Date(),
      });

      logger.debug('Fetched fresh TMDB release date', {
        label: 'PlaceholderContextService',
        tmdbId,
        mediaType,
        releaseDate: releaseInfo.releaseDate,
        isEstimated: releaseInfo.isEstimated,
      });

      return releaseInfo;
    } catch (error) {
      // If TMDB is down, use stale cache if available
      if (cached) {
        const cacheAge = Math.floor(
          (Date.now() - cached.fetchedAt.getTime()) / (1000 * 60 * 60)
        );
        logger.warn('TMDB unavailable, using stale cache', {
          label: 'PlaceholderContextService',
          tmdbId,
          mediaType,
          cacheAgeHours: cacheAge,
          error: error instanceof Error ? error.message : String(error),
        });
        return cached.data;
      }

      // No cache available - return empty result
      logger.error('TMDB unavailable and no cache', {
        label: 'PlaceholderContextService',
        tmdbId,
        mediaType,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        isEstimated: false,
      };
    }
  }

  /**
   * Check monitoring status in Radarr/Sonarr
   * Returns whether item is in *arr, monitored, and has files
   */
  async checkMonitoringStatus(
    tmdbId: number,
    tvdbId: number | undefined,
    mediaType: 'movie' | 'tv'
  ): Promise<MonitoringStatus> {
    const settings = getSettings();

    const status: MonitoringStatus = {
      inRadarr: false,
      inSonarr: false,
      isMonitored: false,
      downloaded: false,
    };

    try {
      if (mediaType === 'movie' && settings.radarr) {
        for (const radarrInstance of settings.radarr) {
          const radarrClient = new RadarrAPI({
            url: `${radarrInstance.useSsl ? 'https' : 'http'}://${
              radarrInstance.hostname
            }:${radarrInstance.port}${radarrInstance.baseUrl || ''}/api/v3`,
            apiKey: radarrInstance.apiKey,
          });

          const movies = await radarrClient.getMovies();
          const movie = movies.find((m) => m.tmdbId === tmdbId);

          if (movie) {
            status.inRadarr = true;
            status.isMonitored = movie.monitored || false;
            status.downloaded = movie.hasFile || false;
            break;
          }
        }
      } else if (mediaType === 'tv' && settings.sonarr) {
        for (const sonarrInstance of settings.sonarr) {
          const sonarrClient = new SonarrAPI({
            url: `${sonarrInstance.useSsl ? 'https' : 'http'}://${
              sonarrInstance.hostname
            }:${sonarrInstance.port}${sonarrInstance.baseUrl || ''}/api/v3`,
            apiKey: sonarrInstance.apiKey,
          });

          const shows = await sonarrClient.getSeries();
          const show = shows.find((s) => s.tvdbId === tvdbId);

          if (show) {
            status.inSonarr = true;
            status.isMonitored = show.monitored || false;
            status.downloaded =
              (show.statistics?.episodeFileCount || 0) > 0 || false;

            // Get season number from next airing episode or latest season
            if (show.seasons && show.seasons.length > 0) {
              const monitoredSeasons = show.seasons.filter(
                (s) => s.monitored && s.seasonNumber > 0
              );
              if (monitoredSeasons.length > 0) {
                status.seasonNumber =
                  monitoredSeasons[monitoredSeasons.length - 1].seasonNumber;
              }
            }
            break;
          }
        }
      }
    } catch (error) {
      logger.error('Failed to check monitoring status', {
        label: 'PlaceholderContextService',
        tmdbId,
        tvdbId,
        mediaType,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return status;
  }

  /**
   * Check if a placeholder has been replaced with real content
   * This checks both Plex metadata (isPlaceholder) and *arr status (downloaded)
   */
  async hasRealContent(
    item: PlaceholderItem,
    plexMetadata?: {
      type: string;
      guid?: string;
      editionTitle?: string;
      Guid?: { id: string }[];
      childCount?: number;
      Children?: { Metadata?: unknown[]; Directory?: unknown[] };
      seasonCount?: number;
      leafCount?: number;
    }
  ): Promise<boolean> {
    // First check Plex metadata
    if (plexMetadata && !this.isPlaceholderItem(plexMetadata)) {
      return true;
    }

    // Also check *arr status
    const monitoringStatus = await this.checkMonitoringStatus(
      item.tmdbId,
      item.tvdbId,
      item.mediaType
    );

    return monitoringStatus.downloaded;
  }
}

// Export singleton instance
export const placeholderContextService = new PlaceholderContextService();
