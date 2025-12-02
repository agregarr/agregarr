import OverseerrAPI from '@server/api/overseerr';
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

    // Store profiles and root folders for ALL servers, keyed by server ID
    const radarrServerOptions: Record<
      number,
      {
        profiles: { id: number; name: string }[];
        rootFolders: { id: number; path: string }[];
      }
    > = {};

    const sonarrServerOptions: Record<
      number,
      {
        profiles: { id: number; name: string }[];
        rootFolders: { id: number; path: string }[];
      }
    > = {};

    try {
      const radarrServers = await overseerrClient.getRadarrServers();
      const sonarrServers = await overseerrClient.getSonarrServers();
      servers = { radarr: radarrServers, sonarr: sonarrServers };

      // Fetch profiles and root folders for ALL Radarr servers
      for (const server of radarrServers) {
        try {
          const [profiles, rootFolders] = await Promise.all([
            overseerrClient.getRadarrProfiles(server.id),
            overseerrClient.getRadarrRootFolders(server.id),
          ]);
          radarrServerOptions[server.id] = { profiles, rootFolders };
        } catch (error) {
          logger.warn('Failed to fetch Radarr options for server', {
            label: 'Overseerr Connection',
            serverId: server.id,
            serverName: server.name,
            error: error instanceof Error ? error.message : String(error),
          });
          radarrServerOptions[server.id] = { profiles: [], rootFolders: [] };
        }
      }

      // Fetch profiles and root folders for ALL Sonarr servers
      for (const server of sonarrServers) {
        try {
          const [profiles, rootFolders] = await Promise.all([
            overseerrClient.getSonarrProfiles(server.id),
            overseerrClient.getSonarrRootFolders(server.id),
          ]);
          sonarrServerOptions[server.id] = { profiles, rootFolders };
        } catch (error) {
          logger.warn('Failed to fetch Sonarr options for server', {
            label: 'Overseerr Connection',
            serverId: server.id,
            serverName: server.name,
            error: error instanceof Error ? error.message : String(error),
          });
          sonarrServerOptions[server.id] = { profiles: [], rootFolders: [] };
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

export default router;
