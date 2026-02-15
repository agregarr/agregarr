import logger from '@server/logger';
import ServarrBase from './base';

/**
 * Sonarr monitor types - determines which episodes are monitored when adding a series
 */
export type SonarrMonitorType =
  | 'all' // Monitor all episodes except specials
  | 'future' // Monitor episodes that have not aired yet
  | 'missing' // Monitor episodes that do not have files or have not aired yet
  | 'existing' // Monitor episodes that have files or have not aired yet
  | 'recent' // Monitor episodes aired within the last 90 days and future episodes
  | 'pilot' // Only monitor the first episode of the first season
  | 'firstSeason' // Monitor all episodes of the first season
  | 'lastSeason' // Monitor all episodes of the last season
  | 'none'; // No episodes will be monitored

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    previousAiring?: string;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}
interface EpisodeResult {
  seriesId: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate: string;
  airDateUtc: string;
  overview: string;
  hasFile: boolean;
  monitored: boolean;
  absoluteEpisodeNumber: number;
  unverifiedSceneNumbering: boolean;
  id: number;
}

export interface EpisodeFile {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath: string;
  path: string;
  size: number;
  dateAdded: string; // ISO date string
  quality: {
    quality: {
      id: number;
      name: string;
    };
  };
}

export interface SonarrSeries {
  title: string;
  sortTitle: string;
  seasonCount: number;
  status: string;
  overview: string;
  network: string;
  airTime: string;
  images: {
    coverType: string;
    url: string;
  }[];
  remotePoster: string;
  seasons: SonarrSeason[];
  year: number;
  path: string;
  profileId: number;
  languageProfileId: number;
  seasonFolder: boolean;
  monitored: boolean;
  useSceneNumbering: boolean;
  runtime: number;
  tvdbId: number;
  tvRageId: number;
  tvMazeId: number;
  firstAired: string;
  lastInfoSync?: string;
  seriesType: 'standard' | 'daily' | 'anime';
  cleanTitle: string;
  imdbId: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: {
    votes: number;
    value: number;
  };
  qualityProfileId: number;
  id?: number;
  rootFolderPath?: string;
  addOptions?: {
    ignoreEpisodesWithFiles?: boolean;
    ignoreEpisodesWithoutFiles?: boolean;
    searchForMissingEpisodes?: boolean;
  };
  statistics: {
    seasonCount: number;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    releaseGroups: string[];
    percentOfEpisodes: number;
  };
}

export interface AddSeriesOptions {
  tvdbid: number;
  title: string;
  profileId: number;
  languageProfileId?: number;
  seasons: number[];
  seasonFolder: boolean;
  rootFolderPath: string;
  tags?: number[];
  seriesType: SonarrSeries['seriesType'];
  monitored?: boolean;
  monitorType?: SonarrMonitorType;
  searchNow?: boolean;
}

export interface LanguageProfile {
  id: number;
  name: string;
}

export interface SonarrExclusion {
  id: number;
  tvdbId: number;
  title: string;
}

export type ApplyTagsMode = 'add' | 'remove' | 'replace';

export interface SonarrBulkEditOptions {
  seriesIds: number[];
  tags?: number[];
  applyTags?: ApplyTagsMode;
}

export interface SonarrPagedResponse<T> {
  page: number;
  pageSize: number;
  sortKey: string | null;
  sortDirection: 'default' | 'ascending' | 'descending';
  totalRecords: number;
  records: T[];
}

