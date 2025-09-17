import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
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

/**
 * Direct download service for bypassing Overseerr and downloading directly to *arr apps
 *
 * This service provides a true *arr-style workflow by sending items directly to
 * Radarr/Sonarr without going through request/approval workflow
 */
export class DirectDownloadService {
  private radarrAPI: RadarrAPI | null = null;
  private sonarrAPI: SonarrAPI | null = null;

  /**
   * Get or initialize Radarr API client
   */
  private getRadarrAPI(): RadarrAPI {
    if (!this.radarrAPI) {
      const settings = getSettings();
      // Find default Radarr instance (4K support was removed but can be re-added by filtering r.is4k === false)
      const radarrSettings = settings.radarr.find((r) => r.isDefault);

      if (!radarrSettings) {
        throw new Error('No default Radarr instance configured');
      }

      this.radarrAPI = new RadarrAPI({
        url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
        apiKey: radarrSettings.apiKey,
      });
    }
    return this.radarrAPI;
  }

  /**
   * Get or initialize Sonarr API client
   */
  private getSonarrAPI(): SonarrAPI {
    if (!this.sonarrAPI) {
      const settings = getSettings();
      // Find default Sonarr instance (4K support was removed but can be re-added by filtering s.is4k === false)
      const sonarrSettings = settings.sonarr.find((s) => s.isDefault);

      if (!sonarrSettings) {
        throw new Error('No default Sonarr instance configured');
      }

      this.sonarrAPI = new SonarrAPI({
        url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
        apiKey: sonarrSettings.apiKey,
      });
    }
    return this.sonarrAPI;
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
    source: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd' | 'networks'
  ): Promise<AutoRequestResult> {
    // Only proceed if direct download is enabled (we'll add this setting later)
    if (!config.searchMissingMovies && !config.searchMissingTV) {
      return this.emptyResult();
    }

    // Filter items based on config settings
    const filteredMissingItems = missingItems.filter((item) => {
      // Check media type
      if (item.mediaType === 'movie' && !config.searchMissingMovies)
        return false;
      if (item.mediaType === 'tv' && !config.searchMissingTV) return false;
      if (item.mediaType !== 'movie' && item.mediaType !== 'tv') return false;

      // Check minimum year filter
      if (config.minimumYear && config.minimumYear > 0 && item.year) {
        if (item.year < config.minimumYear) return false;
      }

      return true;
    });

    if (filteredMissingItems.length === 0) {
      return this.emptyResult();
    }

    try {
      let autoApprovedRequests = 0;
      let skippedRequests = 0;
      let alreadyDownloadedCount = 0;
      const maxSeasons = Number(config.maxSeasonsToRequest) || 3;

      for (const item of filteredMissingItems) {
        try {
          // Determine if we should download based on media type and season limits only
          // Auto-approve settings are irrelevant for direct downloads
          if (item.mediaType === 'movie') {
            // Movies are always downloaded
          } else if (item.mediaType === 'tv') {
            // For TV shows, check season count limit only
            const seasonCount = await this.getTvSeasonCount(item.tmdbId);

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
          } else {
            // Unknown media type
            skippedRequests++;
            continue;
          }

          // Check if item is excluded in *arr service
          if (await this.isItemExcluded(item)) {
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
          if (await this.checkAlreadyDownloaded(item)) {
            alreadyDownloadedCount++;
            continue;
          }

          // Add to appropriate *arr service
          if (item.mediaType === 'movie') {
            await this.addMovieToRadarr(item, config);
          } else if (item.mediaType === 'tv') {
            await this.addSeriesToSonarr(item, config, maxSeasons);
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

      if (autoApprovedRequests > 0) {
        logger.info(
          `${
            source.charAt(0).toUpperCase() + source.slice(1)
          } collection direct downloads initiated for ${
            config.name
          }: ${autoApprovedRequests} added to *arr${
            skippedRequests > 0 ? `, ${skippedRequests} skipped` : ''
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
        skipped: skippedRequests,
        total: filteredMissingItems.length,
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
   * Generate collection-based tag name from collection title
   */
  private generateCollectionTag(collectionName: string): string {
    // Remove spaces and special characters, keep alphanumeric only
    const cleanName = collectionName
      .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special chars except spaces
      .replace(/\s+/g, '') // Remove all spaces
      .replace(/[^a-zA-Z0-9]/g, ''); // Remove any remaining non-alphanumeric

    return `${cleanName}Agregarr`;
  }

  /**
   * Get Radarr tags including collection tag if enabled
   */
  private async getRadarrTagsWithCollection(
    radarrSettings: RadarrSettings,
    config: CollectionConfig
  ): Promise<number[]> {
    const tags = [...(radarrSettings.tags || [])];

    if (radarrSettings.tagRequests) {
      const radarrAPI = this.getRadarrAPI();
      const collectionTagName = this.generateCollectionTag(config.name);

      let collectionTag = (await radarrAPI.getTags()).find(
        (v) => v.label === collectionTagName
      );

      if (!collectionTag) {
        logger.info(`Collection has no active tag. Creating new`, {
          label: 'Direct Download Service',
          collection: config.name,
          newTag: collectionTagName,
        });
        collectionTag = await radarrAPI.createTag({
          label: collectionTagName,
        });
      }

      if (collectionTag.id) {
        if (!tags?.find((v) => v === collectionTag?.id)) {
          tags?.push(collectionTag.id);
        }
      } else {
        logger.warn(`Collection has no tag and failed to add one`, {
          label: 'Direct Download Service',
          collection: config.name,
          radarrServer: radarrSettings.hostname + ':' + radarrSettings.port,
        });
      }
    }

    return tags;
  }

  /**
   * Get Sonarr tags including collection tag if enabled
   */
  private async getSonarrTagsWithCollection(
    sonarrSettings: SonarrSettings,
    config: CollectionConfig
  ): Promise<number[]> {
    const tags = [...(sonarrSettings.tags || [])];

    if (sonarrSettings.tagRequests) {
      const sonarrAPI = this.getSonarrAPI();
      const collectionTagName = this.generateCollectionTag(config.name);

      let collectionTag = (await sonarrAPI.getTags()).find(
        (v) => v.label === collectionTagName
      );

      if (!collectionTag) {
        logger.info(`Collection has no active tag. Creating new`, {
          label: 'Direct Download Service',
          collection: config.name,
          newTag: collectionTagName,
        });
        collectionTag = await sonarrAPI.createTag({
          label: collectionTagName,
        });
      }

      if (collectionTag.id) {
        if (!tags?.find((v) => v === collectionTag?.id)) {
          tags?.push(collectionTag.id);
        }
      } else {
        logger.warn(`Collection has no tag and failed to add one`, {
          label: 'Direct Download Service',
          collection: config.name,
          sonarrServer: sonarrSettings.hostname + ':' + sonarrSettings.port,
        });
      }
    }

    return tags;
  }

  /**
   * Add a movie directly to Radarr
   */
  private async addMovieToRadarr(
    item: MissingItem,
    config: CollectionConfig
  ): Promise<void> {
    const radarrAPI = this.getRadarrAPI();
    const settings = getSettings();
    const radarrSettings = settings.radarr.find(
      (r) => r.isDefault // TODO: Add 4K support - && r.is4k === false
    );

    if (!radarrSettings) {
      throw new Error('No default Radarr configuration found');
    }

    await radarrAPI.addMovie({
      title: item.title,
      qualityProfileId: radarrSettings.activeProfileId,
      minimumAvailability: radarrSettings.minimumAvailability,
      tags: await this.getRadarrTagsWithCollection(radarrSettings, config),
      profileId: radarrSettings.activeProfileId,
      year: item.year || new Date().getFullYear(), // Use item year or current year as fallback
      rootFolderPath: radarrSettings.activeDirectory,
      tmdbId: item.tmdbId,
      monitored: true,
      searchNow: true, // Immediately start searching for the movie
    });

    logger.debug('Added movie to Radarr for collection', {
      label: 'Direct Download Service',
      collection: config.name,
      movie: item.title,
      tmdbId: item.tmdbId,
      tags: await this.getRadarrTagsWithCollection(radarrSettings, config),
    });
  }

  /**
   * Add a TV series directly to Sonarr
   */
  private async addSeriesToSonarr(
    item: MissingItem,
    config: CollectionConfig,
    maxSeasons: number
  ): Promise<void> {
    const sonarrAPI = this.getSonarrAPI();
    const settings = getSettings();
    const sonarrSettings = settings.sonarr.find(
      (s) => s.isDefault // TODO: Add 4K support - && s.is4k === false
    );

    if (!sonarrSettings) {
      throw new Error('No default Sonarr configuration found');
    }

    // Get TV show details to get TVDB ID (required by Sonarr)
    const tvdbId = await this.getTvdbIdFromTmdb(item.tmdbId);
    if (!tvdbId) {
      throw new Error(`Could not find TVDB ID for TMDB ID: ${item.tmdbId}`);
    }

    const seasonCount = await this.getTvSeasonCount(item.tmdbId);
    let seasonsToMonitor = Math.min(seasonCount, maxSeasons);

    // Apply seasonsPerShowLimit if configured
    if (config.seasonsPerShowLimit && config.seasonsPerShowLimit > 0) {
      seasonsToMonitor = Math.min(seasonsToMonitor, config.seasonsPerShowLimit);

      logger.debug(
        `Limiting ${item.title} to first ${config.seasonsPerShowLimit} seasons (total seasons: ${seasonCount})`,
        {
          label: 'Direct Download Service',
          collection: config.name,
        }
      );
    }

    await sonarrAPI.addSeries({
      tvdbid: tvdbId,
      title: item.title,
      profileId: sonarrSettings.activeProfileId,
      languageProfileId: sonarrSettings.activeLanguageProfileId,
      seasons: Array.from({ length: seasonsToMonitor }, (_, i) => i + 1),
      tags: await this.getSonarrTagsWithCollection(sonarrSettings, config),
      rootFolderPath: sonarrSettings.activeDirectory,
      monitored: true,
      seasonFolder: sonarrSettings.enableSeasonFolders,
      seriesType: 'standard', // Default to standard series type
      searchNow: true, // Immediately start searching for episodes
    });
  }

  /**
   * Check if an item is excluded in the appropriate *arr service
   */
  private async isItemExcluded(item: MissingItem): Promise<boolean> {
    try {
      if (item.mediaType === 'movie') {
        const radarrAPI = this.getRadarrAPI();
        const exclusions = await radarrAPI.getExclusions();
        return exclusions.some((exclusion) => exclusion.tmdbId === item.tmdbId);
      } else if (item.mediaType === 'tv') {
        const sonarrAPI = this.getSonarrAPI();
        const exclusions = await sonarrAPI.getExclusions();
        const tvdbId = await this.getTvdbIdFromTmdb(item.tmdbId);
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
  private async checkAlreadyDownloaded(item: MissingItem): Promise<boolean> {
    try {
      if (item.mediaType === 'movie') {
        const radarrAPI = this.getRadarrAPI();
        const existingMovie = await radarrAPI.getMovieByTmdbId(item.tmdbId);
        return existingMovie && existingMovie.hasFile;
      } else if (item.mediaType === 'tv') {
        const sonarrAPI = this.getSonarrAPI();
        const tvdbId = await this.getTvdbIdFromTmdb(item.tmdbId);
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
   * Get the number of seasons for a TV show
   */
  private async getTvSeasonCount(tmdbId: number): Promise<number> {
    try {
      const tmdb = new (await import('@server/api/themoviedb')).default();
      const tvShow = await tmdb.getTvShow({ tvId: tmdbId });
      // Filter out season 0 (specials) when counting
      return (
        tvShow.seasons?.filter((season) => season.season_number > 0).length || 1
      );
    } catch (error) {
      logger.warn(
        `Failed to get season count for TMDB ID ${tmdbId}, assuming 1 season`,
        {
          label: 'Direct Download Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return 1; // Default to 1 season if we can't determine
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
