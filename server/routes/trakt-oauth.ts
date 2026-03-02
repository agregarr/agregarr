import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { TRAKT_OOB_REDIRECT_URI } from '@server/utils/traktAuth';
import axios from 'axios';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

const traktOAuthRoutes = Router();

const TRAKT_STATE_TTL = 10 * 60 * 1000;
const traktStateStore = new Map<string, number>();

const clearExpiredTraktStates = () => {
  const now = Date.now();
  for (const [state, expiresAt] of traktStateStore.entries()) {
    if (expiresAt <= now) {
      traktStateStore.delete(state);
    }
  }
};

async function exchangeTraktOauth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const {
      code,
      clientId: bodyClientId,
      clientSecret: bodyClientSecret,
    } = req.body;
    const settings = getSettings();
    const clientId =
      bodyClientId || settings.trakt.clientId || settings.trakt.apiKey;
    const clientSecret = bodyClientSecret || settings.trakt.clientSecret;
    const redirectUri = TRAKT_OOB_REDIRECT_URI;

    if (!code) {
      return next({ status: 400, message: 'Authorization code is required' });
    }

    if (!clientId || !clientSecret) {
      return next({
        status: 400,
        message: 'Client ID and Client Secret are required',
      });
    }

    const tokenResponse = await axios.post(
      'https://api.trakt.tv/oauth/token',
      {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    settings.trakt.clientId = clientId;
    settings.trakt.clientSecret = clientSecret;
    settings.trakt.accessToken = tokenResponse.data.access_token;
    settings.trakt.refreshToken = tokenResponse.data.refresh_token;
    settings.trakt.tokenExpiresAt =
      Date.now() + (tokenResponse.data.expires_in || 0) * 1000;
    settings.save();

    return res.status(200).json({
      success: true,
      accessToken: settings.trakt.accessToken,
      refreshToken: settings.trakt.refreshToken,
      tokenExpiresAt: settings.trakt.tokenExpiresAt,
    });
  } catch (e) {
    const status = e.response?.status || 500;
    const traktMessage =
      e.response?.data?.error_description ||
      e.response?.data?.error ||
      e.response?.data?.message;

    logger.error('Trakt OAuth exchange failed', {
      label: 'Trakt OAuth',
      error: e instanceof Error ? e.message : String(e),
      status: e.response?.status,
      data: e.response?.data,
    });
    return next({
      status,
      message:
        traktMessage ||
        'Failed to exchange Trakt authorization code. Please verify the code and try again.',
    });
  }
}

function startTraktOauth(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = getSettings();
    const clientId = settings.trakt.clientId || settings.trakt.apiKey;
    const clientSecret = settings.trakt.clientSecret;
    const redirectUri = TRAKT_OOB_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      return next({
        status: 400,
        message:
          'Client ID and Client Secret are required before starting OAuth',
      });
    }

    clearExpiredTraktStates();
    const state = randomUUID();
    traktStateStore.set(state, Date.now() + TRAKT_STATE_TTL);

    const authUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}`;

    return res.status(200).json({ url: authUrl, state });
  } catch (e) {
    return next({
      status: 500,
      message: 'Unable to start Trakt OAuth flow',
    });
  }
}

function proxyTraktOauth(req: Request, res: Response, next: NextFunction) {
  try {
    const { state } = req.query;
    const settings = getSettings();
    const clientId = settings.trakt.clientId || settings.trakt.apiKey;
    const clientSecret = settings.trakt.clientSecret;
    const redirectUri = TRAKT_OOB_REDIRECT_URI;

    if (!state || typeof state !== 'string') {
      return next({ status: 400, message: 'Missing OAuth state' });
    }

    clearExpiredTraktStates();
    const stateExpiry = traktStateStore.get(state);
    if (!stateExpiry || stateExpiry < Date.now()) {
      return next({ status: 400, message: 'Invalid or expired OAuth state' });
    }

    if (!clientId || !clientSecret) {
      return next({
        status: 400,
        message: 'Client ID and Client Secret are required',
      });
    }

    const authUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${state}`;

    return res.redirect(authUrl);
  } catch (e) {
    return next({
      status: 500,
      message: 'Unable to redirect to Trakt',
    });
  }
}

async function callbackTraktOauth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { code, state } = req.query;
    const settings = getSettings();
    const redirectUri = TRAKT_OOB_REDIRECT_URI;

    if (!code || typeof code !== 'string') {
      return next({ status: 400, message: 'Missing authorization code' });
    }

    if (!state || typeof state !== 'string') {
      return next({ status: 400, message: 'Missing OAuth state' });
    }

    clearExpiredTraktStates();
    const stateExpiry = traktStateStore.get(state);
    traktStateStore.delete(state);

    if (!stateExpiry || stateExpiry < Date.now()) {
      return next({ status: 400, message: 'Invalid or expired OAuth state' });
    }

    const clientId = settings.trakt.clientId || settings.trakt.apiKey;
    const clientSecret = settings.trakt.clientSecret;

    if (!clientId || !clientSecret || !redirectUri) {
      return next({
        status: 400,
        message: 'Client ID, Client Secret, and redirect URI are required',
      });
    }

    const tokenResponse = await axios.post(
      'https://api.trakt.tv/oauth/token',
      {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    settings.trakt.accessToken = tokenResponse.data.access_token;
    settings.trakt.refreshToken = tokenResponse.data.refresh_token;
    settings.trakt.tokenExpiresAt =
      Date.now() + (tokenResponse.data.expires_in || 0) * 1000;
    settings.save();

    const targetBase =
      settings.main.applicationUrl ||
      `${req.protocol}://${req.get('host') || 'localhost'}`;

    return res.redirect(
      `${targetBase.replace(/\/$/, '')}/settings/sources?traktAuth=success`
    );
  } catch (e) {
    const traktMessage =
      e.response?.data?.error_description ||
      e.response?.data?.error ||
      e.response?.data?.message;

    logger.error('Trakt OAuth callback failed', {
      label: 'Trakt OAuth',
      error: e instanceof Error ? e.message : String(e),
      status: e.response?.status,
      data: e.response?.data,
    });

    const targetBase =
      (await getSettings()).main.applicationUrl ||
      `${req.protocol}://${req.get('host') || 'localhost'}`;

    return res.redirect(
      `${targetBase.replace(
        /\/$/,
        ''
      )}/settings/sources?traktAuth=error&message=${encodeURIComponent(
        traktMessage || 'OAuth callback failed'
      )}`
    );
  }
}

traktOAuthRoutes.get('/oauth/proxy', isAuthenticated(), proxyTraktOauth);
traktOAuthRoutes.get('/oauth/callback', callbackTraktOauth); // must remain open: Trakt redirects here
traktOAuthRoutes.post('/oauth/exchange', isAuthenticated(), exchangeTraktOauth);
traktOAuthRoutes.get('/oauth/start', isAuthenticated(), startTraktOauth);

export default traktOAuthRoutes;
