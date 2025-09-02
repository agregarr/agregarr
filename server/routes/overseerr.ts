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
    const result = await overseerrClient.testConnection();

    if (!result.success) {
      throw new Error('Unable to connect to Overseerr');
    }

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

    logger.info('Overseerr connection test successful', {
      label: 'Overseerr Connection',
      version: result.version,
      responseTime: Date.now() - startTime,
      templateDataSuccess,
    });

    return res.status(200).json({
      success: true,
      version: result.version,
      templateDataSuccess,
      templateDataMessage,
    });
  } catch (e) {
    const connectionUrl = `${req.body.useSsl ? 'https' : 'http'}://${
      req.body.hostname
    }:${req.body.port}${req.body.urlBase || ''}`;

    logger.error('Overseerr connection test failed', {
      label: 'Overseerr Connection',
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
      message: `Unable to connect to Overseerr at ${connectionUrl}: ${e.message}`,
    });
  }
});

export default router;
