import OverseerrAPI from '@server/api/overseerr';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();

router.post('/test', async (req, res, next) => {
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
        templateDataMessage = `Template variables updated: ${overseerrSettings.applicationTitle}`;
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

    return res.status(200).json({
      success: true,
      version: result.version,
      templateDataSuccess,
      templateDataMessage,
    });
  } catch (e) {
    logger.error('Overseerr connection test failed', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to connect to Overseerr.',
    });
  }
});

export default router;
