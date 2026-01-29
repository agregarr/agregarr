import OverseerrAPI from '@server/api/overseerr';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();

router.post('/test', async (req, res, next) => {
  const startTime = Date.now();

  logger.debug('Overseerr connection test requested', {
    label: 'Overseerr Connection',
    hostname: req.body.hostname,
    port: req.body.port,
    useSsl: req.body.useSsl,
    urlBase: req.body.urlBase,
  });

  try {
    const { hostname, port, apiKey, useSsl, urlBase } = req.body;

    if (!hostname || !port || !apiKey) {
      return next({
        status: 400,
        message: 'Hostname, port, and API key are required',
      });
    }

    const settings = {
      hostname,
      port: Number(port),
      useSsl: useSsl || false,
      urlBase: urlBase || '',
      apiKey,
    };

    const connectionUrl = `${settings.useSsl ? 'https' : 'http'}://${
      settings.hostname
    }:${settings.port}${settings.urlBase}`;
    logger.debug('Testing Overseerr connection', {
      label: 'Overseerr Connection',
      url: connectionUrl,
      apiKeyLength: apiKey.length,
    });

    const overseerrClient = new OverseerrAPI(settings);
    await overseerrClient.testConnection();

    // After successful connection, fetch and store Overseerr settings for template variables
    // This is critical data but we don't fail the test if it can't be fetched
    let templateDataSuccess = false;
    let templateDataMessage = '';

    try {
      const overseerrSettings = await overseerrClient.getMainSettings();
      if (overseerrSettings) {
        const globalSettings = getSettings();
        globalSettings.updateExternalOverseerrInfo(
          overseerrSettings.applicationUrl,
          overseerrSettings.applicationTitle
        );
        templateDataSuccess = true;
        templateDataMessage = `Template variables updated: ${overseerrSettings.applicationTitle} (${overseerrSettings.applicationUrl})`;
        logger.info(
          'Stored external Overseerr settings for template variables',
          {
            label: 'API',
            applicationTitle: overseerrSettings.applicationTitle,
            applicationUrl: overseerrSettings.applicationUrl,
          }
        );
      }
    } catch (settingsError) {
      templateDataMessage = `Warning: Could not fetch template variables - ${
        settingsError instanceof Error
          ? settingsError.message
          : String(settingsError)
      }`;
      logger.warn('Failed to fetch Overseerr settings for template variables', {
        label: 'API',
        error:
          settingsError instanceof Error
            ? settingsError.message
            : String(settingsError),
      });
    }

    // Fetch servers and their profiles/root folders (ALL servers, not just default)
    let servers: {
      radarr: {
        id: number;
        name: string;
        hostname: string;
        port: number;
        is4k: boolean;
        isDefault: boolean;
      }[];
      sonarr: {
        id: number;
        name: string;
        hostname: string;
        port: number;
        is4k: boolean;
        isDefault: boolean;
      }[];
    } = { radarr: [], sonarr: [] };

    // Store profiles, root folders, and tags for ALL servers, keyed by server ID
    const radarrServerOptions: Record<
      number,
      {
        profiles: { id: number; name: string }[];
        rootFolders: { id: number; path: string }[];
        tags: { id: number; label: string }[];
      }
    > = {};

    const sonarrServerOptions: Record<
      number,
      {
        profiles: { id: number; name: string }[];
        rootFolders: { id: number; path: string }[];
        tags: { id: number; label: string }[];
      }
    > = {};

    try {
      const radarrServers = await overseerrClient.getRadarrServers();
      const sonarrServers = await overseerrClient.getSonarrServers();
      servers = { radarr: radarrServers, sonarr: sonarrServers };

      // Fetch profiles, root folders, and tags for ALL Radarr servers
      for (const server of radarrServers) {
        try {
          const [profiles, rootFolders, tags] = await Promise.all([
            overseerrClient.getRadarrProfiles(server.id),
            overseerrClient.getRadarrRootFolders(server.id),
            overseerrClient.getRadarrTags(server.id),
          ]);
          radarrServerOptions[server.id] = { profiles, rootFolders, tags };
        } catch (error) {
          logger.warn('Failed to fetch Radarr options for server', {
            label: 'Overseerr Connection',
            serverId: server.id,
            serverName: server.name,
            error: error instanceof Error ? error.message : String(error),
          });
          radarrServerOptions[server.id] = {
            profiles: [],
            rootFolders: [],
            tags: [],
          };
        }
      }

      // Fetch profiles, root folders, and tags for ALL Sonarr servers
      for (const server of sonarrServers) {
        try {
          const [profiles, rootFolders, tags] = await Promise.all([
            overseerrClient.getSonarrProfiles(server.id),
            overseerrClient.getSonarrRootFolders(server.id),
            overseerrClient.getSonarrTags(server.id),
          ]);
          sonarrServerOptions[server.id] = { profiles, rootFolders, tags };
        } catch (error) {
          logger.warn('Failed to fetch Sonarr options for server', {
            label: 'Overseerr Connection',
            serverId: server.id,
            serverName: server.name,
            error: error instanceof Error ? error.message : String(error),
          });
          sonarrServerOptions[server.id] = {
            profiles: [],
            rootFolders: [],
            tags: [],
          };
        }
      }
    } catch (serverError) {
      logger.warn('Failed to fetch servers during test', {
        label: 'Overseerr Connection',
        error:
          serverError instanceof Error
            ? serverError.message
            : String(serverError),
      });
    }

    logger.info('Overseerr connection test successful', {
      label: 'Overseerr Connection',
      responseTime: Date.now() - startTime,
      templateDataSuccess,
      radarrServers: servers.radarr.length,
      sonarrServers: servers.sonarr.length,
      radarrOptionsCount: Object.keys(radarrServerOptions).length,
      sonarrOptionsCount: Object.keys(sonarrServerOptions).length,
    });

    return res.status(200).json({
      success: true,
      templateDataSuccess,
      templateDataMessage,
      servers,
      radarrServerOptions,
      sonarrServerOptions,
    });
  } catch (e) {
    const connectionUrl = `${req.body.useSsl ? 'https' : 'http'}://${
      req.body.hostname
    }:${req.body.port}${req.body.urlBase || ''}`;

    // Determine appropriate status code and message based on error type
    let status = 500;
    let message = 'Unable to connect to Overseerr';

    // Check if it's an axios error with response
    if (e.response) {
      status = e.response.status;

      if (status === 401 || status === 403) {
        message = 'Invalid API key - Authentication failed';
      } else if (status === 404) {
        message = 'Overseerr API not found - Check URL base and port';
      } else {
        message = `Overseerr returned error: ${
          e.response.statusText || 'Unknown error'
        }`;
      }
    } else if (e.code === 'ECONNREFUSED') {
      message = 'Connection refused - Check hostname and port';
    } else if (e.code === 'ENOTFOUND') {
      message = 'Host not found - Check hostname';
    } else if (e.code === 'ETIMEDOUT') {
      message = 'Connection timeout - Check network connectivity';
    } else if (e.message) {
      message = e.message;
    }

    logger.error('Overseerr connection test failed', {
      label: 'Overseerr Connection',
      error: e.message,
      errorType: e.constructor?.name,
      errorCode: e.code,
      httpStatus: e.response?.status,
      connectionUrl,
      responseTime: Date.now() - startTime,
      requestedSettings: {
        hostname: req.body.hostname,
        port: req.body.port,
        ssl: req.body.useSsl,
        urlBase: req.body.urlBase,
      },
    });

    return next({
      status,
      message: `${message} (${connectionUrl})`,
    });
  }
});

