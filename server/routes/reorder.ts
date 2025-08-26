import { defaultHubConfigService } from '@server/lib/collections/services/DefaultHubConfigService';
import { preExistingCollectionConfigService } from '@server/lib/collections/services/PreExistingCollectionConfigService';
import type {
  CollectionConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router, type Response } from 'express';

// Mixed item types from frontend (original config + metadata)
type MixedCollectionItem = (
  | CollectionConfig
  | PlexHubConfig
  | PreExistingCollectionConfig
) & {
  configType: 'collection' | 'hub' | 'preExisting';
};

// Type guards to validate config structure matches declared type
function isCollectionConfig(
  config: CollectionConfig | PlexHubConfig | PreExistingCollectionConfig
): config is CollectionConfig {
  return 'type' in config && 'subtype' in config && 'template' in config;
}

function isHubConfig(
  config: CollectionConfig | PlexHubConfig | PreExistingCollectionConfig
): config is PlexHubConfig {
  return 'hubIdentifier' in config;
}

function isPreExistingConfig(
  config: CollectionConfig | PlexHubConfig | PreExistingCollectionConfig
): config is PreExistingCollectionConfig {
  return 'collectionRatingKey' in config;
}

const reorderRoutes = Router();

/**
 * Determine if a collection/hub/pre-existing is visible in the given context
 * Checks visibility settings and active state based on time restrictions
 */
function isVisibleInContext(
  config: CollectionConfig | PlexHubConfig | PreExistingCollectionConfig,
  context: string
): boolean {
  // Check if collection is active (time restrictions)
  if (config.isActive === false) {
    return false;
  }

  // Check visibility settings based on context
  const visibilityConfig = config.visibilityConfig;
  if (!visibilityConfig) {
    return true; // Default to visible if no visibility config
  }

  switch (context) {
    case 'home':
      return visibilityConfig.usersHome || visibilityConfig.serverOwnerHome;
    case 'recommended':
      return visibilityConfig.libraryRecommended;
    case 'library':
      return visibilityConfig.libraryRecommended;
    default:
      return true;
  }
}

/**
 * POST /api/v1/reorder
 * Universal Sort Order Management API
 *
 * Handles both manual reordering (drag-drop) and automatic sort order management
 * for all collection types across all contexts (home/recommended/library).
 *
 * Features:
 * - Manual reordering with mixedItems array
 * - Auto-reordering mode for new collections, deletions, visibility changes
 * - Smart detection of undefined sort orders
 * - Gap filling after deletions
 * - Context-aware visibility filtering
 * - Sequential sort order assignment (0,1,2,3...)
 */
