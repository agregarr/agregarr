import type { OverseerrSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

export interface OverseerrUser {
  id: number;
  plexId?: number;
  plexTitle?: string;
  plexUsername?: string;
  username?: string | null;
  email: string;
  displayName?: string;
  avatar?: string;
  permissions: number;
  createdAt: string;
  updatedAt: string;
  recoveryLinkExpirationDate?: string | null;
  userType?: number;
  movieQuotaLimit?: number | null;
  movieQuotaDays?: number | null;
  tvQuotaLimit?: number | null;
  tvQuotaDays?: number | null;
  requestCount?: number;
  // Additional fields for Agregarr functionality
  plexToken?: string; // Needed to fetch Plex titles/nicknames directly
}

export interface OverseerrMediaRequest {
  id: number;
  type: 'movie' | 'tv';
  status: number;
  is4k: boolean;
  serverId?: number | null;
  profileId?: number | null;
  rootFolder?: string | null;
  languageProfileId?: number | null;
  tags?: number[] | null;
  isAutoRequest: boolean;
  requestedBy: OverseerrUser; // Use full user object
  modifiedBy?: OverseerrUser;
  media: {
    id: number;
    tmdbId: number;
    title?: string;
    year?: number;
    ratingKey?: string;
    ratingKey4k?: string;
    mediaType: 'movie' | 'tv';
    status: number;
    status4k?: number;
    serviceId?: number | null;
    serviceId4k?: number | null;
    externalServiceId?: number | null;
    externalServiceId4k?: number | null;
    externalServiceSlug?: string | null;
    externalServiceSlug4k?: string | null;
    mediaAddedAt?: string;
    lastSeasonChange?: string;
    plexUrl?: string;
    iOSPlexUrl?: string;
    serviceUrl?: string;
    downloadStatus?: unknown[];
    downloadStatus4k?: unknown[];
    tvdbId?: number;
    imdbId?: string | null;
  };
  seasons?: unknown[];
  seasonCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface OverseerrMedia {
  id: number;
  tmdbId: number;
  title: string;
  mediaType: 'movie' | 'tv';
  status: number;
  ratingKey?: string;
  ratingKey4k?: string;
  seasonCount?: number;
}

export interface OverseerrWatchlistItem {
  ratingKey: string;
  title: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  displayName?: string;
  permissions?: number;
  avatar?: string;
}

export interface CreateMediaRequestParams {
  mediaId: number;
  tvdbId?: number;
  mediaType: 'movie' | 'tv';
  seasons?: number[] | 'all';
  is4k?: boolean;
  userId: number;
  serverId?: number;
  languageProfileId?: number;
  profileId?: number;
  rootFolder?: string;
  tags?: string[];
}

interface OverseerrRequestPayload {
  mediaId: number;
  mediaType: 'movie' | 'tv';
  is4k: boolean;
  serverId: number;
  tags: string[];
  tvdbId?: number;
  seasons?: number[] | 'all';
  languageProfileId?: number;
  profileId?: number;
  rootFolder?: string;
}

/**
 * API client for communicating with external Overseerr instances
 * Used by our standalone collections app to interact with users' Overseerr installations
 */
class OverseerrAPI {
  private axios: AxiosInstance;
  private baseUrl: string;
  private adminUserCache: {
    user: OverseerrUser | null;
    timestamp: number;
  } | null = null;
  private readonly ADMIN_USER_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(settings: OverseerrSettings) {
    // Build URL from individual settings components
    const protocol = settings.useSsl ? 'https' : 'http';
    const port = settings.port ? `:${settings.port}` : '';
    const urlBase = settings.urlBase || '';
    this.baseUrl = `${protocol}://${settings.hostname}${port}${urlBase}`;

    this.axios = axios.create({
      baseURL: `${this.baseUrl}/api/v1`,
      headers: {
        'X-API-Key': settings.apiKey || '',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Add response/error logging (with sensitive data redacted)
    this.axios.interceptors.response.use(
      (response) => {
        return response;
      },
      (error) => {
        // Redact sensitive headers to prevent credential leaks in logs
        const safeHeaders = error.config?.headers
          ? { ...error.config.headers }
          : undefined;
        if (safeHeaders) {
          delete safeHeaders['X-Api-Key'];
          delete safeHeaders['Authorization'];
          delete safeHeaders['x-api-key'];
          delete safeHeaders['authorization'];
        }

        // Truncate response data to prevent log bloat and credential echo
        let safeResponseData: string | undefined;
        if (error.response?.data) {
          const dataStr =
            typeof error.response.data === 'string'
              ? error.response.data
              : JSON.stringify(error.response.data);
          safeResponseData =
            dataStr.length > 500
              ? dataStr.substring(0, 500) + '... [truncated]'
              : dataStr;
        }

        logger.error(`Overseerr API Error: ${error.message}`, {
          label: 'OverseerrAPI',
          url: error.config?.url,
          method: error.config?.method?.toUpperCase(),
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseData: safeResponseData,
          requestHeaders: safeHeaders,
        });
        throw error;
      }
    );
  }

  /**
   * Retry helper with exponential backoff for transient network errors
   */
  private async retryWithBackoff<T>(
    fn: () => Promise,
    maxRetries = 3,
    initialDelayMs = 1000
  ): Promise {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Only retry on network/timeout errors, not on 4xx client errors
        const shouldRetry =
          attempt < maxRetries &&
          (lastError.message.includes('socket hang up') ||
            lastError.message.includes('ECONNRESET') ||
            lastError.message.includes('ETIMEDOUT') ||
            lastError.message.includes('ECONNREFUSED') ||
            lastError.message.includes('timeout'));

        if (!shouldRetry) {
          throw lastError;
        }

        const delayMs = initialDelayMs * Math.pow(2, attempt);
        logger.debug(
          `Retrying Overseerr API call (attempt ${
            attempt + 1
          }/${maxRetries}) after ${delayMs}ms`,
          {
            label: 'OverseerrAPI',
            error: lastError.message,
          }
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  /**
   * Test connection to Overseerr instance
   * Uses /auth/me endpoint to validate API key authentication
   * Throws the actual error for proper error handling in routes
   */
  async testConnection(): Promise {
    await this.axios.get('/auth/me');
    return {
      success: true,
    };
  }

  /**
   * Get all users from Overseerr
   */
  async getUsers(params?: { take?: number; skip?: number }): Promise {
    const response = await this.axios.get('/user', { params });
    return response.data;
  }

  /**
   * Get specific user by ID
   */
  async getUser(userId: number): Promise {
    const response = await this.axios.get(`/user/${userId}`);
    return response.data;
  }

  /**
   * Create or update a service user
   */
  async createUser(userData: CreateUserRequest): Promise {
    const response = await this.axios.post('/user', userData);
    return response.data;
  }

  /**
   * Update user permissions
   */
  async updateUserPermissions(userId: number, permissions: number): Promise {
    await this.axios.post(`/user/${userId}/settings/permissions`, {
      permissions: permissions,
    });
  }

  /**
   * Get current authenticated user (admin check)
   */
  async getCurrentUser(): Promise {
    const response = await this.axios.get('/auth/me');
    return response.data;
  }

  /**
   * Get all media requests
   */
  async getRequests(params?: {
    take?: number;
    skip?: number;
    requestedBy?: number;
    filter?:
      | 'all'
      | 'approved'
      | 'available'
      | 'pending'
      | 'processing'
      | 'unavailable'
      | 'failed'
      | 'deleted'
      | 'completed';
    sort?: 'added' | 'modified';
  }): Promise {
    const response = await this.axios.get('/request', { params });
    return response.data;
  }

  /**
   * Create a new media request
   */
  async createRequest(requestData: CreateMediaRequestParams): Promise {
    const payload: OverseerrRequestPayload = {
      mediaId: requestData.mediaId,
      mediaType: requestData.mediaType,
      is4k: requestData.is4k || false,
      serverId: requestData.serverId || 0,
      tags: requestData.tags || [],
    };

    // Don't include userId in payload when using X-API-User header for impersonation

    // Add media type specific fields
    if (requestData.mediaType === 'tv') {
      if (requestData.tvdbId) {
        payload.tvdbId = requestData.tvdbId;
      }
      if (requestData.seasons) {
        payload.seasons = requestData.seasons;
      }
      if (requestData.languageProfileId) {
        payload.languageProfileId = requestData.languageProfileId;
      }
    }

    // Add profileId and rootFolder for both movies and TV shows
    if (requestData.profileId) {
      payload.profileId = requestData.profileId;
    }
    if (requestData.rootFolder) {
      payload.rootFolder = requestData.rootFolder;
    }

    // Create request with user impersonation to avoid admin auto-approval
    const response = await this.axios.post('/request', payload, {
      headers: {
        'X-API-User': requestData.userId.toString(),
      },
    });
    return response.data;
  }

  /**
   * Check if media exists in Plex by TMDB ID
   */
  async getMediaByTmdbId(tmdbId: number): Promise {
    try {
      const response = await this.axios.get(`/media/${tmdbId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // Media not found
      }
      throw error;
    }
  }

  /**
   * Search for existing requests to avoid duplicates
   */
  async checkRequestExists(tmdbId: number, userId: number): Promise {
    try {
      // Get user's requests and check for this TMDB ID
      const requests = await this.getRequests({
        requestedBy: userId,
        take: 9999, // Get all user requests
      });

      return (
        requests.results.find((req) => req.media.tmdbId === tmdbId) || null
      );
    } catch (error) {
      logger.warn(`Failed to check existing request: ${error.message}`, {
        label: 'OverseerrAPI',
        tmdbId,
        userId,
      });
      return null;
    }
  }

  /**
   * Get request count (for admin operations)
   */
  async getRequestCount(): Promise {
    const response = await this.axios.get('/request/count');
    return response.data;
  }

  /**
   * Get media season count for TV shows
   */
  async getMediaSeasonCount(tmdbId: number): Promise {
    const media = await this.getMediaByTmdbId(tmdbId);
    return media?.seasonCount || 0;
  }

  /**
   * Batch get users by IDs
   */
  async getUsersByIds(userIds: number[]): Promise {
    // Overseerr doesn't have batch user endpoint, so fetch individually
    const users: OverseerrUser[] = [];

    for (const userId of userIds) {
      try {
        const user = await this.getUser(userId);
        users.push(user);
      } catch (error) {
        logger.warn(`Failed to fetch user ${userId}: ${error.message}`, {
          label: 'OverseerrAPI',
        });
      }
    }

    return users;
  }

  /**
   * Get admin user (typically user ID 1) with caching and retry logic
   */
  async getAdminUser(): Promise {
    // Check cache first
    if (
      this.adminUserCache &&
      Date.now() - this.adminUserCache.timestamp < this.ADMIN_USER_CACHE_TTL
    ) {
      logger.debug('Returning cached admin user', {
        label: 'OverseerrAPI',
        cacheAge: Math.round(
          (Date.now() - this.adminUserCache.timestamp) / 1000
        ),
      });
      return this.adminUserCache.user;
    }

    try {
      // Fetch with retry logic for transient network errors
      const user = await this.retryWithBackoff(() => this.getUser(1));

      // Cache the result
      this.adminUserCache = {
        user,
        timestamp: Date.now(),
      };

      logger.debug('Fetched and cached admin user', {
        label: 'OverseerrAPI',
        userId: user.id,
        plexId: user.plexId,
      });

      return user;
    } catch (error) {
      logger.error(
        `Failed to get admin user after retries: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          label: 'OverseerrAPI',
        }
      );
      return null;
    }
  }

  /**
   * Get main settings from external Overseerr instance
   * Used for template variables like {domain} and {appTitle}
   */
  async getMainSettings(): Promise {
    try {
      const response = await this.axios.get('/settings/main');
      return {
        applicationUrl: response.data.applicationUrl,
        applicationTitle: response.data.applicationTitle,
      };
    } catch (error) {
      logger.error(
        `Failed to get main settings from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return null;
    }
  }

  /**
   * Get Radarr servers from Overseerr
   */
  async getRadarrServers(): Promise {
    try {
      const response = await this.axios.get('/settings/radarr');
      return response.data;
    } catch (error) {
      logger.error(
        `Failed to get Radarr servers from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get Sonarr servers from Overseerr
   */
  async getSonarrServers(): Promise {
    try {
      const response = await this.axios.get('/settings/sonarr');
      return response.data;
    } catch (error) {
      logger.error(
        `Failed to get Sonarr servers from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get quality profiles from a Radarr server
   */
  async getRadarrProfiles(serverId: number): Promise {
    try {
      const response = await this.axios.get(`/service/radarr/${serverId}`);
      return response.data.profiles || [];
    } catch (error) {
      logger.error(
        `Failed to get Radarr profiles from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get quality profiles from a Sonarr server
   */
  async getSonarrProfiles(serverId: number): Promise {
    try {
      const response = await this.axios.get(`/service/sonarr/${serverId}`);
      return response.data.profiles || [];
    } catch (error) {
      logger.error(
        `Failed to get Sonarr profiles from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get root folders from a Radarr server
   */
  async getRadarrRootFolders(serverId: number): Promise {
    try {
      const response = await this.axios.get(`/service/radarr/${serverId}`);
      return response.data.rootFolders || [];
    } catch (error) {
      logger.error(
        `Failed to get Radarr root folders from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get root folders from a Sonarr server
   */
  async getSonarrRootFolders(serverId: number): Promise {
    try {
      const response = await this.axios.get(`/service/sonarr/${serverId}`);
      return response.data.rootFolders || [];
    } catch (error) {
      logger.error(
        `Failed to get Sonarr root folders from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get tags from a Radarr server
   */
  async getRadarrTags(serverId: number): Promise {
    try {
      const response = await this.axios.get(`/service/radarr/${serverId}`);
      return response.data.tags || [];
    } catch (error) {
      logger.error(
        `Failed to get Radarr tags from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get tags from a Sonarr server
   */
  async getSonarrTags(serverId: number): Promise {
    try {
      const response = await this.axios.get(`/service/sonarr/${serverId}`);
      return response.data.tags || [];
    } catch (error) {
      logger.error(
        `Failed to get Sonarr tags from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
        }
      );
      return [];
    }
  }

  /**
   * Get a user's Plex watchlist
   */
  async getUserWatchlist(userId: number): Promise {
    try {
      const response = await this.axios.get(`/user/${userId}/watchlist`);
      return {
        results: response.data.results || [],
        total: response.data.totalResults || 0,
      };
    } catch (error) {
      logger.error(
        `Failed to get user watchlist from Overseerr: ${error.message}`,
        {
          label: 'OverseerrAPI',
          userId,
        }
      );
      return {
        results: [],
        total: 0,
      };
    }
  }
}

export default OverseerrAPI;
