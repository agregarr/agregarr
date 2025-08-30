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
import type { JobId, MainSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
// Discover settings routes removed - discovery functionality not needed in Agregarr
import { appDataPath } from '@server/utils/appDataVolume';
import { getAppVersion } from '@server/utils/appVersion';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { escapeRegExp, merge, set, sortBy } from 'lodash';
import { rescheduleJob } from 'node-schedule';
import path from 'path';
import semver from 'semver';
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
    const plexapi = new PlexAPI({ plexToken: admin.plexToken });

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
    const libraries = await plexapi.getLibraries();

    // Return clean library data directly from Plex (no transformation)
    const cleanLibraries = libraries.map((lib) => ({
      key: lib.key,
      name: lib.title,
      type: lib.type, // 'movie' or 'show'
    }));

    return res.status(200).json(cleanLibraries);
  } catch (error) {
    logger.error('Failed to fetch Plex libraries', {
      label: 'Settings Routes',
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: 'Failed to fetch Plex libraries' });
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

    // Check version compatibility but don't fail test if unsupported
    let versionCheckSuccess = false;
    let versionCheckMessage = '';

    try {
      if (!semver.gte(semver.coerce(result.tautulli_version) ?? '', '2.9.0')) {
        versionCheckMessage = `Warning: Tautulli version ${result.tautulli_version} may not be fully supported. Minimum recommended: 2.9.0`;
      } else {
        versionCheckSuccess = true;
        versionCheckMessage = `Version ${result.tautulli_version} is supported`;
      }
    } catch (versionError) {
      versionCheckMessage = `Warning: Could not verify version compatibility - ${versionError.message}`;
    }

    logger.info('Tautulli connection test successful', {
      label: 'Tautulli Connection',
      version: result.tautulli_version,
      responseTime: Date.now() - startTime,
      versionCheckSuccess,
    });

    return res.status(200).json({
      success: true,
      version: result.tautulli_version,
      versionCheckSuccess,
      versionCheckMessage,
    });
  } catch (e) {
    const connectionUrl = `${req.body.useSsl ? 'https' : 'http'}://${
      req.body.hostname
    }:${req.body.port}${req.body.urlBase || ''}`;

    logger.error('Tautulli connection test failed', {
      label: 'Tautulli Connection',
      error: e.message,
      errorType: e.constructor?.name,
      errorCode: e.code,
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
      status: 500,
      message: `Unable to connect to Tautulli at ${connectionUrl}: ${e.message}`,
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
  try {
    const { apiKey } = req.body;

    if (!apiKey) {
      return next({
        status: 400,
        message: 'API key is required',
      });
    }

    const traktClient = new TraktAPI(apiKey);
    const success = await traktClient.testConnection();

    if (!success) {
      throw new Error('Unable to connect to Trakt');
    }

    return res.status(200).json({
      success: true,
    });
  } catch (e) {
    logger.error('Trakt connection test failed', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to connect to Trakt.',
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
    scheduledJobs.map((job) => ({
      id: job.id,
      name: job.name,
      type: job.type,
      interval: job.interval,
      cronSchedule: job.cronSchedule,
      nextExecutionTime: job.job.nextInvocation(),
      running: job.running ? job.running() : false,
    }))
  );
});

settingsRoutes.post<{ jobId: string }>('/jobs/:jobId/run', (req, res, next) => {
  const scheduledJob = scheduledJobs.find((job) => job.id === req.params.jobId);

  if (!scheduledJob) {
    return next({ status: 404, message: 'Job not found.' });
  }

  scheduledJob.job.invoke();

  return res.status(200).json({
    id: scheduledJob.id,
    name: scheduledJob.name,
    type: scheduledJob.type,
    interval: scheduledJob.interval,
    cronSchedule: scheduledJob.cronSchedule,
    nextExecutionTime: scheduledJob.job.nextInvocation(),
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

    return res.status(200).json({
      id: scheduledJob.id,
      name: scheduledJob.name,
      type: scheduledJob.type,
      interval: scheduledJob.interval,
      cronSchedule: scheduledJob.cronSchedule,
      nextExecutionTime: scheduledJob.job.nextInvocation(),
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

      return res.status(200).json({
        id: scheduledJob.id,
        name: scheduledJob.name,
        type: scheduledJob.type,
        interval: scheduledJob.interval,
        cronSchedule: scheduledJob.cronSchedule,
        nextExecutionTime: scheduledJob.job.nextInvocation(),
        running: scheduledJob.running ? scheduledJob.running() : false,
      });
    } else {
      return next({ status: 400, message: 'Invalid job schedule.' });
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

export default settingsRoutes;
