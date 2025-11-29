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
    logger.error('No admin Plex token found for connection', {
      label: 'Plex Connection',
      adminExists: !!admin,
    });
    throw new Error('No admin Plex token found');
  }

  const settings = await import('@server/lib/settings').then((m) =>
    m.getSettings()
  );

  const connectionUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
    settings.plex.ip
  }:${settings.plex.port}`;

  logger.debug('Establishing Plex connection', {
    label: 'Plex Connection',
    url: connectionUrl,
    ssl: settings.plex.useSsl,
    machineId: settings.plex.machineId?.substring(0, 8) + '...',
    tokenLength: admin.plexToken.length,
  });

  try {
    const client = new PlexAPI({
      plexToken: admin.plexToken,
      plexSettings: settings.plex,
      timeout: 30000, // 30 second timeout for discovery operations
    });

    logger.debug('Plex client created successfully', {
      label: 'Plex Connection',
    });

    return client;
  } catch (error) {
    logger.error('Failed to create Plex client', {
      label: 'Plex Connection',
      error: error instanceof Error ? error.message : String(error),
      connectionUrl,
    });
    throw error;
  }
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
    const discoveryResult = await discoveryService.discoverAllHubs(
      plexClient,
      true
    );

    res.status(200).json(discoveryResult);
  } catch (error) {
    // Get diagnostic context for better error reporting
    const errorContext: {
      errorType?: string;
      errorCode?: string;
      plexSettings?: {
        ip: string;
        port: number;
        ssl: boolean;
        hasToken: boolean;
      };
    } = {
      errorType: error?.constructor?.name,
      errorCode: (error as { code?: string })?.code,
    };

    // Try to get connection info for context
    try {
      const settings = await import('@server/lib/settings').then((m) =>
        m.getSettings()
      );
      const admin = await import(
        '@server/lib/collections/core/CollectionUtilities'
      ).then((m) => m.getAdminUser());

      errorContext.plexSettings = {
        ip: settings.plex.ip,
        port: settings.plex.port,
        ssl: !!settings.plex.useSsl,
        hasToken: !!(await admin)?.plexToken,
      };
    } catch {
      // Don't fail if we can't get context
    }

    // Create user-friendly error message based on error type
    const errorMessage = error instanceof Error ? error.message : String(error);
    let userFriendlyMessage = errorMessage;

    // Check for specific error patterns and provide helpful guidance
    if (errorMessage.includes('No admin Plex token found')) {
      userFriendlyMessage =
        'No admin user configured. Please complete the initial setup and sign in with Plex.';
    } else if (errorMessage.includes('already running')) {
      userFriendlyMessage = errorMessage; // Already user-friendly
    } else if (errorMessage.includes('ENOTFOUND')) {
      // DNS/hostname resolution failure
      userFriendlyMessage = `Cannot resolve Plex server address${
        errorContext.plexSettings ? ` "${errorContext.plexSettings.ip}"` : ''
      }. Please check your Plex server IP/hostname in settings.`;
    } else if (errorMessage.includes('ECONNREFUSED')) {
      // Connection refused - server not listening
      const plexUrl = errorContext.plexSettings
        ? `${errorContext.plexSettings.ssl ? 'https' : 'http'}://${
            errorContext.plexSettings.ip
          }:${errorContext.plexSettings.port}`
        : 'Plex server';
      userFriendlyMessage = `Cannot connect to ${plexUrl}. Please check that your Plex server is running and the connection settings (IP, port, SSL) are correct.`;
    } else if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('ETIMEDOUT')
    ) {
      // Timeout - server not responding in time
      userFriendlyMessage =
        'Connection timeout. Your Plex server is taking too long to respond. Please check your network connection and server status.';
    } else if (
      errorMessage.includes('401') ||
      errorMessage.includes('Unauthorized')
    ) {
      userFriendlyMessage =
        'Authentication failed. Your Plex token may be invalid or expired. Please try signing in again.';
    } else if (
      errorMessage.includes('403') ||
      errorMessage.includes('Forbidden')
    ) {
      userFriendlyMessage =
        'Access denied. Please check that your Plex account has permission to access this server.';
    }

    logger.error('Failed to discover Plex hubs', {
      label: 'Discovery API',
      error: errorMessage,
      userFriendlyMessage,
      context: errorContext,
    });

    res.status(500).json({
      error: 'Failed to discover Plex hubs',
      message: errorMessage,
      userFriendlyMessage,
      context: errorContext,
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
