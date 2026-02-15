import { type SonarrMonitorType } from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import type {
  AutoRequestResult,
  MissingItem,
} from '@server/lib/collections/core/types';
import type {
  CollectionConfig,
  RadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  getRadarrAPI,
  getRadarrTagsWithCollection,
  getSonarrAPI,
  getSonarrTagsWithCollection,
} from './ArrTagUtils';
import { missingItemFilterService } from './MissingItemFilterService';

/**
 * Direct download service for bypassing Overseerr and downloading directly to *arr apps
 *
 * This service provides a true *arr-style workflow by sending items directly to
 * Radarr/Sonarr without going through request/approval workflow
 */
export class DirectDownloadService {
  private tmdbAPI: TheMovieDb;

  constructor() {
    this.tmdbAPI = new TheMovieDb();
  }

  /**
   * Process direct downloads for missing items - bypasses Overseerr completely
   *
   * @param missingItems - Items that are missing from Plex
   * @param config - Collection configuration with auto-request settings
   * @param source - Source type for logging
   * @returns Promise with download results
   */
  public async processDirectDownloads(
    missingItems: MissingItem[],
    config: CollectionConfig,
    source:
      | 'trakt'
      | 'tmdb'
      | 'imdb'
      | 'letterboxd'
      | 'anilist'
      | 'myanimelist'
      | 'mdblist'
      | 'networks'
      | 'originals'
      | 'multi-source'
      | 'radarrtag'
      | 'sonarrtag'
  ): Promise<AutoRequestResult> {
    // Only proceed if direct download is enabled
    if (!config.searchMissingMovies && !config.searchMissingTV) {
      return this.emptyResult();
    }

    // Filter items using shared filtering service
    const filterResult = await missingItemFilterService.filterMissingItems(
      missingItems,
      config,
      'Direct Download Service'
    );

    if (filterResult.filteredItems.length === 0) {
      return this.emptyResult();
    }

    try {
      let autoApprovedRequests = 0;
      let skippedRequests = 0;
      let alreadyDownloadedCount = 0;
      const maxSeasons =
        config.maxSeasonsToRequest !== undefined &&
        config.maxSeasonsToRequest !== null
          ? Number(config.maxSeasonsToRequest)
          : 0; // 0 = no limit

      for (const item of filterResult.filteredItems) {
        try {
          // For TV shows, check season count limit only if maxSeasons is set (> 0)
          if (item.mediaType === 'tv' && maxSeasons > 0) {
            const seasonCount = await missingItemFilterService.getTvSeasonCount(
              item.tmdbId
            );

            if (seasonCount > maxSeasons) {
              logger.debug(
                `Skipping ${item.title}: Too many seasons (${seasonCount} > ${maxSeasons})`,
                {
                  label: 'Direct Download Service',
                  collection: config.name,
                }
              );
              skippedRequests++;
              continue;
            }
          }

          // Check if item is excluded in *arr service
          if (await this.isItemExcluded(item, config)) {
            logger.debug(
              `Skipping ${item.title}: Item is excluded in ${
                item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'
              }`,
              {
                label: 'Direct Download Service',
                collection: config.name,
              }
            );
            skippedRequests++;
            continue;
          }

          // Check if already exists in *arr
          if (await this.checkAlreadyDownloaded(item, config)) {
            alreadyDownloadedCount++;
            continue;
          }

          // Add to appropriate *arr service
          if (item.mediaType === 'movie') {
            await this.addMovieToRadarr(item, config, source);
          } else if (item.mediaType === 'tv') {
            await this.addSeriesToSonarr(item, config, maxSeasons, source);
          }

          autoApprovedRequests++;

          logger.info(
            `Direct download initiated for ${item.mediaType}: ${item.title} (TMDB: ${item.tmdbId})`,
            {
              label: `${
                source.charAt(0).toUpperCase() + source.slice(1)
              } Collections`,
              collection: config.name,
            }
          );
        } catch (error) {
          logger.warn(
            `Failed to initiate direct download for ${item.title}: ${error}`,
            {
              label: `${
                source.charAt(0).toUpperCase() + source.slice(1)
              } Collections`,
              collection: config.name,
            }
          );
          skippedRequests++;
        }
      }

      // Log filtering summary (genres, countries, IMDb ratings)
      missingItemFilterService.logFilteringSummary(
        filterResult,
        config,
        source
      );

      // To maintain exact compatibility with original behavior, add filter counts to skipped
      const totalSkipped =
        skippedRequests +
        filterResult.lowRatedItems.length +
        filterResult.lowRatedRTItems.length +
        filterResult.excludedGenreItems.length +
        filterResult.excludedCountryItems.length +
        filterResult.excludedLanguageItems.length +
        filterResult.includedGenreItems.length +
        filterResult.includedCountryItems.length +
        filterResult.includedLanguageItems.length;

      if (autoApprovedRequests > 0) {
        logger.info(
          `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } collection direct downloads initiated for ${
            config.name
          }: ${autoApprovedRequests} added to *arr${
            totalSkipped > 0 ? `, ${totalSkipped} skipped` : ''
          }${
            alreadyDownloadedCount > 0
              ? `, ${alreadyDownloadedCount} already available`
              : ''
          }`,
          {
            label: `${
              source.charAt(0).toUpperCase() + source.slice(1)
            } Collections`,
          }
        );
      }

      return {
        autoApproved: autoApprovedRequests,
        manualApproval: 0, // Direct downloads are immediate, no manual approval
        alreadyRequested: alreadyDownloadedCount,
        skipped: totalSkipped,
        total: missingItems.length - filterResult.yearFilteredItems.length,
      };
    } catch (error) {
      logger.error(
        `Failed to process direct downloads for ${source} collection ${config.name}: ${error}`,
        {
          label: `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } Collections`,
        }
      );
      throw error;
    }
  }