reorderRoutes.post('/', isAuthenticated(), async (req, res) => {
  try {
    const { libraryId, mixedItems, context, mode = 'manual' } = req.body;

    if (!libraryId || !context) {
      return res.status(400).json({
        error: 'Missing required fields: libraryId, context',
      });
    }

    if (!['home', 'recommended', 'library'].includes(context)) {
      return res.status(400).json({
        error: 'Invalid context. Must be one of: home, recommended, library',
      });
    }

    if (!['manual', 'auto'].includes(mode)) {
      return res.status(400).json({
        error: 'Invalid mode. Must be one of: manual, auto',
      });
    }

    // For manual mode, mixedItems is required
    if (mode === 'manual' && !Array.isArray(mixedItems)) {
      return res.status(400).json({
        error: 'mixedItems array required for manual reordering',
      });
    }

    const sortOrderField =
      context === 'home' || context === 'recommended'
        ? 'sortOrderHome'
        : 'sortOrderLibrary';

    // Handle auto-reordering mode - smart sort order management
    if (mode === 'auto') {
      return await handleAutoReordering(
        libraryId,
        context,
        sortOrderField,
        res
      );
    }

    // Handle manual reordering mode (existing logic)
    return await handleManualReordering(
      libraryId,
      mixedItems,
      context,
      sortOrderField,
      res
    );
  } catch (error) {
    logger.error('Failed to reorder items', {
      label: 'Universal Reorder API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to reorder items',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Handle automatic sort order management for all collection types
 * Assigns sequential sort orders, handles new collections, fills gaps
 */
async function handleAutoReordering(
  libraryId: string,
  context: string,
  sortOrderField: 'sortOrderHome' | 'sortOrderLibrary',
  res: Response
) {
  const result = await performAutoReordering(
    libraryId,
    context,
    sortOrderField
  );

  return res.status(200).json({
    success: true,
    message: `Successfully auto-reordered ${result.totalItemsReordered} items`,
    mode: 'auto',
    ...result,
  });
}

/**
 * Handle manual reordering (existing drag-drop functionality)
 */
async function handleManualReordering(
  libraryId: string,
  mixedItems: MixedCollectionItem[],
  context: string,
  sortOrderField: 'sortOrderHome' | 'sortOrderLibrary',
  res: Response
) {
  const settings = getSettings();
  let totalUpdated = 0;
  let finalCollectionConfigs: CollectionConfig[] | undefined;
  let finalHubConfigs: PlexHubConfig[] | undefined;
  let finalPreExistingConfigs: PreExistingCollectionConfig[] | undefined;

  // Split mixed items by type
  const collectionsToUpdate: CollectionConfig[] = [];
  const hubsToUpdate: PlexHubConfig[] = [];
  const preExistingToUpdate: PreExistingCollectionConfig[] = [];

  mixedItems.forEach((item: MixedCollectionItem, index) => {
    // Strip metadata and add sort order
    const { configType, ...originalConfig } = item;

    // Apply correct sort order logic based on context and collection type
    let sortOrder = index;

    // For Library context, respect the A-Z vs Promoted section design
    if (sortOrderField === 'sortOrderLibrary') {
      if (originalConfig.isLibraryPromoted === false) {
        sortOrder = 0; // A-Z section always gets 0
      } else {
        sortOrder = index + 1; // Promoted section starts from 1
      }
    } else {
      // For Home/Recommended contexts, start from 1 (0 is void value)
      sortOrder = index + 1;
    }

    const updatedConfig = { ...originalConfig, [sortOrderField]: sortOrder };

    // Set everLibraryPromoted: true when a collection is assigned to the promoted library section
    if (
      sortOrderField === 'sortOrderLibrary' &&
      originalConfig.isLibraryPromoted === true &&
      sortOrder > 0 &&
      configType === 'collection'
    ) {
      updatedConfig.everLibraryPromoted = true;
    }

    // Use type guards to ensure config matches declared type
    if (configType === 'collection' && isCollectionConfig(updatedConfig)) {
      collectionsToUpdate.push(updatedConfig);
    } else if (configType === 'hub' && isHubConfig(updatedConfig)) {
      hubsToUpdate.push(updatedConfig);
    } else if (
      configType === 'preExisting' &&
      isPreExistingConfig(updatedConfig)
    ) {
      preExistingToUpdate.push(updatedConfig);
    } else {
      logger.warn(
        `Skipping item with mismatched configType: declared='${configType}' but structure suggests different type`,
        {
          itemId: updatedConfig.id,
        }
      );
    }
  });

  // Process collections if any
  if (collectionsToUpdate.length > 0) {
    const allCollectionConfigs = settings.plex.collectionConfigs || [];

    // Get all items from other libraries
    const otherLibraryConfigs = allCollectionConfigs.filter(
      (config: CollectionConfig) => {
        const configLibraryId = Array.isArray(config.libraryId)
          ? config.libraryId[0]
          : config.libraryId;
        return configLibraryId !== libraryId;
      }
    );

    // Get hidden items from current library
    const visibleIds = new Set(collectionsToUpdate.map((item) => item.id));
    const hiddenCurrentLibraryConfigs = allCollectionConfigs.filter(
      (config: CollectionConfig) => {
        const configLibraryId = Array.isArray(config.libraryId)
          ? config.libraryId[0]
          : config.libraryId;
        return configLibraryId === libraryId && !visibleIds.has(config.id);
      }
    );

    // Combine visible + hidden and preserve original fields
    const allCurrentLibraryConfigs = [
      ...collectionsToUpdate,
      ...hiddenCurrentLibraryConfigs,
    ];
    const finalConfigs = allCurrentLibraryConfigs.map(
      (config: CollectionConfig, index: number) => {
        const originalConfig = allCollectionConfigs.find(
          (original) => original.id === config.id
        );
        return {
          ...(originalConfig || config),
          ...config,
          [sortOrderField]: config[sortOrderField] ?? index,
        };
      }
    );

    finalCollectionConfigs = [...otherLibraryConfigs, ...finalConfigs];
    totalUpdated += finalConfigs.length;
  }

  // Process hubs if any
  if (hubsToUpdate.length > 0) {
    const allHubConfigs = defaultHubConfigService.getConfigs();
    const otherLibraryHubs = allHubConfigs.filter(
      (config) => config.libraryId !== libraryId
    );

    const visibleIds = new Set(hubsToUpdate.map((item) => item.id));
    const hiddenCurrentLibraryHubs = allHubConfigs.filter(
      (config) => config.libraryId === libraryId && !visibleIds.has(config.id)
    );

    const allCurrentLibraryHubs = [
      ...hubsToUpdate,
      ...hiddenCurrentLibraryHubs,
    ];
    const finalHubs = allCurrentLibraryHubs.map(
      (config: PlexHubConfig, index: number) => {
        const originalConfig = allHubConfigs.find(
          (original) => original.id === config.id
        );
        return {
          ...(originalConfig || config),
          ...config,
          [sortOrderField]: config[sortOrderField] ?? index,
        };
      }
    );

    finalHubConfigs = [...otherLibraryHubs, ...finalHubs];
    totalUpdated += finalHubs.length;
  }

  // Process preexisting if any
  if (preExistingToUpdate.length > 0) {
    const allPreExistingConfigs =
      preExistingCollectionConfigService.getConfigs();
    const otherLibraryPreExisting = allPreExistingConfigs.filter(
      (config) => config.libraryId !== libraryId
    );

    const visibleIds = new Set(preExistingToUpdate.map((item) => item.id));
    const hiddenCurrentLibraryPreExisting = allPreExistingConfigs.filter(
      (config) => config.libraryId === libraryId && !visibleIds.has(config.id)
    );

    const allCurrentLibraryPreExisting = [
      ...preExistingToUpdate,
      ...hiddenCurrentLibraryPreExisting,
    ];
    const finalPreExisting = allCurrentLibraryPreExisting.map(
      (config: PreExistingCollectionConfig, index: number) => {
        const originalConfig = allPreExistingConfigs.find(
          (original) => original.id === config.id
        );
        return {
          ...(originalConfig || config),
          ...config,
          [sortOrderField]: config[sortOrderField] ?? index,
        };
      }
    );

    finalPreExistingConfigs = [...otherLibraryPreExisting, ...finalPreExisting];
    totalUpdated += finalPreExisting.length;
  }

  // Apply all changes to settings and save once
  if (finalCollectionConfigs) {
    settings.plex.collectionConfigs = finalCollectionConfigs;
  }
  if (finalHubConfigs) {
    settings.plex.hubConfigs = finalHubConfigs;
  }
  if (finalPreExistingConfigs) {
    settings.plex.preExistingCollectionConfigs = finalPreExistingConfigs;
  }

  // Single save operation for all changes
  if (finalCollectionConfigs || finalHubConfigs || finalPreExistingConfigs) {
    settings.save();
  }

  logger.info(`Manual reordering completed for library ${libraryId}`, {
    label: 'Universal Reorder API',
    libraryId,
    context,
    mode: 'manual',
    visibleItems: mixedItems.length,
    totalItemsProcessed: totalUpdated,
    collections: collectionsToUpdate.length,
    hubs: hubsToUpdate.length,
    preExisting: preExistingToUpdate.length,
  });

  return res.status(200).json({
    success: true,
    message: `Successfully reordered ${totalUpdated} items (${mixedItems.length} visible items affected)`,
    mode: 'manual',
    totalItemsProcessed: totalUpdated,
    collectionsUpdated: collectionsToUpdate.length,
    hubsUpdated: hubsToUpdate.length,
    preExistingUpdated: preExistingToUpdate.length,
  });
}

/**
 * Internal auto-reordering logic without response handling
 * Used by both HTTP endpoint and direct function calls
 */
async function performAutoReordering(
  libraryId: string,
  context: string,
  sortOrderField: 'sortOrderHome' | 'sortOrderLibrary'
): Promise<{
  totalItemsReordered: number;
  collectionsUpdated: number;
  hubsUpdated: number;
  preExistingUpdated: number;
}> {
  const settings = getSettings();

  // Get all collections from each service
  const allCollectionConfigs = settings.plex.collectionConfigs || [];
  const allHubConfigs = defaultHubConfigService.getConfigs();
  const allPreExistingConfigs = preExistingCollectionConfigService.getConfigs();

  // Filter to current library and determine visibility
  const libraryCollections = allCollectionConfigs.filter((config) => {
    // Multi-library collections should be included if they contain current library
    const belongsToCurrentLibrary = Array.isArray(config.libraryId)
      ? config.libraryId.includes(libraryId)
      : config.libraryId === libraryId;
    return belongsToCurrentLibrary && isVisibleInContext(config, context);
  });

  const libraryHubs = allHubConfigs.filter(
    (config) =>
      config.libraryId === libraryId && isVisibleInContext(config, context)
  );

  const libraryPreExisting = allPreExistingConfigs.filter(
    (config) =>
      config.libraryId === libraryId && isVisibleInContext(config, context)
  );

  // Combine all items for this library context
  const allLibraryItems = [
    ...libraryCollections.map((c) => ({
      ...c,
      configType: 'collection' as const,
    })),
    ...libraryHubs.map((h) => ({ ...h, configType: 'hub' as const })),
    ...libraryPreExisting.map((p) => ({
      ...p,
      configType: 'preExisting' as const,
    })),
  ];

  // Sort by current sort order, with undefined values treated as needing repositioning
  allLibraryItems.sort((a, b) => {
    const aSortOrder = a[sortOrderField];
    const bSortOrder = b[sortOrderField];

    // For promoted collections, sortOrderLibrary 0 should be treated as undefined
    // because 0 means A-Z section, but promoted collections should start from 1
    const aIsUndefined =
      aSortOrder === undefined ||
      (sortOrderField === 'sortOrderLibrary' &&
        a.isLibraryPromoted &&
        aSortOrder === 0);
    const bIsUndefined =
      bSortOrder === undefined ||
      (sortOrderField === 'sortOrderLibrary' &&
        b.isLibraryPromoted &&
        bSortOrder === 0);

    // New items (undefined sort order or promoted with 0) go to front
    if (aIsUndefined && !bIsUndefined) return -1;
    if (!aIsUndefined && bIsUndefined) return 1;
    if (aIsUndefined && bIsUndefined) return 0;

    return (aSortOrder as number) - (bSortOrder as number);
  });

  // Assign sequential sort orders with proper A-Z vs Promoted section logic
  const updatedItems = allLibraryItems.map((item, index) => {
    let newSortOrder = index;

    // For Library context, respect the A-Z vs Promoted section design:
    // - A-Z section (isLibraryPromoted: false) → sortOrderLibrary: 0
    // - Promoted section (isLibraryPromoted: true) → sortOrderLibrary: 1, 2, 3...
    if (sortOrderField === 'sortOrderLibrary') {
      if (item.isLibraryPromoted === false) {
        newSortOrder = 0; // A-Z section always gets 0
      } else {
        newSortOrder = index + 1; // Promoted section starts from 1
      }
    } else {
      // For Home/Recommended contexts, start from 1 (0 is void value)
      newSortOrder = index + 1;
    }

    const updatedItem = {
      ...item,
      [sortOrderField]: newSortOrder,
    };

    // Set everLibraryPromoted: true when a collection is assigned to the promoted library section
    if (
      sortOrderField === 'sortOrderLibrary' &&
      item.isLibraryPromoted === true &&
      newSortOrder > 0 &&
      item.configType === 'collection'
    ) {
      updatedItem.everLibraryPromoted = true;
    }

    return updatedItem;
  });

  // Apply updates back to their respective services
  let totalUpdated = 0;
  const collectionsToUpdate = updatedItems.filter(
    (item) => item.configType === 'collection'
  );
  const hubsToUpdate = updatedItems.filter((item) => item.configType === 'hub');
  const preExistingToUpdate = updatedItems.filter(
    (item) => item.configType === 'preExisting'
  );

  // Update collections
  if (collectionsToUpdate.length > 0) {
    const otherLibraryConfigs = allCollectionConfigs.filter((config) => {
      // Multi-library collections should be excluded from "other" if they include current library
      if (Array.isArray(config.libraryId)) {
        return !config.libraryId.includes(libraryId);
      }
      return config.libraryId !== libraryId;
    });

    // Get ALL collections from current library (including hidden ones)
    const allCurrentLibraryConfigs = allCollectionConfigs.filter((config) => {
      // Multi-library collections should be included if they contain current library
      if (Array.isArray(config.libraryId)) {
        return config.libraryId.includes(libraryId);
      }
      return config.libraryId === libraryId;
    });

    const updatedConfigs = collectionsToUpdate.map(
      ({ ...config }) => config as CollectionConfig
    );

    // Merge: preserve hidden collections, update visible ones
    const finalConfigs = allCurrentLibraryConfigs.map((originalConfig) => {
      const updatedConfig = updatedConfigs.find(
        (updated) => updated.id === originalConfig.id
      );
      return updatedConfig || originalConfig; // Use updated version if available, otherwise keep original
    });

    settings.plex.collectionConfigs = [...otherLibraryConfigs, ...finalConfigs];
    totalUpdated += updatedConfigs.length;
  }

  // Update hubs
  if (hubsToUpdate.length > 0) {
    const otherLibraryHubs = allHubConfigs.filter(
      (config) => config.libraryId !== libraryId
    );
    // Get ALL hubs from current library (including hidden ones)
    const allCurrentLibraryHubs = allHubConfigs.filter(
      (config) => config.libraryId === libraryId
    );
    const updatedHubs = hubsToUpdate.map(({ ...hub }) => hub as PlexHubConfig);

    // Merge: preserve hidden hubs, update visible ones
    const finalHubs = allCurrentLibraryHubs.map((originalHub) => {
      const updatedHub = updatedHubs.find(
        (updated) => updated.id === originalHub.id
      );
      return updatedHub || originalHub; // Use updated version if available, otherwise keep original
    });

    defaultHubConfigService.saveExistingConfigs([
      ...otherLibraryHubs,
      ...finalHubs,
    ]);
    totalUpdated += updatedHubs.length;
  }

  // Update pre-existing
  if (preExistingToUpdate.length > 0) {
    const otherLibraryPreExisting = allPreExistingConfigs.filter(
      (config) => config.libraryId !== libraryId
    );
    // Get ALL pre-existing from current library (including hidden ones)
    const allCurrentLibraryPreExisting = allPreExistingConfigs.filter(
      (config) => config.libraryId === libraryId
    );
    const updatedPreExisting = preExistingToUpdate.map(
      ({ ...config }) => config as PreExistingCollectionConfig
    );

    // Merge: preserve hidden pre-existing, update visible ones
    const finalPreExisting = allCurrentLibraryPreExisting.map(
      (originalConfig) => {
        const updatedConfig = updatedPreExisting.find(
          (updated) => updated.id === originalConfig.id
        );
        return updatedConfig || originalConfig; // Use updated version if available, otherwise keep original
      }
    );

    preExistingCollectionConfigService.saveExistingConfigs([
      ...otherLibraryPreExisting,
      ...finalPreExisting,
    ]);
    totalUpdated += updatedPreExisting.length;
  }

  // Save settings if collections were updated
  if (collectionsToUpdate.length > 0) {
    settings.save();
  }

  logger.info(`Auto-reordering completed for library ${libraryId}`, {
    label: 'Universal Reorder API',
    libraryId,
    context,
    mode: 'auto',
    totalItemsReordered: totalUpdated,
    collections: collectionsToUpdate.length,
    hubs: hubsToUpdate.length,
    preExisting: preExistingToUpdate.length,
  });

  return {
    totalItemsReordered: totalUpdated,
    collectionsUpdated: collectionsToUpdate.length,
    hubsUpdated: hubsToUpdate.length,
    preExistingUpdated: preExistingToUpdate.length,
  };
}

/**
 * Utility function to auto-reorder a library from other modules
 * Calls the auto-reordering logic without going through HTTP
 */
export async function autoReorderLibrary(
  libraryId: string,
  context: 'home' | 'recommended' | 'library'
): Promise<void> {
  const sortOrderField =
    context === 'home' || context === 'recommended'
      ? 'sortOrderHome'
      : 'sortOrderLibrary';

  await performAutoReordering(libraryId, context, sortOrderField);
}

export default reorderRoutes;
