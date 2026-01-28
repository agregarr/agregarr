import type { User } from '@server/entity/User';
import type { TautulliSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { uniqWith } from 'lodash';

export interface TautulliHistoryRecord {
  date: number;
  duration: number;
  friendly_name: string;
  full_title: string;
  grandparent_rating_key: number;
  grandparent_title: string;
  original_title: string;
  group_count: number;
  group_ids?: string;
  guid: string;
  ip_address: string;
  live: number;
  machine_id: string;
  media_index: number;
  media_type: string;
  originally_available_at: string;
  parent_media_index: number;
  parent_rating_key: number;
  parent_title: string;
  paused_counter: number;
  percent_complete: number;
  platform: string;
  product: string;
  player: string;
  rating_key: number;
  reference_id?: number;
  row_id?: number;
  session_key?: string;
  started: number;
  state?: string;
  stopped: number;
  thumb: string;
  title: string;
  transcode_decision: string;
  user: string;
  user_id: number;
  watched_status: number;
  year: number;
}

interface TautulliHistoryResponse {
  response: {
    result: string;
    message?: string;
    data: {
      draw: number;
      recordsTotal: number;
      recordsFiltered: number;
      total_duration: string;
      filter_duration: string;
      data: TautulliHistoryRecord[];
    };
  };
}

interface TautulliWatchStats {
  query_days: number;
  total_time: number;
  total_plays: number;
}

interface TautulliWatchStatsResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchStats[];
  };
}

interface TautulliWatchUser {
  friendly_name: string;
  user_id: number;
  user_thumb: string;
  username: string;
  total_plays: number;
  total_time: number;
}

interface TautulliWatchUsersResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchUser[];
  };
}

interface TautulliInfo {
  tautulli_install_type: string;
  tautulli_version: string;
  tautulli_branch: string;
  tautulli_commit: string;
  tautulli_platform: string;
  tautulli_platform_release: string;
  tautulli_platform_version: string;
  tautulli_platform_linux_distro: string;
  tautulli_platform_device_name: string;
  tautulli_python_version: string;
}

interface TautulliInfoResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliInfo;
  };
}

interface TautulliHomeStatRow {
  rating_key: string;
  title: string;
  total_plays: number;
  media_type: string;
  grandparent_rating_key?: string;
  grandparent_title?: string;
  plays?: number;
  users_watched: string; // String containing unique viewer count
}

interface TautulliHomeStat {
  stat_id: string;
  stat_type?: string;
  rows: TautulliHomeStatRow[];
}

interface TautulliHomeStatsResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliHomeStat[];
  };
}

interface TautulliCollection {
  section_id: number;
  section_name: string;
  rating_key: string;
  parent_rating_key: string;
  grandparent_rating_key: string;
  title: string;
  sort_title: string;
  media_index: number;
  parent_media_index: number;
  year: number;
  thumb: string;
  parent_thumb: string;
  grandparent_thumb: string;
  art: string;
  media_type: string;
  content_rating: string;
  summary: string;
  tagline: string;
  rating: number;
  duration: number;
  guid: string;
  directors: string[];
  writers: string[];
  actors: string[];
  genres: string[];
  labels: string[];
  collections: string[];
  full_title: string;
  children_count: number;
  live: number;
  originally_available_at: string;
  added_at: number;
  updated_at: number;
  last_viewed_at: number;
  guid_type: string;
  item_count: number;
  play_count: number;
  last_played: number;
}

interface TautulliCollectionsResponse {
  response: {
    result: string;
    message?: string;
    data: {
      draw: number;
      recordsTotal: number;
      recordsFiltered: number;
      data: TautulliCollection[];
    };
  };
}

interface TautulliCollectionStats {
  rating_key: string;
  title: string;
  media_type: string;
  section_id: number;
  section_name: string;
  item_count: number;
  total_plays: number;
  total_duration: number;
  last_played?: number;
  play_count?: number;
  watch_time_stats: TautulliWatchStats[];
  user_stats: TautulliWatchUser[];
}

