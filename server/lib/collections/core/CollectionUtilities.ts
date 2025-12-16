import type PlexAPI from '@server/api/plexapi';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { templateEngine } from '@server/lib/collections/utils/TemplateEngine';
import type { CollectionConfig } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type {
  AutoRequestResult,
  CollectionItem,
  CollectionSource,
  CollectionSyncError,
  MissingItem,
} from './types';
import { CollectionSyncErrorType } from './types';

// DEFAULTS.ADMIN_USER_ID remains hardcoded as it's a system constant
const DEFAULTS = {
  ADMIN_USER_ID: 1,
} as const;

// Utility functions moved from templateUtils.ts

/**
 * Get user display name with basic fallback
 */
export function getUserDisplayName(user: User): string {
  return (
    user.displayName ||
    user.plexUsername ||
    user.username ||
    user.email ||
    `User ${user.plexId || user.id}`
  );
}

/**
 * Extract error message from unknown error type
 */
export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Create URL-encoded form data from object
 */
export function createFormData(
  payload: Record<string, string | undefined | null>
): string {
  return Object.entries(payload)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value ?? '')}`
    )
    .join('&');
}

/**
 * Generate global collection name with domain/appTitle fallback
 * Now uses TemplateEngine for consistency
 */
export function generateGlobalCollectionName(): string {
  const context = templateEngine.createGlobalContext();

  // Use domain if available, otherwise appTitle
  if (context.domain) {
    return templateEngine.processTemplate(
      '{domain} requests by Everyone',
      context
    );
  }

  return templateEngine.processTemplate(
    '{appTitle} requests by Everyone',
    context
  );
}

// Collection-specific utilities

/**
 * Clean Agregarr-specific labels from filter strings
 * Used to remove auto-generated labels when updating user filters
 *
 * Plex filter syntax: filter1&filter2&filter3
 * Each filter can be: key=value1,value2|key=value3
 * Examples:
 * - "label!=X,Y,Z" (negative labels)
 * - "contentRating=G&label!=X,Y" (content rating + negative labels)
 * - "contentRating=G|label=kids&label!=X,Y" (OR content/label + negative labels)
 */
export function cleanOverseerrLabels(filterStr: string): string {
  if (!filterStr) return '';

  // Split by & to get individual filter groups
  const filterGroups = filterStr.split('&');

  // Process each filter group
  const cleanedGroups = filterGroups
    .map((group) => {
      // Check if this is a label filter (either label= or label!=)
      if (group.includes('label=') || group.includes('label!=')) {
        // Split by | to handle OR conditions within the group
        const orParts = group.split('|');

        const cleanedOrParts = orParts
          .map((part) => {
            // Only process label!= (negative filters), leave label= (positive filters) unchanged
            if (!part.startsWith('label!=')) {
              return part; // Keep label= and other filters unchanged
            }

            // Extract the values after label!=
            const valuesStr = part.substring('label!='.length);
            if (!valuesStr) return ''; // Empty values

            // Split by comma to get individual labels
            const labels = valuesStr.split(',');

            // Filter out Agregarr user/owner labels only
            const nonAgregarrLabels = labels.filter(
              (label) => !label.toLowerCase().startsWith('agregarr')
            );

            // Reconstruct the label filter if there are remaining labels
            if (nonAgregarrLabels.length > 0) {
              return `label!=${nonAgregarrLabels.join(',')}`;
            }

            return ''; // All labels were Agregarr labels
          })
          .filter((part) => part !== ''); // Remove empty parts

        // Rejoin OR parts if any remain
        return cleanedOrParts.join('|');
      }

      // Not a label filter, keep as-is
      return group;
    })
    .filter((group) => group !== ''); // Remove empty groups

  // Rejoin all filter groups
  return cleanedGroups.join('&');
}

/**
 * Clean Agregarr-specific labels from collection label arrays
 * Preserves user's custom labels while removing auto-generated ones
 * @param existingLabels Array of current labels on the collection
 * @param preserveLabel Optional specific Agregarr label to preserve during cleaning
 */
export function cleanAgregarrCollectionLabels(
  existingLabels: string[],
  preserveLabel?: string
): string[] {
  if (!existingLabels || existingLabels.length === 0) return [];

  // Filter out Agregarr labels, but preserve the specified label if provided
  return existingLabels.filter((label: string) => {
    const isAgregarrLabel = label.toLowerCase().startsWith('agregarr');
    if (!isAgregarrLabel) return true; // Keep non-Agregarr labels
    if (preserveLabel && label === preserveLabel) return true; // Keep specified label
    return false; // Remove other Agregarr labels
  });
}

/**
 * Fetch admin user from database
 * Returns the server owner user (ID = 1) with minimal required fields
 */
export async function getAdminUser(): Promise<User | null> {
  const userRepository = getRepository(User);
  return await userRepository.findOne({
    where: { id: DEFAULTS.ADMIN_USER_ID },
    select: { id: true, plexToken: true, plexId: true },
  });
}

/**
 * Get all users that have Plex IDs (are connected to Plex)
 * Used for user-specific collection generation
 */
export async function getUsersWithPlexIds(): Promise<User[]> {
  const userRepository = getRepository(User);
  return await userRepository
    .createQueryBuilder('user')
    .select([
      'user.id',
      'user.plexId',
      'user.email',
      'user.plexUsername',
      'user.plexTitle',
      'user.username',
    ])
    .where('user.plexId IS NOT NULL')
    .getMany();
}

/**
 * Clean up collections for users who are no longer active/connected
 * Removes orphaned collections that belong to deleted or inactive users
 */
export async function cleanupOrphanedCollections(
  plexClient: PlexAPI,
  activeUserPlexIds: Set<number>
): Promise<{ deletedCount: number }> {
  logger.info('Starting cleanup of orphaned collections...');

  let deletedCount = 0;

  try {
    // Get all libraries - filter to only movie and show libraries
    const allLibraries = await plexClient.getLibraries();
    const libraries = allLibraries.filter(
      (library) => library.type === 'movie' || library.type === 'show'
    );

    for (const library of libraries) {
      // Get all collections - they're filtered by library key internally
      const collections = await plexClient.getAllCollections();

      // Filter collections to this library key
      const libraryCollections = collections.filter(
        (c) => c.libraryKey === library.key
      );

      for (const collection of libraryCollections) {
        // Check if collection has user-specific labels
        if (collection.labels && collection.labels.length > 0) {
          // Look for Agregarr user-specific labels
          const agregarrUserLabels = collection.labels.filter(
            (label: string) =>
              label.toLowerCase().startsWith('agregarr') &&
              label.includes('user-')
          );

          if (agregarrUserLabels.length > 0) {
            // Extract user ID from label format: "agregarr-user-{plexId}"
            const userIdMatches = agregarrUserLabels[0].match(/user-(\d+)/);
            if (userIdMatches) {
              const userPlexId = parseInt(userIdMatches[1]);

              // If user is no longer active, delete the collection
              if (!activeUserPlexIds.has(userPlexId)) {
                logger.info(
                  `Deleting orphaned collection "${collection.title}" for inactive user ${userPlexId}`
                );

                try {
                  await plexClient.deleteCollection(collection.ratingKey);
                  deletedCount++;
                } catch (deleteError) {
                  logger.error(
                    `Failed to delete orphaned collection "${collection.title}":`,
                    deleteError
                  );
                }
              }
            }
          }
        }
      }
    }

    logger.info(
      `Cleanup completed. Deleted ${deletedCount} orphaned collections.`
    );
    return { deletedCount };
  } catch (error) {
    logger.error('Error during orphaned collection cleanup:', error);
    return { deletedCount };
  }
}

// Simple media type utilities - replaces over-engineered MediaTypeStrategies.ts

/**
 * Derive media type from library ID
 */
export function getMediaTypeFromLibrary(libraryId: string): 'movie' | 'tv' {
  const settings = getSettings();
  const library = settings.plex.libraries.find((lib) => lib.key === libraryId);
  if (!library) {
    throw new Error(`Library with ID ${libraryId} not found`);
  }
  // Convert Plex library types to our media types
  return library.type === 'show' ? 'tv' : 'movie';
}

/**
 * Get media type for collection config
 */
export function getCollectionMediaType(
  config: CollectionConfig
): 'movie' | 'tv' {
  return getMediaTypeFromLibrary(config.libraryId);
}

// Simple utility functions - replaces over-engineered CollectionSyncUtils class

/**
 * Create standardized collection label for identification
 */
export function createCollectionLabel(
  source: CollectionSource,
  configId: string,
  userId?: number
): string {
  const baseParts = ['Agregarr', source, configId.toString()];

  if (userId !== undefined) {
    baseParts.push('user', userId.toString());
  }

  return baseParts.join('');
}

/**
 * Parse collection config ID from Agregarr label
 * Returns the config ID if the label matches our pattern, otherwise null
 */
export function parseConfigIdFromLabel(label: string): string | null {
  // Match pattern: Agregarr[Source][ConfigId] or Agregarr[Source][ConfigId]user[UserId]
  const match = label.match(/^Agregarr([A-Za-z]+)([a-f0-9-]+)(?:user\d+)?$/i);
  return match ? match[2] : null;
}

/**
 * Find collection by config ID in Plex collections using multiple matching strategies
 * 1. First tries to match by ratingKey (fastest)
 * 2. Falls back to matching by config ID in labels
 * 3. Final fallback: exact name matching (only for Agregarr-labeled collections)
 */
export function findCollectionByConfigId(
  configId: string,
  ratingKey: string | undefined,
  allCollections: {
    ratingKey: string;
    title?: string;
    libraryKey?: string;
    labels?: (string | { tag: string })[];
  }[],
  configType?: string,
  configSubtype?: string,
  configName?: string,
  configLibraryId?: string
): boolean {
  // Use already imported logger

  // Special handling for Overseerr user collections
  if (configType === 'overseerr' && configSubtype === 'users') {
    // User collections are dynamically generated and don't store rating keys in configs
    // They should be considered as "found" if any user collection exists
    const hasUserCollections = allCollections.some((collection) => {
      if (!collection.labels) return false;
      return collection.labels.some((label) => {
        const labelText = typeof label === 'string' ? label : label.tag;
        return labelText.match(/^AgregarrOverseerrUser\d+$/i);
      });
    });

    if (hasUserCollections) {
      logger.debug(`Overseerr user collections found for config: ${configId}`, {
        label: 'Collection Matching',
        configId,
        configType,
        configSubtype,
      });
      return true;
    }
  }

  // Special handling for TMDB franchise collections
  if (configType === 'tmdb' && configSubtype === 'auto_franchise') {
    // Franchise collections are dynamically generated and don't store rating keys in configs
    // They should be considered as "found" if any franchise collection for this config exists
    const hasFranchiseCollections = allCollections.some((collection) => {
      if (!collection.labels) return false;
      return collection.labels.some((label) => {
        const labelText = typeof label === 'string' ? label : label.tag;
        // Match pattern: AgregarrAutoFranchise-{configId}-{franchiseId}
        return labelText.match(
          new RegExp(`^AgregarrAutoFranchise-${configId}-\\d+$`, 'i')
        );
      });
    });

    if (hasFranchiseCollections) {
      logger.debug(`TMDB franchise collections found for config: ${configId}`, {
        label: 'Collection Matching',
        configId,
        configType,
        configSubtype,
      });
      return true;
    }
  }

  // First, try to match by rating key (fastest)
  if (ratingKey && allCollections.some((c) => c.ratingKey === ratingKey)) {
    return true;
  }

  // Fallback: search by config ID in labels
  const foundByLabel = allCollections.some((collection) => {
    if (!collection.labels) return false;

    const hasMatchingLabel = collection.labels.some((label) => {
      // Handle both string and PlexLabel types
      const labelText = typeof label === 'string' ? label : label.tag;
      const parsedConfigId = parseConfigIdFromLabel(labelText);
      return parsedConfigId === configId;
    });

    return hasMatchingLabel;
  });

  // Third fallback: name matching for Agregarr-labeled collections (only if label matching failed)
  if (!foundByLabel && configName && configLibraryId) {
    const matchingCollections = allCollections.filter((collection) => {
      // Must be in the same library
      if (
        collection.libraryKey &&
        String(collection.libraryKey) !== String(configLibraryId)
      ) {
        return false;
      }

      // Must have a title to match against
      if (!collection.title) return false;

      // Try exact name match first
      if (collection.title === configName) return true;

      // Try fuzzy matching for common variations
      const normalizedConfigName = configName.toLowerCase().trim();
      const normalizedCollectionTitle = collection.title.toLowerCase().trim();
      return normalizedConfigName === normalizedCollectionTitle;
    });

    if (matchingCollections.length === 0) {
      // No name matches found - this is expected and not an error
      return false;
    }

    if (matchingCollections.length > 1) {
      logger.warn(
        `Multiple Plex collections found matching config name "${configName}" - skipping name match for safety`,
        {
          label: 'Collection Matching',
          configId,
          configName,
          matchingTitles: matchingCollections.map((c) => c.title),
          matchingRatingKeys: matchingCollections.map((c) => c.ratingKey),
        }
      );
      return false;
    }

    // Single match found
    const matchingCollection = matchingCollections[0];

    // Check if this collection has Agregarr labels (indicates it was managed by us)
    const hasAgregarrLabels = matchingCollection.labels?.some((label) => {
      const labelText = typeof label === 'string' ? label : label.tag;
      return labelText.toLowerCase().startsWith('agregarr');
    });

    // Only proceed if it has Agregarr labels (safety check to avoid matching unrelated collections)
    if (hasAgregarrLabels) {
      return true;
    } else {
      return false;
    }
  }

  return foundByLabel;
}

/**
 * Sync config IDs and rating keys between Agregarr settings and Plex collections
 * Fixes out-of-sync collections by pushing our config IDs to Plex labels and updating our rating keys
 */
export async function syncConfigsWithPlexCollections(
  plexClient: PlexAPI,
  collectionConfigs: {
    id: string;
    name: string;
    collectionRatingKey?: string;
    libraryId: string;
    source: string;
    type?: string;
    subtype?: string;
  }[],
  allCollections: {
    ratingKey: string;
    title: string;
    libraryKey?: string;
    labels?: (string | { tag: string })[];
    smart?: string; // Plex returns string "1" for smart collections
  }[]
): Promise<{
  syncedConfigs: { configId: string; newRatingKey: string }[];
  updatedPlexLabels: string[];
  errors: string[];
}> {
  // Use already imported logger
  const syncedConfigs: { configId: string; newRatingKey: string }[] = [];
  const updatedPlexLabels: string[] = [];
  const errors: string[] = [];

  logger.info(
    `Starting config sync process for ${collectionConfigs.length} configs with ${allCollections.length} Plex collections`,
    {
      label: 'Collection Config Sync',
    }
  );

  // Track sync operations for summary logging
  let foundByLabel = 0;
  let foundByName = 0;
  let labelsReplaced = 0;
  let overseerrSkipped = 0;

  for (const config of collectionConfigs) {
    try {
      // Always check and sync labels even if rating key exists - ensures labels are always correct

      // Try to find collection using same logic as findCollectionByConfigId for consistency

      // First, try label parsing (same as discovery validation)
      let matchingCollection: (typeof allCollections)[0] | null = null;

      for (const collection of allCollections) {
        // Must be in same library
        if (
          collection.libraryKey &&
          String(collection.libraryKey) !== String(config.libraryId)
        ) {
          continue;
        }

        // Try label parsing match first (consistent with discovery)
        if (collection.labels) {
          const hasMatchingLabel = collection.labels.some((label) => {
            const labelText = typeof label === 'string' ? label : label.tag;
            const parsedConfigId = parseConfigIdFromLabel(labelText);
            return parsedConfigId === config.id;
          });

          if (hasMatchingLabel) {
            // CRITICAL: Skip smart collections - they should not update the base collectionRatingKey
            // EXCEPT for recently_added type - that IS a smart collection
            const isSmartCollection = collection.smart === '1';
            const isRecentlyAddedSmartCollection =
              config.type === 'recently_added';

            if (isSmartCollection && !isRecentlyAddedSmartCollection) {
              logger.debug(
                `Config sync skipping smart collection match for ${config.name}`,
                {
                  label: 'Collection Config Sync',
                  configId: config.id,
                  smartCollectionRatingKey: collection.ratingKey,
                  reason:
                    'smart collections should not update base collectionRatingKey',
                }
              );
              continue; // Skip this collection and keep looking for the base collection
            }

            matchingCollection = collection;
            foundByLabel++;
            break;
          }
        }
      }

      // Fallback: Try name matching (only if label parsing failed)
      if (!matchingCollection) {
        const matchingCollections = allCollections.filter((collection) => {
          // CRITICAL: Must be in the same library
          if (
            collection.libraryKey &&
            String(collection.libraryKey) !== String(config.libraryId)
          ) {
            return false;
          }

          // Must have Agregarr labels (safety check - consistent with discovery)
          const hasAgregarrLabels = collection.labels?.some((label) => {
            const labelText = typeof label === 'string' ? label : label.tag;
            return labelText.toLowerCase().startsWith('agregarr');
          });

          if (!hasAgregarrLabels) return false;

          // Try exact name match first
          if (collection.title === config.name) return true;

          // Try fuzzy matching for common variations
          const normalizedConfigName = config.name.toLowerCase().trim();
          const normalizedCollectionTitle = collection.title
            .toLowerCase()
            .trim();
          return normalizedConfigName === normalizedCollectionTitle;
        });

        // CRITICAL: Filter out smart collections before processing name matches
        // EXCEPT for recently_added type - that IS a smart collection
        const isRecentlyAddedSmartCollection = config.type === 'recently_added';

        const baseCollections = matchingCollections.filter((collection) => {
          const isSmartCollection = collection.smart === '1';
          if (isSmartCollection && !isRecentlyAddedSmartCollection) {
            logger.debug(
              `Config sync filtering out smart collection from name matches for ${config.name}`,
              {
                label: 'Collection Config Sync',
                configId: config.id,
                smartCollectionRatingKey: collection.ratingKey,
                collectionTitle: collection.title,
              }
            );
            return false;
          }
          return true;
        });

        if (baseCollections.length === 1) {
          matchingCollection = baseCollections[0];
          foundByName++;
        } else if (baseCollections.length > 1) {
          logger.warn(
            `Multiple base collections found matching config "${config.name}" - skipping`,
            {
              label: 'Collection Config Sync',
              configId: config.id,
              configName: config.name,
              matchingTitles: baseCollections.map((c) => c.title),
            }
          );
          continue;
        }
      }

      // If no collection found by either method, skip this config
      if (!matchingCollection) {
        logger.debug(
          `No Plex collection found matching config "${config.name}"`,
          {
            label: 'Collection Config Sync',
            configId: config.id,
            configName: config.name,
          }
        );
        continue;
      }

      // Check if this collection has an Agregarr label already (safety check)
      const existingAgregarrLabels =
        matchingCollection.labels?.filter((label) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          return labelText.toLowerCase().startsWith('agregarr');
        }) || [];

      // Safety check: Only sync collections that already have Agregarr labels
      // This prevents accidentally taking over unrelated user collections
      if (existingAgregarrLabels.length === 0) {
        logger.debug(
          `Skipping collection "${matchingCollection.title}" - no existing Agregarr labels found (safety check)`,
          {
            label: 'Collection Config Sync',
            configId: config.id,
            configName: config.name,
            collectionTitle: matchingCollection.title,
            collectionRatingKey: matchingCollection.ratingKey,
          }
        );
        continue;
      }

      // Skip Overseerr collections - they manage their own specialized labels
      // (AgregarrOverseerrUser${userId}, AgregarrOverseerrOwner${userId}, etc.)
      if (config.source === 'overseerr') {
        overseerrSkipped++;
        continue;
      }

      // Generate the correct label for our config
      const correctLabel = createCollectionLabel(
        config.source as CollectionSource,
        config.id
      );

      // Update Plex collection with our config ID label
      // addLabelToCollection automatically cleans existing Agregarr labels and replaces with new one
      await plexClient.addLabelToCollection(
        matchingCollection.ratingKey,
        correctLabel
      );
      updatedPlexLabels.push(matchingCollection.ratingKey);
      labelsReplaced++;

      // Note: We don't update the config here since it's a copy
      // Return the sync info so the caller can update the actual settings
      syncedConfigs.push({
        configId: config.id,
        newRatingKey: matchingCollection.ratingKey,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      errors.push(`Failed to sync config ${config.id}: ${errorMessage}`);
      logger.error(`Failed to sync config "${config.name}"`, {
        label: 'Collection Config Sync',
        configId: config.id,
        error: errorMessage,
      });
    }
  }

  logger.info(
    `Collection sync completed: ${syncedConfigs.length} configs synced (${foundByLabel} by label, ${foundByName} by name), ${labelsReplaced} labels updated, ${overseerrSkipped} Overseerr skipped, ${errors.length} errors`,
    {
      label: 'Collection Config Sync',
      syncedConfigs: syncedConfigs.length,
      foundByLabel,
      foundByName,
      labelsReplaced,
      overseerrSkipped,
      errors: errors.length,
    }
  );

  return { syncedConfigs, updatedPlexLabels, errors };
}

/**
 * Create a delay for rate limiting
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sanitize collection name for Plex compatibility
 */
export function sanitizeCollectionName(name: string): string {
  // Remove or replace characters that could cause issues in Plex
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid file system characters
    .split('')
    .filter((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127) // Remove control characters
    .join('')
    .trim()
    .substring(0, 100); // Limit length to avoid Plex issues
}

/**
 * Validate collection configuration has required fields
 */
export function validateRequiredFields(
  config: Record<string, unknown>,
  requiredFields: string[]
): string[] {
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    const value = field.includes('.')
      ? field
          .split('.')
          .reduce<unknown>(
            (obj, key) =>
              obj && typeof obj === 'object' && obj !== null
                ? (obj as Record<string, unknown>)[key]
                : undefined,
            config
          )
      : config[field];

    if (value === undefined || value === null || value === '') {
      missingFields.push(field);
    }
  }

  return missingFields;
}

/**
 * Check if items array contains valid collection items
 */
export function validateCollectionItems(items: unknown[]): {
  valid: CollectionItem[];
  invalid: unknown[];
  errors: string[];
} {
  const valid: CollectionItem[] = [];
  const invalid: unknown[] = [];
  const errors: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item) {
      invalid.push(item);
      errors.push(`Item ${i}: null or undefined`);
      continue;
    }

    // Type guard to check if item has the required properties
    if (!item || typeof item !== 'object') {
      invalid.push(item);
      errors.push(`Item ${i}: not an object`);
      continue;
    }

    const itemObj = item as Record<string, unknown>;

    if (!itemObj.ratingKey || typeof itemObj.ratingKey !== 'string') {
      invalid.push(item);
      errors.push(`Item ${i}: missing or invalid ratingKey`);
      continue;
    }

    if (!itemObj.type || !['movie', 'tv'].includes(itemObj.type as string)) {
      invalid.push(item);
      errors.push(`Item ${i}: missing or invalid type (${itemObj.type})`);
      continue;
    }

    if (!itemObj.title || typeof itemObj.title !== 'string') {
      invalid.push(item);
      errors.push(`Item ${i}: missing or invalid title`);
      continue;
    }

    // At this point we know the item has all required properties
    valid.push({
      ratingKey: itemObj.ratingKey,
      title: itemObj.title,
      type: itemObj.type as 'movie' | 'tv',
      tmdbId: typeof itemObj.tmdbId === 'number' ? itemObj.tmdbId : undefined,
      metadata: itemObj.metadata as Record<string, unknown> | undefined,
      episodeInfo: itemObj.episodeInfo as
        | CollectionItem['episodeInfo']
        | undefined,
    });
  }

  return { valid, invalid, errors };
}

// Collection configuration update utilities (moved from CollectionConfigUpdater.ts)

/**
 * Update a collection config with its Plex rating key
 * Simplified to work with individual configs only (no more multi-library configs)
 */
export function updateConfigWithRatingKey(
  configId: string,
  collectionRatingKey: string,
  libraryId?: string
): void {
  try {
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];

    // Find the config directly - no more complex expansion logic needed
    const configIndex = collectionConfigs.findIndex(
      (config) => config.id === configId
    );

    if (configIndex >= 0) {
      const existingConfig = collectionConfigs[configIndex];

      // Verify this rating key is for the correct library
      if (libraryId && existingConfig.libraryId !== libraryId) {
        logger.warn(
          `Rating key library mismatch: config for library ${existingConfig.libraryId}, but rating key for library ${libraryId}`,
          {
            label: 'Collection Utilities',
            configId,
            configLibrary: existingConfig.libraryId,
            ratingKeyLibrary: libraryId,
          }
        );
        return;
      }

      // Simple update - just set the rating key
      const updatedConfig = {
        ...existingConfig,
        collectionRatingKey,
      };

      // Update the config in the array
      collectionConfigs[configIndex] = updatedConfig;

      // Save the updated settings
      settings.plex.collectionConfigs = collectionConfigs;
      settings.save();

      // Config updated with rating key
    } else {
      logger.warn(`Config ${configId} not found for rating key update`, {
        label: 'Collection Utilities',
        configId,
        collectionRatingKey,
      });
    }
  } catch (error) {
    logger.error(
      `Failed to update config ${configId} with rating key: ${error}`,
      {
        label: 'Collection Utilities',
        configId,
        collectionRatingKey,
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

/**
 * Update multiple configs with their rating keys in a batch
 */
export function updateConfigsWithRatingKeys(
  updates: { configId: string; collectionRatingKey: string }[]
): void {
  if (updates.length === 0) return;

  try {
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];
    let updatedCount = 0;

    // Apply all updates
    for (const { configId, collectionRatingKey } of updates) {
      const configIndex = collectionConfigs.findIndex(
        (config) => config.id === configId
      );
      if (configIndex >= 0) {
        collectionConfigs[configIndex] = {
          ...collectionConfigs[configIndex],
          collectionRatingKey,
        };
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      // Save the updated settings
      settings.plex.collectionConfigs = collectionConfigs;
      settings.save();

      logger.info(
        `Updated ${updatedCount} collection configs with rating keys`,
        {
          label: 'Collection Utilities',
          updatedCount,
          totalUpdates: updates.length,
        }
      );
    }
  } catch (error) {
    logger.error(`Failed to batch update configs with rating keys: ${error}`, {
      label: 'Collection Utilities',
      updateCount: updates.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Error handling and utility functions (moved from collectionsUtils.ts)

/**
 * Create a structured error object for collection sync operations
 */
export function createSyncError(
  type: CollectionSyncErrorType,
  message: string,
  context: Record<string, unknown> = {},
  originalError?: Error,
  source?: CollectionSource
): CollectionSyncError {
  return {
    type,
    message,
    details: context,
    originalError,
    context: {
      source,
      ...context,
    },
  };
}

/**
 * Validate and sanitize collection items with logging
 */
export function validateAndSanitizeItems(
  items: unknown[],
  sourceName = 'Collection'
): {
  validItems: CollectionItem[];
  invalidItems: unknown[];
  validationErrors: string[];
} {
  const validation = validateCollectionItems(items);

  if (validation.errors.length > 0) {
    logger.warn(
      `Found ${validation.invalid.length} invalid items in ${sourceName} collection`,
      {
        label: `${sourceName} Collections`,
        errors: validation.errors.slice(0, 5), // Log first 5 errors to avoid spam
        totalErrors: validation.errors.length,
      }
    );
  }

  return {
    validItems: validation.valid,
    invalidItems: validation.invalid,
    validationErrors: validation.errors,
  };
}

/**
 * Handle rate limiting with exponential backoff
 */
export async function handleRateLimit(
  attempt: number,
  sourceName = 'API',
  maxAttempts = 3
): Promise<void> {
  const effectiveMaxAttempts = maxAttempts;

  if (attempt >= effectiveMaxAttempts) {
    throw createSyncError(
      CollectionSyncErrorType.API_ERROR,
      `Rate limit exceeded after ${effectiveMaxAttempts} attempts`,
      { attempt, maxAttempts: effectiveMaxAttempts },
      undefined,
      sourceName as CollectionSource
    );
  }

  const delayTime = Math.min(1000 * Math.pow(2, attempt), 30000);

  logger.warn(
    `Rate limit hit for ${sourceName}, waiting ${delayTime}ms before retry (attempt ${
      attempt + 1
    }/${effectiveMaxAttempts})`,
    {
      label: `${sourceName} Collections`,
      attempt: attempt + 1,
      maxAttempts: effectiveMaxAttempts,
      delay: delayTime,
    }
  );

  await delay(delayTime);
}

/**
 * Log collection processing results with appropriate level and context
 */
export function logCollectionProcessingResults(
  configName: string,
  result: { created: number; updated: number; itemCount?: number },
  processingTime: number,
  sourceName = 'Collection',
  configId?: string,
  additionalContext?: Record<string, unknown>
): void {
  const logLevel = result.created > 0 || result.updated > 0 ? 'info' : 'debug';
  const action =
    result.created > 0
      ? 'created'
      : result.updated > 0
      ? 'updated'
      : 'processed';

  logger[logLevel](
    `Collection ${action}: ${configName} (${result.itemCount || 0} items)`,
    {
      label: `${sourceName} Collections`,
      configId,
      configName,
      action,
      created: result.created,
      updated: result.updated,
      itemCount: result.itemCount,
      processingTime,
      ...additionalContext,
    }
  );
}

/**
 * Download Mode Routing and Utilities
 */

/**
 * Filter items by position limit if specified
 * Only process items in positions 1-X of the original source list
 */
export function filterItemsByPosition<T extends { originalPosition: number }>(
  items: T[],
  maxPosition?: number
): T[] {
  // If no limit specified (0 or undefined), return all items
  if (!maxPosition || maxPosition <= 0) {
    return items;
  }

  // Return only items that were within the position limit in the original list
  return items.filter((item) => item.originalPosition <= maxPosition);
}

/**
 * Process missing items using the appropriate download service based on collection config
 * Routes to either Overseerr request workflow or direct *arr download workflow
 */
export async function processMissingItemsWithMode(
  missingItems: MissingItem[],
  config: CollectionConfig,
  source:
    | 'trakt'
    | 'tmdb'
    | 'imdb'
    | 'awards'
    | 'letterboxd'
    | 'anilist'
    | 'myanimelist'
    | 'mdblist'
    | 'networks'
    | 'originals'
    | 'multi-source'
): Promise<AutoRequestResult> {
  // Apply position filtering first
  const filteredItems = filterItemsByPosition(
    missingItems,
    Number(config.maxPositionToProcess) || undefined
  );

  if (filteredItems.length === 0) {
    logger.debug(
      `No items to process after position filtering for ${config.name}`,
      {
        label: 'Collection Utilities',
        originalCount: missingItems.length,
        maxPosition: config.maxPositionToProcess,
      }
    );

    return {
      autoApproved: 0,
      manualApproval: 0,
      alreadyRequested: 0,
      skipped: 0,
      total: 0,
    };
  }

  // Log position filtering if it occurred
  if (filteredItems.length < missingItems.length) {
    logger.info(
      `Position filter applied to ${config.name}: Processing ${filteredItems.length}/${missingItems.length} items (positions 1-${config.maxPositionToProcess})`,
      {
        label: `${
          source.charAt(0).toUpperCase() + source.slice(1)
        } Collections`,
        collection: config.name,
      }
    );
  }

  // Route to appropriate service based on download mode
  const downloadMode = config.downloadMode || 'overseerr'; // Default to overseerr for backward compatibility

  try {
    switch (downloadMode) {
      case 'direct': {
        const { directDownloadService } = await import(
          '../services/DirectDownloadService'
        );
        return await directDownloadService.processDirectDownloads(
          filteredItems,
          config,
          source
        );
      }

      case 'overseerr':
      default: {
        const { autoRequestService } = await import(
          '../services/AutoRequestService'
        );
        return await autoRequestService.processAutoRequests(
          filteredItems,
          config,
          source
        );
      }
    }
  } catch (error) {
    logger.error(
      `Failed to process missing items for ${config.name} using ${downloadMode} mode: ${error}`,
      {
        label: `${
          source.charAt(0).toUpperCase() + source.slice(1)
        } Collections`,
        downloadMode,
      }
    );
    throw error;
  }
}

/**
 * Validate collection configuration for download mode
 */
export function validateDownloadModeConfig(config: CollectionConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const downloadMode = config.downloadMode || 'overseerr';

  // Common validations
  if (!config.searchMissingMovies && !config.searchMissingTV) {
    errors.push(
      'At least one media type (Movies or TV) must be enabled for auto-processing'
    );
  }

  // Position limit validation (0 = no limit)
  if (
    config.maxPositionToProcess !== undefined &&
    config.maxPositionToProcess !== null &&
    config.maxPositionToProcess < 0
  ) {
    errors.push('Position limit must be 0 or greater (0 = no limit)');
  }

  // Season limit validation (0 = no limit)
  if (
    config.maxSeasonsToRequest !== undefined &&
    config.maxSeasonsToRequest !== null &&
    config.maxSeasonsToRequest < 0
  ) {
    errors.push('Season limit must be 0 or greater (0 = no limit)');
  }

  // Seasons per show limit validation (0 = all seasons)
  if (
    config.seasonsPerShowLimit !== undefined &&
    config.seasonsPerShowLimit !== null &&
    config.seasonsPerShowLimit < 0
  ) {
    errors.push(
      'Seasons per show limit must be 0 or greater (0 = all seasons)'
    );
  }

  // Validate seasonGrabOrder
  if (
    config.seasonGrabOrder &&
    !['first', 'latest', 'airing'].includes(config.seasonGrabOrder)
  ) {
    errors.push(`Invalid season grab order mode: ${config.seasonGrabOrder}`);
  }

  // Mode-specific validations
  if (downloadMode === 'overseerr') {
    // Overseerr mode requires external Overseerr connection settings
    const settings = getSettings();
    if (!settings.overseerr.hostname || !settings.overseerr.apiKey) {
      errors.push(
        'Overseerr mode requires valid Overseerr connection settings (hostname and API key)'
      );
    }
  } else if (downloadMode === 'direct') {
    // Direct mode requires *arr service configurations
    const settings = getSettings();
    const hasRadarr = config.searchMissingMovies && settings.radarr.length > 0;
    const hasSonarr = config.searchMissingTV && settings.sonarr.length > 0;

    if (config.searchMissingMovies && !hasRadarr) {
      errors.push(
        'Direct mode with movie auto-processing requires at least one configured Radarr instance'
      );
    }

    if (config.searchMissingTV && !hasSonarr) {
      errors.push(
        'Direct mode with TV auto-processing requires at least one configured Sonarr instance'
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Extract TMDB ID from Plex GUID array
 */
function extractTmdbIdFromGuids(guids: { id: string }[]): number | null {
  if (!guids || guids.length === 0) {
    return null;
  }

  // Log all GUIDs for the first few items to understand the format
  const sampleGuidLogging = Math.random() < 0.001; // Log 0.1% of items for sampling
  if (sampleGuidLogging) {
    logger.debug('Sample Plex GUID analysis', {
      label: 'Plex Search',
      allGuids: guids.map((g) => g.id),
      guidCount: guids.length,
    });
  }

  const tmdbGuid = guids?.find((guid) => guid.id.startsWith('tmdb://'));
  if (tmdbGuid) {
    const match = tmdbGuid.id.match(/tmdb:\/\/(\d+)/);
    const tmdbId = match ? parseInt(match[1], 10) : null;

    if (sampleGuidLogging && tmdbId) {
      logger.debug('TMDB GUID extraction successful', {
        label: 'Plex Search',
        originalGuid: tmdbGuid.id,
        extractedTmdbId: tmdbId,
      });
    }

    return tmdbId;
  }

  return null;
}

/**
 * Get all items from a Plex library using pagination
 */
async function getAllLibraryItems(
  plexClient: PlexAPI,
  libraryKey: string
): Promise<{ ratingKey: string; title: string; Guid?: { id: string }[] }[]> {
  const allItems: {
    ratingKey: string;
    title: string;
    Guid?: { id: string }[];
  }[] = [];
  let offset = 0;
  const pageSize = 200; // Larger page size for efficiency

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await plexClient.getLibraryContents(libraryKey, {
      offset,
      size: pageSize,
    });

    allItems.push(...response.items);

    // If we got fewer items than requested, we've reached the end
    if (response.items.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return allItems;
}

// Cache interface for library items
export interface LibraryItemsCache {
  [libraryKey: string]: {
    ratingKey: string;
    title: string;
    Guid?: { id: string }[];
  }[];
}

/**
 * Pre-fetch all library items to avoid repeated API calls during sync
 * OPTIMIZATION: Call this ONCE at the start of sync operations
 */
export async function prefetchAllLibraryItems(
  plexClient: PlexAPI,
  targetLibraryId?: string
): Promise<LibraryItemsCache> {
  const cache: LibraryItemsCache = {};

  try {
    const allLibraries = await plexClient.getLibraries();
    // Filter to only movie and show libraries
    const libraries = allLibraries.filter(
      (library) => library.type === 'movie' || library.type === 'show'
    );
    let librariesToCache = libraries;

    // If targetLibraryId is specified, only cache that library
    if (targetLibraryId) {
      librariesToCache = libraries.filter((lib) => lib.key === targetLibraryId);
    }

    // Parallelize library content fetching for better performance
    const cachePromises = librariesToCache.map(async (library) => {
      try {
        const items = await getAllLibraryItems(plexClient, library.key);
        // Individual library cache results logged in summary
        return { libraryKey: library.key, items };
      } catch (error) {
        logger.warn(
          `Failed to cache items from library ${library.key}: ${error}`,
          {
            label: 'Library Cache',
            libraryKey: library.key,
          }
        );
        return { libraryKey: library.key, items: [] };
      }
    });

    const cacheResults = await Promise.allSettled(cachePromises);

    // Build cache from successful results
    cacheResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        cache[result.value.libraryKey] = result.value.items;
      }
    });

    logger.info(
      `Library content cache built for ${Object.keys(cache).length} libraries`,
      {
        label: 'Library Cache',
        cachedLibraries: Object.keys(cache),
      }
    );

    return cache;
  } catch (error) {
    logger.error(`Failed to build library cache: ${error}`, {
      label: 'Library Cache',
    });
    return cache; // Return empty cache on error
  }
}

/**
 * Find Plex items by TMDB IDs using cached library data or direct Plex API queries
 * This replaces the old Media table dependency with real-time Plex searches
 *
 * OPTIMIZATION: Pass libraryCache to avoid repeated API calls during sync
 *
 * @param plexClient - Plex API client
 * @param tmdbLookups - Array of TMDB IDs to search for
 * @param targetLibraryId - Optional library ID to limit search scope (for collection creation)
 * @param libraryCache - Optional pre-fetched library items cache (RECOMMENDED)
 * @param forDuplicateDetection - If true, searches all libraries for duplicate prevention (missing items). If false, respects targetLibraryId for collection creation.
 */
export async function findPlexItemsByTmdbIds(
  plexClient: PlexAPI,
  tmdbLookups: {
    tmdbId: number;
    showTmdbId?: number; // For episodes: the parent show's TMDB ID
    mediaType: 'movie' | 'tv';
    title: string;
    episodeInfo?: {
      season?: number;
      episode?: number;
      episodeTitle?: string;
    };
  }[],
  targetLibraryId?: string,
  libraryCache?: LibraryItemsCache,
  forDuplicateDetection = false
): Promise<
  Map<string, { ratingKey: string; title: string; libraryKey: string }>
> {
  const results = new Map<
    string,
    { ratingKey: string; title: string; libraryKey: string }
  >();

  if (tmdbLookups.length === 0) {
    logger.debug('No TMDB lookups provided to findPlexItemsByTmdbIds', {
      label: 'Plex Search',
    });
    return results;
  }

  try {
    // OPTIMIZATION: Use cached library data if available, otherwise fetch fresh data
    let libraries: { key: string; title: string; type: string }[];

    if (libraryCache) {
      // Use cached data - no API calls needed!
      libraries = Object.keys(libraryCache).map((key) => ({
        key,
        title: key, // We don't need title for processing, just use key
        type: 'unknown', // Will be determined by checking library contents
      }));

      logger.debug(
        `Using cached library data for ${
          Object.keys(libraryCache).length
        } libraries`,
        {
          label: 'Plex Search (Cached)',
          cachedLibraries: Object.keys(libraryCache).length,
        }
      );
    } else {
      // Fallback to fresh API call if no cache
      const allLibraries = await plexClient.getLibraries();
      // Filter to only movie and show libraries
      libraries = allLibraries.filter(
        (library) => library.type === 'movie' || library.type === 'show'
      );
      // No library cache available, fetching fresh data
    }

    // Organize lookups by media type for efficient querying
    const movieLookups = tmdbLookups.filter(
      (lookup) => lookup.mediaType === 'movie'
    );
    const tvLookups = tmdbLookups.filter((lookup) => lookup.mediaType === 'tv');

    // Query movie libraries
    if (movieLookups.length > 0) {
      let movieLibraries = libraries.filter(
        (lib) => lib.type === 'movie' || libraryCache
      );

      // If targetLibraryId is specified and we're NOT doing duplicate detection, filter to target library
      if (targetLibraryId && !forDuplicateDetection) {
        if (libraryCache) {
          movieLibraries = movieLibraries.filter(
            (lib) => lib.key === targetLibraryId
          );
        } else {
          movieLibraries = movieLibraries.filter(
            (lib) => lib.key === targetLibraryId
          );
          if (movieLibraries.length === 0) {
            logger.warn(
              `Target library ${targetLibraryId} not found or is not a movie library`,
              {
                label: 'Plex Search',
                targetLibraryId,
                availableMovieLibraries: libraries
                  .filter((lib) => lib.type === 'movie')
                  .map((lib) => ({ key: lib.key, title: lib.title })),
              }
            );
          }
        }
        logger.debug(
          `Library-scoped search - checking target library ${targetLibraryId} for collection creation`,
          {
            label: 'Plex Search (Scoped)',
            targetLibraryId,
            movieLibraryCount: movieLibraries.length,
          }
        );
      } else if (targetLibraryId && forDuplicateDetection) {
        logger.debug(
          `Global library search enabled - checking all ${movieLibraries.length} movie libraries for duplicate detection`,
          {
            label: 'Plex Search (Global)',
            targetLibraryId,
            movieLibraryCount: movieLibraries.length,
          }
        );
      }

      for (const library of movieLibraries) {
        let items: {
          ratingKey: string;
          title: string;
          Guid?: { id: string }[];
        }[];

        if (libraryCache && libraryCache[library.key]) {
          // OPTIMIZATION: Use cached items - no API call!
          items = libraryCache[library.key];

          logger.debug(
            `Using cached data for library ${library.key} - found ${items.length} items`,
            {
              label: 'Plex Search (Cached)',
              libraryKey: library.key,
              itemCount: items.length,
            }
          );
        } else {
          // Fallback to API call if no cache for this library
          items = await getAllLibraryItems(plexClient, library.key);

          // Fetched fresh data for library
        }

        const foundTmdbIds: number[] = [];

        for (const item of items) {
          if (item.Guid) {
            const tmdbId = extractTmdbIdFromGuids(item.Guid);
            if (tmdbId) {
              foundTmdbIds.push(tmdbId);
              const lookup = movieLookups.find((l) => l.tmdbId === tmdbId);
              if (lookup) {
                const key = `${tmdbId}-movie`;
                results.set(key, {
                  ratingKey: item.ratingKey,
                  title: item.title,
                  libraryKey: library.key,
                });
              }
            }
          }
        }
      }
    }

    // Query TV libraries
    if (tvLookups.length > 0) {
      let tvLibraries = libraries.filter(
        (lib) => lib.type === 'show' || libraryCache
      );

      // If targetLibraryId is specified and we're NOT doing duplicate detection, filter to target library
      if (targetLibraryId && !forDuplicateDetection) {
        if (libraryCache) {
          tvLibraries = tvLibraries.filter(
            (lib) => lib.key === targetLibraryId
          );
        } else {
          tvLibraries = tvLibraries.filter(
            (lib) => lib.key === targetLibraryId
          );
          if (tvLibraries.length === 0) {
            logger.warn(
              `Target library ${targetLibraryId} not found or is not a TV library`,
              {
                label: 'Plex Search',
                targetLibraryId,
                availableTvLibraries: libraries
                  .filter((lib) => lib.type === 'show')
                  .map((lib) => ({ key: lib.key, title: lib.title })),
              }
            );
          }
        }
        logger.debug(
          `Library-scoped search - checking target library ${targetLibraryId} for collection creation`,
          {
            label: 'Plex Search (Scoped)',
            targetLibraryId,
            tvLibraryCount: tvLibraries.length,
          }
        );
      } else if (targetLibraryId && forDuplicateDetection) {
        logger.debug(
          `Global library search enabled - checking all ${tvLibraries.length} TV libraries for duplicate detection`,
          {
            label: 'Plex Search (Global)',
            targetLibraryId,
            tvLibraryCount: tvLibraries.length,
          }
        );
      }

      for (const library of tvLibraries) {
        let items: {
          ratingKey: string;
          title: string;
          Guid?: { id: string }[];
        }[];

        if (libraryCache && libraryCache[library.key]) {
          // OPTIMIZATION: Use cached items - no API call!
          items = libraryCache[library.key];

          logger.debug(
            `Using cached data for library ${library.key} - found ${items.length} items`,
            {
              label: 'Plex Search (Cached)',
              libraryKey: library.key,
              itemCount: items.length,
            }
          );
        } else {
          // Fallback to API call if no cache for this library
          items = await getAllLibraryItems(plexClient, library.key);

          // Fetched fresh data for library
        }

        const foundTmdbIds: number[] = [];

        for (const item of items) {
          if (item.Guid) {
            const tmdbId = extractTmdbIdFromGuids(item.Guid);
            if (tmdbId) {
              foundTmdbIds.push(tmdbId);

              // First try regular show lookup (for shows without episodes)
              const lookup = tvLookups.find(
                (l) => l.tmdbId === tmdbId && !l.episodeInfo
              );

              if (lookup) {
                // Regular show found - add it directly
                const key = `${tmdbId}-tv`;

                results.set(key, {
                  ratingKey: item.ratingKey,
                  title: item.title,
                  libraryKey: library.key,
                });
              } else {
                // Check if this show has episodes we need to find
                const episodeLookups = tvLookups.filter(
                  (l) => l.showTmdbId === tmdbId && l.episodeInfo
                );

                if (episodeLookups.length > 0) {
                  // This show has episodes we need - get all episodes and match by TMDB ID
                  try {
                    const allEpisodes = await plexClient.getAllEpisodesFromShow(
                      item.ratingKey
                    );

                    // Early termination: stop searching once we find all target episodes
                    const targetCount = episodeLookups.length;
                    let foundCount = 0;

                    // Search through episodes with early termination
                    for (
                      let i = 0;
                      i < allEpisodes.length && foundCount < targetCount;
                      i++
                    ) {
                      const episode = allEpisodes[i];

                      // Check if this episode matches any of our target TMDB IDs
                      for (const episodeLookup of episodeLookups) {
                        // Skip if we already found this episode
                        const key = `${episodeLookup.tmdbId}-tv`;
                        if (results.has(key)) continue;

                        // Find episode by TMDB ID in the episode GUIDs
                        if (
                          episode.Guid &&
                          episode.Guid.some(
                            (guid) =>
                              guid.id === `tmdb://${episodeLookup.tmdbId}`
                          )
                        ) {
                          results.set(key, {
                            ratingKey: episode.ratingKey,
                            title: episode.title,
                            libraryKey: library.key,
                          });

                          foundCount++;
                          break; // Found this episode, move to next episode
                        }
                      }
                    }

                    // Log any missing episodes
                    for (const episodeLookup of episodeLookups) {
                      const key = `${episodeLookup.tmdbId}-tv`;
                      if (!results.has(key)) {
                        logger.debug(
                          `Episode with TMDB ID ${episodeLookup.tmdbId} not found in show ${item.title}`
                        );
                      }
                    }
                  } catch (error) {
                    logger.warn(
                      `Failed to get episodes for show ${item.title}`,
                      {
                        label: 'Plex Search (Episode)',
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      }
                    );
                  }
                }
              }
            }
          }
        }
      }
    }

    const searchScope = forDuplicateDetection
      ? 'all libraries (duplicate detection)'
      : targetLibraryId && !forDuplicateDetection
      ? `target library ${targetLibraryId} (collection creation)`
      : 'all libraries (no target specified)';

    logger.info(
      `Plex search completed: ${results.size}/${tmdbLookups.length} matches found - ${searchScope}`,
      {
        label: forDuplicateDetection
          ? 'Plex Search (Global)'
          : 'Plex Search (Scoped)',
        foundMatches: results.size,
        totalLookups: tmdbLookups.length,
        movieLookups: movieLookups.length,
        tvLookups: tvLookups.length,
        searchScope,
        targetLibrary: targetLibraryId || 'not specified',
        forDuplicateDetection,
        searchedLibraries: libraries.map((l) => ({
          key: l.key,
          title: l.title,
          type: l.type,
        })),
      }
    );
  } catch (error) {
    logger.error('Failed to search Plex for items', {
      label: 'Plex Search',
      error: error instanceof Error ? error.message : 'Unknown error',
      totalLookups: tmdbLookups.length,
    });
  }

  return results;
}

