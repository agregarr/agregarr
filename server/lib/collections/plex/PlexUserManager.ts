import {
  cleanOverseerrLabels,
  extractErrorMessage,
  getAdminUser,
} from '@server/lib/collections/core/CollectionUtilities';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import xml2js from 'xml2js';

/**
 * V2 API: Sharing settings from /api/v2/sharing_settings or nested in shared server
 */
export interface V2SharingSettings {
  $: {
    allowSync: string;
    allowCameraUpload: string;
    allowChannels: string;
    allowTuners: string;
    allowSubtitleAdmin: string;
    filterAll: string;
    filterMovies: string;
    filterMusic: string;
    filterPhotos: string;
    filterTelevision: string;
  };
}

/**
 * V2 API: Invited user data from /api/v2/shared_servers/owned/accepted
 */
export interface V2InvitedUser {
  $: {
    id: string;
    uuid: string;
    title: string;
    username: string;
    email?: string;
    friendlyName: string;
    thumb: string;
    home: string;
    status: string;
    restricted: string;
    subscription: string;
  };
  sharingSettings: V2SharingSettings[];
}

/**
 * V2 API: Shared server data from /api/v2/shared_servers/owned/accepted
 */
export interface V2SharedServer {
  $: {
    id: string;
    name: string;
    invitedId: string;
    invitedEmail: string;
    acceptedAt: string;
    deletedAt: string;
    leftAt: string;
    machineIdentifier: string;
    searchEnabled: string;
    ownerId: string;
    serverId: string;
    accepted: string;
    owned: string;
    inviteToken: string;
    lastSeenAt: string;
    numLibraries: string;
    allLibraries: string;
  };
  invited: V2InvitedUser[];
  sharingSettings: V2SharingSettings[];
}

// Simple cache for V2 shared server responses
const sharedServerCache = new Map<string, V2SharedServer[]>();

/**
 * Merge Agregarr labels into an existing Plex filter string
 * Preserves all existing filter components (contentRating, etc.) and only adds/updates label!= section
 *
 * Plex filter syntax: filter1&filter2&filter3
 * Each filter can be: key=value1,value2|key=value3
 *
 * @param existingFilter The current filter string (already cleaned of old Agregarr labels)
 * @param agregarrLabels Array of Agregarr label names to add to label!= section
 * @returns Complete filter string with Agregarr labels merged in
 */
function mergeAgregarrLabelsIntoFilter(
  existingFilter: string,
  agregarrLabels: string[]
): string {
  if (agregarrLabels.length === 0) {
    return existingFilter;
  }

  // If no existing filter, just create a simple label!= filter
  if (!existingFilter) {
    return `label!=${agregarrLabels.join(',')}`;
  }

  // Split by & to get individual filter groups
  const filterGroups = existingFilter.split('&');

  // Find if there's already a label!= group and track other groups
  let labelNotEqualGroup: string | null = null;
  let labelNotEqualIndex = -1;
  const otherGroups: string[] = [];

  filterGroups.forEach((group, index) => {
    // Check if this group contains label!=
    if (group.includes('label!=')) {
      // We need to be more careful - check if label!= appears in any OR part
      const orParts = group.split('|');
      const hasLabelNotEqual = orParts.some((part) =>
        part.startsWith('label!=')
      );

      if (hasLabelNotEqual) {
        labelNotEqualGroup = group;
        labelNotEqualIndex = index;
      } else {
        otherGroups.push(group);
      }
    } else {
      otherGroups.push(group);
    }
  });

  // If there's an existing label!= group, merge our labels into it
  if (labelNotEqualGroup) {
    // TypeScript narrowing: we know it's a string now
    const groupStr: string = labelNotEqualGroup;
    const orParts = groupStr.split('|');
    const updatedOrParts = orParts.map((part: string) => {
      if (part.startsWith('label!=')) {
        // Extract existing labels
        const existingLabelsStr = part.substring('label!='.length);
        const existingLabels = existingLabelsStr
          ? existingLabelsStr.split(',')
          : [];

        // Merge with Agregarr labels
        const allLabels = [...existingLabels, ...agregarrLabels];
        return `label!=${allLabels.join(',')}`;
      }
      return part; // Keep non-label!= OR parts unchanged
    });

    // Replace the old label!= group with the updated one
    const mergedLabelGroup = updatedOrParts.join('|');
    otherGroups.splice(labelNotEqualIndex, 0, mergedLabelGroup);
  } else {
    // No existing label!= group, add one at the end
    otherGroups.push(`label!=${agregarrLabels.join(',')}`);
  }

  return otherGroups.join('&');
}

/**
 * Get shared servers data from V2 API with simple caching
 * Fetches ALL shared servers and filters by machineId
 */
