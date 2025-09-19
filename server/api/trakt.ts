import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

export interface TraktMovie {
  title: string;
  year: number;
  ids: {
    trakt: number;
    slug: string;
    imdb: string;
    tmdb: number;
  };
}

export interface TraktShow {
  title: string;
  year: number;
  ids: {
    trakt: number;
    slug: string;
    imdb: string;
    tmdb: number;
    tvdb: number;
  };
}

export interface TraktTrendingResponse {
  watchers: number;
  plays?: number;
  movie?: TraktMovie;
  show?: TraktShow;
}

export interface TraktPopularResponse {
  movie?: TraktMovie;
  show?: TraktShow;
}

export interface TraktWatchedResponse {
  plays: number;
  last_watched_at: string;
  last_updated_at: string;
  movie?: TraktMovie;
  show?: TraktShow;
}

export interface TraktListResponse {
  rank: number;
  id: number;
  listed_at: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  movie?: TraktMovie;
  show?: TraktShow;
  season?: {
    number: number;
    ids: {
      trakt: number;
      tvdb: number;
      tmdb: number;
    };
    show?: TraktShow;
  };
  episode?: {
    season: number;
    number: number;
    title: string;
    ids: {
      trakt: number;
      tvdb: number;
      tmdb: number;
    };
    show?: TraktShow;
  };
}

export interface TraktListSummary {
  name: string;
  trakt: number;
  slug: string;
  ids: {
    trakt: number;
    slug: string;
  };
  user: {
    username: string;
    private: boolean;
    name: string;
    vip: boolean;
    vip_ep: boolean;
    ids: {
      slug: string;
    };
  };
  description?: string;
  privacy: 'public' | 'private' | 'friends';
  display_numbers: boolean;
  allow_comments: boolean;
  sort_by: string;
  sort_how: string;
  created_at: string;
  updated_at: string;
  item_count: number;
  comment_count: number;
  like_count: number;
}

class TraktAPI {
  private axios: AxiosInstance;

  constructor(apiKey: string) {
    this.axios = axios.create({
      baseURL: 'https://api.trakt.tv',
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': apiKey,
      },
      timeout: 30000,
    });
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    maxRetries = 3,
    delay = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        // Check if it's a retryable error (5xx or network errors)
        const isRetryable = error.response?.status >= 500 || !error.response;
        if (!isRetryable) {
          throw error;
        }