  /**
   * Add a movie directly to Radarr
   */
  private async addMovieToRadarr(
    item: MissingItem,
    config: CollectionConfig,
    source:
      | 'trakt'
      | 'tmdb'
      | 'imdb'
      | 'letterboxd'
      | 'anilist'
      | 'myanimelist'
      | 'mdblist'
      | 'networks'
      | 'originals'
      | 'multi-source'
      | 'tautulli'
      | 'overseerr'
      | 'radarrtag'
      | 'sonarrtag'
  ): Promise<void> {
    const settings = getSettings();

    // Use collection-specific server or fall back to default
    let radarrSettings: RadarrSettings | undefined;
    const selectedRadarrServerId =
      config.directDownloadRadarrServerId ?? undefined;

    if (selectedRadarrServerId !== undefined) {
      radarrSettings = settings.radarr.find(
        (r) => r.id === selectedRadarrServerId
      );
      if (!radarrSettings) {
        throw new Error(
          `Radarr server with ID ${selectedRadarrServerId} not found`
        );
      }
    } else {
      radarrSettings = settings.radarr.find((r) => r.isDefault);
      if (!radarrSettings) {
        throw new Error('No default Radarr configuration found');
      }
    }

    const radarrAPI = getRadarrAPI(radarrSettings.id);

    // Use collection-specific profile or fall back to server default
    const profileId =
      config.directDownloadRadarrProfileId || radarrSettings.activeProfileId;

    // Get all tags: server defaults + auto-generated + collection overrides
    const tagsToSend = await getRadarrTagsWithCollection(
      radarrSettings,
      config,
      source
    );
    const collectionTags = config.directDownloadRadarrTags || [];
    const finalTags = [...new Set([...tagsToSend, ...collectionTags])];

    const directRadarrRootFolder = config.directDownloadRadarrRootFolder;

    const rootFolderPath =
      directRadarrRootFolder ??
      config.directDownloadRadarrRootFolder ??
      radarrSettings.activeDirectory;

    // Use per-collection overrides for monitor and searchOnAdd, fallback to server defaults
    const monitored =
      config.directDownloadRadarrMonitor !== undefined
        ? config.directDownloadRadarrMonitor
        : radarrSettings.monitorByDefault ?? true;
    const searchNow =
      config.directDownloadRadarrSearchOnAdd !== undefined
        ? config.directDownloadRadarrSearchOnAdd
        : radarrSettings.searchOnAdd ?? true;

    await radarrAPI.addMovie({
      title: item.title,
      qualityProfileId: profileId,
      minimumAvailability: radarrSettings.minimumAvailability,
      tags: finalTags,
      profileId: profileId,
      year: item.year || new Date().getFullYear(), // Use item year or current year as fallback
      rootFolderPath,
      tmdbId: item.tmdbId,
      monitored,
      searchNow,
    });

    logger.debug('Added movie to Radarr for collection', {
      label: 'Direct Download Service',
      collection: config.name,
      movie: item.title,
      tmdbId: item.tmdbId,
      radarrServer: `${radarrSettings.hostname}:${radarrSettings.port}`,
      profileId: profileId,
      rootFolderPath,
      tags: tagsToSend,
    });
  }

