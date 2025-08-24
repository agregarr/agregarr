import PlexAPI from '@server/api/plexapi';
import { getAdminUser } from '@server/lib/collections/core/CollectionUtilities';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const hubsRoutes = Router();

/**
 * Initialize Plex client with admin credentials
 */
async function getPlexClient(): Promise<PlexAPI> {
  const admin = await getAdminUser();
  if (!admin?.plexToken) {
    throw new Error('No admin Plex token found');
  }

  const settings = getSettings();
  return new PlexAPI({
    plexToken: admin.plexToken,
    plexSettings: settings.plex,
  });
}

/**
 * PUT /api/v1/hubs/libraries/:sectionId/move
 * Move a hub to a new position in the library
 */
hubsRoutes.put(
  '/libraries/:sectionId/move',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { sectionId } = req.params;
      const { hubId, afterHubId } = req.body;

      if (!hubId) {
        return res.status(400).json({
          error: 'Missing required parameter: hubId',
        });
      }

      const plexClient = await getPlexClient();
      await plexClient.moveHub(sectionId, hubId, afterHubId);

      logger.info(`Successfully moved hub ${hubId} in library ${sectionId}`, {
        label: 'Hub Management API',
        sectionId,
        hubId,
        afterHubId,
      });

      res.status(200).json({
        success: true,
        message: 'Hub moved successfully',
      });
    } catch (error) {
      logger.error(
        `Failed to move hub in library section ${req.params.sectionId}`,
        {
          label: 'Hub Management API',
          error: error instanceof Error ? error.message : String(error),
          sectionId: req.params.sectionId,
          hubId: req.body.hubId,
          afterHubId: req.body.afterHubId,
        }
      );

      res.status(500).json({
        error: 'Failed to move hub',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * PUT /api/v1/hubs/libraries/:sectionId/reorder
 * Reorder multiple hubs in a library section
 */
hubsRoutes.put(
  '/libraries/:sectionId/reorder',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { sectionId } = req.params;
      const { hubOrder } = req.body;

      if (!Array.isArray(hubOrder) || hubOrder.length === 0) {
        return res.status(400).json({
          error: 'Invalid hubOrder: must be a non-empty array of hub IDs',
        });
      }

      const plexClient = await getPlexClient();
      await plexClient.reorderHubs(sectionId, hubOrder);

      logger.info(
        `Successfully reordered ${hubOrder.length} hubs in library ${sectionId}`,
        {
          label: 'Hub Management API',
          sectionId,
          hubCount: hubOrder.length,
        }
      );

      res.status(200).json({
        success: true,
        message: `Successfully reordered ${hubOrder.length} hubs`,
      });
    } catch (error) {
      logger.error(
        `Failed to reorder hubs in library section ${req.params.sectionId}`,
        {
          label: 'Hub Management API',
          error: error instanceof Error ? error.message : String(error),
          sectionId: req.params.sectionId,
          hubOrder: req.body.hubOrder,
        }
      );

      res.status(500).json({
        error: 'Failed to reorder hubs',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * PUT /api/v1/hubs/libraries/:sectionId/visibility
 * Update hub visibility settings
 */
hubsRoutes.put(
  '/libraries/:sectionId/visibility',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { sectionId } = req.params;
      const { hubId, visibility } = req.body;

      if (!hubId) {
        return res.status(400).json({
          error: 'Missing required parameter: hubId',
        });
      }

      if (!visibility || typeof visibility !== 'object') {
        return res.status(400).json({
          error: 'Missing or invalid visibility configuration',
        });
      }

      const plexClient = await getPlexClient();
      await plexClient.updateHubVisibility(sectionId, hubId, visibility);

      logger.info(
        `Successfully updated hub visibility for ${hubId} in library ${sectionId}`,
        {
          label: 'Hub Management API',
          sectionId,
          hubId,
          visibility,
        }
      );

      res.status(200).json({
        success: true,
        message: 'Hub visibility updated successfully',
      });
    } catch (error) {
      logger.error(
        `Failed to update hub visibility in library section ${req.params.sectionId}`,
        {
          label: 'Hub Management API',
          error: error instanceof Error ? error.message : String(error),
          sectionId: req.params.sectionId,
          hubId: req.body.hubId,
          visibility: req.body.visibility,
        }
      );

      res.status(500).json({
        error: 'Failed to update hub visibility',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

export default hubsRoutes;
