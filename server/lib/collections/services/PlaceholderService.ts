/**
 * PlaceholderService - Centralized service for creating placeholders for missing items
 *
 * This service wraps the existing placeholder creation logic and makes it available
 * to any collection type that has `createPlaceholdersForMissing` enabled.
 */

import type PlexAPI from '@server/api/plexapi';
import type {
  CollectionItem,
  MissingItem,
  PlaceholderSourceData,
} from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

// Re-export the placeholder creation function from the existing implementation
// Re-export cleanup functions
export { cleanupReleasedPlaceholders } from '@server/lib/collections/external/comingsoon/comingSoonCleanup';
export { handlePlaceholderCreation } from '@server/lib/collections/external/comingsoon/comingSoonPlaceholders';

/**
 * Convert MissingItem array to PlaceholderSourceData array
 * This allows any collection type to provide placeholder metadata
 *
 * @param missingItems - Array of missing items from the collection
 * @param requireReleaseDates - If true, only include items with release date info (for Coming Soon).
 *                               If false, include all items (for normal collections)
 */
export function missingItemsToPlaceholderSourceData(
  missingItems: MissingItem[],
  requireReleaseDates = false
): PlaceholderSourceData[] {
  return missingItems
    .filter((item) => {
      // For normal collections, include all items
      if (!requireReleaseDates) {
        return true;
      }

      // For Coming Soon collections, only include items with release date info
      const hasReleaseDateInfo = !!(
        item.releaseDate ||
        item.digitalRelease ||
        item.physicalRelease ||
        item.airDate
      );
      return hasReleaseDateInfo;
    })
    .map((item) => ({
      tmdbId: item.tmdbId,
      tvdbId: item.tvdbId,
      title: item.title,
      year: item.year,
      releaseDate: item.releaseDate,
      digitalRelease: item.digitalRelease,
      physicalRelease: item.physicalRelease,
      inCinemas: item.inCinemas,
      airDate: item.airDate,
      mediaType: item.mediaType,
      source: item.source || 'tmdb',
      monitored: item.monitored ?? false,
      isEstimatedDate: item.isEstimatedDate,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      // These will be calculated during placeholder creation
      releaseDateSortValue: undefined,
      releaseType: undefined,
      hasFile: false,
      isReturning: false,
    }));
}

/**
 * Get effective overlay color from config (with backward compatibility)
 */
export function getOverlayColor(config: CollectionConfig): string {
  return (
    config.placeholderOverlayColor || config.comingSoonOverlayColor || '#C21807'
  );
}

/**
 * Get effective released days from config (with backward compatibility)
 */
export function getReleasedDays(config: CollectionConfig): number {
  return config.placeholderReleasedDays || config.comingSoonReleasedDays || 7;
}

/**
 * Get effective days ahead from config (with backward compatibility)
 */
export function getDaysAhead(config: CollectionConfig): number {
  return config.placeholderDaysAhead || config.comingSoonDays || 360;
}

/**
 * Check if a collection config has placeholder creation enabled
 */
export function isPlaceholderCreationEnabled(
  config: CollectionConfig
): boolean {
  return config.createPlaceholdersForMissing === true;
}

/**
 * Process missing items as placeholders for a collection
 * This is the main entry point for any collection type wanting to create placeholders
 */
export async function processPlaceholdersForMissingItems(
  missingItems: MissingItem[],
  config: CollectionConfig,
  plexClient: PlexAPI
): Promise<CollectionItem[]> {
  if (!isPlaceholderCreationEnabled(config)) {
    return [];
  }

  if (missingItems.length === 0) {
    return [];
  }

  // For normal collections (not Coming Soon), create placeholders for ALL missing items
  // For Coming Soon collections, only create placeholders for items with release dates
  const isComingSoonCollection = config.type === 'comingsoon';

  // Convert missing items to placeholder source data
  const sourceData = missingItemsToPlaceholderSourceData(
    missingItems,
    isComingSoonCollection // Only require release dates for Coming Soon collections
  );

  if (sourceData.length === 0) {
    const message = isComingSoonCollection
      ? 'No missing items have sufficient release date metadata for placeholder creation'
      : 'No missing items to create placeholders for';

    logger.info(message, {
      label: 'PlaceholderService',
      configName: config.name,
      originalCount: missingItems.length,
      collectionType: config.type,
    });
    return [];
  }

  logger.info('Creating placeholders for missing items', {
    label: 'PlaceholderService',
    configName: config.name,
    itemCount: sourceData.length,
    skippedNoReleaseDate: missingItems.length - sourceData.length,
    collectionType: config.type,
  });

  // Import and call the existing placeholder creation logic
  const { handlePlaceholderCreation } = await import(
    '@server/lib/collections/external/comingsoon/comingSoonPlaceholders'
  );

  // Filter missingItems to only those that have sourceData
  const tmdbIdsWithSourceData = new Set(sourceData.map((s) => s.tmdbId));
  const filteredMissingItems = missingItems.filter((item) =>
    tmdbIdsWithSourceData.has(item.tmdbId)
  );

  return handlePlaceholderCreation(
    filteredMissingItems,
    sourceData,
    config,
    plexClient
  );
}

export default {
  processPlaceholdersForMissingItems,
  missingItemsToPlaceholderSourceData,
  isPlaceholderCreationEnabled,
  getOverlayColor,
  getReleasedDays,
  getDaysAhead,
};
