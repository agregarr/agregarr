import { defaultHubConfigService } from '@server/lib/collections/services/DefaultHubConfigService';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const defaultHubsRoutes = Router();

/**
 * GET /api/v1/defaulthubs
 * Get current default Plex hub configurations
 */
defaultHubsRoutes.get('/', isAuthenticated(), async (req, res) => {
  try {
    const configs = defaultHubConfigService.getConfigs();
    res.status(200).json(configs);
  } catch (error) {
    logger.error('Failed to get default hub configurations', {
      label: 'Default Hubs API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get default hub configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/v1/defaulthubs/:id/settings
 * Update individual default hub settings
 */
defaultHubsRoutes.put('/:id/settings', isAuthenticated(), async (req, res) => {
  const { id } = req.params;

  try {
    const updatedConfig = defaultHubConfigService.updateSettings(id, req.body);

    // Mark hub as needing sync due to modification
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    settings.markCollectionModified(id, 'hub');

    // Auto-reorder after visibility changes to assign proper sort orders
    // For linked hubs, we need to reorder all affected libraries, not just the primary one
    const { autoReorderLibrary } = await import('@server/routes/reorder');
    try {
      const allConfigs = defaultHubConfigService.getConfigs();
      const affectedLibraries = new Set<string>();

      // If this hub is linked, find all libraries with the same linkId
      if (updatedConfig.isLinked && updatedConfig.linkId) {
        const linkedConfigs = allConfigs.filter(
          (c) => c.linkId === updatedConfig.linkId && c.isLinked
        );
        linkedConfigs.forEach((config) =>
          affectedLibraries.add(config.libraryId)
        );
        logger.debug(
          `Found ${linkedConfigs.length} linked hubs across ${affectedLibraries.size} libraries`,
          {
            label: 'Default Hubs API - Auto Reorder',
            linkId: updatedConfig.linkId,
            libraries: Array.from(affectedLibraries),
          }
        );
      } else {
        // Non-linked hub, just reorder its own library
        affectedLibraries.add(updatedConfig.libraryId);
      }

      // Auto-reorder each affected library
      for (const libraryId of affectedLibraries) {
        await autoReorderLibrary(libraryId, 'home');
        await autoReorderLibrary(libraryId, 'library');
        logger.debug(
          `Auto-reordering completed after hub settings update for library ${libraryId}`,
          {
            label: 'Default Hubs API - Auto Reorder',
            isLinked: updatedConfig.isLinked,
            linkId: updatedConfig.linkId || 'none',
          }
        );
      }
    } catch (error) {
      logger.warn('Failed to auto-reorder after hub settings update', {
        label: 'Default Hubs API - Auto Reorder',
        libraryId: updatedConfig.libraryId,
        isLinked: updatedConfig.isLinked,
        linkId: updatedConfig.linkId || 'none',
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't fail the settings update if reordering fails
    }

    res.status(200).json({
      hubConfig: updatedConfig,
      message: 'Default hub settings updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update individual default hub settings', {
      label: 'Default Hubs API',
      error: error instanceof Error ? error.message : String(error),
      configId: id,
    });

    if (error instanceof Error && error.message === 'Config not found') {
      return res.status(404).json({
        error: 'Default hub not found',
        message: `Default hub with id "${id}" not found`,
      });
    }

    res.status(500).json({
      error: 'Failed to update default hub settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/defaulthubs/discover
 * Discovery operation for new default hubs
 */
defaultHubsRoutes.post('/discover', isAuthenticated(), async (req, res) => {
  try {
    const { hubConfigs } = req.body;

    if (!Array.isArray(hubConfigs)) {
      return res.status(400).json({
        error: 'Invalid hubConfigs: must be an array',
      });
    }

    const discoveredConfigs = defaultHubConfigService.saveConfigs(hubConfigs);

    // Mark all newly discovered hubs as needing sync
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    discoveredConfigs.forEach((config) => {
      settings.markCollectionModified(config.id, 'hub');
    });

    res.status(200).json({
      hubConfigs: discoveredConfigs,
      message: 'Default hubs discovered successfully',
    });
  } catch (error) {
    logger.error('Failed to discover default hubs', {
      label: 'Default Hubs API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to discover default hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/defaulthubs
 * Save default Plex hub configurations (replaces entire config array)
 */
defaultHubsRoutes.post('/', isAuthenticated(), async (req, res) => {
  try {
    const { hubConfigs } = req.body;

    if (!Array.isArray(hubConfigs)) {
      return res.status(400).json({
        error: 'Invalid hubConfigs: must be an array',
      });
    }

    // Determine if we're receiving discovered configs or existing configs
    const firstConfig = hubConfigs[0];
    let savedConfigs;

    if (
      firstConfig &&
      'hubIdentifier' in firstConfig &&
      !('collectionRatingKey' in firstConfig)
    ) {
      // This is discovery data - use saveConfigs for conversion
      savedConfigs = defaultHubConfigService.saveConfigs(hubConfigs);
    } else {
      // This is existing config data (reordering/editing) - use saveExistingConfigs
      savedConfigs = defaultHubConfigService.saveExistingConfigs(hubConfigs);
    }

    res.status(200).json({
      hubConfigs: savedConfigs,
      message: 'Default hub configurations saved successfully',
    });
  } catch (error) {
    logger.error('Failed to save default hub configurations', {
      label: 'Default Hubs API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to save default hub configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/v1/defaulthubs/append
 * Append new default hub configurations to existing ones (for discovery)
 */
defaultHubsRoutes.post('/append', isAuthenticated(), async (req, res) => {
  try {
    const { hubConfigs } = req.body;

    if (!Array.isArray(hubConfigs)) {
      return res.status(400).json({
        error: 'Invalid hubConfigs: must be an array',
      });
    }

    const appendedConfigs = defaultHubConfigService.appendConfigs(hubConfigs);

    // Mark all newly appended hubs as needing sync
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    appendedConfigs.forEach((config) => {
      settings.markCollectionModified(config.id, 'hub');
    });

    res.status(200).json({
      hubConfigs: appendedConfigs,
      message: 'Default hub configurations appended successfully',
    });
  } catch (error) {
    logger.error('Failed to append default hub configurations', {
      label: 'Default Hubs API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to append default hub configurations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default defaultHubsRoutes;