  /**
   * Add a TV series directly to Sonarr
   */
  private async addSeriesToSonarr(
    item: MissingItem,
    config: CollectionConfig,
    maxSeasons: number,
    source:
      | 'trakt'
      | 'tmdb'
      | 'imdb'
      | 'letterboxd'
      | 'anilist'
      | 'myanimelist'
      | 'mdblist'
      | 'networks'
      | 'originals'
      | 'multi-source'
      | 'tautulli'
      | 'overseerr'
      | 'radarrtag'
      | 'sonarrtag'
  ): Promise<void> {
    const settings = getSettings();

    // Use collection-specific server or fall back to default
    let sonarrSettings: SonarrSettings | undefined;
    const selectedSonarrServerId =
      config.directDownloadSonarrServerId ?? undefined;

    if (selectedSonarrServerId !== undefined) {
      sonarrSettings = settings.sonarr.find(
        (s) => s.id === selectedSonarrServerId
      );
      if (!sonarrSettings) {
        throw new Error(
          `Sonarr server with ID ${selectedSonarrServerId} not found`
        );
      }
    } else {
      sonarrSettings = settings.sonarr.find((s) => s.isDefault);
      if (!sonarrSettings) {
        throw new Error('No default Sonarr configuration found');
      }
    }

    const sonarrAPI = getSonarrAPI(sonarrSettings.id);

    // Use collection-specific profile or fall back to server default
    const profileId =
      config.directDownloadSonarrProfileId || sonarrSettings.activeProfileId;

    // Get TV show details to get TVDB ID (required by Sonarr)
    // Use TVDB ID directly if available (anime), otherwise lookup via TMDB
    let tvdbId = item.tvdbId;
    if (!tvdbId) {
      tvdbId = (await this.getTvdbIdFromTmdb(item.tmdbId)) || undefined;
    }
    if (!tvdbId) {
      throw new Error(`Could not find TVDB ID for TMDB ID: ${item.tmdbId}`);
    }

    const seasonCount = await missingItemFilterService.getTvSeasonCount(
      item.tmdbId
    );

    // Determine how many seasons to grab
    let seasonsLimit =
      maxSeasons > 0 ? Math.min(seasonCount, maxSeasons) : seasonCount;

    // Apply seasonsPerShowLimit if configured
    if (config.seasonsPerShowLimit && config.seasonsPerShowLimit > 0) {
      seasonsLimit = Math.min(seasonsLimit, config.seasonsPerShowLimit);
    }

    // Determine which specific seasons to monitor based on grab order
    const grabOrder = config.seasonGrabOrder || 'first'; // Default to 'first'
    const seasonsToMonitorArray =
      await missingItemFilterService.selectSeasonsToGrab(
        item.tmdbId,
        seasonsLimit,
        grabOrder
      );

    logger.debug(
      `Selecting seasons for ${item.title} using ${grabOrder} mode (total seasons: ${seasonCount})`,
      {
        label: 'Direct Download Service',
        collection: config.name,
        mode: grabOrder,
        limit: seasonsLimit,
        selectedSeasons: seasonsToMonitorArray,
      }
    );

    // Get all tags: server defaults + auto-generated + collection overrides
    const tagsToSend = await getSonarrTagsWithCollection(
      sonarrSettings,
      config,
      source
    );
    const collectionTags = config.directDownloadSonarrTags || [];
    const finalTags = [...new Set([...tagsToSend, ...collectionTags])];

    const directSonarrRootFolder = config.directDownloadSonarrRootFolder;

    const rootFolderPath =
      directSonarrRootFolder ??
      config.directDownloadSonarrRootFolder ??
      sonarrSettings.activeDirectory;

    // Use per-collection overrides for monitor type and searchOnAdd, fallback to server defaults
    // Backwards compatibility: if monitorType is not set, check legacy monitorByDefault boolean
    const getMonitorType = (): SonarrMonitorType => {
      // First check collection-level override
      if (config.directDownloadSonarrMonitorType) {
        return config.directDownloadSonarrMonitorType;
      }
      // Then check server-level setting (sonarrSettings is guaranteed defined at this point)
      if (sonarrSettings?.monitorType) {
        return sonarrSettings.monitorType;
      }
      // Backwards compatibility: check legacy boolean settings
      // Collection-level override takes precedence
      if (config.directDownloadSonarrMonitor === false) {
        return 'none';
      }
      if (sonarrSettings?.monitorByDefault === false) {
        return 'none';
      }
      // Default to 'all'
      return 'all';
    };
    const monitorType = getMonitorType();
    // Derive monitored boolean from monitorType - matches Sonarr UI behavior
    const monitored = monitorType !== 'none';
    const searchNow =
      config.directDownloadSonarrSearchOnAdd !== undefined
        ? config.directDownloadSonarrSearchOnAdd
        : sonarrSettings.searchOnAdd ?? true;

    await sonarrAPI.addSeries({
      tvdbid: tvdbId,
      title: item.title,
      profileId: profileId,
      languageProfileId: sonarrSettings.activeLanguageProfileId,
      seasons: seasonsToMonitorArray, // Pass the selected season numbers
      tags: finalTags,
      rootFolderPath,
      monitored,
      monitorType,
      seasonFolder: sonarrSettings.enableSeasonFolders ?? true, // Default to true (Sonarr's default behavior)
      seriesType: sonarrSettings.seriesType || 'standard',
      searchNow,
    });

    logger.debug('Added TV series to Sonarr for collection', {
      label: 'Direct Download Service',
      collection: config.name,
      series: item.title,
      tmdbId: item.tmdbId,
      tvdbId: tvdbId,
      sonarrServer: `${sonarrSettings.hostname}:${sonarrSettings.port}`,
      profileId: profileId,
      rootFolderPath,
      seasonsToMonitor: seasonsToMonitorArray,
      tags: tagsToSend,
    });
  }

