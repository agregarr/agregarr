import type PlexAPI from '@server/api/plexapi';
import { extractErrorMessage } from '@server/lib/collections/core/CollectionUtilities';
import logger from '@server/logger';

/**
 * Unified ordering service for collections and hubs
 * Handles conversion between UI ordering and Plex identifiers
 */

export interface OrderingItem {
  id: number | string;
  type: 'collection' | 'hub';
  libraryId: string;
  collectionRatingKey?: string; // For collections
  hubIdentifier?: string; // For hubs (e.g., "movie.recentlyadded")
  sortOrder: number;
}

export interface PlexOrderingItem {
  identifier: string; // Plex identifier for reordering
  libraryId: string;
  sortOrder: number;
}

/**
 * Convert UI ordering items to Plex identifiers for reordering API
 */
export function convertUIOrderingToPlexIdentifiers(
  orderingItems: OrderingItem[]
): PlexOrderingItem[] {
  const plexItems: PlexOrderingItem[] = [];

  for (const item of orderingItems) {
    let identifier: string;

    if (item.type === 'hub') {
      // Hub: handle both built-in hubs and raw rating keys
      if (!item.hubIdentifier) {
        logger.warn(`Hub item ${item.id} missing hubIdentifier, skipping`, {
          label: 'Unified Ordering',
        });
        continue;
      }

      // Check if this is a raw rating key (just numbers) that needs conversion
      if (/^\d+$/.test(item.hubIdentifier)) {
        // Raw rating key for non-promoted collection - convert to proper format
        identifier = `custom.collection.${item.libraryId}.${item.hubIdentifier}`;
        logger.debug(
          `Converting raw rating key to proper format: ${item.hubIdentifier} -> ${identifier}`,
          {
            label: 'Unified Ordering',
            hubId: item.id,
            libraryId: item.libraryId,
          }
        );
      } else {
        // Built-in hub identifier - use directly (e.g., "movie.recentlyadded")
        identifier = item.hubIdentifier;
      }
    } else {
      // Collection: use custom collection format "custom.collection.{libraryId}.{collectionRatingKey}"
      if (!item.collectionRatingKey) {
        logger.warn(
          `Collection item ${item.id} missing collectionRatingKey, skipping`,
          {
            label: 'Unified Ordering',
          }
        );
        continue;
      }
      identifier = `custom.collection.${item.libraryId}.${item.collectionRatingKey}`;
    }

    plexItems.push({
      identifier,
      libraryId: item.libraryId,
      sortOrder: item.sortOrder,
    });
  }

  return plexItems;
}

/**
 * Apply unified ordering to Plex libraries
 */
export async function applyUnifiedOrderingToPlex(
  plexClient: PlexAPI,
  orderingItems: OrderingItem[]
): Promise<void> {
  try {
    // Convert UI ordering to Plex identifiers
    const plexItems = convertUIOrderingToPlexIdentifiers(orderingItems);

    // Group by library for efficient processing
    const itemsByLibrary = new Map<string, PlexOrderingItem[]>();

    for (const item of plexItems) {
      if (!itemsByLibrary.has(item.libraryId)) {
        itemsByLibrary.set(item.libraryId, []);
      }
      const libraryItems = itemsByLibrary.get(item.libraryId);
      if (libraryItems) {
        libraryItems.push(item);
      }
    }

    // Process each library
    for (const [libraryId, libraryItems] of itemsByLibrary) {
      // Sort items by their desired order
      const sortedItems = libraryItems.sort(
        (a, b) => a.sortOrder - b.sortOrder
      );

      // Extract identifiers in the desired order
      const orderedIdentifiers = sortedItems.map((item) => item.identifier);

      // Apply ordering using Plex hub reordering API
      await plexClient.reorderHubs(libraryId, orderedIdentifiers);
    }

    // Successfully applied unified ordering
  } catch (error) {
    logger.error(
      `Failed to apply unified ordering: ${extractErrorMessage(error)}`,
      {
        label: 'Unified Ordering',
        error: extractErrorMessage(error),
      }
    );
    throw error;
  }
}

/**
 * Generate placeholder collection identifier for collections not yet created
 * Format: "placeholder.collection.{configId}"
 */
export function generatePlaceholderCollectionIdentifier(
  configId: number | string
): string {
  return `placeholder.collection.${configId}`;
}

/**
 * Check if an identifier is a placeholder
 */
export function isPlaceholderIdentifier(identifier: string): boolean {
  return identifier.startsWith('placeholder.collection.');
}

/**
 * Extract config ID from placeholder identifier
 */
export function extractConfigIdFromPlaceholder(identifier: string): string {
  return identifier.replace('placeholder.collection.', '');
}
