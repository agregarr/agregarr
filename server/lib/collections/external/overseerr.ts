import type {
  OverseerrMediaRequest,
  OverseerrUser,
} from '@server/api/overseerr';
import OverseerrAPI from '@server/api/overseerr';
import { extractErrorMessage } from '@server/lib/collections/core/CollectionUtilities';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Service class to handle all Overseerr API operations needed by the collections system
 * This replaces direct database access when working with external Overseerr instances
 */
export class OverseerrCollectionService {
  private overseerrClient: OverseerrAPI | null = null;
  private isExternalMode = false;

  constructor() {
    // Don't initialize client in constructor - use lazy initialization like TautulliCollectionSync
    this.isExternalMode = true; // Always external mode
  }

  /**
   * Get Overseerr API client with lazy initialization using current settings
   * Similar to TautulliCollectionSync.getTautulliClient()
   */
  private getOverseerrClient(): OverseerrAPI | null {
    const settings = getSettings(); // Get current settings every time

    // Check if Overseerr is configured
    if (!settings.overseerr?.hostname || !settings.overseerr?.apiKey) {
      return null; // Not configured
    }

    // Create fresh client with current settings (don't cache)
    return new OverseerrAPI(settings.overseerr);
  }

  /**
   * Get admin user from external Overseerr
   */
  async getAdminUser(): Promise<OverseerrUser | null> {
    const client = this.getOverseerrClient();
    if (!client) {
      logger.error('External Overseerr client not configured', {
        label: 'OverseerrCollectionService',
      });
      return null;
    }

    try {
      return await client.getAdminUser();
    } catch (error) {
      logger.error('Failed to get admin user from external Overseerr', {
        label: 'OverseerrCollectionService',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get all users with Plex IDs from external Overseerr
   */
  async getUsersWithPlexIds(): Promise<OverseerrUser[]> {
    const client = this.getOverseerrClient();
    if (!client) {
      logger.error('External Overseerr client not configured', {
        label: 'OverseerrCollectionService',
      });
      return [];
    }

    try {
      // Get all users and filter those with Plex IDs
      const response = await client.getUsers({ take: 1000 });
      return response.results.filter((user) => user.plexId);
    } catch (error) {
      logger.error('Failed to get users from external Overseerr', {
        label: 'OverseerrCollectionService',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get all media requests from external Overseerr for collection processing
   */
  async getCollectionRequests(): Promise<OverseerrMediaRequest[]> {
    const client = this.getOverseerrClient();
    if (!client) {
      logger.error('External Overseerr client not configured', {
        label: 'OverseerrCollectionService',
      });
      return [];
    }

    try {
      // Get all requests from external Overseerr - let Plex be the source of truth for availability
      const response = await client.getRequests({
        filter: 'all',
        take: 5000, // Get enough to cover all users' needs
        sort: 'modified', // Try modified sort to get newest first
      });

      // DEBUG: Log the actual order we're getting from API
      logger.debug(
        `Overseerr API returned ${response.results.length} requests with filter=all:`,
        {
          label: 'OverseerrCollectionService',
          totalRequests: response.results.length,
          first5Dates: response.results.slice(0, 5).map((r) => ({
            id: r.id,
            createdAt: r.createdAt,
            title: r.media?.title,
          })),
          last5Dates: response.results.slice(-5).map((r) => ({
            id: r.id,
            createdAt: r.createdAt,
            title: r.media?.title,
          })),
        }
      );

      return response.results;
    } catch (error) {
      logger.error('Failed to get requests from external Overseerr', {
        label: 'OverseerrCollectionService',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Test connection to external Overseerr
   */
  async testConnection(): Promise<{ success: boolean; version?: string }> {
    const client = this.getOverseerrClient();
    if (!client) {
      return { success: false };
    }

    return await client.testConnection();
  }

  /**
   * Get service mode information
   */
  getServiceInfo(): { mode: 'external'; hostname?: string } {
    const settings = getSettings();
    return {
      mode: 'external',
      hostname: settings.overseerr?.hostname,
    };
  }

  /**
   * Update specific users - External mode is read-only
   */
  async updateSpecificUsers(users: OverseerrUser[]): Promise<number> {
    logger.warn(
      'Cannot update specific users in external Overseerr mode - read-only access',
      {
        label: 'OverseerrCollectionService',
        userCount: users.length,
      }
    );
    return 0;
  }

  /**
   * Get service-specific data needed for collections operations
   */
  async getCollectionServiceData(): Promise<{
    mode: 'external';
    canUpdateUsers: false;
    canAccessFullDatabase: false;
  }> {
    return {
      mode: 'external',
      canUpdateUsers: false,
      canAccessFullDatabase: false,
    };
  }

  /**
   * Get main settings from external Overseerr for template variables
   */
  async getOverseerrSettings(): Promise<{
    applicationUrl?: string;
    applicationTitle?: string;
  } | null> {
    const client = this.getOverseerrClient();
    if (!client) {
      logger.error('External Overseerr client not configured', {
        label: 'OverseerrCollectionService',
      });
      return null;
    }

    try {
      return await client.getMainSettings();
    } catch (error) {
      logger.error('Failed to get Overseerr settings', {
        label: 'OverseerrCollectionService',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get filtered and sorted requests for collections
   * Consolidated from duplicate implementations in CollectionSyncOrchestrator and collectionsSync
   * Note: Gets all requests and relies on Plex rating key validation for availability
   */
  async getFilteredCollectionRequests(): Promise<OverseerrMediaRequest[]> {
    try {
      const requests = await this.getCollectionRequests();

      // Apply filtering logic (consolidated from multiple implementations)
      const filteredRequests = requests.filter((request) => {
        // Only requests with media and user data
        if (!request.media || !request.requestedBy) return false;

        // Exclude Trakt service users from Overseerr collections
        if (
          request.requestedBy &&
          typeof request.requestedBy === 'object' &&
          'email' in request.requestedBy
        ) {
          const email = (request.requestedBy as OverseerrUser).email;
          if (
            email &&
            email.includes('@') &&
            email.includes('traktcollections')
          ) {
            return false;
          }
        }

        // Check for valid rating keys
        const hasValidRatingKey = request.is4k
          ? request.media.ratingKey4k &&
            request.media.ratingKey4k !== '' &&
            request.media.ratingKey4k !== 'null' &&
            request.media.ratingKey4k !== 'undefined'
          : request.media.ratingKey &&
            request.media.ratingKey !== '' &&
            request.media.ratingKey !== 'null' &&
            request.media.ratingKey !== 'undefined';

        return hasValidRatingKey;
      });

      // Sort by creation date (newest first)
      filteredRequests.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA; // Descending (newest first)
      });

      return filteredRequests;
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      logger.error(
        `Error fetching filtered collection requests: ${errorMessage}`,
        {
          label: 'Overseerr Collection Service',
          errorMessage,
        }
      );
      throw new Error(`Failed to fetch collection requests: ${errorMessage}`);
    }
  }

  /**
   * Reinitialize the client when settings change - no longer needed with lazy initialization
   */
  reinitialize(): void {
    // No-op: Client is now created fresh on each request with current settings
  }
}

// Export singleton instance
export const overseerrCollectionService = new OverseerrCollectionService();
