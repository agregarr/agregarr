import MaintainerrAPI from '@server/api/maintainerr';
import MDBListAPI from '@server/api/mdblist';
import { getRankedAnime } from '@server/api/myanimelist';
import PlexAPI from '@server/api/plexapi';
import PlexTvAPI from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import TraktAPI from '@server/api/trakt';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
// MediaRequest entity removed - not needed for Agregarr
import { User } from '@server/entity/User';
import type { PlexConnection } from '@server/interfaces/api/plexInterfaces';
import type {
  LogMessage,
  LogsResultsResponse,
  SettingsAboutResponse,
} from '@server/interfaces/api/settingsInterfaces';
import { scheduledJobs } from '@server/job/schedule';
import type { AvailableCacheIds } from '@server/lib/cache';
import cacheManager from '@server/lib/cache';
// ImageProxy removed - not needed for collections-only app
// Plex scanner import removed - not needed for collections-only app
import type {
  JobId,
  MainSettings,
  WatchlistSyncSettings,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
// Discover settings routes removed - discovery functionality not needed in Agregarr
import { appDataPath } from '@server/utils/appDataVolume';
import { getAppVersion } from '@server/utils/appVersion';
import {
  buildTraktRedirectUri,
  persistTraktTokens,
} from '@server/utils/traktAuth';
import archiver from 'archiver';
import parser from 'cron-parser';
import type { Request } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { escapeRegExp, merge, set, sortBy } from 'lodash';
import { rescheduleJob } from 'node-schedule';
import path from 'path';
import { URL } from 'url';
// Notification routes removed - not needed for Agregarr
import radarrRoutes from './radarr';
import sonarrRoutes from './sonarr';
const settingsRoutes = Router();

settingsRoutes.use('/radarr', radarrRoutes);
settingsRoutes.use('/sonarr', sonarrRoutes);
// Discover settings routes removed - discovery functionality not needed in Agregarr

const filteredMainSettings = (
  user: User,
  main: MainSettings
): Partial<MainSettings> => {
  // Permission system removed - all authenticated users get full settings
  return main;
};

const getTraktRedirectUri = (req?: Request) => {
  const settings = getSettings();
  return buildTraktRedirectUri(settings, req);
};

settingsRoutes.get('/main', (req, res, next) => {
  const settings = getSettings();

  if (!req.user) {
    return next({ status: 400, message: 'User missing from request.' });
  }

  res.status(200).json(filteredMainSettings(req.user, settings.main));
});

settingsRoutes.post('/main', (req, res) => {
  const settings = getSettings();

  settings.main = merge(settings.main, req.body);
  settings.save();

  return res.status(200).json(settings.main);
});

settingsRoutes.post('/main/regenerate', (req, res, next) => {
  const settings = getSettings();

  const main = settings.regenerateApiKey();

  if (!req.user) {
    return next({ status: 500, message: 'User missing from request.' });
  }

  return res.status(200).json(filteredMainSettings(req.user, main));
});

settingsRoutes.get('/plex', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.plex);
});