class SonarrAPI extends ServarrBase<{
  seriesId: number;
  episodeId: number;
  episode: EpisodeResult;
}> {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super({ url, apiKey, apiName: 'Sonarr', cacheName: 'sonarr' });
  }

  public async getSeries(): Promise<SonarrSeries[]> {
    try {
      const response = await this.axios.get<SonarrSeries[]>('/series');

      return response.data;
    } catch (e) {
      throw new Error(`[Sonarr] Failed to retrieve series: ${e.message}`);
    }
  }

  public async getSeriesById(id: number): Promise<SonarrSeries> {
    try {
      const response = await this.axios.get<SonarrSeries>(`/series/${id}`);

      return response.data;
    } catch (e) {
      throw new Error(`[Sonarr] Failed to retrieve series by ID: ${e.message}`);
    }
  }

  public async getSeriesByTitle(title: string): Promise<SonarrSeries[]> {
    try {
      const response = await this.axios.get<SonarrSeries[]>('/series/lookup', {
        params: {
          term: title,
        },
      });

      if (!response.data[0]) {
        throw new Error('No series found');
      }

      return response.data;
    } catch (e) {
      logger.error('Error retrieving series by series title', {
        label: 'Sonarr API',
        errorMessage: e.message,
        title,
      });
      throw new Error('No series found');
    }
  }

  public async getSeriesByTvdbId(id: number): Promise<SonarrSeries> {
    try {
      const response = await this.axios.get<SonarrSeries[]>('/series/lookup', {
        params: {
          term: `tvdb:${id}`,
        },
      });

      if (!response.data[0]) {
        throw new Error('Series not found');
      }

      return response.data[0];
    } catch (e) {
      logger.error('Error retrieving series by tvdb ID', {
        label: 'Sonarr API',
        errorMessage: e.message,
        tvdbId: id,
      });
      throw new Error('Series not found');
    }
  }

  /**
   * Get episodes for a series
   */
  public async getEpisodesBySeries(seriesId: number): Promise<EpisodeResult[]> {
    try {
      const response = await this.axios.get<EpisodeResult[]>('/episode', {
        params: {
          seriesId,
        },
      });

      return response.data;
    } catch (e) {
      logger.error('Error retrieving episodes for series', {
        label: 'Sonarr API',
        errorMessage: e.message,
        seriesId,
      });
      throw new Error(`Failed to retrieve episodes: ${e.message}`);
    }
  }

  /**
   * Get episode file details by ID
   */
  public async getEpisodeFile(episodeFileId: number): Promise<EpisodeFile> {
    try {
      const response = await this.axios.get<EpisodeFile>(
        `/episodefile/${episodeFileId}`
      );
      return response.data;
    } catch (e) {
      logger.error('Error retrieving episode file', {
        label: 'Sonarr API',
        errorMessage: e.message,
        episodeFileId,
      });
      throw new Error(`Failed to retrieve episode file: ${e.message}`);
    }
  }

  public async addSeries(options: AddSeriesOptions): Promise<SonarrSeries> {
    try {
      const series = await this.getSeriesByTvdbId(options.tvdbid);

      // Check if all requested seasons are already monitored and have episodes
      if (
        series.id &&
        this.areRequestedSeasonsAlreadyAvailable(series, options.seasons)
      ) {
        logger.info(
          'Series already exists and requested seasons are available. Skipping add and returning success',
          {
            label: 'Sonarr',
            seriesId: series.id,
            seriesTitle: series.title,
            requestedSeasons: options.seasons,
          }
        );
        return series;
      }

      // Series exists in Sonarr but is unmonitored - respect user's choice to keep it unmonitored
      if (series.id && !series.monitored) {
        logger.info(
          'Series exists in Sonarr but is unmonitored. Respecting user choice and skipping.',
          {
            label: 'Sonarr',
            seriesId: series.id,
            seriesTitle: series.title,
          }
        );
        return series;
      }

      // Series exists and is already monitored - skip adding
      if (series.id) {
        logger.info(
          'Series is already monitored in Sonarr. Skipping add and returning success',
          {
            label: 'Sonarr',
            seriesId: series.id,
            seriesTitle: series.title,
          }
        );
        return series;
      }

      const createdSeriesResponse = await this.axios.post<SonarrSeries>(
        '/series',
        {
          tvdbId: options.tvdbid,
          title: options.title,
          qualityProfileId: options.profileId,
          languageProfileId: options.languageProfileId,
          seasons: this.buildSeasonList(
            options.seasons,
            series.seasons.map((season) => ({
              seasonNumber: season.seasonNumber,
              // We force all seasons to false if its the first request
              monitored: false,
            }))
          ),
          tags: options.tags,
          seasonFolder: options.seasonFolder,
          monitored: options.monitored,
          rootFolderPath: options.rootFolderPath,
          seriesType: options.seriesType,
          addOptions: {
            monitor: options.monitorType || 'all',
            searchForMissingEpisodes: options.searchNow,
          },
        } as Partial<SonarrSeries>
      );

      if (createdSeriesResponse.data.id) {
        logger.info('Sonarr accepted request', { label: 'Sonarr' });
        logger.debug('Sonarr add details', {
          label: 'Sonarr',
          movie: createdSeriesResponse.data,
        });
      } else {
        logger.error('Failed to add movie to Sonarr', {
          label: 'Sonarr',
          options,
        });
        throw new Error('Failed to add series to Sonarr');
      }

      return createdSeriesResponse.data;
    } catch (e) {
      logger.error('Something went wrong while adding a series to Sonarr.', {
        label: 'Sonarr API',
        errorMessage: e.message,
        options,
        response: e?.response?.data,
      });
      throw new Error('Failed to add series');
    }
  }

  public async getLanguageProfiles(): Promise<LanguageProfile[]> {
    try {
      const data = await this.getRolling<LanguageProfile[]>(
        '/languageprofile',
        undefined,
        3600
      );

      return data;
    } catch (e) {
      logger.error(
        'Something went wrong while retrieving Sonarr language profiles.',
        {
          label: 'Sonarr API',
          errorMessage: e.message,
        }
      );

      throw new Error('Failed to get language profiles');
    }
  }

  public async searchSeries(seriesId: number): Promise<void> {
    logger.info('Executing series search command.', {
      label: 'Sonarr API',
      seriesId,
    });

    try {
      await this.runCommand('SeriesSearch', { seriesId });
    } catch (e) {
      logger.error(
        'Something went wrong while executing Sonarr series search.',
        {
          label: 'Sonarr API',
          errorMessage: e.message,
          seriesId,
        }
      );
    }
  }

  /**
   * Bulk add tags to multiple series without removing existing tags
   * Uses the series editor endpoint with applyTags: 'add'
   */
  public async bulkAddTags(
    seriesIds: number[],
    tagIds: number[]
  ): Promise<void> {
    if (seriesIds.length === 0 || tagIds.length === 0) {
      return;
    }

    try {
      await this.axios.put('/series/editor', {
        seriesIds,
        tags: tagIds,
        applyTags: 'add',
      });

      logger.info(`Bulk added tags to ${seriesIds.length} series`, {
        label: 'Sonarr API',
        seriesCount: seriesIds.length,
        tagIds,
      });
    } catch (e) {
      logger.error('Failed to bulk add tags to series', {
        label: 'Sonarr API',
        errorMessage: e.message,
        seriesCount: seriesIds.length,
        tagIds,
      });
      throw new Error(`[Sonarr] Failed to bulk add tags: ${e.message}`);
    }
  }

  public getExclusions = async (): Promise<SonarrExclusion[]> => {
    try {
      // Fetch all pages with a reasonable page size
      const allExclusions: SonarrExclusion[] = [];
      let currentPage = 1;
      let totalRecords = 0;

      do {
        const response = await this.axios.get<
          SonarrPagedResponse<SonarrExclusion>
        >('/importlistexclusion/paged', {
          params: {
            page: currentPage,
            pageSize: 100,
            sortDirection: 'default',
          },
        });

        allExclusions.push(...response.data.records);
        totalRecords = response.data.totalRecords;
        currentPage++;
      } while (allExclusions.length < totalRecords);

      return allExclusions;
    } catch (e) {
      logger.error('Error retrieving exclusions from Sonarr', {
        label: 'Sonarr API',
        errorMessage: e.message,
      });
      throw new Error(`[Sonarr] Failed to retrieve exclusions: ${e.message}`);
    }
  };

  /**
   * Check if the requested seasons are already monitored and have episodes
   */
  private areRequestedSeasonsAlreadyAvailable(
    series: SonarrSeries,
    requestedSeasons: number[]
  ): boolean {
    if (!series.seasons || requestedSeasons.length === 0) {
      return false;
    }

    // Check each requested season
    for (const requestedSeason of requestedSeasons) {
      const existingSeason = series.seasons.find(
        (season) => season.seasonNumber === requestedSeason
      );

      // If season doesn't exist, not available
      if (!existingSeason) {
        return false;
      }

      // If season is not monitored, not available
      if (!existingSeason.monitored) {
        return false;
      }

      // If season has no episodes downloaded, not available
      if (
        !existingSeason.statistics ||
        existingSeason.statistics.episodeFileCount === 0
      ) {
        return false;
      }
    }

    // All requested seasons are monitored and have episodes
    return true;
  }

  private buildSeasonList(
    seasons: number[],
    existingSeasons?: SonarrSeason[]
  ): SonarrSeason[] {
    if (existingSeasons) {
      const newSeasons = existingSeasons.map((season) => {
        if (seasons.includes(season.seasonNumber)) {
          season.monitored = true;
        }
        return season;
      });

      return newSeasons;
    }

    const newSeasons = seasons.map(
      (seasonNumber): SonarrSeason => ({
        seasonNumber,
        monitored: true,
      })
    );

    return newSeasons;
  }
}

export default SonarrAPI;
