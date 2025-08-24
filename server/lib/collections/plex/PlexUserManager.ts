import {
  cleanOverseerrLabels,
  createFormData,
  extractErrorMessage,
  getAdminUser,
} from '@server/lib/collections/core/CollectionUtilities';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import xml2js from 'xml2js';

/**
 * Shared server data interface for Plex API responses
 */
export interface SharedServerData {
  $: {
    id: string;
    username: string;
    email: string;
    userID: string;
    accessToken: string;
    name: string;
    acceptedAt: string;
    invitedAt: string;
    allowSync: string;
    allowCameraUpload: string;
    allowChannels: string;
    allowTuners: string;
    allowSubtitleAdmin: string;
    owned: string;
    filterMovies?: string;
    filterTelevision?: string;
  };
}

// Simple cache for shared server responses
const sharedServerCache = new Map<string, SharedServerData[]>();

/**
 * Get shared servers data with simple caching
 * Fetches user sharing data from Plex.tv API
 */
export async function getSharedServers(
  machineId: string,
  plexToken: string,
  forceRefresh = false
): Promise<SharedServerData[]> {
  const cacheKey = `${machineId}-${plexToken.substring(0, 8)}`;

  // Return cached data if not forcing refresh
  if (!forceRefresh && sharedServerCache.has(cacheKey)) {
    const cachedData = sharedServerCache.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }
  }

  // Fetch fresh data
  const shareUrl = `https://plex.tv/api/servers/${machineId}/shared_servers`;
  const response = await fetch(shareUrl, {
    method: 'GET',
    headers: {
      'X-Plex-Token': plexToken,
      Accept: 'application/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const shareXml = await response.text();
  const parsedXml = await xml2js.parseStringPromise(shareXml);
  const sharedServers: SharedServerData[] =
    parsedXml.MediaContainer?.SharedServer || [];

  // Cache the result
  sharedServerCache.set(cacheKey, sharedServers);
  return sharedServers;
}

/**
 * Get all Plex user IDs from shared servers
 * Returns array of Plex user IDs for all users with access to the server
 */
export async function getAllPlexUserIds(): Promise<string[]> {
  try {
    const settings = getSettings();
    const admin = await getAdminUser();

    if (!admin?.plexToken) {
      throw new Error('No admin Plex token found');
    }

    if (!settings.plex.machineId) {
      throw new Error('Machine ID not configured');
    }

    const sharedServers = await getSharedServers(
      settings.plex.machineId,
      admin.plexToken
    );

    const userIds = sharedServers.map((server) => server.$.userID);

    logger.debug(`Found ${userIds.length} Plex users`, {
      label: 'Plex User Manager',
      userIds,
    });

    return userIds;
  } catch (error) {
    logger.error('Failed to get all Plex user IDs', {
      label: 'Plex User Manager',
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get a specific user's shared server data with simple caching
 */
export async function getUserSharedServer(
  machineId: string,
  plexToken: string,
  userPlexId: string,
  forceRefresh = false
): Promise<SharedServerData | undefined> {
  const sharedServers = await getSharedServers(
    machineId,
    plexToken,
    forceRefresh
  );
  return sharedServers.find((server) => server.$.userID === userPlexId);
}

/**
 * Update user filter settings to hide other users' collections
 * This implements the core user isolation functionality for Plex Pass users
 */
export async function updateUserFilterSettings(
  targetUserPlexId: string,
  allUserPlexIds: string[],
  activeOverseerrUserIds: string[],
  hasServerOwnerConfig = false
): Promise<void> {
  try {
    const settings = getSettings();
    const admin = await getAdminUser();

    if (!admin?.plexToken) {
      throw new Error('No admin Plex token found');
    }

    if (!settings.plex.machineId) {
      throw new Error('Machine ID not configured');
    }

    // Get user's current filter settings with robust error handling
    let userServer: SharedServerData | undefined;
    try {
      userServer = await getUserSharedServer(
        settings.plex.machineId,
        admin.plexToken,
        targetUserPlexId
      );
    } catch (error) {
      logger.error(
        `Failed to get user shared server data for ${targetUserPlexId}`,
        {
          label: 'Collections Utils',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw new Error(
        `Cannot update user filter settings: Unable to retrieve current filter settings for user ${targetUserPlexId}. This prevents safe label updates that could overwrite existing restrictions.`
      );
    }

    let currentMovieFilter = '';
    let currentTvFilter = '';

    if (userServer) {
      currentMovieFilter = decodeURIComponent(userServer.$.filterMovies || '');
      currentTvFilter = decodeURIComponent(userServer.$.filterTelevision || '');
    }

    // Clean existing Agregarr labels
    const cleanedMovieFilter = cleanOverseerrLabels(currentMovieFilter);
    const cleanedTvFilter = cleanOverseerrLabels(currentTvFilter);

    // Generate new Agregarr label restrictions
    // Only create labels for users who actually have active Overseerr collections
    const activeOtherUserIds = activeOverseerrUserIds.filter(
      (id) => id !== targetUserPlexId
    );
    const agregarrLabels = activeOtherUserIds.map(
      (id) => `AgregarrOverseerrUser${id}`
    );

    // Also exclude server owner collections for non-admin users (if server owner config is active)
    const adminUser = await getAdminUser();
    if (
      hasServerOwnerConfig &&
      adminUser?.plexId &&
      adminUser.plexId.toString() !== targetUserPlexId
    ) {
      agregarrLabels.push(`AgregarrOverseerrOwner${adminUser.plexId}`);
    }

    // Combine filters
    let finalMovieFilter = cleanedMovieFilter;
    let finalTvFilter = cleanedTvFilter;

    if (agregarrLabels.length > 0) {
      const labelFilter = `label!=${agregarrLabels.join(',')}`;

      if (!finalMovieFilter) {
        finalMovieFilter = labelFilter;
      } else if (finalMovieFilter.startsWith('label!=')) {
        const existingLabels = finalMovieFilter.split('!=')[1];
        finalMovieFilter = `label!=${existingLabels},${agregarrLabels.join(
          ','
        )}`;
      } else {
        logger.warn(
          `Non-label filter detected for user ${targetUserPlexId}: "${finalMovieFilter}". Using only Agregarr labels.`
        );
        finalMovieFilter = labelFilter;
      }

      if (!finalTvFilter) {
        finalTvFilter = labelFilter;
      } else if (finalTvFilter.startsWith('label!=')) {
        const existingLabels = finalTvFilter.split('!=')[1];
        finalTvFilter = `label!=${existingLabels},${agregarrLabels.join(',')}`;
      } else {
        logger.warn(
          `Non-label filter detected for user ${targetUserPlexId}: "${finalTvFilter}". Using only Agregarr labels.`
        );
        finalTvFilter = labelFilter;
      }
    }

    // Use persistent server client identifier (following Overseerr pattern)
    const plexClientIdentifier = settings.clientId;

    // Update user restrictions
    const url = `https://plex.tv/api/friends/${targetUserPlexId}`;
    const headers = {
      'X-Plex-Token': admin.plexToken,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Plex-Client-Identifier': plexClientIdentifier,
    };

    const formData = createFormData({
      server_id: settings.plex.machineId,
      filterMovies: finalMovieFilter,
      filterTelevision: finalTvFilter,
    });

    // Individual user filter updates logged in batch summary

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to update user filter settings: HTTP ${response.status} - ${errorText}`
      );
    }

    // Log the response briefly for success
    const responseText = await response.text();

    // Success log will be generated after verification

    // VERIFICATION: Immediately fetch user data again to confirm restrictions were applied
    try {
      const verificationServer = await getUserSharedServer(
        settings.plex.machineId,
        admin.plexToken,
        targetUserPlexId,
        true // Force refresh
      );

      if (verificationServer) {
        const actualMovieFilter = decodeURIComponent(
          verificationServer.$.filterMovies || ''
        );
        const actualTvFilter = decodeURIComponent(
          verificationServer.$.filterTelevision || ''
        );

        const movieFiltersMatch = actualMovieFilter === finalMovieFilter;
        const tvFiltersMatch = actualTvFilter === finalTvFilter;

        // Individual successes logged in batch summary

        if (!movieFiltersMatch || !tvFiltersMatch) {
          logger.error(
            `User filter verification failed - restrictions not applied correctly`,
            {
              label: 'Plex User Manager',
              userPlexId: targetUserPlexId,
              expected: { movies: finalMovieFilter, tv: finalTvFilter },
              actual: { movies: actualMovieFilter, tv: actualTvFilter },
              success: { movies: movieFiltersMatch, tv: tvFiltersMatch },
              discrepancy: {
                movieMismatch: !movieFiltersMatch,
                tvMismatch: !tvFiltersMatch,
              },
              plexApiResponse: responseText,
            }
          );
        }
      } else {
        logger.warn(
          `VERIFICATION WARNING for user ${targetUserPlexId} - Could not retrieve user data for verification`,
          {
            label: 'Plex User Manager',
            userPlexId: targetUserPlexId,
          }
        );
      }
    } catch (verificationError) {
      logger.error(`User filter verification failed due to API error`, {
        label: 'Plex User Manager',
        userPlexId: targetUserPlexId,
        error: extractErrorMessage(verificationError),
        context:
          'Failed to fetch user data for verification after filter update',
        plexApiResponse: responseText,
      });
    }
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    logger.error(`User filter update failed`, {
      label: 'Plex User Manager',
      userPlexId: targetUserPlexId,
      error: errorMessage,
      context: 'Failed to update Plex user filter settings via API',
    });
    throw error;
  }
}

/**
 * Apply pre-sync user restrictions to prevent visibility window during collection creation
 * This gets ALL potential Overseerr users and applies restrictions to ALL Plex users
 */
export async function applyPreSyncUserRestrictions(): Promise<void> {
  try {
    logger.info('Starting pre-sync user restriction application', {
      label: 'Plex User Manager',
    });

    // Get all Plex users who need restrictions applied
    const allPlexUserIds = await getAllPlexUserIds();
    if (allPlexUserIds.length === 0) {
      logger.warn('No Plex users found - skipping user restrictions', {
        label: 'Plex User Manager',
      });
      return;
    }

    // Get all potential Overseerr users (those who could have collections)
    const { overseerrCollectionService } = await import(
      '@server/lib/collections/external/overseerr'
    );
    const potentialOverseerrUsers =
      await overseerrCollectionService.getUsersWithPlexIds();
    const potentialUserIds = potentialOverseerrUsers
      .map((user) => user.plexId?.toString())
      .filter((id): id is string => Boolean(id));

    if (potentialUserIds.length === 0) {
      logger.info(
        'No Overseerr users with Plex IDs found - skipping user restrictions',
        {
          label: 'Plex User Manager',
        }
      );
      return;
    }

    logger.info(
      `Applying restrictions to ${allPlexUserIds.length} Plex users based on ${potentialUserIds.length} potential Overseerr users`,
      {
        label: 'Plex User Manager',
        plexUsers: allPlexUserIds.length,
        potentialOverseerrUsers: potentialUserIds.length,
      }
    );

    // Apply restrictions to all Plex users to hide all potential Overseerr collections
    await applyUserFiltersToAllUsers(allPlexUserIds, potentialUserIds);

    logger.info('Pre-sync user restrictions applied successfully', {
      label: 'Plex User Manager',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to apply pre-sync user restrictions: ${errorMessage}`,
      {
        label: 'Plex User Manager',
        error: errorMessage,
      }
    );
    throw error;
  }
}

/**
 * Apply selective pre-sync user restrictions based on active config types
 * Only applies restrictions for the specific collection types that are active
 */
export async function applySelectivePreSyncUserRestrictions(
  hasUsersConfig: boolean,
  hasServerOwnerConfig: boolean
): Promise<void> {
  try {
    logger.info(
      `Starting selective pre-sync user restriction application (users: ${hasUsersConfig}, server_owner: ${hasServerOwnerConfig})`,
      {
        label: 'Plex User Manager',
        hasUsersConfig,
        hasServerOwnerConfig,
      }
    );

    // Get all Plex users who need restrictions applied
    const allPlexUserIds = await getAllPlexUserIds();
    if (allPlexUserIds.length === 0) {
      logger.warn('No Plex users found - skipping user restrictions', {
        label: 'Plex User Manager',
      });
      return;
    }

    // Build the list of active user IDs based on which configs are enabled
    const activeOverseerrUserIds: string[] = [];

    if (hasUsersConfig) {
      // Get Overseerr users with Plex IDs for regular user collections
      // Exclude admin user from user collections (consistent with overseerr sync logic)
      const { overseerrCollectionService } = await import(
        '@server/lib/collections/external/overseerr'
      );
      const overseerrUsers =
        await overseerrCollectionService.getUsersWithPlexIds();
      const adminUser = await overseerrCollectionService.getAdminUser(); // Use external admin user for consistency

      const userIds = overseerrUsers
        .filter((user) => {
          // Exclude admin user from user collections (same logic as overseerr sync)
          // Compare using the same identifier logic used for labels: plexId || id
          if (!adminUser) return true;
          const userIdentifier = user.plexId || user.id;
          const adminIdentifier = adminUser.plexId || adminUser.id;
          return userIdentifier !== adminIdentifier;
        })
        .map((user) => user.plexId?.toString())
        .filter((id): id is string => Boolean(id));

      activeOverseerrUserIds.push(...userIds);
    }

    // Check if we have any active configs that require restrictions
    if (activeOverseerrUserIds.length === 0 && !hasServerOwnerConfig) {
      logger.info(
        'No active Overseerr users found and no server owner config - skipping user restrictions',
        {
          label: 'Plex User Manager',
        }
      );
      return;
    }

    logger.info(
      `Applying restrictions to ${allPlexUserIds.length} Plex users (${
        activeOverseerrUserIds.length
      } user collections${hasServerOwnerConfig ? ' + server owner' : ''})`,
      {
        label: 'Plex User Manager',
        plexUsers: allPlexUserIds.length,
        activeOverseerrUsers: activeOverseerrUserIds.length,
        configTypes: { hasUsersConfig, hasServerOwnerConfig },
      }
    );

    // Apply restrictions to all Plex users to hide only the specific active collection types
    await applyUserFiltersToAllUsers(
      allPlexUserIds,
      activeOverseerrUserIds,
      hasServerOwnerConfig
    );

    logger.info('Selective pre-sync user restrictions applied successfully', {
      label: 'Plex User Manager',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to apply selective pre-sync user restrictions: ${errorMessage}`,
      {
        label: 'Plex User Manager',
        error: errorMessage,
      }
    );
    throw error;
  }
}

/**
 * Apply user filter settings to all Plex users to enforce collection isolation
 * This should be called after Overseerr collections are synced
 */
export async function applyUserFiltersToAllUsers(
  allPlexUserIds: string[],
  activeOverseerrUserIds: string[],
  hasServerOwnerConfig = false
): Promise<void> {
  logger.info(
    `Applying user filter restrictions to ${allPlexUserIds.length} Plex users (${activeOverseerrUserIds.length} have active collections)`,
    {
      label: 'Plex User Manager',
      allUsers: allPlexUserIds.length,
      activeUsers: activeOverseerrUserIds.length,
    }
  );

  // OPTIMIZATION: Process all users concurrently instead of sequentially
  // This eliminates the blocking bottleneck when multiple users need updates
  logger.info(
    `Processing filter restrictions for ${allPlexUserIds.length} users concurrently`,
    {
      label: 'Plex User Manager',
      totalUsers: allPlexUserIds.length,
    }
  );

  const userUpdatePromises = allPlexUserIds.map(async (userPlexId) => {
    try {
      await updateUserFilterSettings(
        userPlexId,
        allPlexUserIds,
        activeOverseerrUserIds,
        hasServerOwnerConfig
      );

      // Individual user success logged at info level after batch completion

      return { userPlexId, success: true, error: null };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(
        `Failed to apply filter restrictions for user ${userPlexId}: ${errorMessage}`,
        {
          label: 'Plex User Manager',
          userPlexId,
          error: errorMessage,
        }
      );

      return { userPlexId, success: false, error: errorMessage };
    }
  });

  // Wait for all user updates to complete (or fail) independently
  const results = await Promise.allSettled(userUpdatePromises);

  // Collect successful results and errors
  const errors: string[] = [];
  let successCount = 0;

  results.forEach((result, index) => {
    const userPlexId = allPlexUserIds[index];

    if (result.status === 'fulfilled') {
      if (result.value.success) {
        successCount++;
      } else {
        errors.push(`User ${userPlexId}: ${result.value.error}`);
      }
    } else {
      // Promise.allSettled rejection (shouldn't happen with our error handling, but just in case)
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      errors.push(`User ${userPlexId}: Promise rejected - ${errorMessage}`);
    }
  });

  logger.info(
    `Completed concurrent user filter processing: ${successCount} successful, ${errors.length} failed`,
    {
      label: 'Plex User Manager',
      successCount,
      errorCount: errors.length,
      totalUsers: allPlexUserIds.length,
    }
  );

  if (errors.length > 0) {
    logger.warn(
      `Failed to apply restrictions to ${errors.length} users: ${errors.join(
        '; '
      )}`,
      {
        label: 'Plex User Manager',
        errorCount: errors.length,
        totalUsers: allPlexUserIds.length,
      }
    );
  } else {
    logger.info(
      `Successfully applied filter restrictions to all ${allPlexUserIds.length} Plex users`,
      {
        label: 'Plex User Manager',
        totalUsers: allPlexUserIds.length,
      }
    );
  }
}

/**
 * Remove all Agregarr-generated filters for a specific user
 * Used when cleaning up or resetting user permissions
 */
export async function clearUserFilters(
  targetUserPlexId: string
): Promise<void> {
  try {
    const settings = getSettings();
    const admin = await getAdminUser();

    if (!admin?.plexToken) {
      throw new Error('No admin Plex token found');
    }

    if (!settings.plex.machineId) {
      throw new Error('Machine ID not configured');
    }

    // Get user's current filter settings
    const userServer = await getUserSharedServer(
      settings.plex.machineId,
      admin.plexToken,
      targetUserPlexId
    );

    let currentMovieFilter = '';
    let currentTvFilter = '';

    if (userServer) {
      currentMovieFilter = decodeURIComponent(userServer.$.filterMovies || '');
      currentTvFilter = decodeURIComponent(userServer.$.filterTelevision || '');
    }

    // Clean all Agregarr labels, keeping user's custom filters
    const cleanedMovieFilter = cleanOverseerrLabels(currentMovieFilter);
    const cleanedTvFilter = cleanOverseerrLabels(currentTvFilter);

    // Use persistent server client identifier (following Overseerr pattern)
    const plexClientIdentifier = settings.clientId;

    // Update user restrictions with cleaned filters
    const url = `https://plex.tv/api/friends/${targetUserPlexId}`;
    const headers = {
      'X-Plex-Token': admin.plexToken,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Plex-Client-Identifier': plexClientIdentifier,
    };

    const formData = createFormData({
      server_id: settings.plex.machineId,
      filterMovies: cleanedMovieFilter,
      filterTelevision: cleanedTvFilter,
    });

    // Log the exact HTTP request data being sent for clear operation
    logger.debug(
      `Sending Plex.tv CLEAR API request for user ${targetUserPlexId}`,
      {
        label: 'Plex User Manager',
        userPlexId: targetUserPlexId,
        url,
        method: 'PUT',
        headers: {
          'X-Plex-Token': '[REDACTED]',
          Accept: headers.Accept,
          'X-Plex-Client-Identifier': headers['X-Plex-Client-Identifier'],
        },
        formDataString: formData,
        formDataLength: formData.length,
        rawFormData: {
          server_id: settings.plex.machineId,
          filterMovies: cleanedMovieFilter,
          filterTelevision: cleanedTvFilter,
        },
        movieFilter: cleanedMovieFilter,
        tvFilter: cleanedTvFilter,
      }
    );

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to clear user filters: HTTP ${response.status} - ${errorText}`
      );
    }

    logger.info(
      `Cleared Agregarr filters for user ${targetUserPlexId}. Remaining filters - Movies: "${cleanedMovieFilter}", TV: "${cleanedTvFilter}"`
    );

    // VERIFICATION: Immediately fetch user data again to confirm filters were cleared
    try {
      const verificationServer = await getUserSharedServer(
        settings.plex.machineId,
        admin.plexToken,
        targetUserPlexId,
        true // Force refresh
      );

      if (verificationServer) {
        const actualMovieFilter = decodeURIComponent(
          verificationServer.$.filterMovies || ''
        );
        const actualTvFilter = decodeURIComponent(
          verificationServer.$.filterTelevision || ''
        );

        const movieFiltersMatch = actualMovieFilter === cleanedMovieFilter;
        const tvFiltersMatch = actualTvFilter === cleanedTvFilter;

        logger.info(
          `CLEAR VERIFICATION for user ${targetUserPlexId} - Filters cleared successfully: ${
            movieFiltersMatch && tvFiltersMatch
          }`,
          {
            label: 'Plex User Manager',
            userPlexId: targetUserPlexId,
            expected: { movies: cleanedMovieFilter, tv: cleanedTvFilter },
            actual: { movies: actualMovieFilter, tv: actualTvFilter },
            success: { movies: movieFiltersMatch, tv: tvFiltersMatch },
          }
        );

        if (!movieFiltersMatch || !tvFiltersMatch) {
          logger.error(
            `CLEAR VERIFICATION FAILED for user ${targetUserPlexId} - Filters were not properly cleared!`,
            {
              label: 'Plex User Manager',
              userPlexId: targetUserPlexId,
              discrepancy: {
                movieMismatch: !movieFiltersMatch,
                tvMismatch: !tvFiltersMatch,
              },
            }
          );
        }
      } else {
        logger.warn(
          `CLEAR VERIFICATION WARNING for user ${targetUserPlexId} - Could not retrieve user data for verification`,
          {
            label: 'Plex User Manager',
            userPlexId: targetUserPlexId,
          }
        );
      }
    } catch (verificationError) {
      logger.error(
        `CLEAR VERIFICATION ERROR for user ${targetUserPlexId}: ${extractErrorMessage(
          verificationError
        )}`,
        {
          label: 'Plex User Manager',
          userPlexId: targetUserPlexId,
          verificationError: extractErrorMessage(verificationError),
        }
      );
    }
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    logger.error(
      `Failed to clear user filters for user ${targetUserPlexId}: ${errorMessage}`
    );
    throw error;
  }
}