/**
 * Create a tag on a Radarr server using credentials from Overseerr
 * This allows tag creation even when Radarr isn't configured locally in Agregarr
 */
router.post('/radarr/:serverId/tags', async (req, res, next) => {
  try {
    const serverId = Number(req.params.serverId);
    const { label } = req.body;

    if (!label || typeof label !== 'string') {
      return next({
        status: 400,
        message: 'Tag label is required',
      });
    }

    // Get Overseerr settings
    const settings = getSettings();
    const overseerrSettings = settings.overseerr;

    if (!overseerrSettings?.hostname || !overseerrSettings?.apiKey) {
      return next({
        status: 400,
        message: 'Overseerr is not configured',
      });
    }

    // Create Overseerr client and get Radarr server config
    const overseerrClient = new OverseerrAPI(overseerrSettings);
    const radarrConfig = await overseerrClient.getRadarrServerConfig(serverId);

    if (!radarrConfig) {
      return next({
        status: 404,
        message: `Radarr server with ID ${serverId} not found in Overseerr`,
      });
    }

    // Create Radarr client with credentials from Overseerr
    const radarrClient = new RadarrAPI({
      url: `${radarrConfig.useSsl ? 'https' : 'http'}://${
        radarrConfig.hostname
      }:${radarrConfig.port}${radarrConfig.baseUrl || ''}`,
      apiKey: radarrConfig.apiKey,
    });

    // Create the tag
    const newTag = await radarrClient.createTag({ label });

    logger.info('Created Radarr tag via Overseerr server config', {
      label: 'API',
      serverId,
      serverName: radarrConfig.name,
      tagId: newTag.id,
      tagLabel: newTag.label,
    });

    return res.status(201).json(newTag);
  } catch (e) {
    logger.error('Failed to create Radarr tag via Overseerr', {
      label: 'API',
      error: e instanceof Error ? e.message : String(e),
      serverId: req.params.serverId,
    });

    return next({
      status: 500,
      message: `Failed to create tag: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }
});

/**
 * Create a tag on a Sonarr server using credentials from Overseerr
 * This allows tag creation even when Sonarr isn't configured locally in Agregarr
 */
router.post('/sonarr/:serverId/tags', async (req, res, next) => {
  try {
    const serverId = Number(req.params.serverId);
    const { label } = req.body;

    if (!label || typeof label !== 'string') {
      return next({
        status: 400,
        message: 'Tag label is required',
      });
    }

    // Get Overseerr settings
    const settings = getSettings();
    const overseerrSettings = settings.overseerr;

    if (!overseerrSettings?.hostname || !overseerrSettings?.apiKey) {
      return next({
        status: 400,
        message: 'Overseerr is not configured',
      });
    }

    // Create Overseerr client and get Sonarr server config
    const overseerrClient = new OverseerrAPI(overseerrSettings);
    const sonarrConfig = await overseerrClient.getSonarrServerConfig(serverId);

    if (!sonarrConfig) {
      return next({
        status: 404,
        message: `Sonarr server with ID ${serverId} not found in Overseerr`,
      });
    }

    // Create Sonarr client with credentials from Overseerr
    const sonarrClient = new SonarrAPI({
      url: `${sonarrConfig.useSsl ? 'https' : 'http'}://${
        sonarrConfig.hostname
      }:${sonarrConfig.port}${sonarrConfig.baseUrl || ''}`,
      apiKey: sonarrConfig.apiKey,
    });

    // Create the tag
    const newTag = await sonarrClient.createTag({ label });

    logger.info('Created Sonarr tag via Overseerr server config', {
      label: 'API',
      serverId,
      serverName: sonarrConfig.name,
      tagId: newTag.id,
      tagLabel: newTag.label,
    });

    return res.status(201).json(newTag);
  } catch (e) {
    logger.error('Failed to create Sonarr tag via Overseerr', {
      label: 'API',
      error: e instanceof Error ? e.message : String(e),
      serverId: req.params.serverId,
    });

    return next({
      status: 500,
      message: `Failed to create tag: ${
        e instanceof Error ? e.message : String(e)
      }`,
    });
  }
});

export default router;