export async function getSharedServers(
  machineId: string,
  plexToken: string,
  forceRefresh = false
): Promise<V2SharedServer[]> {
  const cacheKey = `v2-${machineId}-${plexToken.substring(0, 8)}`;

  // Return cached data if not forcing refresh
  if (!forceRefresh && sharedServerCache.has(cacheKey)) {
    const cachedData = sharedServerCache.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }
  }

  const settings = getSettings();
  const plexClientIdentifier = settings.clientId;

  // Fetch from V2 endpoint - returns ALL servers for this account
  const shareUrl = `https://clients.plex.tv/api/v2/shared_servers/owned/accepted?X-Plex-Product=Agregarr&X-Plex-Client-Identifier=${plexClientIdentifier}&X-Plex-Token=${plexToken}`;

  const response = await fetch(shareUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const shareXml = await response.text();
  const parsedXml = await xml2js.parseStringPromise(shareXml);
  const allServers: V2SharedServer[] =
    parsedXml.sharedServers?.sharedServer || [];

  // Filter to only our server's users by machineIdentifier
  const ourServers = allServers.filter(
    (server) => server.$.machineIdentifier === machineId
  );

  logger.debug('Retrieved V2 shared servers', {
    label: 'Plex User Manager',
    totalServerInvites: allServers.length,
    ourServerInvites: ourServers.length,
    machineId,
  });

  // Cache the filtered result
  sharedServerCache.set(cacheKey, ourServers);
  return ourServers;
}

/**
 * Get all Plex user IDs from shared servers (V2 API)
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

    // V2 uses invitedId instead of userID
    const userIds = sharedServers.map((server) => server.$.invitedId);

    logger.debug(`Found ${userIds.length} Plex users (V2)`, {
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
 * Get a specific user's shared server data (V2 API)
 */
export async function getUserSharedServer(
  machineId: string,
  plexToken: string,
  userPlexId: string,
  forceRefresh = false
): Promise<V2SharedServer | undefined> {
  const sharedServers = await getSharedServers(
    machineId,
    plexToken,
    forceRefresh
  );
  // V2 uses invitedId instead of userID
  return sharedServers.find((server) => server.$.invitedId === userPlexId);
}

/**
 * Update user filter settings to hide other users' collections
 * This implements the core user isolation functionality for Plex Pass users
 */