class TautulliAPI {
  private axios: AxiosInstance;

  constructor(settings: TautulliSettings) {
    // Use conditional port logic to match OverseerrAPI - only include port if specified
    const protocol = settings.useSsl ? 'https' : 'http';
    const port = settings.port ? `:${settings.port}` : '';
    const urlBase = settings.urlBase ?? '';

    this.axios = axios.create({
      baseURL: `${protocol}://${settings.hostname}${port}${urlBase}`,
      params: { apikey: settings.apiKey },
      timeout: 30000, // 30 second timeout to match OverseerrAPI
    });
  }

  public async getInfo(): Promise<TautulliInfo> {
    try {
      return (
        await this.axios.get<TautulliInfoResponse>('/api/v2', {
          params: { cmd: 'get_tautulli_info' },
        })
      ).data.response.data;
    } catch (e) {
      logger.error('Something went wrong fetching Tautulli server info', {
        label: 'Tautulli API',
        errorMessage: e.message,
      });
      // Throw the original error to preserve response status codes for proper error handling
      throw e;
    }
  }

  public async getMediaWatchStats(
    ratingKey: string
  ): Promise<TautulliWatchStats[]> {
    try {
      return (
        await this.axios.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_item_watch_time_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch stats: ${e.message}`
      );
    }
  }

  public async getMediaWatchUsers(
    ratingKey: string
  ): Promise<TautulliWatchUser[]> {
    try {
      return (
        await this.axios.get<TautulliWatchUsersResponse>('/api/v2', {
          params: {
            cmd: 'get_item_user_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch users from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch users: ${e.message}`
      );
    }
  }

