import type {
  MainSettings,
  MDBListSettings,
  MyAnimeListSettings,
  OverseerrSettings,
  RadarrSettings,
  SonarrSettings,
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
    main?: MainSettings;
    trakt?: TraktSettings;
    mdblist?: MDBListSettings;
    tautulli?: TautulliSettings;
    overseerr?: OverseerrSettings;
    myanimelist?: MyAnimeListSettings;
    radarr?: RadarrSettings[];
    sonarr?: SonarrSettings[];
  },
  subtype?: string,
  createPlaceholdersForMissing?: boolean
): ApiKeyValidationResult {
  const requirements: ApiKeyRequirement[] = [];
  // Trakt can work with just clientId (basic mode) OR full OAuth
  const hasTraktBasic = Boolean(
    settings.trakt?.clientId || settings.trakt?.apiKey
  );

  switch (collectionType) {
    case 'trakt':
      requirements.push({
        service: 'Trakt',
        required: true,
        configured: hasTraktBasic,
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

    case 'originals':
      requirements.push({
        service: 'MDBList (Originals use MDBList lists)',
        required: true,
        configured: !!settings.mdblist?.apiKey,
        settingsPath: '/settings/sources',
      });
      break;

    case 'myanimelist':
      requirements.push({
        service: 'MyAnimeList',
        required: true,
        configured: !!settings.myanimelist?.apiKey,
        settingsPath: '/settings/sources',
      });
      break;

    case 'comingsoon': {
      // Coming Soon - check for specific subtypes
      if (subtype === 'trakt_anticipated') {
        requirements.push({
          service: 'Trakt',
          required: true,
          configured: hasTraktBasic,
          settingsPath: '/settings/sources',
        });
      } else if (subtype === 'monitored') {
        // Only 'monitored' subtype requires Radarr/Sonarr (gets data from them)
        const hasRadarr = !!(settings.radarr && settings.radarr.length > 0);
        const hasSonarr = !!(settings.sonarr && settings.sonarr.length > 0);

        if (!hasRadarr) {
          requirements.push({
            service: 'Radarr',
            required: true,
            configured: false,
            settingsPath: '/settings/downloads',
          });
        }
        if (!hasSonarr) {
          requirements.push({
            service: 'Sonarr',
            required: true,
            configured: false,
            settingsPath: '/settings/downloads',
          });
        }
      }
      // tmdb_anticipated doesn't require any API keys (TMDB is free)
      break;
    }

    case 'radarrtag':
      // Radarr Tag requires at least one Radarr instance
      requirements.push({
        service: 'Radarr',
        required: true,
        configured: !!(settings.radarr && settings.radarr.length > 0),
        settingsPath: '/settings/downloads',
      });
      break;

    case 'sonarrtag':
      // Sonarr Tag requires at least one Sonarr instance
      requirements.push({
        service: 'Sonarr',
        required: true,
        configured: !!(settings.sonarr && settings.sonarr.length > 0),
        settingsPath: '/settings/downloads',
      });
      break;

    // These don't require API keys
    case 'imdb':
    case 'tmdb':
    case 'letterboxd':
    case 'networks':
    case 'anilist':
    case 'multi-source':
    case 'recently_added':
    default:
      // No API key requirements
      break;
  }

  // Check if placeholder creation is enabled and requires root folders configured
  if (createPlaceholdersForMissing) {
    const hasMovieRootFolder = !!settings.main?.placeholderMovieRootFolder;
    const hasTVRootFolder = !!settings.main?.placeholderTVRootFolder;

    if (!hasMovieRootFolder) {
      requirements.push({
        service: 'Movie Placeholder Root Folder',
        required: true,
        configured: false,
        settingsPath: '/settings/downloads',
      });
    }
    if (!hasTVRootFolder) {
      requirements.push({
        service: 'TV Placeholder Root Folder',
        required: true,
        configured: false,
        settingsPath: '/settings/downloads',
      });
    }
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
    tmdb: 'TMDB',
    imdb: 'IMDb',
    letterboxd: 'Letterboxd',
    networks: 'Networks',
    originals: 'Originals',
    anilist: 'AniList',
    myanimelist: 'MyAnimeList',
  };

  return serviceNames[serviceType] || serviceType;
}