/**
 * Search Plex library items by title (fallback for unmatched items)
 * Used when TMDB/TVDB guid matching fails
 *
 * @param plexClient - Plex API client
 * @param title - Title to search for
 * @param year - Optional release year for better matching
 * @param libraryId - Library to search in
 * @param mediaType - Media type (movie or tv)
 * @param libraryCache - Optional pre-fetched library items cache
 * @returns Array of matching items with rating keys and guid info
 */
export async function findPlexItemsByTitle(
  plexClient: PlexAPI,
  title: string,
  year: number | undefined,
  libraryId: string,
  mediaType: 'movie' | 'tv',
  libraryCache?: LibraryItemsCache
): Promise<
  {
    ratingKey: string;
    title: string;
    year?: number;
    hasTmdbGuid: boolean;
    hasAnyGuid: boolean;
  }[]
> {
  const results: {
    ratingKey: string;
    title: string;
    year?: number;
    hasTmdbGuid: boolean;
    hasAnyGuid: boolean;
  }[] = [];

  try {
    // Get library items from cache or fetch fresh
    let items: {
      ratingKey: string;
      title: string;
      year?: number;
      Guid?: { id: string }[];
    }[];

    if (libraryCache && libraryCache[libraryId]) {
      items = libraryCache[libraryId];
      logger.debug(
        `Using cached data for title search in library ${libraryId}`,
        {
          label: 'Plex Title Search',
          libraryId,
          itemCount: items.length,
        }
      );
    } else {
      items = await getAllLibraryItems(plexClient, libraryId);
      logger.debug(
        `Fetched fresh data for title search in library ${libraryId}`,
        {
          label: 'Plex Title Search',
          libraryId,
          itemCount: items.length,
        }
      );
    }

    // Normalize search title for comparison
    const normalizedSearchTitle = title.toLowerCase().trim();

    // Search items by title
    for (const item of items) {
      const normalizedItemTitle = item.title.toLowerCase().trim();

      // Exact or close match
      if (
        normalizedItemTitle === normalizedSearchTitle ||
        normalizedItemTitle.includes(normalizedSearchTitle) ||
        normalizedSearchTitle.includes(normalizedItemTitle)
      ) {
        // If year is provided, check for year match to reduce false positives
        if (year !== undefined && item.year !== undefined) {
          // Allow +/- 1 year tolerance for release date discrepancies
          if (Math.abs(item.year - year) > 1) {
            continue;
          }
        }

        // Check if item has TMDB guid
        const hasTmdbGuid =
          item.Guid?.some((guid) => guid.id.startsWith('tmdb://')) || false;

        // Check if item has any guid (matched vs unmatched)
        const hasAnyGuid = (item.Guid?.length || 0) > 0;

        results.push({
          ratingKey: item.ratingKey,
          title: item.title,
          year: item.year,
          hasTmdbGuid,
          hasAnyGuid,
        });
      }
    }

    logger.info(
      `Title search completed: found ${results.length} matches for "${title}"${
        year ? ` (${year})` : ''
      }`,
      {
        label: 'Plex Title Search',
        searchTitle: title,
        searchYear: year,
        libraryId,
        mediaType,
        matchCount: results.length,
        matches: results.map((r) => ({
          title: r.title,
          year: r.year,
          hasTmdbGuid: r.hasTmdbGuid,
          hasAnyGuid: r.hasAnyGuid,
        })),
      }
    );
  } catch (error) {
    logger.error('Failed to search Plex by title', {
      label: 'Plex Title Search',
      searchTitle: title,
      searchYear: year,
      libraryId,
      mediaType,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return results;
}

// Multi-source collection sync counter utilities

/**
 * Get the current sync counter for a multi-source collection
 */
export function getCollectionSyncCounter(configId: string): number {
  try {
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];

    const config = collectionConfigs.find((c) => c.id === configId);
    if (!config) {
      logger.warn(`Config not found for sync counter: ${configId}`, {
        label: 'Collection Utilities',
        configId,
      });
      return 0;
    }

    // Get sync counter from config (with type assertion for extended properties)
    const extendedConfig = config as typeof config & { syncCounter?: number };
    return extendedConfig.syncCounter || 0;
  } catch (error) {
    logger.error(`Failed to get sync counter for ${configId}: ${error}`, {
      label: 'Collection Utilities',
      configId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Increment and persist the sync counter for a multi-source collection
 */
export function incrementCollectionSyncCounter(configId: string): number {
  try {
    const settings = getSettings();
    const collectionConfigs = settings.plex.collectionConfigs || [];

    const configIndex = collectionConfigs.findIndex((c) => c.id === configId);
    if (configIndex < 0) {
      logger.warn(`Config not found for sync counter increment: ${configId}`, {
        label: 'Collection Utilities',
        configId,
      });
      return 0;
    }

    const existingConfig = collectionConfigs[configIndex];

    // Get current counter and increment (with type assertion for extended properties)
    const extendedConfig = existingConfig as typeof existingConfig & {
      syncCounter?: number;
    };
    const newCounter = (extendedConfig.syncCounter || 0) + 1;

    // Update config with new counter
    const updatedConfig = {
      ...existingConfig,
      syncCounter: newCounter,
    };

    // Save updated config
    collectionConfigs[configIndex] = updatedConfig;
    settings.plex.collectionConfigs = collectionConfigs;
    settings.save();

    logger.debug(`Incremented sync counter for ${configId}: ${newCounter}`, {
      label: 'Collection Utilities',
      configId,
      syncCounter: newCounter,
    });

    return newCounter;
  } catch (error) {
    logger.error(`Failed to increment sync counter for ${configId}: ${error}`, {
      label: 'Collection Utilities',
      configId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