  /**
   * Check if an item is excluded in the appropriate *arr service
   */
  private async isItemExcluded(
    item: MissingItem,
    config: CollectionConfig
  ): Promise<boolean> {
    try {
      if (item.mediaType === 'movie') {
        const settings = getSettings();
        const radarrServerId =
          config.directDownloadRadarrServerId ??
          settings.radarr.find((r) => r.isDefault)?.id;

        const radarrAPI = getRadarrAPI(radarrServerId);
        const exclusions = await radarrAPI.getExclusions();
        return exclusions.some((exclusion) => exclusion.tmdbId === item.tmdbId);
      } else if (item.mediaType === 'tv') {
        const settings = getSettings();
        const sonarrServerId =
          config.directDownloadSonarrServerId ??
          settings.sonarr.find((s) => s.isDefault)?.id;

        const sonarrAPI = getSonarrAPI(sonarrServerId);
        const exclusions = await sonarrAPI.getExclusions();
        // Use TVDB ID directly if available (anime), otherwise lookup via TMDB
        let tvdbId = item.tvdbId;
        if (!tvdbId) {
          tvdbId = (await this.getTvdbIdFromTmdb(item.tmdbId)) || undefined;
        }
        return tvdbId
          ? exclusions.some((exclusion) => exclusion.tvdbId === tvdbId)
          : false;
      }
    } catch (error) {
      logger.debug(
        `Could not check exclusion status for ${item.title}: ${error}`,
        {
          label: 'Direct Download Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      // If we can't check exclusions, allow the item to be processed to avoid blocking legitimate downloads
    }
    return false;
  }

  /**
   * Check if an item is already downloaded in the appropriate *arr service
   */
  private async checkAlreadyDownloaded(
    item: MissingItem,
    config: CollectionConfig
  ): Promise<boolean> {
    try {
      if (item.mediaType === 'movie') {
        const settings = getSettings();
        const radarrServerId =
          config.directDownloadRadarrServerId ??
          settings.radarr.find((r) => r.isDefault)?.id;

        const radarrAPI = getRadarrAPI(radarrServerId);
        const existingMovie = await radarrAPI.getMovieByTmdbId(item.tmdbId);
        return existingMovie && existingMovie.hasFile;
      } else if (item.mediaType === 'tv') {
        const settings = getSettings();
        const sonarrServerId =
          config.directDownloadSonarrServerId ??
          settings.sonarr.find((s) => s.isDefault)?.id;

        const sonarrAPI = getSonarrAPI(sonarrServerId);
        // Use TVDB ID directly if available (anime), otherwise lookup via TMDB
        let tvdbId = item.tvdbId;
        if (!tvdbId) {
          tvdbId = (await this.getTvdbIdFromTmdb(item.tmdbId)) || undefined;
        }
        if (!tvdbId) return false;

        const existingSeries = await sonarrAPI.getSeriesByTvdbId(tvdbId);
        return (
          existingSeries && existingSeries.statistics?.percentOfEpisodes > 0
        );
      }
    } catch (error) {
      // If we can't check, assume it's not downloaded to be safe
      logger.debug(
        `Could not verify download status for ${item.title}: ${error}`,
        {
          label: 'Direct Download Service',
        }
      );
    }
    return false;
  }

  /**
   * Get TVDB ID from TMDB ID for TV shows (required by Sonarr)
   */
  private async getTvdbIdFromTmdb(tmdbId: number): Promise<number | null> {
    try {
      const tmdb = new (await import('@server/api/themoviedb')).default();
      const tvShow = await tmdb.getTvShow({ tvId: tmdbId });

      // Look for TVDB ID in external_ids
      if (tvShow.external_ids?.tvdb_id) {
        return tvShow.external_ids.tvdb_id;
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to get TVDB ID for TMDB ID ${tmdbId}`, {
        label: 'Direct Download Service',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Return empty result structure
   */
  private emptyResult(): AutoRequestResult {
    return {
      autoApproved: 0,
      manualApproval: 0,
      alreadyRequested: 0,
      skipped: 0,
      total: 0,
    };
  }
}

// Export singleton instance
export const directDownloadService = new DirectDownloadService();
