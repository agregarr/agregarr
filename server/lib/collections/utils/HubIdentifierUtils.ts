/**
 * Centralized utility for parsing and handling Plex hub identifiers
 *
 * Hub identifiers come in two forms:
 * 1. Built-in hubs: "movie.recentlyadded", "tv.recentlyadded" (shared across libraries)
 * 2. Custom collections: "custom.collection.{libraryId}.{ratingKey}" (library-specific)
 *
 * The key insight: Built-in hub identifiers like "movie.recentlyadded" appear
 * in MULTIPLE libraries (both 4K and non-4K movies), so we must always combine
 * with libraryId to create unique hub configs.
 */

export interface ParsedHubIdentifier {
  /** Original hub identifier from Plex */
  hubIdentifier: string;

  /** Library ID this hub belongs to */
  libraryId: string;

  /** Unique ID combining library and hub identifier */
  uniqueId: string;

  /** Whether this is a built-in Plex hub (vs custom collection) */
  isBuiltIn: boolean;

  /** Whether this is a custom collection promoted to hub */
  isCustomCollection: boolean;

  /** Rating key for custom collections (undefined for built-in hubs) */
  ratingKey?: string;

  /** Library ID extracted from custom collection identifier (for validation) */
  extractedLibraryId?: string;

  /** Media type inferred from identifier */
  mediaType: 'movie' | 'tv' | 'unknown';
}

/**
 * Parse a Plex hub identifier and extract all relevant information
 * Can handle:
 * - Built-in hubs: "movie.recentlyadded", "tv.ondeck"
 * - Custom collection hubs: "custom.collection.1.35954"
 * - Raw rating keys: "35954" (for non-promoted collections)
 */
export function parseHubIdentifier(
  hubIdentifier: string,
  libraryId: string
): ParsedHubIdentifier {
  // Determine what type of identifier this is
  const isCustomCollection = hubIdentifier.startsWith('custom.collection.');
  const isBuiltInHub = hubIdentifier.includes('.') && !isCustomCollection;
  const isRawRatingKey = !isCustomCollection && !isBuiltInHub;

  // Determine the rating key or hub identifier for the unified ID
  let ratingKeyOrHubId: string;

  if (isCustomCollection) {
    // Extract rating key from custom.collection.{libraryId}.{ratingKey}
    const parts = hubIdentifier.split('.');
    ratingKeyOrHubId = parts.length >= 4 ? parts[3] : hubIdentifier;
  } else {
    // For built-in hubs or raw rating keys, use as-is
    ratingKeyOrHubId = hubIdentifier;
  }

  const uniqueId = generateUnifiedId(libraryId, ratingKeyOrHubId);
  const isBuiltIn = isBuiltInHub;

  let ratingKey: string | undefined;
  let extractedLibraryId: string | undefined;

  // Parse different identifier types
  if (isCustomCollection) {
    // Parse custom collection identifiers: "custom.collection.1.35954"
    const parts = hubIdentifier.split('.');
    if (parts.length >= 4) {
      extractedLibraryId = parts[2];
      ratingKey = parts[3];
    }
  } else if (isRawRatingKey) {
    // Raw rating key for non-promoted collections
    ratingKey = hubIdentifier;
  }

  // Infer media type from identifier
  let mediaType: 'movie' | 'tv' | 'unknown' = 'unknown';
  if (isBuiltInHub) {
    if (hubIdentifier.startsWith('movie.')) {
      mediaType = 'movie';
    } else if (hubIdentifier.startsWith('tv.')) {
      mediaType = 'tv';
    }
  }
  // Collections (custom or raw rating key) don't have media type in identifier
  // This will need to be determined from library type

  return {
    hubIdentifier,
    libraryId,
    uniqueId,
    isBuiltIn,
    isCustomCollection: isCustomCollection || isRawRatingKey, // Both promoted and non-promoted collections
    ratingKey,
    extractedLibraryId,
    mediaType,
  };
}

/**
 * Generate a unified identifier for any hub or collection
 * Format: {libraryId}:{ratingKey|hubIdentifier}
 * Examples: "1:35954", "2:movie.recentlyadded"
 */
export function generateUnifiedId(
  libraryId: string,
  ratingKeyOrHubId: string
): string {
  return `${libraryId}:${ratingKeyOrHubId}`;
}

/**
 * Parse a unified identifier back to its components
 * Input: "1:35954" or "2:movie.recentlyadded"
 * Output: { libraryId: "1", ratingKeyOrHubId: "35954" }
 */
export function parseUnifiedId(
  unifiedId: string
): { libraryId: string; ratingKeyOrHubId: string } | null {
  const parts = unifiedId.split(':');
  if (parts.length !== 2) {
    return null;
  }
  return {
    libraryId: parts[0],
    ratingKeyOrHubId: parts[1],
  };
}