settingsRoutes.post('/plex', async (req, res, next) => {
  const userRepository = getRepository(User);
  const settings = getSettings();

  logger.debug('Plex settings update requested', {
    label: 'Plex Settings',
    ip: req.body.ip,
    port: req.body.port,
    useSsl: req.body.useSsl,
  });

  try {
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });

    Object.assign(settings.plex, req.body);

    const connectionUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
      settings.plex.ip
    }:${settings.plex.port}`;
    logger.debug('Testing Plex connection with new settings', {
      label: 'Plex Settings',
      url: connectionUrl,
    });

    // Note: Collections sync is now handled by scheduled job (every 12 hours)
    // or manual "Save & Run" button - no auto-trigger on enable

    const plexClient = new PlexAPI({ plexToken: admin.plexToken });

    const result = await plexClient.getStatus();

    if (!result?.MediaContainer?.machineIdentifier) {
      throw new Error('Server not found');
    }

    settings.plex.machineId = result.MediaContainer.machineIdentifier;
    settings.plex.name = result.MediaContainer.friendlyName;

    settings.save();

    logger.info('Plex settings updated successfully', {
      label: 'Plex Settings',
      serverName: result.MediaContainer.friendlyName,
      machineId:
        result.MediaContainer.machineIdentifier.substring(0, 8) + '...',
    });

    // Collections sync now only triggered by:
    // 1. Scheduled job (every 12 hours) when collections are enabled
    // 2. Manual "Save & Run" button in UI

    // Return the updated Plex settings
    const response = {
      ...settings.plex,
    };

    return res.status(200).json(response);
  } catch (e) {
    const connectionUrl = `${settings.plex.useSsl ? 'https' : 'http'}://${
      settings.plex.ip
    }:${settings.plex.port}`;

    logger.error('Failed to connect to Plex with new settings', {
      label: 'Plex Settings',
      error: e.message,
      errorType: e.constructor?.name,
      errorCode: e.code,
      connectionUrl,
      requestedSettings: {
        ip: req.body.ip,
        port: req.body.port,
        ssl: req.body.useSsl,
      },
    });

    return next({
      status: 500,
      message: `Unable to connect to Plex at ${connectionUrl}: ${e.message}`,
    });
  }

  return res.status(200).json(settings.plex);
});

settingsRoutes.get('/plex/devices/servers', async (req, res, next) => {
  const userRepository = getRepository(User);
  try {
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });
    const plexTvClient = admin.plexToken
      ? new PlexTvAPI(admin.plexToken)
      : null;
    const devices = (await plexTvClient?.getDevices())?.filter((device) => {
      return device.provides.includes('server') && device.owned;
    });
    const settings = getSettings();

    if (devices) {
      await Promise.all(
        devices.map(async (device) => {
          const plexDirectConnections: PlexConnection[] = [];

          device.connection.forEach((connection) => {
            const url = new URL(connection.uri);

            if (url.hostname !== connection.address) {
              const plexDirectConnection = { ...connection };
              plexDirectConnection.address = url.hostname;
              plexDirectConnections.push(plexDirectConnection);

              // Connect to IP addresses over HTTP
              connection.protocol = 'http';
            }
          });

          plexDirectConnections.forEach((plexDirectConnection) => {
            device.connection.push(plexDirectConnection);
          });

          await Promise.all(
            device.connection.map(async (connection) => {
              const plexDeviceSettings = {
                ...settings.plex,
                ip: connection.address,
                port: connection.port,
                useSsl: connection.protocol === 'https',
              };
              const plexClient = new PlexAPI({
                plexToken: admin.plexToken,
                plexSettings: plexDeviceSettings,
                timeout: 5000,
              });

              try {
                await plexClient.getStatus();
                connection.status = 200;
                connection.message = 'OK';
              } catch (e) {
                connection.status = 500;
                connection.message = e.message.split(':')[0];
              }
            })
          );
        })
      );
    }
    return res.status(200).json(devices);
  } catch (e) {
    logger.error('Something went wrong retrieving Plex server list', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve Plex server list.',
    });
  }
});

settingsRoutes.get('/plex/library', async (req, res) => {
  const settings = getSettings();

  if (req.query.sync) {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });
    const plexapi = new PlexAPI({
      plexToken: admin.plexToken,
      timeout: 30000, // 30 second timeout
    });

    await plexapi.syncLibraries();
  }

  // Library enabled/disabled feature was removed - no longer needed
  settings.save();
  return res.status(200).json(settings.plex.libraries);
});

settingsRoutes.get('/plex/libraries', async (req, res) => {
  try {
    const userRepository = getRepository(User);
    const admin = await userRepository.findOne({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });

    if (!admin?.plexToken) {
      return res.status(400).json({ error: 'No admin Plex token found' });
    }

    const plexapi = new PlexAPI({ plexToken: admin.plexToken });

    // Sync libraries to settings so they're available for collection operations
    await plexapi.syncLibraries();

    // Return the libraries that were just synced to settings
    // This ensures UI and backend always see the same library data
    const settings = getSettings();
    return res.status(200).json(settings.plex.libraries);
  } catch (error) {
    logger.error('Failed to sync Plex libraries', {
      label: 'Settings Routes',
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: 'Failed to sync Plex libraries' });
  }
});

settingsRoutes.get('/plex/sync', (_req, res) => {
  // Plex sync not needed for collections-only app
  return res.status(200).json({ running: false, progress: 0, total: 0 });
});

settingsRoutes.post('/plex/sync', (req, res) => {
  // Plex sync not needed for collections-only app
  return res.status(200).json({ running: false, progress: 0, total: 0 });
});

settingsRoutes.get('/tautulli', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.tautulli);
});

// MyAnimeList settings
settingsRoutes.get('/myanimelist', (_req, res) => {
  const settings = getSettings();
  return res.status(200).json(settings.myanimelist || {});
});

settingsRoutes.post('/myanimelist', (req, res) => {
  const settings = getSettings();
  settings.myanimelist = settings.myanimelist || {};
  settings.myanimelist.apiKey = req.body.apiKey;
  settings.save();

  return res.status(200).json(settings.myanimelist);
});

settingsRoutes.post('/myanimelist/test', async (req, res, next) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return next({
        status: 400,
        message: 'API key is required',
      });
    }

    // Temporarily set the API key for testing
    const settings = getSettings();
    const originalApiKey = settings.myanimelist?.apiKey;
    settings.myanimelist = settings.myanimelist || {};
    settings.myanimelist.apiKey = apiKey;

    try {
      // Test by attempting to fetch ranked anime with the provided API key
      await getRankedAnime('all', 5);

      return res.status(200).json({
        success: true,
      });
    } finally {
      // Restore original API key
      if (originalApiKey) {
        settings.myanimelist.apiKey = originalApiKey;
      } else {
        settings.myanimelist.apiKey = undefined;
      }
    }
  } catch (error: unknown) {
    let status = 500;
    let message = 'Unable to connect to MyAnimeList';

    const statusFromError =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof (error as { status?: number }).status === 'number'
        ? (error as { status?: number }).status
        : undefined;

    if (typeof statusFromError === 'number') {
      status = statusFromError;
    }

    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof (error as { message?: string }).message === 'string'
        ? (error as { message?: string }).message
        : undefined;

    if (status === 400 || status === 401 || status === 403) {
      message = 'Invalid API key - Authentication failed';
    } else if (status === 404) {
      message = 'MyAnimeList API endpoint not found';
    } else if (status === 429) {
      message = 'Rate limit exceeded - Try again later';
    } else if (errorMessage) {
      message = errorMessage;
    }

    logger.error('MyAnimeList connection test failed', {
      label: 'MyAnimeList Connection',
      error: errorMessage,
      errorType: error instanceof Error ? error.constructor?.name : undefined,
      httpStatus: status,
    });

    return next({
      status,
      message,
    });
  }
});

settingsRoutes.post('/tautulli', async (req, res) => {
  const settings = getSettings();

  Object.assign(settings.tautulli, req.body);
  settings.save();

  return res.status(200).json(settings.tautulli);
});

settingsRoutes.post('/tautulli/test', async (req, res, next) => {
  const startTime = Date.now();

  logger.debug('Tautulli connection test requested', {
    label: 'Tautulli Connection',
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
    logger.debug('Testing Tautulli connection', {
      label: 'Tautulli Connection',
      url: connectionUrl,
      apiKeyLength: apiKey.length,
    });

    const tautulliClient = new TautulliAPI(settings);
    const result = await tautulliClient.getInfo();

    if (!result || !result.tautulli_version) {
      throw new Error('Unable to connect to Tautulli');
    }

    logger.info('Tautulli connection test successful', {
      label: 'Tautulli Connection',
      responseTime: Date.now() - startTime,
    });

    return res.status(200).json({
      success: true,
    });
  } catch (e) {
    const connectionUrl = `${req.body.useSsl ? 'https' : 'http'}://${
      req.body.hostname
    }:${req.body.port}${req.body.urlBase || ''}`;

    // Determine appropriate status code and message based on error type
    let status = 500;
    let message = 'Unable to connect to Tautulli';

    // Check if it's an axios error with response
    if (e.response) {
      status = e.response.status;

      if (status === 400 || status === 401 || status === 403) {
        // Tautulli returns 400 for invalid API keys
        message = 'Invalid API key - Authentication failed';
      } else if (status === 404) {
        message = 'Tautulli API not found - Check URL base and port';
      } else {
        message = `Tautulli returned error: ${
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

    logger.error('Tautulli connection test failed', {
      label: 'Tautulli Connection',
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

settingsRoutes.get('/maintainerr', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.maintainerr);
});

settingsRoutes.post('/maintainerr', async (req, res) => {
  const settings = getSettings();

  Object.assign(settings.maintainerr, req.body);
  settings.save();

  return res.status(200).json(settings.maintainerr);
});

settingsRoutes.post('/maintainerr/test', async (req, res, next) => {
  const startTime = Date.now();

  logger.debug('Maintainerr connection test requested', {
    label: 'Maintainerr Connection',
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
    logger.debug('Testing Maintainerr connection', {
      label: 'Maintainerr Connection',
      url: connectionUrl,
      apiKeyLength: apiKey.length,
    });

    const maintainerrClient = new MaintainerrAPI(settings);
    const collections = await maintainerrClient.getCollections();

    if (!Array.isArray(collections)) {
      throw new Error('Invalid response from Maintainerr API');
    }

    logger.info('Maintainerr connection test successful', {
      label: 'Maintainerr Connection',
      responseTime: Date.now() - startTime,
      collectionsFound: collections.length,
    });

    return res.status(200).json({
      success: true,
    });
  } catch (e) {
    const connectionUrl = `${req.body.useSsl ? 'https' : 'http'}://${
      req.body.hostname
    }:${req.body.port}${req.body.urlBase || ''}`;

    let status = 500;
    let message = 'Unable to connect to Maintainerr';

    if (e.response) {
      status = e.response.status;

      if (status === 400 || status === 401 || status === 403) {
        message = 'Invalid API key - Authentication failed';
      } else if (status === 404) {
        message = 'Maintainerr API not found - Check URL base and port';
      } else {
        message = `Maintainerr returned error: ${
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

    logger.error('Maintainerr connection test failed', {
      label: 'Maintainerr Connection',
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

settingsRoutes.get('/trakt', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.trakt);
});

settingsRoutes.post('/trakt', async (req, res) => {
  const settings = getSettings();

  Object.assign(settings.trakt, req.body);
  settings.save();

  return res.status(200).json(settings.trakt);
});

settingsRoutes.post('/trakt/test', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const settings = getSettings();
    const { clientId, clientSecret, accessToken, refreshToken } = {
      clientId:
        req.body.clientId || settings.trakt.clientId || settings.trakt.apiKey,
      clientSecret: req.body.clientSecret || settings.trakt.clientSecret,
      accessToken: req.body.accessToken || settings.trakt.accessToken,
      refreshToken: req.body.refreshToken || settings.trakt.refreshToken,
    };
    const redirectUri = getTraktRedirectUri(req);

    if (!clientId) {
      return next({
        status: 400,
        message: 'Client ID is required',
      });
    }

    // Determine mode: Basic (clientId only) or OAuth (full auth)
    const isOAuthMode = !!(clientSecret && accessToken);

    logger.debug('Trakt connection test requested', {
      label: 'Trakt Connection',
      mode: isOAuthMode ? 'OAuth' : 'Basic',
      clientIdLength: String(clientId).length,
      hasAccessToken: !!accessToken,
      hasClientSecret: !!clientSecret,
    });

    let traktClient: TraktAPI;
    if (isOAuthMode) {
      // OAuth mode: full authentication
      traktClient = new TraktAPI({
        clientId,
        accessToken,
        clientSecret,
        refreshToken,
        tokenExpiresAt: settings.trakt.tokenExpiresAt,
        redirectUri,
        onTokenRefreshed: (tokens) => persistTraktTokens(settings, tokens),
      });
    } else {
      // Basic mode: clientId only (for public endpoints)
      traktClient = new TraktAPI(clientId);
    }
    await traktClient.testConnection();

    logger.info('Trakt connection test successful', {
      label: 'Trakt Connection',
      responseTime: Date.now() - startTime,
    });

    return res.status(200).json({
      success: true,
    });
  } catch (e) {
    // Determine appropriate status code and message based on error type
    let status = 500;
    let message = 'Unable to connect to Trakt';

    // Check if it's an axios error with response
    if (e.response) {
      status = e.response.status;

      if (status === 401 || status === 403) {
        message =
          'Invalid client credentials or access token - Authentication failed';
      } else if (status === 404) {
        message = 'Trakt API endpoint not found';
      } else if (status === 429) {
        message = 'Rate limit exceeded - Try again later';
      } else {
        message = `Trakt returned error: ${
          e.response.statusText || 'Unknown error'
        }`;
      }
    } else if (e.code === 'ECONNREFUSED') {
      message = 'Connection refused - Check network connectivity';
    } else if (e.code === 'ENOTFOUND') {
      message = 'Unable to reach Trakt API - Check network connectivity';
    } else if (e.code === 'ETIMEDOUT') {
      message = 'Connection timeout - Check network connectivity';
    } else if (e.message) {
      message = e.message;
    }

    logger.error('Trakt connection test failed', {
      label: 'Trakt Connection',
      error: e.message,
      errorType: e.constructor?.name,
      errorCode: e.code,
      httpStatus: e.response?.status,
      responseTime: Date.now() - startTime,
    });

    return next({
      status,
      message,
    });
  }
});

settingsRoutes.get('/mdblist', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.mdblist);
});

settingsRoutes.post('/mdblist', async (req, res) => {
  const settings = getSettings();

  Object.assign(settings.mdblist, req.body);
  settings.save();

  return res.status(200).json(settings.mdblist);
});

settingsRoutes.post('/mdblist/test', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return next({
        status: 400,
        message: 'API key is required',
      });
    }

    logger.debug('MDBList connection test requested', {
      label: 'MDBList Connection',
      apiKeyLength: apiKey.length,
    });

    const mdblistClient = new MDBListAPI(apiKey);
    await mdblistClient.testConnection();

    logger.info('MDBList connection test successful', {
      label: 'MDBList Connection',
      responseTime: Date.now() - startTime,
    });

    return res.status(200).json({
      success: true,
    });
  } catch (e) {
    // Determine appropriate status code and message based on error type
    let status = 500;
    let message = 'Unable to connect to MDBList';

    // Check if it's an axios error with response
    if (e.response) {
      status = e.response.status;

      if (status === 401 || status === 403) {
        message = 'Invalid API key - Authentication failed';
      } else if (status === 404) {
        message = 'MDBList API endpoint not found';
      } else if (status === 429) {
        message = 'Rate limit exceeded - Try again later';
      } else {
        message = `MDBList returned error: ${
          e.response.statusText || 'Unknown error'
        }`;
      }
    } else if (e.code === 'ECONNREFUSED') {
      message = 'Connection refused - Check network connectivity';
    } else if (e.code === 'ENOTFOUND') {
      message = 'Unable to reach MDBList API - Check network connectivity';
    } else if (e.code === 'ETIMEDOUT') {
      message = 'Connection timeout - Check network connectivity';
    } else if (e.message) {
      message = e.message;
    }

    logger.error('MDBList connection test failed', {
      label: 'MDBList Connection',
      error: e.message,
      errorType: e.constructor?.name,
      errorCode: e.code,
      httpStatus: e.response?.status,
      responseTime: Date.now() - startTime,
    });

    return next({
      status,
      message,
    });
  }
});

settingsRoutes.get('/overseerr', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.overseerr);
});

settingsRoutes.post('/overseerr', async (req, res) => {
  const settings = getSettings();

  Object.assign(settings.overseerr, req.body);
  settings.save();

  return res.status(200).json(settings.overseerr);
});

settingsRoutes.delete('/overseerr', (req, res) => {
  const settings = getSettings();

  // Clear all Overseerr settings
  settings.overseerr = {};
  settings.save();

  return res.status(200).json(settings.overseerr);
});

settingsRoutes.get('/serviceuser', (_req, res) => {
  const settings = getSettings();
  res.status(200).json(settings.serviceUser);
});

settingsRoutes.post('/serviceuser', async (req, res) => {
  const settings = getSettings();

  Object.assign(settings.serviceUser, req.body);
  settings.save();

  return res.status(200).json(settings.serviceUser);
});

settingsRoutes.get('/plex/users', isAuthenticated(), async (req, res, next) => {
  const userRepository = getRepository(User);
  const qb = userRepository.createQueryBuilder('user');

  try {
    const admin = await userRepository.findOneOrFail({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });
    const plexApi = new PlexTvAPI(admin.plexToken ?? '');
    const plexUsers = (await plexApi.getUsers()).MediaContainer.User.map(
      (user) => user.$
    ).filter((user) => user.email);

    const unimportedPlexUsers: {
      id: string;
      title: string;
      username: string;
      email: string;
      thumb: string;
    }[] = [];

    const existingUsers = await qb
      .where('user.plexId IN (:...plexIds)', {
        plexIds: plexUsers.map((plexUser) => plexUser.id),
      })
      .orWhere('user.email IN (:...plexEmails)', {
        plexEmails: plexUsers.map((plexUser) => plexUser.email.toLowerCase()),
      })
      .getMany();

    await Promise.all(
      plexUsers.map(async (plexUser) => {
        if (
          !existingUsers.find(
            (user) =>
              user.plexId === parseInt(plexUser.id) ||
              user.email === plexUser.email.toLowerCase()
          ) &&
          (await plexApi.checkUserAccess(parseInt(plexUser.id)))
        ) {
          unimportedPlexUsers.push(plexUser);
        }
      })
    );

    return res.status(200).json(sortBy(unimportedPlexUsers, 'username'));
  } catch (e) {
    logger.error('Something went wrong getting unimported Plex users', {
      label: 'API',
      errorMessage: e.message,
    });
    next({
      status: 500,
      message: 'Unable to retrieve unimported Plex users.',
    });
  }
});

settingsRoutes.get(
  '/logs',
  rateLimit({ windowMs: 60 * 1000, max: 50 }),
  (req, res, next) => {
    const pageSize = req.query.take ? Number(req.query.take) : 25;
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const search = (req.query.search as string) ?? '';
    const searchRegexp = new RegExp(escapeRegExp(search), 'i');

    let filter: string[] = [];
    switch (req.query.filter) {
      case 'debug':
        filter.push('debug');
      // falls through
      case 'info':
        filter.push('info');
      // falls through
      case 'warn':
        filter.push('warn');
      // falls through
      case 'error':
        filter.push('error');
        break;
      default:
        filter = ['debug', 'info', 'warn', 'error'];
    }

    const logFile = process.env.CONFIG_DIRECTORY
      ? `${process.env.CONFIG_DIRECTORY}/logs/.machinelogs.json`
      : path.join(__dirname, '../../../config/logs/.machinelogs.json');
    const logs: LogMessage[] = [];
    const logMessageProperties = [
      'timestamp',
      'level',
      'label',
      'message',
      'data',
    ];

    const deepValueStrings = (obj: Record<string, unknown>): string[] => {
      const values = [];

      for (const val of Object.values(obj)) {
        if (typeof val === 'string') {
          values.push(val);
        } else if (typeof val === 'number') {
          values.push(val.toString());
        } else if (val !== null && typeof val === 'object') {
          values.push(...deepValueStrings(val as Record<string, unknown>));
        }
      }

      return values;
    };

    try {
      fs.readFileSync(logFile, 'utf-8')
        .split('\n')
        .forEach((line) => {
          if (!line.length) return;

          const logMessage = JSON.parse(line);

          if (!filter.includes(logMessage.level)) {
            return;
          }

          if (
            !Object.keys(logMessage).every((key) =>
              logMessageProperties.includes(key)
            )
          ) {
            Object.keys(logMessage)
              .filter((prop) => !logMessageProperties.includes(prop))
              .forEach((prop) => {
                set(logMessage, `data.${prop}`, logMessage[prop]);
              });
          }

          if (req.query.search) {
            if (
              // label and data are sometimes undefined
              !searchRegexp.test(logMessage.label ?? '') &&
              !searchRegexp.test(logMessage.message) &&
              !deepValueStrings(logMessage.data ?? {}).some((val) =>
                searchRegexp.test(val)
              )
            ) {
              return;
            }
          }

          logs.push(logMessage);
        });

      const displayedLogs = logs.reverse().slice(skip, skip + pageSize);

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(logs.length / pageSize),
          pageSize,
          results: logs.length,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: displayedLogs,
      } as LogsResultsResponse);
    } catch (error) {
      logger.error('Something went wrong while retrieving logs', {
        label: 'Logs',
        errorMessage: error.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve logs.',
      });
    }
  }
);

settingsRoutes.get('/jobs', (_req, res) => {
  return res.status(200).json(
    scheduledJobs.map((job) => {
      const nextExecution = job.job.nextInvocation();
      let followingExecution: Date | null = null;

      if (nextExecution && job.cronSchedule) {
        try {
          // Add 1 second to nextExecution to ensure we get the occurrence AFTER it
          const startDate = new Date(new Date(nextExecution).getTime() + 1000);
          const interval = parser.parse(job.cronSchedule, {
            currentDate: startDate,
          });
          followingExecution = interval.next().toDate(); // Get execution AFTER nextExecution
        } catch (error) {
          // If cron parsing fails, followingExecution stays null
        }
      }

      return {
        id: job.id,
        name: job.name,
        type: job.type,
        interval: job.interval,
        cronSchedule: job.cronSchedule,
        nextExecutionTime: nextExecution,
        followingExecutionTime: followingExecution,
        running: job.running ? job.running() : false,
      };
    })
  );
});

settingsRoutes.post<{ jobId: string }>('/jobs/:jobId/run', (req, res, next) => {
  const scheduledJob = scheduledJobs.find((job) => job.id === req.params.jobId);

  if (!scheduledJob) {
    return next({ status: 404, message: 'Job not found.' });
  }

  scheduledJob.job.invoke();

  const nextExecution = scheduledJob.job.nextInvocation();
  let followingExecution: Date | null = null;

  if (nextExecution && scheduledJob.cronSchedule) {
    try {
      // Add 1 second to nextExecution to ensure we get the occurrence AFTER it
      const startDate = new Date(new Date(nextExecution).getTime() + 1000);
      const interval = parser.parse(scheduledJob.cronSchedule, {
        currentDate: startDate,
      });
      followingExecution = interval.next().toDate(); // Get execution AFTER nextExecution
    } catch (error) {
      // If cron parsing fails, followingExecution stays null
    }
  }

  return res.status(200).json({
    id: scheduledJob.id,
    name: scheduledJob.name,
    type: scheduledJob.type,
    interval: scheduledJob.interval,
    cronSchedule: scheduledJob.cronSchedule,
    nextExecutionTime: nextExecution,
    followingExecutionTime: followingExecution,
    running: scheduledJob.running ? scheduledJob.running() : false,
  });
});

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/cancel',
  (req, res, next) => {
    const scheduledJob = scheduledJobs.find(
      (job) => job.id === req.params.jobId
    );

    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    if (scheduledJob.cancelFn) {
      scheduledJob.cancelFn();
    }

    const nextExecution = scheduledJob.job.nextInvocation();
    let followingExecution: Date | null = null;

    if (nextExecution && scheduledJob.cronSchedule) {
      try {
        // Add 1 second to nextExecution to ensure we get the occurrence AFTER it
        const startDate = new Date(new Date(nextExecution).getTime() + 1000);
        const interval = parser.parse(scheduledJob.cronSchedule, {
          currentDate: startDate,
        });
        followingExecution = interval.next().toDate(); // Get execution AFTER nextExecution
      } catch (error) {
        // If cron parsing fails, followingExecution stays null
      }
    }

    return res.status(200).json({
      id: scheduledJob.id,
      name: scheduledJob.name,
      type: scheduledJob.type,
      interval: scheduledJob.interval,
      cronSchedule: scheduledJob.cronSchedule,
      nextExecutionTime: nextExecution,
      followingExecutionTime: followingExecution,
      running: scheduledJob.running ? scheduledJob.running() : false,
    });
  }
);

settingsRoutes.post<{ jobId: JobId }>(
  '/jobs/:jobId/schedule',
  (req, res, next) => {
    const scheduledJob = scheduledJobs.find(
      (job) => job.id === req.params.jobId
    );

    if (!scheduledJob) {
      return next({ status: 404, message: 'Job not found.' });
    }

    const result = rescheduleJob(scheduledJob.job, req.body.schedule);
    const settings = getSettings();

    if (result) {
      settings.jobs[scheduledJob.id].schedule = req.body.schedule;
      settings.save();

      scheduledJob.cronSchedule = req.body.schedule;

      const nextExecution = scheduledJob.job.nextInvocation();
      let followingExecution: Date | null = null;

      if (nextExecution && scheduledJob.cronSchedule) {
        try {
          // Add 1 second to nextExecution to ensure we get the occurrence AFTER it
          const startDate = new Date(new Date(nextExecution).getTime() + 1000);
          const interval = parser.parse(scheduledJob.cronSchedule, {
            currentDate: startDate,
          });
          followingExecution = interval.next().toDate(); // Get execution AFTER nextExecution
        } catch (error) {
          // If cron parsing fails, followingExecution stays null
        }
      }

      return res.status(200).json({
        id: scheduledJob.id,
        name: scheduledJob.name,
        type: scheduledJob.type,
        interval: scheduledJob.interval,
        cronSchedule: scheduledJob.cronSchedule,
        nextExecutionTime: nextExecution,
        followingExecutionTime: followingExecution,
        running: scheduledJob.running ? scheduledJob.running() : false,
      });
    } else {
      return next({
        status: 400,
        message:
          'Invalid CRON expression. Must be 6-part format (second minute hour day month weekday). Examples: "0 */15 * * * *" (every 15 min), "0 0 */6 * * *" (every 6 hours)',
      });
    }
  }
);

settingsRoutes.get('/cache', async (_req, res) => {
  const cacheManagerCaches = cacheManager.getAllCaches();

  const apiCaches = Object.values(cacheManagerCaches).map((cache) => ({
    id: cache.id,
    name: cache.name,
    stats: cache.getStats(),
  }));

  // TMDB image cache stats removed - imageproxy not needed for collections-only app

  return res.status(200).json({
    apiCaches,
    // imageCache removed - not needed for collections-only app
  });
});

settingsRoutes.post<{ cacheId: AvailableCacheIds }>(
  '/cache/:cacheId/flush',
  (req, res, next) => {
    const cache = cacheManager.getCache(req.params.cacheId);

    if (cache) {
      cache.flush();
      return res.status(204).send();
    }

    next({ status: 404, message: 'Cache not found.' });
  }
);

settingsRoutes.post('/initialize', isAuthenticated(), (_req, res) => {
  const settings = getSettings();

  settings.public.initialized = true;
  settings.save();

  return res.status(200).json(settings.public);
});

settingsRoutes.get('/about', async (req, res) => {
  const mediaRepository = getRepository(Media);
  // MediaRequest functionality removed for Agregarr

  const totalMediaItems = await mediaRepository.count();
  const totalRequests = 0; // Request system removed

  return res.status(200).json({
    version: getAppVersion(),
    totalMediaItems,
    totalRequests,
    tz: process.env.TZ,
    appDataPath: appDataPath(),
  } as SettingsAboutResponse);
});

settingsRoutes.post('/reset', async (_req, res, next) => {
  try {
    logger.info(
      'Manual reset requested - cleaning up all agregarr collections',
      {
        label: 'Settings Reset',
      }
    );

    const collectionsSync = await import('@server/lib/collectionsSync');
    await collectionsSync.default.cleanupCollections();

    // Clean up ALL placeholder records and files
    try {
      const { getRepository } = await import('@server/datasource');
      const { PlaceholderItem } = await import(
        '@server/entity/PlaceholderItem'
      );
      const path = await import('path');
      const settings = getSettings();

      const repository = getRepository(PlaceholderItem);
      const allPlaceholders = await repository.find();

      if (allPlaceholders.length > 0) {
        logger.info(
          `Cleaning up ${allPlaceholders.length} placeholder records during reset`,
          {
            label: 'Settings Reset',
            recordCount: allPlaceholders.length,
          }
        );

        let filesRemoved = 0;
        const filesToDelete = new Set<string>(); // Track unique file paths
        const { getPlaceholderRootFolder } = await import(
          '@server/lib/placeholders/helpers/placeholderPathHelpers'
        );

        // Collect unique file paths to delete from ALL libraries
        for (const record of allPlaceholders) {
          if (record.placeholderPath) {
            // Try to find placeholder in any library with configured folder
            for (const library of settings.plex.libraries) {
              if (library.type !== record.mediaType) continue;

              const libraryPath = getPlaceholderRootFolder(
                library.key,
                record.mediaType
              );
              if (libraryPath) {
                const fullPath = path.join(libraryPath, record.placeholderPath);
                filesToDelete.add(fullPath);
              }
            }
          }
        }

        // Delete all unique placeholder files
        if (filesToDelete.size > 0) {
          const { removePlaceholder } = await import(
            '@server/lib/placeholders/placeholderManager'
          );

          for (const fullPath of filesToDelete) {
            try {
              // Determine media type from filename pattern
              const mediaType = fullPath.includes('{edition-Trailer}')
                ? 'movie'
                : 'tv';
              await removePlaceholder(fullPath, mediaType);
              filesRemoved++;
            } catch (error) {
              // File might already be gone - that's ok
              if (error instanceof Error && !error.message.includes('ENOENT')) {
                logger.warn('Failed to remove placeholder file during reset', {
                  label: 'Settings Reset',
                  path: fullPath,
                  error: error.message,
                });
              } else {
                filesRemoved++; // File doesn't exist - consider it removed
              }
            }
          }
        }

        // Delete all database records
        await repository.remove(allPlaceholders);

        logger.info('Placeholder cleanup completed during reset', {
          label: 'Settings Reset',
          recordsRemoved: allPlaceholders.length,
          filesRemoved,
        });
      }
    } catch (error) {
      logger.warn('Failed to cleanup placeholder records during reset', {
        label: 'Settings Reset',
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with reset even if placeholder cleanup fails
    }

    logger.info('Manual reset completed successfully', {
      label: 'Settings Reset',
    });

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    logger.error('Manual reset failed', {
      label: 'Settings Reset',
      error: error instanceof Error ? error.message : String(error),
    });

    return next({
      status: 500,
      message: `Failed to reset collections: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    });
  }
});

// Watchlist Sync Settings
settingsRoutes.get('/watchlistsync', (req, res) => {
  const settings = getSettings();
  return res.status(200).json(settings.watchlistSync);
});

settingsRoutes.post('/watchlistsync', (req, res) => {
  const settings = getSettings();
  const watchlistSync = req.body as WatchlistSyncSettings;

  settings.watchlistSync = watchlistSync;
  settings.save();

  return res.status(200).json(settings.watchlistSync);
});

settingsRoutes.post('/export-debug', (req, res, next) => {
  try {
    const { includeDatabase, includeSettings, includeLogs } = req.body;
    const configPath = appDataPath();

    logger.info('Debug export requested', {
      label: 'Settings',
      includeDatabase,
      includeSettings,
      includeLogs,
    });

    // Set response headers for file download
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `agregarr-debug-${timestamp}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Create archiver instance
    const archive = archiver('zip', {
      zlib: { level: 9 }, // Maximum compression
    });

    // Handle archiver errors
    archive.on('error', (err) => {
      logger.error('Error creating debug export archive', {
        label: 'Settings',
        errorMessage: err.message,
      });
      next(err);
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add database if requested
    if (includeDatabase) {
      const dbPath = path.join(configPath, 'db', 'db.sqlite3');
      if (fs.existsSync(dbPath)) {
        archive.file(dbPath, { name: 'db/db.sqlite3' });
        logger.debug('Added database to export', { label: 'Settings' });
      } else {
        logger.warn('Database file not found for export', {
          label: 'Settings',
        });
      }
    }

    // Add settings.json if requested
    if (includeSettings) {
      const settingsPath = path.join(configPath, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        archive.file(settingsPath, { name: 'settings.json' });
        logger.debug('Added settings.json to export', { label: 'Settings' });
      } else {
        logger.warn('settings.json not found for export', {
          label: 'Settings',
        });
      }
    }

    // Add logs directory if requested
    if (includeLogs) {
      const logsPath = path.join(configPath, 'logs');
      if (fs.existsSync(logsPath)) {
        archive.directory(logsPath, 'logs');
        logger.debug('Added logs directory to export', { label: 'Settings' });
      } else {
        logger.warn('Logs directory not found for export', {
          label: 'Settings',
        });
      }
    }

    // Finalize the archive
    archive.finalize();

    logger.info('Debug export completed successfully', {
      label: 'Settings',
      filename,
    });
  } catch (error) {
    logger.error('Error during debug export', {
      label: 'Settings',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    next(error);
  }
});

export default settingsRoutes;
