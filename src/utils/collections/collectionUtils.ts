import type {
  CollectionFormConfig,
  CustomSyncSchedule,
  Library,
} from '@app/types/collections';
import { SYNC_SCHEDULE_PRESETS } from '@app/types/collections';

/**
 * Frontend utility functions for collection configuration management
 */

/**
 * Group collection configurations by library for UI display
 *
 * This function groups both regular configs and expanded configs by library,
 * ensuring proper display in the library-grouped UI.
 */
export function groupConfigsByLibrary(
  configs: CollectionFormConfig[],
  libraries: Library[],
  activeTab:
    | 'home'
    | 'recommended'
    | 'library'
    | 'inactive'
    | 'unmanaged' = 'home'
): Map<string, CollectionFormConfig[]> {
  const libraryGroups = new Map<string, CollectionFormConfig[]>();

  // First, handle configs with specific library IDs
  for (const config of configs) {
    // Each config now has a single libraryId
    const libraryId = config.libraryId;
    if (!libraryId) continue; // Skip configs without library ID

    if (!libraryGroups.has(libraryId)) {
      libraryGroups.set(libraryId, []);
    }

    const libraryConfigs = libraryGroups.get(libraryId);
    if (libraryConfigs) {
      libraryConfigs.push(config);
    }
  }

  // Sort configurations within each library by the appropriate sort order based on active tab
  for (const [libraryId, libraryConfigs] of Array.from(
    libraryGroups.entries()
  )) {
    libraryConfigs.sort((a: CollectionFormConfig, b: CollectionFormConfig) => {
      let aSortOrder: number;
      let bSortOrder: number;

      if (activeTab === 'library') {
        aSortOrder = a.sortOrderLibrary ?? 0; // Keep 0 for A-Z section
        bSortOrder = b.sortOrderLibrary ?? 0; // Keep 0 for A-Z section
      } else {
        aSortOrder = a.sortOrderHome ?? 1; // 1+ for positioned, 0 for void
        bSortOrder = b.sortOrderHome ?? 1; // 1+ for positioned, 0 for void
      }

      return aSortOrder - bSortOrder;
    });
    libraryGroups.set(libraryId, libraryConfigs);
  }

  return libraryGroups;
}

/**
 * Update collection configurations after reordering within a library
 */
export function updateConfigsAfterReorder(
  originalConfigs: CollectionFormConfig[],
  libraryId: string,
  reorderedConfigs: CollectionFormConfig[]
): CollectionFormConfig[] {
  const updatedConfigs = [...originalConfigs];

  // Update the original configs with new sort orders
  for (const reorderedConfig of reorderedConfigs) {
    let originalIndex = -1;

    // Find the matching original config
    originalIndex = updatedConfigs.findIndex((config) => {
      // Simple exact match by composite key
      return config.id === reorderedConfig.id;
    });

    if (originalIndex !== -1) {
      const originalConfig = updatedConfigs[originalIndex];
      const updatedConfig = { ...originalConfig };

      // Simple update for single-library configs
      if (reorderedConfig.sortOrderHome !== undefined) {
        updatedConfig.sortOrderHome = reorderedConfig.sortOrderHome;
      }

      if (reorderedConfig.sortOrderLibrary !== undefined) {
        updatedConfig.sortOrderLibrary = reorderedConfig.sortOrderLibrary;
      }

      updatedConfigs[originalIndex] = updatedConfig;
    }
  }

  return updatedConfigs;
}

/**
 * Convert between frontend display configs and backend storage configs
 */
export function normalizeConfigsForStorage(
  configs: CollectionFormConfig[]
): CollectionFormConfig[] {
  // Remove any UI-specific properties and ensure proper structure
  const normalized = configs.map((config) => ({
    ...config,
    // Ensure sort orders are properly set
    sortOrderHome: config.sortOrderHome ?? 1, // 1+ for positioned, 0 for void
    sortOrderLibrary: config.sortOrderLibrary ?? 0, // Keep 0 for A-Z section
  }));

  return normalized;
}

/**
 * Check if a library is compatible with the specified media type
 */
function isLibraryCompatible(library: Library, mediaType?: string): boolean {
  if (!mediaType) {
    return true; // No media type restriction
  }

  if (mediaType === 'movie' && library.type === 'movie') {
    return true;
  }

  if (mediaType === 'tv' && library.type === 'show') {
    return true;
  }

  return false;
}