/**
 * Extract rating key from a custom collection hub identifier
 * Input: "custom.collection.1.35954"
 * Output: "35954"
 */
export function extractRatingKeyFromHubIdentifier(
  hubIdentifier: string
): string | null {
  if (!hubIdentifier.startsWith('custom.collection.')) {
    return null;
  }

  const parts = hubIdentifier.split('.');
  if (parts.length >= 4) {
    return parts[3];
  }

  return null;
}

/**
 * Extract library ID from a custom collection hub identifier
 * Input: "custom.collection.1.35954"
 * Output: "1"
 */
export function extractLibraryIdFromHubIdentifier(
  hubIdentifier: string
): string | null {
  if (!hubIdentifier.startsWith('custom.collection.')) {
    return null;
  }

  const parts = hubIdentifier.split('.');
  if (parts.length >= 3) {
    return parts[2];
  }

  return null;
}

/**
 * Check if a hub identifier represents a built-in Plex hub
 * Built-in hubs: "movie.recentlyadded", "tv.recentlyadded", etc.
 * Custom collections: "custom.collection.1.35954"
 */
export function isBuiltInHub(hubIdentifier: string): boolean {
  return !hubIdentifier.startsWith('custom.collection.');
}

/**
 * Check if a hub identifier represents a custom collection
 */
export function isCustomCollectionHub(hubIdentifier: string): boolean {
  return hubIdentifier.startsWith('custom.collection.');
}

/**
 * Validate that a custom collection hub identifier is well-formed
 * Expected format: "custom.collection.{libraryId}.{ratingKey}"
 */
export function validateCustomCollectionIdentifier(hubIdentifier: string): {
  isValid: boolean;
  libraryId?: string;
  ratingKey?: string;
  error?: string;
} {
  if (!hubIdentifier.startsWith('custom.collection.')) {
    return {
      isValid: false,
      error: 'Not a custom collection identifier',
    };
  }

  const parts = hubIdentifier.split('.');
  if (parts.length < 4) {
    return {
      isValid: false,
      error: 'Custom collection identifier must have at least 4 parts',
    };
  }

  const libraryId = parts[2];
  const ratingKey = parts[3];

  if (!libraryId || !ratingKey) {
    return {
      isValid: false,
      error: 'Library ID and rating key must be non-empty',
    };
  }

  return {
    isValid: true,
    libraryId,
    ratingKey,
  };
}

/**
 * Build a custom collection hub identifier from components
 * Input: libraryId="1", ratingKey="35954"
 * Output: "custom.collection.1.35954"
 */
export function buildCustomCollectionIdentifier(
  libraryId: string,
  ratingKey: string
): string {
  return `custom.collection.${libraryId}.${ratingKey}`;
}

/**
 * Get user-friendly display name for common built-in hub identifiers
 */
export function getBuiltInHubDisplayName(hubIdentifier: string): string | null {
  const displayNames: Record<string, string> = {
    'movie.recentlyadded': 'Recently Added Movies',
    'movie.recentlyreleased': 'Recently Released Movies',
    'movie.curated': 'Seasonal Movies',
    'movie.topunwatched': 'Top Unwatched Movies',
    'movie.recentlyviewed': 'Recently Watched Movies',
    'movie.genre': 'Top Movies in (Genre)',
    'movie.by.actor.or.director': 'Top Movies by (Actor or Director)',
    'tv.recentlyadded': 'Recently Added TV',
    'tv.recentlyaired': 'Recently Released Episodes',
    'tv.startwatching': 'Start Watching',
    'tv.rediscover': 'Rediscover',
    'tv.toprated': 'Top Rated TV',
    'tv.recentlyviewed': 'Recently Watched Episodes',
    'tv.morefromnetwork': 'More from (Network)',
    'tv.moreingenre': 'More in (Genre)',
    'recent.library.playlists': 'Library Playlists',
  };

  return displayNames[hubIdentifier] || null;
}

/**
 * Check if two hub identifiers conflict (same identifier, different libraries)
 * This helps identify cases where built-in hubs appear in multiple libraries
 */
export function doHubIdentifiersConflict(
  hub1: { hubIdentifier: string; libraryId: string },
  hub2: { hubIdentifier: string; libraryId: string }
): boolean {
  return (
    hub1.hubIdentifier === hub2.hubIdentifier &&
    hub1.libraryId !== hub2.libraryId
  );
}

/**
 * Group hub configs by their base identifier to identify conflicts
 * Useful for detecting built-in hubs that appear across multiple libraries
 */