export async function updateUserFilterSettings(
  targetUserPlexId: string,
  allUserPlexIds: string[],
  activeOverseerrUserIds: string[],
  hasServerOwnerConfig = false,
  targetUserConfigs?: CollectionConfig[]
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

    // Get user data from V2 API (includes user info AND settings!)
    let userServer: V2SharedServer | undefined;
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
          label: 'Plex User Manager',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw new Error(
        `Cannot update user filter settings: Unable to retrieve user data for user ${targetUserPlexId}.`
      );
    }

    if (!userServer) {
      throw new Error(`User ${targetUserPlexId} not found in shared servers`);
    }

    // V2 data structure: settings are in invited[0].sharingSettings[0]
    const invitedUser = userServer.invited[0];
    const userSettings = invitedUser.sharingSettings[0];

    if (!invitedUser || !userSettings) {
      throw new Error(`Invalid V2 data structure for user ${targetUserPlexId}`);
    }

    let currentMovieFilter = '';
    let currentTvFilter = '';

    if (userSettings) {
      currentMovieFilter = decodeURIComponent(
        userSettings.$.filterMovies || ''
      );
      currentTvFilter = decodeURIComponent(
        userSettings.$.filterTelevision || ''
      );
    }

    // Clean existing Agregarr labels from Movies and TV only
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

    // Also exclude targeted collection labels for OTHER users
    if (targetUserConfigs && targetUserConfigs.length > 0) {
      for (const config of targetUserConfigs) {
        if (
          config.targetUserId &&
          config.targetUserId.toString() !== targetUserPlexId
        ) {
          agregarrLabels.push(
            `AgregarrTargetUser_${config.id}_${config.targetUserId}`
          );
        }
      }
    }

    // Combine filters - merge Agregarr labels into existing filter structure for Movies and TV only
    let finalMovieFilter = cleanedMovieFilter;
    let finalTvFilter = cleanedTvFilter;

    if (agregarrLabels.length > 0) {
      finalMovieFilter = mergeAgregarrLabelsIntoFilter(
        cleanedMovieFilter,
        agregarrLabels
      );
      finalTvFilter = mergeAgregarrLabelsIntoFilter(
        cleanedTvFilter,
        agregarrLabels
      );
    }

    // Use persistent server client identifier (following Overseerr pattern)
    const plexClientIdentifier = settings.clientId;

    // Build v2 API payload - matches Plex UI exactly (no allLibraries!)
    const settingsPayload = {
      allowChannels: userSettings.$.allowChannels === '1',
      filterMovies: finalMovieFilter || '',
      filterMusic: userSettings.$.filterMusic || '',
      filterPhotos: userSettings.$.filterPhotos || '',
      filterTelevision: finalTvFilter || '',
      filterAll: userSettings.$.filterAll || null,
      allowSync: userSettings.$.allowSync === '1',
      allowCameraUpload: userSettings.$.allowCameraUpload === '1',
      allowSubtitleAdmin: userSettings.$.allowSubtitleAdmin === '1',
      allowTuners: parseInt(userSettings.$.allowTuners || '0', 10), // Number (0, 1, or 2)
    };

    // V2: Use username as invitedEmail (Plex UI does this)
    const payload = {
      settings: settingsPayload,
      invitedEmail: invitedUser.$.username,
    };

    logger.debug(
      `Updating user filters (v2 API) - payload for user ${targetUserPlexId}`,
      {
        label: 'Plex User Manager',
        userPlexId: targetUserPlexId,
        payload,
      }
    );

    // Use v2 API endpoint - invitedEmail in payload identifies user (not URL parameter!)
    const url = `https://clients.plex.tv/api/v2/sharing_settings?X-Plex-Product=Agregarr&X-Plex-Client-Identifier=${plexClientIdentifier}&X-Plex-Token=${admin.plexToken}`;
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    // Individual user filter updates logged in batch summary

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
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
        const verifySettings =
          verificationServer.invited[0]?.sharingSettings[0];
        if (!verifySettings) {
          logger.warn('Verification data structure invalid', {
            label: 'Plex User Manager',
            userPlexId: targetUserPlexId,
          });
          return;
        }

        const actualMovieFilter = decodeURIComponent(
          verifySettings.$.filterMovies || ''
        );
        const actualTvFilter = decodeURIComponent(
          verifySettings.$.filterTelevision || ''
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
      '@server/lib/collections/sources/overseerr'
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
  hasServerOwnerConfig: boolean,
  targetUserConfigs?: CollectionConfig[]
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
        '@server/lib/collections/sources/overseerr'
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
    const hasTargetUsers = targetUserConfigs && targetUserConfigs.length > 0;
    if (
      activeOverseerrUserIds.length === 0 &&
      !hasServerOwnerConfig &&
      !hasTargetUsers
    ) {
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
      hasServerOwnerConfig,
      targetUserConfigs
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
  hasServerOwnerConfig = false,
  targetUserConfigs?: CollectionConfig[]
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
        hasServerOwnerConfig,
        targetUserConfigs
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

    // Get user data from V2 API
    const userServer = await getUserSharedServer(
      settings.plex.machineId,
      admin.plexToken,
      targetUserPlexId
    );

    if (!userServer) {
      throw new Error(
        `Cannot clear filters: user ${targetUserPlexId} not found`
      );
    }

    // V2 data structure: settings are in invited[0].sharingSettings[0]
    const invitedUser = userServer.invited[0];
    const userSettings = invitedUser?.sharingSettings[0];

    if (!invitedUser || !userSettings) {
      throw new Error(`Invalid V2 data structure for user ${targetUserPlexId}`);
    }

    let currentMovieFilter = '';
    let currentTvFilter = '';

    if (userSettings) {
      currentMovieFilter = decodeURIComponent(
        userSettings.$.filterMovies || ''
      );
      currentTvFilter = decodeURIComponent(
        userSettings.$.filterTelevision || ''
      );
    }

    // Clean all Agregarr labels, keeping user's custom filters
    const cleanedMovieFilter = cleanOverseerrLabels(currentMovieFilter);
    const cleanedTvFilter = cleanOverseerrLabels(currentTvFilter);

    // Use persistent server client identifier (following Overseerr pattern)
    const plexClientIdentifier = settings.clientId;

    // Build v2 API payload - matches Plex UI exactly
    const settingsPayload = {
      allowChannels: userSettings.$.allowChannels === '1',
      filterMovies: cleanedMovieFilter || '',
      filterMusic: userSettings.$.filterMusic || '',
      filterPhotos: userSettings.$.filterPhotos || '',
      filterTelevision: cleanedTvFilter || '',
      filterAll: userSettings.$.filterAll || null,
      allowSync: userSettings.$.allowSync === '1',
      allowCameraUpload: userSettings.$.allowCameraUpload === '1',
      allowSubtitleAdmin: userSettings.$.allowSubtitleAdmin === '1',
      allowTuners: parseInt(userSettings.$.allowTuners || '0', 10), // Number (0, 1, or 2)
    };

    // V2: Use username as invitedEmail
    const payload = {
      settings: settingsPayload,
      invitedEmail: invitedUser.$.username,
    };

    // Log the exact HTTP request data being sent for clear operation
    logger.debug(
      `Sending Plex.tv CLEAR API request (v2) for user ${targetUserPlexId}`,
      {
        label: 'Plex User Manager',
        userPlexId: targetUserPlexId,
        payload,
        movieFilter: cleanedMovieFilter,
        tvFilter: cleanedTvFilter,
      }
    );

    // Use v2 API endpoint - invitedEmail in payload identifies user (not URL parameter!)
    const url = `https://clients.plex.tv/api/v2/sharing_settings?X-Plex-Product=Agregarr&X-Plex-Client-Identifier=${plexClientIdentifier}&X-Plex-Token=${admin.plexToken}`;
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
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
        const verifySettings =
          verificationServer.invited[0]?.sharingSettings[0];
        if (!verifySettings) {
          logger.warn('Verification data structure invalid', {
            label: 'Plex User Manager',
            userPlexId: targetUserPlexId,
          });
          return;
        }

        const actualMovieFilter = decodeURIComponent(
          verifySettings.$.filterMovies || ''
        );
        const actualTvFilter = decodeURIComponent(
          verifySettings.$.filterTelevision || ''
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