/**
 * Get libraries that are compatible with a media type
 */
export function getCompatibleLibraries(
  libraries: Library[],
  mediaType?: string
): Library[] {
  if (!mediaType) {
    return libraries; // No restriction, show all libraries
  }

  return libraries.filter((library) => isLibraryCompatible(library, mediaType));
}

/**
 * Generate a consistent color for All Libraries badge based on collection name
 */
export function getAllLibrariesBadgeColor(
  config: CollectionFormConfig
): string {
  // Generate consistent colors based on config name
  const colors = [
    'bg-orange-500/40 text-orange-200',
    'bg-orange-600/40 text-orange-200',
    'bg-green-500/40 text-green-200',
    'bg-orange-400/40 text-orange-200',
    'bg-pink-500/40 text-pink-200',
    'bg-orange-400/40 text-orange-200',
    'bg-red-500/40 text-red-200',
    'bg-orange-400/40 text-orange-200',
    'bg-orange-500/40 text-orange-200',
    'bg-cyan-500/40 text-cyan-200',
  ];

  // Generate hash from config name
  const nameHash = config.name
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[nameHash % colors.length];
}

/**
 * Check if a config is part of a linked collection group
 * (multiple collections with same type/subtype, regardless of library selection method)
 */
export function isLinkedCollection(
  config: CollectionFormConfig,
  originalConfigs: CollectionFormConfig[]
): boolean {
  // If this config is explicitly unlinked, it's not considered linked
  if (config.isUnlinked) {
    return false;
  }

  // If this config is not actively linked, it's not linked
  if (!config.isLinked) {
    return false;
  }

  // If this config doesn't have a group ID, it's not linked
  if (!config.linkId || config.linkId <= 0) {
    return false;
  }

  // A config is "linked" if there are other configs with the same group ID that are also actively linked
  const sameGroupConfigs = originalConfigs.filter(
    (orig) =>
      orig.type === config.type &&
      orig.subtype === config.subtype &&
      orig.linkId === config.linkId && // Same group ID
      orig.isLinked && // Must be actively linked
      !orig.isUnlinked &&
      orig.id !== config.id // Don't count itself
  );

  return sameGroupConfigs.length > 0;
}

/**
 * Validate that a configuration has all required fields for the new system
 */
export function validateCollectionFormConfig(
  config: CollectionFormConfig
): string[] {
  const errors: string[] = [];

  if (!config.name?.trim()) {
    errors.push('Collection name is required');
  }

  if (!config.type) {
    errors.push('Collection type is required');
  }

  // Subtype not required for multi-source, tag-based, or recently_added collections
  if (
    !config.subtype &&
    config.type !== 'multi-source' &&
    config.type !== 'radarrtag' &&
    config.type !== 'sonarrtag' &&
    config.type !== 'recently_added'
  ) {
    errors.push('Collection subtype is required');
  }

  if (!config.template?.trim()) {
    errors.push('Collection template is required');
  }

  if (config.maxItems !== undefined && config.maxItems <= 0) {
    errors.push('Max items must be greater than 0');
  }

  if (
    config.type === 'tautulli' &&
    (!config.customDays || config.customDays <= 0)
  ) {
    errors.push('Custom days is required for Tautulli collections');
  }

  if (
    config.type === 'trakt' &&
    config.subtype === 'custom_list' &&
    !config.traktCustomListUrl?.trim()
  ) {
    errors.push(
      'Trakt custom list URL is required for custom list collections'
    );
  }

  if (
    config.type === 'letterboxd' &&
    config.subtype === 'custom' &&
    !config.letterboxdCustomListUrl?.trim()
  ) {
    errors.push(
      'Letterboxd custom list URL is required for custom list collections'
    );
  }

  return errors;
}

/**
 * Universal linked config preparation for editing across all collection types
 * Works with CollectionFormConfig, PlexHubConfig, and PreExistingCollectionConfig
 */
export const prepareLinkedConfigForEditing = <
  T extends {
    id: string;
    libraryId: string;
    libraryName: string;
    linkId?: number;
    isLinked?: boolean;
    isUnlinked?: boolean;
    customPoster?: string | Record<string, string>;
  }