export function groupHubsByIdentifier<
  T extends { hubIdentifier: string; libraryId: string }
>(hubs: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const hub of hubs) {
    const existing = groups.get(hub.hubIdentifier) || [];
    existing.push(hub);
    groups.set(hub.hubIdentifier, existing);
  }

  return groups;
}

/**
 * Find hub configs that have conflicting identifiers (same identifier, different libraries)
 */
export function findConflictingHubs<
  T extends { hubIdentifier: string; libraryId: string }
>(hubs: T[]): { identifier: string; conflicts: T[] }[] {
  const groups = groupHubsByIdentifier(hubs);
  const conflicts: { identifier: string; conflicts: T[] }[] = [];

  for (const [identifier, hubList] of groups.entries()) {
    if (hubList.length > 1) {
      conflicts.push({
        identifier,
        conflicts: hubList,
      });
    }
  }

  return conflicts;
}

/**
 * Hub discovery categorization utilities
 */

import { parseConfigIdFromLabel } from '@server/lib/collections/core/CollectionUtilities';
import { CollectionType } from '@server/lib/settings';
import { IdGenerator } from '@server/utils/idGenerator';

export interface HubCategorizationResult {
  collectionType: CollectionType;
  matchedConfig?: { id: number | string; name: string };
}

/**
 * Categorize a discovered hub or collection item
 * Centralizes the categorization logic used in hub discovery
 */
export function categorizeDiscoveredItem(
  parsedHub: ParsedHubIdentifier,
  collectionConfigs: {
    id: number | string;
    name: string;
    collectionRatingKey?: string;
    libraryId: string;
  }[],
  libraryId: string,
  collectionLabels?: (string | { tag: string })[]
): HubCategorizationResult {
  // Built-in Plex hubs are always default hubs
  if (parsedHub.isBuiltIn) {
    return {
      collectionType: CollectionType.DEFAULT_PLEX_HUB,
    };
  }

  // Custom collections - check if they're Agregarr-managed
  if (parsedHub.isCustomCollection && parsedHub.ratingKey) {
    // First try to match by rating key
    let matchedConfig = collectionConfigs.find(
      (config) =>
        config.collectionRatingKey === parsedHub.ratingKey &&
        config.libraryId === libraryId
    );

    // If no rating key match and we have labels, try label-based matching
    if (!matchedConfig && collectionLabels) {
      // Extract config IDs from labels
      const configIdsFromLabels = collectionLabels
        .map((label) => {
          const labelText = typeof label === 'string' ? label : label.tag;
          return parseConfigIdFromLabel(labelText);
        })
        .filter(Boolean) as string[];

      // Find matching config by ID
      if (configIdsFromLabels.length > 0) {
        matchedConfig = collectionConfigs.find(
          (config) =>
            configIdsFromLabels.includes(String(config.id)) &&
            config.libraryId === libraryId
        );
      }
    }

    return {
      collectionType: matchedConfig
        ? CollectionType.AGREGARR_CREATED
        : CollectionType.PRE_EXISTING,
      matchedConfig: matchedConfig
        ? { id: matchedConfig.id, name: matchedConfig.name }
        : undefined,
    };
  }

  // Non-promoted collections - check by labels
  if (collectionLabels) {
    const isAgregarrManaged = collectionLabels.some((label) => {
      const labelText = typeof label === 'string' ? label : label.tag;
      return labelText.toLowerCase().startsWith('agregarr');
    });

    return {
      collectionType: isAgregarrManaged
        ? CollectionType.AGREGARR_CREATED
        : CollectionType.PRE_EXISTING,
    };
  }

  // Unknown/unexpected hub type - assume pre-existing
  return {
    collectionType: CollectionType.PRE_EXISTING,
  };
}

/**
 * Create a standardized hub config object from discovery data
 */
