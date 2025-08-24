import PlexAPI from '@server/api/plexapi';
import { getAdminUser } from '@server/lib/collections/core/CollectionUtilities';
import { discoveryService } from '@server/lib/collections/services/DiscoveryService';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const discoveryRoutes = Router();

/**
 * Initialize Plex client with admin credentials
 */
async function getPlexClient(): Promise<PlexAPI> {
  const admin = await getAdminUser();
  if (!admin?.plexToken) {
    throw new Error('No admin Plex token found');
  }

  const settings = await import('@server/lib/settings').then((m) =>
    m.getSettings()
  );
  return new PlexAPI({
    plexToken: admin.plexToken,
    plexSettings: settings.plex,
  });
}

/**
 * GET /api/v1/discovery/hubs/libraries
 * Get all library hubs across all sections
 */
discoveryRoutes.get('/hubs/libraries', isAuthenticated(), async (req, res) => {
  try {
    const plexClient = await getPlexClient();
    const allHubs = await discoveryService.getAllLibraryHubs(plexClient);

    res.status(200).json(allHubs);
  } catch (error) {
    logger.error('Failed to fetch all library hubs', {
      label: 'Discovery API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to fetch library hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/discovery/hubs/libraries/:sectionId
 * Get hubs for a specific library section
 */
discoveryRoutes.get(
  '/hubs/libraries/:sectionId',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { sectionId } = req.params;
      const plexClient = await getPlexClient();

      const hubs = await discoveryService.getLibraryHubs(plexClient, sectionId);

      res.status(200).json(hubs);
    } catch (error) {
      logger.error(
        `Failed to fetch hubs for library section ${req.params.sectionId}`,
        {
          label: 'Discovery API',
          error: error instanceof Error ? error.message : String(error),
          sectionId: req.params.sectionId,
        }
      );

      res.status(500).json({
        error: 'Failed to fetch library hubs',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /api/v1/discovery/hubs/libraries/:sectionId/manage
 * Get hub management interface for a library section
 */
discoveryRoutes.get(
  '/hubs/libraries/:sectionId/manage',
  isAuthenticated(),
  async (req, res) => {
    try {
      const { sectionId } = req.params;
      const plexClient = await getPlexClient();

      const managementData = await discoveryService.getHubManagement(
        plexClient,
        sectionId
      );

      res.status(200).json(managementData);
    } catch (error) {
      logger.error(
        `Failed to fetch hub management for library section ${req.params.sectionId}`,
        {
          label: 'Discovery API',
          error: error instanceof Error ? error.message : String(error),
          sectionId: req.params.sectionId,
        }
      );

      res.status(500).json({
        error: 'Failed to fetch hub management data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

/**
 * GET /api/v1/discovery/hubs/scan
 * Discover available Plex hubs and convert them to hub configurations
 */
discoveryRoutes.get('/hubs/scan', isAuthenticated(), async (req, res) => {
  try {
    const plexClient = await getPlexClient();
    const discoveryResult = await discoveryService.discoverAllHubs(plexClient);

    res.status(200).json(discoveryResult);
  } catch (error) {
    logger.error('Failed to discover Plex hubs', {
      label: 'Discovery API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to discover Plex hubs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/v1/discovery/hubs/status
 * Get hub management system status and capabilities
 */
discoveryRoutes.get('/hubs/status', isAuthenticated(), async (req, res) => {
  try {
    let plexClient;
    try {
      plexClient = await getPlexClient();
    } catch (error) {
      // If we can't get a plex client, still return status without connection info
    }

    const status = await discoveryService.getSystemStatus(plexClient);
    res.status(200).json(status);
  } catch (error) {
    logger.error('Failed to get hub management status', {
      label: 'Discovery API',
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Failed to get hub management status',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default discoveryRoutes;
