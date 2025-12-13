import logger from '@server/logger';
import { TRAKT_OOB_REDIRECT_URI } from '@server/utils/traktAuth';
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
  private hasAuthToken: boolean;
  private clientId: string;
  private clientSecret?: string;
  private accessToken?: string;
  private refreshToken?: string;
  private tokenExpiresAt?: number;
  private redirectUri?: string;
  private refreshPromise?: Promise<void>;
  private onTokenRefreshed?: (tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }) => Promise<void> | void;

  constructor(
    config:
      | string
      | {
          clientId: string;
          clientSecret?: string;
          accessToken?: string;
          refreshToken?: string;
          tokenExpiresAt?: number;
          redirectUri?: string;
          onTokenRefreshed?: (tokens: {
            accessToken: string;
            refreshToken?: string;
            expiresAt?: number;
          }) => Promise<void> | void;
        }
  ) {
    this.clientId = typeof config === 'string' ? config : config.clientId;
    this.clientSecret =
      typeof config === 'string' ? undefined : config.clientSecret;
    this.accessToken =
      typeof config === 'string' ? undefined : config.accessToken;
    this.refreshToken =
      typeof config === 'string' ? undefined : config.refreshToken;
    this.tokenExpiresAt =
      typeof config === 'string' ? undefined : config.tokenExpiresAt;
    this.redirectUri =
      typeof config === 'string'
        ? TRAKT_OOB_REDIRECT_URI
        : config.redirectUri || TRAKT_OOB_REDIRECT_URI;
    this.onTokenRefreshed =
      typeof config === 'string' ? undefined : config.onTokenRefreshed;

    this.hasAuthToken = !!this.accessToken;

    this.axios = axios.create({
      baseURL: 'https://api.trakt.tv',
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': this.clientId,
        ...(this.accessToken
          ? { Authorization: `Bearer ${this.accessToken}` }
          : {}),
      },
      timeout: 30000,
    });
  }

  private async ensureAccessTokenValid(): Promise<void> {
    if (!this.hasAuthToken) {
      return;
    }

    if (
      this.tokenExpiresAt &&
      Date.now() < this.tokenExpiresAt - 60 * 1000 // refresh 1 minute before expiry
    ) {
      return;
    }

    await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.refreshToken || !this.clientSecret) {
      throw new Error(
        'Trakt refresh token or client secret missing; cannot refresh access token'
      );
    }

    if (!this.redirectUri) {
      throw new Error(
        'Trakt redirect URI missing; cannot refresh access token'
      );
    }

    this.refreshPromise = (async () => {
      try {
        const response = await axios.post(
          'https://api.trakt.tv/oauth/token',
          {
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: this.redirectUri,
            grant_type: 'refresh_token',
          },
          {
            headers: { 'Content-Type': 'application/json' },
          }
        );

        this.accessToken = response.data.access_token;
        this.refreshToken = response.data.refresh_token;
        this.tokenExpiresAt =
          Date.now() + (response.data.expires_in || 0) * 1000;
        this.hasAuthToken = !!this.accessToken;

        // Update axios defaults for subsequent requests
        if (this.accessToken) {
          this.axios.defaults.headers.common.Authorization = `Bearer ${this.accessToken}`;
        } else {
          delete this.axios.defaults.headers.common.Authorization;
        }

        if (this.onTokenRefreshed && this.accessToken) {
          await this.onTokenRefreshed({
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiresAt: this.tokenExpiresAt,
          });
        }
      } finally {
        this.refreshPromise = undefined;
      }
    })();

    return this.refreshPromise;
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    maxRetries = 3,
    delay = 1000
  ): Promise<T> {
    await this.ensureAccessTokenValid();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        // Attempt refresh on unauthorized responses if possible
        const shouldRefresh =
          this.hasAuthToken &&
          (error.response?.status === 401 || error.response?.status === 403) &&
          this.refreshToken &&
          this.clientSecret;

        if (shouldRefresh) {
          try {
            await this.refreshAccessToken();
            return await requestFn();
          } catch (refreshError) {
            logger.warn('Trakt token refresh failed during request', {
              label: 'Trakt API',
              error:
                refreshError instanceof Error
                  ? refreshError.message
                  : refreshError,
            });
          }
        }

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
      // Throw the original error to preserve response status for proper error handling
      throw e;
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
    limit = 20,
    page = 1
  ): Promise<TraktPopularResponse[]> {
    try {
      const response = await this.axios.get<TraktPopularResponse[]>(
        `/${mediaType}/anticipated`,
        {
          params: { limit, page },
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
          page,
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

  public async getRecommendations(
    mediaType: 'movies' | 'shows',
    {
      ignoreCollected = false,
      ignoreWatchlisted = false,
      limit = 100,
    }: {
      ignoreCollected?: boolean;
      ignoreWatchlisted?: boolean;
      limit?: number;
    } = {}
  ): Promise<TraktPopularResponse[]> {
    try {
      const response = await this.axios.get<TraktPopularResponse[]>(
        `/recommendations/${mediaType}`,
        {
          params: {
            ignore_collected: ignoreCollected,
            ignore_watchlisted: ignoreWatchlisted,
            limit,
          },
        }
      );
      return response.data;
    } catch (e) {
      logger.error('Something went wrong fetching recommendations from Trakt', {
        label: 'Trakt API',
        errorMessage: e.message,
        mediaType,
        limit,
        ignoreCollected,
        ignoreWatchlisted,
      });
      throw new Error(
        `[Trakt] Failed to fetch recommendations: ${e.message}`
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
    // If we have an auth token, validate it against a user endpoint; otherwise fallback to a public endpoint
    if (this.hasAuthToken) {
      await this.axios.get('/users/settings');
    } else {
      // Test connection with a simple request to trending movies
      // Throw the original error to preserve response status for proper error handling
      await this.getTrending('movies', 1);
    }
    return true;
  }
}

export default TraktAPI;