>(
  config: T,
  allConfigs: T[]
): T & { libraryIds?: string[]; libraryNames?: string[] } => {
  // Check if this config is linked to others with the same linkId
  const linkedConfigs =
    config.isLinked && config.linkId
      ? allConfigs.filter(
          (c) =>
            c.linkId === config.linkId && // Same linkId group
            c.isLinked && // Must also be actively linked
            !c.isUnlinked && // Exclude unlinked configs
            c.id !== config.id // Don't include the current config
        )
      : [];

  if (linkedConfigs.length > 0) {
    // This is a linked config - prepare for linked editing
    const allLinkedConfigs = [config, ...linkedConfigs];
    const allLibraryIds = allLinkedConfigs.map((c) => c.libraryId);
    const allLibraryNames = allLinkedConfigs.map((c) => c.libraryName);

    // Create per-library poster mapping from all linked configs
    const customPosterMapping: Record<string, string> = {};
    for (const linkedConfig of allLinkedConfigs) {
      if (
        linkedConfig.customPoster &&
        typeof linkedConfig.customPoster === 'string' &&
        linkedConfig.customPoster.trim()
      ) {
        customPosterMapping[linkedConfig.libraryId] = linkedConfig.customPoster;
      }
    }

    const linkedConfigForEditing = {
      ...config,
      libraryIds: allLibraryIds,
      libraryNames: allLibraryNames,
      // Use per-library poster mapping instead of single poster from primary config
      customPoster:
        Object.keys(customPosterMapping).length > 0 ? customPosterMapping : {},
    };

    return linkedConfigForEditing;
  } else {
    return config;
  }
};

/**
 * Format custom sync schedule for badge display
 */
export function formatSyncScheduleBadge(
  customSyncSchedule?: CustomSyncSchedule
): string | null {
  if (!customSyncSchedule?.enabled) {
    return null; // No badge when sync schedule is disabled
  }

  if (
    customSyncSchedule.scheduleType === 'preset' &&
    customSyncSchedule.preset
  ) {
    // Find the matching preset
    const preset = SYNC_SCHEDULE_PRESETS.find(
      (p) => p.key === customSyncSchedule.preset
    );
    if (preset) {
      // Convert preset label to badge format
      // "Every 2 hours" -> "Sync: 2 hourly"
      // "Once daily" -> "Sync: 1 daily"
      // "Once weekly" -> "Sync: 1 weekly"
      // "Once yearly" -> "Sync: 1 yearly"
      const label = preset.label.toLowerCase();

      if (label.includes('every') && label.includes('hour')) {
        const match = label.match(/every (\d+) hours?/);
        return match ? `Sync: ${match[1]} hourly` : 'Sync: hourly';
      }

      if (label.includes('every') && label.includes('minute')) {
        const match = label.match(/every (\d+) minutes?/);
        return match ? `Sync: ${match[1]} min` : 'Sync: minutes';
      }

      if (label.includes('every') && label.includes('day')) {
        const match = label.match(/every (\d+) days?/);
        return match ? `Sync: ${match[1]} daily` : 'Sync: daily';
      }

      if (label.includes('every') && label.includes('week')) {
        const match = label.match(/every (\d+) weeks?/);
        return match ? `Sync: ${match[1]} weekly` : 'Sync: weekly';
      }

      if (label.includes('every') && label.includes('month')) {
        const match = label.match(/every (\d+) months?/);
        return match ? `Sync: ${match[1]} monthly` : 'Sync: monthly';
      }

      if (label.includes('once daily')) {
        return 'Sync: 1 daily';
      }

      if (label.includes('once weekly')) {
        return 'Sync: 1 weekly';
      }

      if (label.includes('once monthly')) {
        return 'Sync: 1 monthly';
      }

      if (label.includes('once yearly')) {
        return 'Sync: 1 yearly';
      }

      // Fallback for other preset formats
      return `Sync: ${preset.label}`;
    }
  }

  if (
    customSyncSchedule.scheduleType === 'custom' &&
    customSyncSchedule.customCron
  ) {
    // For custom cron, just show "Sync: Custom"
    return 'Sync: Custom';
  }

  // Fallback
  return 'Sync: Custom';
}
