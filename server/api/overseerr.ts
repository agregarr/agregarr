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
        // Sanitize URL - strip sensitive query parameters
        let safeUrl: string | undefined;
        if (error.config?.url) {
          try {
            const url = new URL(
              error.config.url,
              error.config.baseURL || 'http://localhost'
            );
            // Remove sensitive query params
            const sensitiveParams = [
              'api_key',
              'apikey',
              'token',
              'key',
              'secret',
              'password',
              'X-Plex-Token',
            ];
            sensitiveParams.forEach((param) => {
              url.searchParams.delete(param);
              url.searchParams.delete(param.toLowerCase());
            });
            safeUrl = url.pathname + (url.search || '');
          } catch {
            // If URL parsing fails, just use the path portion or redact entirely
            safeUrl = error.config.url.split('?')[0] + '?[params redacted]';
          }
        }

        // Redact sensitive headers using whitelist approach (safer than blacklist)
        // Only log headers we explicitly know are safe
        const safeHeaderKeys = [
          'content-type',
          'accept',
          'user-agent',
          'content-length',
        ];
        const safeHeaders: Record<string, unknown> = {};
        if (error.config?.headers) {
          // Flatten any nested header structures (Axios can nest headers)
          const flatHeaders =
            typeof error.config.headers.toJSON === 'function'
              ? error.config.headers.toJSON()
              : error.config.headers;

          Object.entries(flatHeaders).forEach(([key, value]) => {
            if (safeHeaderKeys.includes(key.toLowerCase())) {
              safeHeaders[key] = value;
            }
          });
        }

        // Sanitize response data with try/catch to handle circular refs and large payloads
        let safeResponseData: string | undefined;
        if (error.response?.data) {
          try {
            let dataStr: string;
            if (typeof error.response.data === 'string') {
              // Pre-truncate strings to avoid processing huge payloads
              dataStr =
                error.response.data.length > 2000
                  ? error.response.data.substring(0, 2000)
                  : error.response.data;
            } else if (Buffer.isBuffer(error.response.data)) {
              dataStr = '[Binary data]';
            } else {
              // Limit stringify to avoid memory issues with large objects
              const limited = JSON.stringify(error.response.data, null, 0);
              dataStr =
                limited.length > 2000 ? limited.substring(0, 2000) : limited;
            }
            // Redact common sensitive patterns
            const redacted = dataStr
              .replace(/[Bb]earer\s+[^\s"']+/g, 'Bearer [REDACTED]')
              .replace(
                /["']?[Aa]pi[_-]?[Kk]ey["']?\s*[=:]\s*["']?[^"'\s,}]+["']?/gi,
                'apiKey=[REDACTED]'
              )
              .replace(
                /["']?[Tt]oken["']?\s*[=:]\s*["']?[^"'\s,}]+["']?/gi,
                'token=[REDACTED]'
              );
            // Final truncate for logs
            safeResponseData =
              redacted.length > 500
                ? redacted.substring(0, 500) + '... [truncated]'
                : redacted;
          } catch {
            safeResponseData = '[Unable to serialize response data]';
          }
        }

        logger.error(`Overseerr API Error: ${error.message}`, {
          label: 'OverseerrAPI',
          url: safeUrl,
          method: error.config?.method?.toUpperCase(),
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseData: safeResponseData,
          requestHeaders: safeHeaders,
          // requestData omitted entirely to prevent PII leaks
        });
        throw error;
      }
    );
  }

  /**
   * Retry helper with exponential backoff for transient network errors
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    initialDelayMs = 1000
  ): Promise<T> {
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
  async testConnection(): Promise<{ success: boolean }> {
    await this.axios.get('/auth/me');
    return {
      success: true,
    };
  }

  /**
   * Get all users from Overseerr
   */
  async getUsers(params?: { take?: number; skip?: number }): Promise<{
    results: OverseerrUser[];
    total: number;
  }> {
    const response = await this.axios.get('/user', { params });
    return response.data;
  }

  /**
   * Get specific user by ID
   */
  async getUser(userId: number): Promise<OverseerrUser> {
    const response = await this.axios.get(`/user/${userId}`);
    return response.data;
  }

  /**
   * Create or update a service user
   */
  async createUser(userData: CreateUserRequest): Promise<OverseerrUser> {
    const response = await this.axios.post('/user', userData);
    return response.data;
  }

  /**
   * Update user permissions
   */
  async updateUserPermissions(
    userId: number,
    permissions: number
  ): Promise<void> {
    await this.axios.post(`/user/${userId}/settings/permissions`, {
      permissions: permissions,
    });
  }

  /**
   * Disable all notifications for a user
   * Used for service users to prevent notification spam
   */
  async disableUserNotifications(userId: number): Promise<void> {
    await this.axios.post(`/user/${userId}/settings/notifications`, {
      notificationTypes: {
        discord: 0,
        email: 0,
        gotify: 0,
        lunasea: 0,
        pushbullet: 0,
        pushover: 0,
        slack: 0,
        telegram: 0,
        webpush: 0,
        webhook: 0,
      },
    });
  }

  /**
   * Get current authenticated user (admin check)
   */
  async getCurrentUser(): Promise<OverseerrUser> {
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
  }): Promise<{
    results: OverseerrMediaRequest[];
    total: number;
  }> {
    const response = await this.axios.get('/request', { params });
    return response.data;
  }

  /**
   * Create a new media request
   */
  async createRequest(
    requestData: CreateMediaRequestParams
  ): Promise<OverseerrMediaRequest> {
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
  async getMediaByTmdbId(tmdbId: number): Promise<OverseerrMedia | null> {
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
  async checkRequestExists(
    tmdbId: number,
    userId: number
  ): Promise<OverseerrMediaRequest | null> {
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
  async getRequestCount(): Promise<number> {
    const response = await this.axios.get('/request/count');
    return response.data;
  }

  /**
   * Get media season count for TV shows
   */
  async getMediaSeasonCount(tmdbId: number): Promise<number> {
    const media = await this.getMediaByTmdbId(tmdbId);
    return media?.seasonCount || 0;
  }

  /**
   * Batch get users by IDs
   */
  async getUsersByIds(userIds: number[]): Promise<OverseerrUser[]> {
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
  async getAdminUser(): Promise<OverseerrUser | null> {
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
  async getMainSettings(): Promise<{
    applicationUrl?: string;
    applicationTitle?: string;
  } | null> {
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
  async getRadarrServers(): Promise<
    {
      id: number;
      name: string;
      hostname: string;
      port: number;
      is4k: boolean;
      isDefault: boolean;
    }[]
  > {
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
  async getSonarrServers(): Promise<
    {
      id: number;
      name: string;
      hostname: string;
      port: number;
      is4k: boolean;
      isDefault: boolean;
    }[]
  > {
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
  async getRadarrProfiles(
    serverId: number
  ): Promise<{ id: number; name: string }[]> {
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
  async getSonarrProfiles(
    serverId: number
  ): Promise<{ id: number; name: string }[]> {
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
  async getRadarrRootFolders(
    serverId: number
  ): Promise<{ id: number; path: string }[]> {
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
  async getSonarrRootFolders(
    serverId: number
  ): Promise<{ id: number; path: string }[]> {
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
  async getRadarrTags(
    serverId: number
  ): Promise<{ id: number; label: string }[]> {
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
  async getSonarrTags(
    serverId: number
  ): Promise<{ id: number; label: string }[]> {
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
  async getUserWatchlist(userId: number): Promise<{
    results: OverseerrWatchlistItem[];
    total: number;
  }> {
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