        logger.debug(
          `Trakt API request failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
          {
            label: 'Trakt API',
            error: error.message,
            status: error.response?.status,
          }
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
    throw new Error('Max retries exceeded');
  }

  public async getTrending(
    mediaType: 'movies' | 'shows',
    limit = 20
  ): Promise<TraktTrendingResponse[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get<TraktTrendingResponse[]>(
          `/${mediaType}/trending`,
          {
            params: { limit },
          }
        );
        return response.data;
      });
    } catch (e) {
      logger.error(
        'Something went wrong fetching trending content from Trakt',
        {
          label: 'Trakt API',
          errorMessage: e.message,
          mediaType,
          limit,
        }
      );
      throw new Error(
        `[Trakt] Failed to fetch trending ${mediaType}: ${e.message}`
      );
    }
  }

  public async getPopular(
    mediaType: 'movies' | 'shows',
    limit = 20
  ): Promise<TraktPopularResponse[]> {
    try {
      const response = await this.axios.get<TraktPopularResponse[]>(
        `/${mediaType}/popular`,
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (e) {
      logger.error('Something went wrong fetching popular content from Trakt', {
        label: 'Trakt API',
        errorMessage: e.message,
        mediaType,
        limit,
      });
      throw new Error(
        `[Trakt] Failed to fetch popular ${mediaType}: ${e.message}`
      );
    }
  }

  public async getWatched(
    mediaType: 'movies' | 'shows',
    period: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly',
    limit = 20
  ): Promise<TraktWatchedResponse[]> {
    try {
      const response = await this.axios.get<TraktWatchedResponse[]>(
        `/${mediaType}/watched/${period}`,
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (e) {
      logger.error('Something went wrong fetching watched content from Trakt', {
        label: 'Trakt API',
        errorMessage: e.message,
        mediaType,
        period,
        limit,
      });
      throw new Error(
        `[Trakt] Failed to fetch watched ${mediaType}: ${e.message}`
      );
    }
  }

  public async getPlayed(
    mediaType: 'movies' | 'shows',
    period: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly',
    limit = 20
  ): Promise<TraktWatchedResponse[]> {
    try {
      const response = await this.axios.get<TraktWatchedResponse[]>(
        `/${mediaType}/played/${period}`,
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (e) {
      logger.error('Something went wrong fetching played content from Trakt', {
        label: 'Trakt API',
        errorMessage: e.message,
        mediaType,
        period,
        limit,
      });
      throw new Error(
        `[Trakt] Failed to fetch played ${mediaType}: ${e.message}`
      );
    }
  }

  public async getCollected(
    mediaType: 'movies' | 'shows',
    period: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly',
    limit = 20
  ): Promise<TraktWatchedResponse[]> {
    try {
      const response = await this.axios.get<TraktWatchedResponse[]>(
        `/${mediaType}/collected/${period}`,
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching collected content from Trakt',
        {
          label: 'Trakt API',
          errorMessage: e.message,
          mediaType,
          period,
          limit,
        }
      );
      throw new Error(
        `[Trakt] Failed to fetch collected ${mediaType}: ${e.message}`
      );
    }
  }

  public async getFavorited(
    mediaType: 'movies' | 'shows',
    period: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly',
    limit = 20
  ): Promise<TraktWatchedResponse[]> {
    try {
      const response = await this.axios.get<TraktWatchedResponse[]>(
        `/${mediaType}/favorited/${period}`,
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching favorited content from Trakt',
        {
          label: 'Trakt API',
          errorMessage: e.message,
          mediaType,
          period,
          limit,
        }
      );
      throw new Error(
        `[Trakt] Failed to fetch favorited ${mediaType}: ${e.message}`
      );
    }
  }

  public async getAnticipated(
    mediaType: 'movies' | 'shows',
    limit = 20
  ): Promise<TraktPopularResponse[]> {
    try {
      const response = await this.axios.get<TraktPopularResponse[]>(
        `/${mediaType}/anticipated`,
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching anticipated content from Trakt',
        {
          label: 'Trakt API',
          errorMessage: e.message,
          mediaType,
          limit,
        }
      );
      throw new Error(
        `[Trakt] Failed to fetch anticipated ${mediaType}: ${e.message}`
      );
    }
  }

  public async getBoxOffice(limit = 10): Promise<TraktPopularResponse[]> {
    try {
      const response = await this.axios.get<TraktPopularResponse[]>(
        '/movies/boxoffice',
        {
          params: { limit },
        }
      );
      return response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching box office content from Trakt',
        {
          label: 'Trakt API',
          errorMessage: e.message,
          limit,
        }
      );
      throw new Error(
        `[Trakt] Failed to fetch box office movies: ${e.message}`
      );
    }
  }

  public async getCustomList(
    listUrl: string,
    limit = 9999
  ): Promise<TraktListResponse[]> {
    try {
      // Parse the URL to extract username and list slug or official list slug
      // Expected formats:
      // - https://trakt.tv/users/{username}/lists/{list-slug}
      // - https://trakt.tv/lists/official/{collection-name}
      const userListMatch = listUrl.match(
        /trakt\.tv\/users\/([^/]+)\/lists\/([^/?]+)/
      );
      const officialListMatch = listUrl.match(
        /trakt\.tv\/lists\/official\/([^/?]+)/
      );

      let apiPath: string;

      if (userListMatch) {
        const [, username, listSlug] = userListMatch;
        apiPath = `/users/${username}/lists/${listSlug}/items`;
      } else if (officialListMatch) {
        const [, collectionSlug] = officialListMatch;
        apiPath = `/lists/official/${collectionSlug}/items`;
      } else {
        throw new Error(
          'Invalid Trakt list URL format. Expected: https://trakt.tv/users/{username}/lists/{list-name} or https://trakt.tv/lists/official/{collection-name}'
        );
      }

      return await this.retryRequest(async () => {
        const response = await this.axios.get<TraktListResponse[]>(apiPath, {
          params: { limit },
        });
        return response.data;
      });
    } catch (e) {
      logger.error('Something went wrong fetching custom list from Trakt', {
        label: 'Trakt API',
        errorMessage: e.message,
        listUrl,
        limit,
      });
      throw new Error(`[Trakt] Failed to fetch custom list: ${e.message}`);
    }
  }

  /**
   * Get popular public lists for discovery
   */
  public async getPopularLists(limit = 100): Promise<TraktListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get('/lists/popular', {
          params: { limit },
        });
        return response.data;
      });
    } catch (e) {
      logger.error('Failed to fetch popular lists from Trakt', {
        label: 'Trakt API',
        errorMessage: e.message,
        limit,
      });
      throw new Error(`[Trakt] Failed to fetch popular lists: ${e.message}`);
    }
  }

  /**
   * Get trending public lists for discovery
   */
  public async getTrendingLists(limit = 100): Promise<TraktListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get('/lists/trending', {
          params: { limit },
        });
        return response.data;
      });
    } catch (e) {
      logger.error('Failed to fetch trending lists from Trakt', {
        label: 'Trakt API',
        errorMessage: e.message,
        limit,
      });
      throw new Error(`[Trakt] Failed to fetch trending lists: ${e.message}`);
    }
  }

  /**
   * Get public lists from a specific user
   */
  public async getUserLists(
    username: string,
    limit = 50
  ): Promise<TraktListSummary[]> {
    try {
      return await this.retryRequest(async () => {
        const response = await this.axios.get(`/users/${username}/lists`, {
          params: { limit },
        });
        return response.data;
      });
    } catch (e) {
      logger.error(`Failed to fetch lists for user ${username} from Trakt`, {
        label: 'Trakt API',
        errorMessage: e.message,
        username,
        limit,
      });
      throw new Error(`[Trakt] Failed to fetch user lists: ${e.message}`);
    }
  }

  public async getListMetadata(listUrl: string) {
    try {
      // Parse the URL to extract username and list slug
      const userListMatch = listUrl.match(
        /trakt\.tv\/users\/([^/]+)\/lists\/([^/?]+)/
      );
      const officialListMatch = listUrl.match(
        /trakt\.tv\/lists\/official\/([^/?]+)/
      );

      let apiPath: string;

      if (userListMatch) {
        const [, username, listSlug] = userListMatch;
        apiPath = `/users/${username}/lists/${listSlug}`;
      } else if (officialListMatch) {
        const [, collectionSlug] = officialListMatch;
        apiPath = `/lists/official/${collectionSlug}`;
      } else {
        throw new Error('Invalid Trakt list URL format');
      }

      return await this.retryRequest(async () => {
        const response = await this.axios.get(apiPath);
        return response.data;
      });
    } catch (e) {
      logger.error(`Failed to fetch list metadata from Trakt`, {
        label: 'Trakt API',
        errorMessage: e.message,
        listUrl,
      });
      throw new Error(`[Trakt] Failed to fetch list metadata: ${e.message}`);
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      // Test connection with a simple request to trending movies
      await this.getTrending('movies', 1);
      return true;
    } catch (e) {
      logger.error('Trakt API connection test failed', {
        label: 'Trakt API',
        errorMessage: e.message,
      });
      return false;
    }
  }
}

export default TraktAPI;