export function createHubConfigFromDiscovery(
  parsedHub: ParsedHubIdentifier,
  hubData: {
    title?: string;
    promotedToSharedHome?: boolean;
    promotedToOwnHome?: boolean;
    promotedToRecommended?: boolean;
  },
  library: {
    key: string;
    title: string;
    type: string;
  },
  sortOrder: {
    library: number;
    home: number;
  },
  categorization: HubCategorizationResult
) {
  // Get display name using centralized utility or fallback to hub title
  const displayName =
    getBuiltInHubDisplayName(parsedHub.hubIdentifier) ||
    hubData.title ||
    parsedHub.hubIdentifier;

  // Determine media type from parsed data or library type
  const mediaType: 'movie' | 'tv' =
    parsedHub.mediaType !== 'unknown'
      ? parsedHub.mediaType
      : library.type === 'movie'
      ? 'movie'
      : 'tv';

  return {
    id: parsedHub.uniqueId,
    hubIdentifier: parsedHub.hubIdentifier,
    name: displayName,
    libraryId: library.key,
    libraryName: library.title,
    mediaType,
    sortOrderLibrary: sortOrder.library,
    sortOrderHome:
      hubData.promotedToSharedHome ||
      hubData.promotedToOwnHome ||
      hubData.promotedToRecommended
        ? sortOrder.home
        : 0, // 0 for void if not visible on any home/recommended screen
    isLibraryPromoted: false, // Hubs start in A-Z section (though they use different ordering logic)
    everLibraryPromoted: false, // Default: false for all discovered hubs
    collectionType: categorization.collectionType,
    // Set initial promotion status: default hubs always promoted, others calculated
    isPromotedToHub:
      categorization.collectionType === CollectionType.DEFAULT_PLEX_HUB,
    visibilityConfig: {
      usersHome: hubData.promotedToSharedHome || false,
      serverOwnerHome: hubData.promotedToOwnHome || false,
      libraryRecommended: hubData.promotedToRecommended || false,
    },
    // isActive field omitted - will be set server-side when saving
  };
}

/**
 * Create a pre-existing collection config from discovery data
 * This is specifically for collections discovered from Plex collections API
 */
export function createPreExistingConfigFromDiscovery(
  ratingKey: string,
  collectionData: {
    title: string;
    titleSort?: string;
    promotedToSharedHome?: boolean;
    promotedToOwnHome?: boolean;
    promotedToRecommended?: boolean;
  },
  library: {
    key: string;
    title: string;
    type: string;
  },
  sortOrder: {
    library: number;
    home: number;
  },
  mediaType?: 'movie' | 'tv'
) {
  // Determine media type from library type
  const detectedMediaType: 'movie' | 'tv' =
    mediaType || (library.type === 'movie' ? 'movie' : 'tv');

  const config = {
    id: IdGenerator.generateId(),
    collectionRatingKey: ratingKey,
    name: collectionData.title,
    libraryId: library.key,
    libraryName: library.title,
    mediaType: detectedMediaType,
    titleSort: collectionData.titleSort, // Preserve titleSort for alphabetical sorting
    sortOrderLibrary: 0, // All discovered collections start in A-Z section with sortOrderLibrary: 0
    sortOrderHome:
      collectionData.promotedToSharedHome ||
      collectionData.promotedToOwnHome ||
      collectionData.promotedToRecommended
        ? sortOrder.home
        : 0, // 0 for void if not visible on any home/recommended screen
    isLibraryPromoted: false, // All discovered collections start in A-Z section
    everLibraryPromoted: false, // Default: false for all discovered collections
    collectionType: CollectionType.PRE_EXISTING,
    visibilityConfig: {
      usersHome: collectionData.promotedToSharedHome || false,
      serverOwnerHome: collectionData.promotedToOwnHome || false,
      libraryRecommended: collectionData.promotedToRecommended || false,
    },
    // isActive field omitted - will be set server-side when saving
  };

  return config;
}

/**
 * Log discovery result in a standardized format
 * Note: This function takes a logger parameter to avoid importing logger dependency
 */
export function logDiscoveryResult(
  categorization: HubCategorizationResult,
  hubData: { title?: string; identifier?: string },
  parsedHub: ParsedHubIdentifier,
  logger: { info: (message: string, meta: Record<string, unknown>) => void },
  collectionConfigs?: { name: string; template?: string }[]
): void {
  if (
    categorization.collectionType === CollectionType.AGREGARR_CREATED &&
    categorization.matchedConfig
  ) {
    logger.info(
      `Found Agregarr-managed collection promoted to hub: ${hubData.title}`,
      {
        label: 'Hub Discovery',
        identifier: hubData.identifier || parsedHub.hubIdentifier,
        ratingKey: parsedHub.ratingKey,
        collectionId: categorization.matchedConfig.id,
        collectionName: categorization.matchedConfig.name,
        hasRatingKey: !!parsedHub.ratingKey,
      }
    );
  } else if (
    parsedHub.isCustomCollection &&
    categorization.collectionType === CollectionType.PRE_EXISTING
  ) {
    logger.info(
      `Found pre-existing collection promoted to hub: ${hubData.title}`,
      {
        label: 'Hub Discovery',
        identifier: hubData.identifier || parsedHub.hubIdentifier,
        ratingKey: parsedHub.ratingKey,
        note: 'No matching Agregarr collection config found',
        totalConfigs: collectionConfigs?.length || 0,
        configNames:
          collectionConfigs?.map((c) => c.name || c.template || 'unnamed') ||
          [],
      }
    );
  }
}