  public async getUserWatchStats(user: User): Promise<TautulliWatchStats> {
    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      return (
        await this.axios.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_user_watch_time_stats',
            user_id: user.plexId,
            query_days: 0,
            grouping: 1,
          },
        })
      ).data.response.data[0];
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch stats: ${e.message}`
      );
    }
  }

  public async getUserWatchHistory(
    user: User
  ): Promise<TautulliHistoryRecord[]> {
    let results: TautulliHistoryRecord[] = [];

    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      const take = 100;
      let start = 0;

      while (results.length < 20) {
        const tautulliData = (
          await this.axios.get<TautulliHistoryResponse>('/api/v2', {
            params: {
              cmd: 'get_history',
              grouping: 1,
              order_column: 'date',
              order_dir: 'desc',
              user_id: user.plexId,
              media_type: 'movie,episode',
              length: take,
              start,
            },
          })
        ).data.response.data.data;

        if (!tautulliData.length) {
          return results;
        }

        results = uniqWith(results.concat(tautulliData), (recordA, recordB) =>
          recordA.grandparent_rating_key && recordB.grandparent_rating_key
            ? recordA.grandparent_rating_key === recordB.grandparent_rating_key
            : recordA.parent_rating_key && recordB.parent_rating_key
            ? recordA.parent_rating_key === recordB.parent_rating_key
            : recordA.rating_key === recordB.rating_key
        );

        start += take;
      }

      return results.slice(0, 20);
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch history from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch history: ${e.message}`
      );
    }
  }

  public async getHomeStats(
    timeRange = 30,
    statsType: 'plays' | 'duration' = 'plays',
    statId = 'top_movies',
    statsCount = 20,
    statsStart = 0
  ): Promise<TautulliHomeStatRow[]> {
    try {
      const response = await this.axios.get<TautulliHomeStatsResponse>(
        '/api/v2',
        {
          params: {
            cmd: 'get_home_stats',
            time_range: timeRange,
            stats_type: statsType,
            stat_id: statId,
            stats_count: statsCount,
            stats_start: statsStart,
          },
        }
      );

      const data = response.data.response.data;

      // When requesting a specific stat_id, Tautulli returns the stat object directly
      if (
        data &&
        typeof data === 'object' &&
        'stat_id' in data &&
        data.stat_id === statId
      ) {
        const statObject = data as unknown as TautulliHomeStat;
        return statObject.rows || [];
      }

      // Handle array format (when no specific stat_id is requested)
      if (Array.isArray(data) && data.length > 0) {
        // Handle the correct response structure
        if (data[0] && 'stat_id' in data[0]) {
          const statObject = data.find((stat) => stat.stat_id === statId);
          logger.info('Found stat object in array', {
            label: 'Tautulli API',
            statId,
            foundObject: !!statObject,
            rowsCount: statObject ? statObject.rows.length : 0,
            rows: statObject ? statObject.rows.slice(0, 3) : [],
          });
          return statObject ? statObject.rows : [];
        }

        // Fallback for backward compatibility - if data is already an array of rows
        logger.info('Using fallback data structure', {
          label: 'Tautulli API',
          dataLength: data.length,
          firstFewItems: data.slice(0, 3),
        });
        return data as unknown as TautulliHomeStatRow[];
      }

      logger.warn('No data returned from Tautulli', {
        label: 'Tautulli API',
        statId,
        timeRange,
        statsType,
      });

      return [];
    } catch (e) {
      logger.error('Something went wrong fetching home stats from Tautulli', {
        label: 'Tautulli API',
        errorMessage: e.message,
        timeRange,
        statsType,
        statId,
        statsCount,
        statsStart,
      });
      throw new Error(`[Tautulli] Failed to fetch home stats: ${e.message}`);
    }
  }

  public async getLibraryWatchTimeStats(
    sectionId: string,
    queryDays = '7,30'
  ): Promise<unknown[]> {
    try {
      return (
        await this.axios.get('/api/v2', {
          params: {
            cmd: 'get_library_watch_time_stats',
            section_id: sectionId,
            query_days: queryDays,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching library watch time stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          sectionId,
          queryDays,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch library watch time stats: ${e.message}`
      );
    }
  }

  public async getContent(
    mediaType: 'movie' | 'tv',
    timeRangeDays = 30,
    statType: 'plays' | 'duration' = 'plays',
    collectionType: 'most_popular' | 'most_watched' = 'most_popular',
    limit = 20
  ): Promise<TautulliHomeStatRow[]> {
    try {
      // Map collection type + media type to Tautulli stat_id
      const statId =
        collectionType === 'most_watched'
          ? mediaType === 'movie'
            ? 'top_movies'
            : 'top_tv'
          : mediaType === 'movie'
          ? 'popular_movies'
          : 'popular_tv';

      const stats = await this.getHomeStats(
        timeRangeDays,
        statType,
        statId,
        limit,
        0
      );

      // Return the stats (already limited by the API call)
      return stats;
    } catch (e) {
      logger.error('Something went wrong fetching content from Tautulli', {
        label: 'Tautulli API',
        errorMessage: e.message,
        mediaType,
        timeRangeDays,
        statType,
        collectionType,
        limit,
      });
      throw new Error(
        `[Tautulli] Failed to fetch ${collectionType} content: ${e.message}`
      );
    }
  }

  /**
   * Get collections table data for a specific library section
   */
  public async getCollectionsTable(
    sectionId: string
  ): Promise<TautulliCollection[]> {
    try {
      const response = await this.axios.get<TautulliCollectionsResponse>(
        '/api/v2',
        {
          params: {
            cmd: 'get_collections_table',
            section_id: sectionId,
          },
        }
      );

      return response.data.response.data.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching collections table from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          sectionId,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch collections table: ${e.message}`
      );
    }
  }

  /**
   * Get watch time statistics for a collection
   */
  public async getCollectionWatchStats(
    ratingKey: string,
    queryDays = '1,7,30,0'
  ): Promise<TautulliWatchStats[]> {
    try {
      const response = await this.axios.get<TautulliWatchStatsResponse>(
        '/api/v2',
        {
          params: {
            cmd: 'get_item_watch_time_stats',
            rating_key: ratingKey,
            media_type: 'collection', // Required for collections
            grouping: 1,
            query_days: queryDays,
          },
        }
      );

      return response.data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching collection watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
          queryDays,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch collection watch stats: ${e.message}`
      );
    }
  }

  /**
   * Get user statistics for a collection
   */
  public async getCollectionUserStats(
    ratingKey: string
  ): Promise<TautulliWatchUser[]> {
    try {
      const response = await this.axios.get<TautulliWatchUsersResponse>(
        '/api/v2',
        {
          params: {
            cmd: 'get_item_user_stats',
            rating_key: ratingKey,
            media_type: 'collection', // Required for collections
            grouping: 1,
          },
        }
      );

      return response.data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching collection user stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch collection user stats: ${e.message}`
      );
    }
  }

  /**
   * Get comprehensive collection statistics combining watch time and user stats
   */
  public async getCollectionStats(
    ratingKey: string,
    queryDays = '1,7,30,0'
  ): Promise<TautulliCollectionStats> {
    try {
      // Get basic collection info first
      const collections = await this.getCollectionsTable('');
      const collection = collections.find((c) => c.rating_key === ratingKey);

      if (!collection) {
        throw new Error(`Collection with rating key ${ratingKey} not found`);
      }

      // Get watch time stats and user stats in parallel
      const [watchTimeStats, userStats] = await Promise.all([
        this.getCollectionWatchStats(ratingKey, queryDays),
        this.getCollectionUserStats(ratingKey),
      ]);

      // Calculate totals from user stats
      const totalPlays = userStats.reduce(
        (sum, user) => sum + user.total_plays,
        0
      );
      const totalDuration = userStats.reduce(
        (sum, user) => sum + user.total_time,
        0
      );

      return {
        rating_key: ratingKey,
        title: collection.title,
        media_type: collection.media_type,
        section_id: collection.section_id,
        section_name: collection.section_name,
        item_count: collection.item_count,
        total_plays: totalPlays,
        total_duration: totalDuration,
        last_played: collection.last_played,
        play_count: collection.play_count,
        watch_time_stats: watchTimeStats,
        user_stats: userStats,
      };
    } catch (e) {
      logger.error(
        'Something went wrong fetching comprehensive collection stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
          queryDays,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch collection stats: ${e.message}`
      );
    }
  }

  /**
   * Get top collections by plays or duration for our configured collections
   * This method gets stats for each of our collections individually since Tautulli
   * doesn't provide grouped collection statistics
   */
  public async getTopCollections(
    limit = 10,
    statType: 'plays' | 'duration' = 'plays',
    queryDays = 30,
    collectionRatingKeys: string[] = []
  ): Promise<TautulliCollectionStats[]> {
    try {
      logger.info('Fetching stats for configured collections', {
        label: 'Tautulli API',
        collectionCount: collectionRatingKeys.length,
        limit,
        statType,
        queryDays,
      });

      if (collectionRatingKeys.length === 0) {
        logger.warn('No collection rating keys provided', {
          label: 'Tautulli API',
        });
        return [];
      }

      const collectionStats: TautulliCollectionStats[] = [];

      // Get stats for each collection individually
      for (const ratingKey of collectionRatingKeys) {
        try {
          logger.debug(`Getting stats for collection ${ratingKey}`, {
            label: 'Tautulli API',
            ratingKey,
          });

          // Get watch time stats for the specified time period
          const watchTimeStats =
            await this.axios.get<TautulliWatchStatsResponse>('/api/v2', {
              params: {
                cmd: 'get_item_watch_time_stats',
                rating_key: ratingKey,
                media_type: 'collection',
                grouping: 1,
                query_days: `${queryDays}`,
              },
            });

          const stats = watchTimeStats.data.response.data;
          logger.debug(`Got watch time stats for ${ratingKey}`, {
            label: 'Tautulli API',
            ratingKey,
            statsCount: stats.length,
            stats: stats.map((s) => ({
              days: s.query_days,
              plays: s.total_plays,
              time: s.total_time,
            })),
          });

          // Find the stats for our requested time period
          const targetStats =
            stats.find((s) => s.query_days === queryDays) || stats[0];

          if (!targetStats || targetStats.total_plays === 0) {
            logger.debug(`No meaningful stats for collection ${ratingKey}`, {
              label: 'Tautulli API',
              ratingKey,
              targetStats,
            });
            continue;
          }

          // Get basic collection metadata
          let collectionTitle = `Collection ${ratingKey}`;
          let sectionId = 0;
          let sectionName = '';
          let itemCount = 0;

          try {
            const metadataResponse = await this.axios.get('/api/v2', {
              params: {
                cmd: 'get_metadata',
                rating_key: ratingKey,
              },
            });

            const metadata = metadataResponse.data.response.data;
            if (metadata) {
              collectionTitle = metadata.title || collectionTitle;
              sectionId = metadata.section_id || 0;
              sectionName = metadata.library_name || '';
              itemCount = metadata.children_count || 0;
            }
          } catch (metadataError) {
            logger.warn(`Failed to get metadata for collection ${ratingKey}`, {
              label: 'Tautulli API',
              ratingKey,
              error: metadataError.message,
            });
          }

          // Get user stats for this collection
          let userStats: TautulliWatchUser[] = [];
          try {
            const userStatsResponse =
              await this.axios.get<TautulliWatchUsersResponse>('/api/v2', {
                params: {
                  cmd: 'get_item_user_stats',
                  rating_key: ratingKey,
                  media_type: 'collection',
                  grouping: 1,
                },
              });
            userStats = userStatsResponse.data.response.data || [];
          } catch (userStatsError) {
            logger.warn(
              `Failed to get user stats for collection ${ratingKey}`,
              {
                label: 'Tautulli API',
                ratingKey,
                error: userStatsError.message,
              }
            );
          }

          const collectionStat: TautulliCollectionStats = {
            rating_key: ratingKey,
            title: collectionTitle,
            media_type: 'collection',
            section_id: sectionId,
            section_name: sectionName,
            item_count: itemCount,
            total_plays: targetStats.total_plays,
            total_duration: targetStats.total_time,
            last_played: undefined, // Would need additional API call to get this
            watch_time_stats: stats,
            user_stats: userStats,
          };

          collectionStats.push(collectionStat);

          logger.debug(`Successfully processed collection ${collectionTitle}`, {
            label: 'Tautulli API',
            ratingKey,
            plays: targetStats.total_plays,
            duration: targetStats.total_time,
            userCount: userStats.length,
          });
        } catch (error) {
          logger.warn(`Failed to get stats for collection ${ratingKey}`, {
            label: 'Tautulli API',
            ratingKey,
            error: error.message,
          });
          continue;
        }
      }

      // Sort by the requested stat type
      const sortedStats = collectionStats.sort((a, b) => {
        return statType === 'plays'
          ? b.total_plays - a.total_plays
          : b.total_duration - a.total_duration;
      });

      const result = sortedStats.slice(0, limit);

      logger.info('Successfully processed collection stats', {
        label: 'Tautulli API',
        totalProcessed: collectionStats.length,
        returnedCount: result.length,
        topCollections: result.slice(0, 3).map((c) => ({
          title: c.title,
          plays: c.total_plays,
          duration: c.total_duration,
        })),
      });

      return result;
    } catch (e) {
      logger.error(
        'Something went wrong fetching top collections from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          limit,
          statType,
          queryDays,
        }
      );

      // Return empty array instead of throwing to prevent dashboard from breaking
      return [];
    }
  }

  /**
   * Get libraries (this method may need to be implemented if not already available)
   */
  private async getLibraries(): Promise<
    { section_id: string; title: string }[]
  > {
    try {
      const response = await this.axios.get('/api/v2', {
        params: { cmd: 'get_libraries' },
      });
      return response.data.response.data;
    } catch (e) {
      logger.error('Failed to get libraries from Tautulli', {
        label: 'Tautulli API',
        errorMessage: e.message,
      });
      throw new Error(`[Tautulli] Failed to get libraries: ${e.message}`);
    }
  }
}

export default TautulliAPI;
