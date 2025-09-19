import type {
  MDBListSettings,
  OverseerrSettings,
  TautulliSettings,
  TraktSettings,
} from '@server/lib/settings';

export interface ApiKeyRequirement {
  service: string;
  required: boolean;
  configured: boolean;
  settingsPath: string;
}

export interface ApiKeyValidationResult {
  hasRequiredKeys: boolean;
  missingServices: string[];
  requirements: ApiKeyRequirement[];
}

/**
 * Check which collection types require API keys and whether they are configured
 */
export function validateApiKeysForCollectionType(
  collectionType: string,
  settings: {
    trakt?: TraktSettings;
    mdblist?: MDBListSettings;
    tautulli?: TautulliSettings;
    overseerr?: OverseerrSettings;
  }
): ApiKeyValidationResult {
  const requirements: ApiKeyRequirement[] = [];

  switch (collectionType) {
    case 'trakt':
      requirements.push({
        service: 'Trakt',
        required: true,
        configured: !!settings.trakt?.apiKey,
        settingsPath: '/settings/sources',
      });
      break;

    case 'mdblist':
      requirements.push({
        service: 'MDBList',
        required: true,
        configured: !!settings.mdblist?.apiKey,
        settingsPath: '/settings/sources',
      });
      break;

    case 'tautulli':
      requirements.push({
        service: 'Tautulli',
        required: true,
        configured: !!settings.tautulli?.apiKey,
        settingsPath: '/settings/sources',
      });
      break;

    case 'overseerr':
      requirements.push({
        service: 'Overseerr',
        required: true,
        configured: !!settings.overseerr?.apiKey,
        settingsPath: '/settings/sources',
      });
      break;

    // These don't require API keys
    case 'imdb':
    case 'tmdb':
    case 'letterboxd':
    case 'networks':
    case 'multi-source':
    default:
      // No API key requirements
      break;
  }

  const missingServices = requirements
    .filter((req) => req.required && !req.configured)
    .map((req) => req.service);

  return {
    hasRequiredKeys: missingServices.length === 0,
    missingServices,
    requirements,
  };
}

/**
 * Get user-friendly service names
 */
export function getServiceDisplayName(serviceType: string): string {
  const serviceNames: Record<string, string> = {
    trakt: 'Trakt',
    mdblist: 'MDBList',
    tautulli: 'Tautulli',
    overseerr: 'Overseerr',
    tmdb: 'TMDb',
    imdb: 'IMDb',
    letterboxd: 'Letterboxd',
    networks: 'Networks',
  };

  return serviceNames[serviceType] || serviceType;
}
