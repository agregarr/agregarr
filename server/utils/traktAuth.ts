import type Settings from '@server/lib/settings';
import type { Request } from 'express';

export const TRAKT_OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

export interface TraktTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export const buildTraktRedirectUri = (
  settings?: Settings,
  req?: Request
): string => {
  const baseUrl =
    settings?.main?.applicationUrl ||
    (req ? `${req.protocol}://${req.get('host')}` : '');

  if (!baseUrl) {
    return TRAKT_OOB_REDIRECT_URI;
  }

  return `${baseUrl.replace(/\/$/, '')}/api/v1/trakt/oauth/callback`;
};

export const persistTraktTokens = (
  settings: Settings,
  tokens: TraktTokenSet
): void => {
  settings.trakt.accessToken = tokens.accessToken;
  settings.trakt.refreshToken = tokens.refreshToken;
  settings.trakt.tokenExpiresAt = tokens.expiresAt;
  settings.save();
};
