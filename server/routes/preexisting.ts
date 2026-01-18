import { preExistingCollectionConfigService } from '@server/lib/collections/services/PreExistingCollectionConfigService';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const preExistingRoutes = Router();

/**
 * GET /api/v1/preexisting
 * Get current pre-existing collection configurations
 */
preExistingRoutes.get('/', isAuthenticated(), async (req, res) => {
  try {
    const configs = preExistingCollectionConfigService.getConfigs();

    logger.debug('Fetching pre-existing collection configurations', {
      label: 'Pre-existing Collections API',
      count: configs.length,
      collectionNames: configs.map((c) => c.name).slice(0, 10),
    });

    res.status(200).json(configs);
  } catch (error) {
    logger.error('Failed to get pre-existing collection configurations', {
      label: 'Pre-existing Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get pre-existing collection configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/v1/preexisting/:id/settings
 * Update individual pre-existing collection settings
 */
preExistingRoutes.put('/:id/settings', isAuthenticated(), async (req, res) => {
  const { id } = req.params;

  try {
    const updatedConfig = preExistingCollectionConfigService.updateSettings(
      id,
      req.body
    );

    // Mark pre-existing collection as needing sync due to modification
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    settings.markCollectionModified(id, 'preExisting');

    // Auto-reorder after visibility changes to assign proper sort orders
    const { autoReorderLibrary } = await import('@server/routes/reorder');
    try {
      await autoReorderLibrary(updatedConfig.libraryId, 'home');
      await autoReorderLibrary(updatedConfig.libraryId, 'library');
      logger.debug(
        `Auto-reordering completed after pre-existing collection settings update for library ${updatedConfig.libraryId}`,
        {
          label: 'Pre-existing Collections API - Auto Reorder',
        }
      );
    } catch (error) {
      logger.warn(
        'Failed to auto-reorder after pre-existing collection settings update',
        {
          label: 'Pre-existing Collections API - Auto Reorder',
          libraryId: updatedConfig.libraryId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      // Don't fail the settings update if reordering fails
    }

    res.status(200).json({
      preExistingCollectionConfig: updatedConfig,
      message: 'Pre-existing collection settings updated successfully',
    });
  } catch (error) {
    logger.error(
      'Failed to update individual pre-existing collection settings',
      {
        label: 'Pre-existing Collections API',
        error: error instanceof Error ? error.message : String(error),
        configId: id,
      }
    );

    if (error instanceof Error && error.message === 'Config not found') {
      return res.status(404).json({
        error: 'Pre-existing collection not found',
        message: `Pre-existing collection with id "${id}" not found`,
      });
    }

    res.status(500).json({
      error: 'Failed to update pre-existing collection settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/preexisting/discover
 * Discovery operation for new pre-existing collections
 */
preExistingRoutes.post('/discover', isAuthenticated(), async (req, res) => {
  try {
    const { preExistingCollectionConfigs } = req.body;

    if (!Array.isArray(preExistingCollectionConfigs)) {
      return res.status(400).json({
        error: 'Invalid preExistingCollectionConfigs: must be an array',
      });
    }

    const discoveredConfigs = preExistingCollectionConfigService.saveConfigs(
      preExistingCollectionConfigs
    );

    // Mark all newly discovered pre-existing collections as needing sync
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    discoveredConfigs.forEach((config) => {
      settings.markCollectionModified(config.id, 'preExisting');
    });

    res.status(200).json({
      preExistingCollectionConfigs: discoveredConfigs,
      message: 'Pre-existing collections discovered successfully',
    });
  } catch (error) {
    logger.error('Failed to discover pre-existing collections', {
      label: 'Pre-existing Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to discover pre-existing collections',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/preexisting
 * Save pre-existing collection configurations (replaces entire config array)
 */
preExistingRoutes.post('/', isAuthenticated(), async (req, res) => {
  try {
    const { preExistingCollectionConfigs } = req.body;

    if (!Array.isArray(preExistingCollectionConfigs)) {
      return res.status(400).json({
        error: 'Invalid preExistingCollectionConfigs: must be an array',
      });
    }

    // Determine if we're receiving discovered configs (with hubIdentifier) or existing configs (with collectionRatingKey)
    const firstConfig = preExistingCollectionConfigs[0];
    let savedConfigs;

    if (firstConfig && 'hubIdentifier' in firstConfig) {
      // This is discovery data - use saveConfigs for conversion
      savedConfigs = preExistingCollectionConfigService.saveConfigs(
        preExistingCollectionConfigs
      );
    } else {
      // This is existing config data (reordering/editing) - use saveExistingConfigs
      savedConfigs = preExistingCollectionConfigService.saveExistingConfigs(
        preExistingCollectionConfigs
      );
    }

    res.status(200).json({
      preExistingCollectionConfigs: savedConfigs,
      message: 'Pre-existing collection configurations saved successfully',
    });
  } catch (error) {
    logger.error('Failed to save pre-existing collection configurations', {
      label: 'Pre-existing Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to save pre-existing collection configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/preexisting/append
 * Append new pre-existing collection configurations to existing ones (for discovery)
 */
preExistingRoutes.post('/append', isAuthenticated(), async (req, res) => {
  try {
    const { preExistingCollectionConfigs } = req.body;

    if (!Array.isArray(preExistingCollectionConfigs)) {
      return res.status(400).json({
        error: 'Invalid preExistingCollectionConfigs: must be an array',
      });
    }

    const appendedConfigs = preExistingCollectionConfigService.appendConfigs(
      preExistingCollectionConfigs
    );

    // Mark all newly appended pre-existing collections as needing sync
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    appendedConfigs.forEach((config) => {
      settings.markCollectionModified(config.id, 'preExisting');
    });

    res.status(200).json({
      preExistingCollectionConfigs: appendedConfigs,
      message: 'Pre-existing collection configurations appended successfully',
    });
  } catch (error) {
    logger.error('Failed to append pre-existing collection configurations', {
      label: 'Pre-existing Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to append pre-existing collection configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PATCH /api/v1/preexisting/:id/promote
 * Promote a pre-existing collection from A-Z section to promoted section
 */
preExistingRoutes.patch('/:id/promote', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const configs = preExistingCollectionConfigService.getConfigs();

    // Find the collection to promote
    const configIndex = configs.findIndex((config) => config.id === id);
    if (configIndex === -1) {
      return res
        .status(404)
        .json({ error: 'Pre-existing collection not found' });
    }

    const config = configs[configIndex];

    // Check if already promoted
    if (config.isLibraryPromoted) {
      return res
        .status(400)
        .json({ error: 'Collection is already in promoted section' });
    }

    // Find the next available sortOrderLibrary for this library
    const sameLibraryConfigs = configs.filter(
      (c) => c.libraryId === config.libraryId && c.isLibraryPromoted === true
    );
    const maxSortOrder =
      sameLibraryConfigs.length > 0
        ? Math.max(...sameLibraryConfigs.map((c) => c.sortOrderLibrary || 0))
        : 0;

    // Update in service
    const finalConfig = preExistingCollectionConfigService.updateSettings(id, {
      isLibraryPromoted: true,
      sortOrderLibrary: maxSortOrder + 1,
      everLibraryPromoted: true, // Mark as ever promoted when promoting
    });

    // Mark pre-existing collection as needing sync due to promotion
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    settings.markCollectionModified(id, 'preExisting');

    logger.info(
      `Promoted pre-existing collection ${config.name} to promoted section`,
      {
        label: 'Pre-existing Collections API',
        collectionId: id,
        newSortOrderLibrary: maxSortOrder + 1,
      }
    );

    return res.json({ success: true, config: finalConfig });
  } catch (error) {
    logger.error(`Failed to promote pre-existing collection ${req.params.id}`, {
      label: 'Pre-existing Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res
      .status(500)
      .json({ error: 'Failed to promote pre-existing collection' });
  }
});

/**
 * PATCH /api/v1/preexisting/:id/demote
 * Demote a pre-existing collection from promoted section to A-Z section
 */
preExistingRoutes.patch('/:id/demote', isAuthenticated(), async (req, res) => {
  try {
    const { id } = req.params;
    const configs = preExistingCollectionConfigService.getConfigs();

    // Find the collection to demote
    const configIndex = configs.findIndex((config) => config.id === id);
    if (configIndex === -1) {
      return res
        .status(404)
        .json({ error: 'Pre-existing collection not found' });
    }

    const config = configs[configIndex];

    // Check if already in A-Z section
    if (!config.isLibraryPromoted) {
      return res
        .status(400)
        .json({ error: 'Collection is already in A-Z section' });
    }

    // Update in service - Keep everLibraryPromoted: true when demoting
    const finalConfig = preExistingCollectionConfigService.updateSettings(id, {
      isLibraryPromoted: false,
      sortOrderLibrary: 0, // A-Z collections have sortOrderLibrary: 0
      // Note: everLibraryPromoted stays true when demoting - will be reset to false during sync after sortTitle cleanup
    });

    // Mark pre-existing collection as needing sync due to demotion
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    settings.markCollectionModified(id, 'preExisting');

    logger.info(
      `Demoted pre-existing collection ${config.name} to A-Z section`,
      {
        label: 'Pre-existing Collections API',
        collectionId: id,
      }
    );

    return res.json({ success: true, config: finalConfig });
  } catch (error) {
    logger.error(`Failed to demote pre-existing collection ${req.params.id}`, {
      label: 'Pre-existing Collections API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res
      .status(500)
      .json({ error: 'Failed to demote pre-existing collection' });
  }
});

export default preExistingRoutes;
