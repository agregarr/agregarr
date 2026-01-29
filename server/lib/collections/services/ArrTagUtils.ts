import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import type {
  CollectionConfig,
  RadarrSettings,
  SonarrSettings,
  TagRequestsMode,
} from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Source type for tag generation
 */
export type TagSource =
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'anilist'
  | 'myanimelist'
  | 'mdblist'
  | 'networks'
  | 'originals'
  | 'multi-source'
  | 'tautulli'
  | 'overseerr'
  | 'radarrtag'
  | 'sonarrtag';

const SOURCE_LABELS: Record<TagSource, string> = {
  trakt: 'Trakt',
  tmdb: 'Tmdb',
  imdb: 'Imdb',
  letterboxd: 'Letterboxd',
  anilist: 'Anilist',
  myanimelist: 'MyAnimeList',
  mdblist: 'Mdblist',
  networks: 'Networks',
  originals: 'Originals',
  'multi-source': 'MultiSource',
  tautulli: 'Tautulli',
  overseerr: 'Overseerr',
  radarrtag: 'RadarrTag',
  sonarrtag: 'SonarrTag',
};

function resolveTagMode(
  mode: TagRequestsMode | undefined,
  legacyEnabled: boolean | undefined
): TagRequestsMode {
  if (mode === 'off' || mode === 'single' || mode === 'per-service') {
    return mode;
  }

  if (mode === 'granular') {
    return 'granular';
  }

  return legacyEnabled ? 'granular' : 'off';
}

function slugifyTagSegment(segment?: string): string {
  if (!segment) {
    return '';
  }

  return segment
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * Minimal config required for tag generation
 */
export interface TagGenerationConfig {
  subtype?: string;
  name?: string;
}

/**
 * Generate the auto collection tag label based on source, config, and tag mode
 */
export function generateCollectionTag(
  config: TagGenerationConfig,
  source: TagSource,
  mode: TagRequestsMode | undefined,
  legacyEnabled?: boolean
): string | null {
  const resolvedMode = resolveTagMode(mode, legacyEnabled);

  if (resolvedMode === 'off') {
    return null;
  }

  const baseTag = 'agregarr';

  if (resolvedMode === 'single') {
    return baseTag;
  }

  const sourceSegment = slugifyTagSegment(SOURCE_LABELS[source] ?? source);

  if (resolvedMode === 'per-service') {
    const segments = [sourceSegment, baseTag].filter(Boolean);
    return segments.join('-') || baseTag;
  }

  const subtypeSegment = slugifyTagSegment(config.subtype);
  const collectionSegment = subtypeSegment || slugifyTagSegment(config.name);

  const segments = [sourceSegment, collectionSegment, baseTag].filter(
    (value) => value && value.length > 0
  );

  return segments.join('-') || baseTag;
}

/**
 * Get or create a Radarr API client for a specific server
 */
export function getRadarrAPI(serverId?: number | null): RadarrAPI {
  const settings = getSettings();
  let radarrSettings: RadarrSettings | undefined;

  if (serverId !== undefined && serverId !== null) {
    radarrSettings = settings.radarr.find((r) => r.id === serverId);
  }

  if (!radarrSettings) {
    radarrSettings = settings.radarr.find((r) => r.isDefault);
  }

  if (!radarrSettings) {
    throw new Error('No Radarr configuration found');
  }

  return new RadarrAPI({
    url: RadarrAPI.buildUrl(radarrSettings, '/api/v3'),
    apiKey: radarrSettings.apiKey,
  });
}

/**
 * Get or create a Sonarr API client for a specific server
 */
export function getSonarrAPI(serverId?: number | null): SonarrAPI {
  const settings = getSettings();
  let sonarrSettings: SonarrSettings | undefined;

  if (serverId !== undefined && serverId !== null) {
    sonarrSettings = settings.sonarr.find((s) => s.id === serverId);
  }

  if (!sonarrSettings) {
    sonarrSettings = settings.sonarr.find((s) => s.isDefault);
  }

  if (!sonarrSettings) {
    throw new Error('No Sonarr configuration found');
  }

  return new SonarrAPI({
    url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
    apiKey: sonarrSettings.apiKey,
  });
}

/**
 * Get Radarr tags including server defaults and auto-generated collection tag
 * Creates the tag in Radarr if it doesn't exist
 */
export async function getRadarrTagsWithCollection(
  radarrSettings: RadarrSettings,
  config: CollectionConfig,
  source: TagSource
): Promise<number[]> {
  const tags = [...(radarrSettings.tags || [])];

  const autoTagLabel = generateCollectionTag(
    config,
    source,
    radarrSettings.tagRequestsMode,
    radarrSettings.tagRequests
  );

  const tagMatches = (label?: string): boolean =>
    !!autoTagLabel && label?.toLowerCase() === autoTagLabel.toLowerCase();

  if (autoTagLabel) {
    const radarrAPI = getRadarrAPI(radarrSettings.id);

    let collectionTag = (await radarrAPI.getTags()).find((tag) =>
      tagMatches(tag.label)
    );

    if (!collectionTag) {
      logger.info(`Collection has no active tag. Creating new`, {
        label: 'Arr Tag Utils',
        collection: config.name,
        newTag: autoTagLabel,
      });
      try {
        collectionTag = await radarrAPI.createTag({
          label: autoTagLabel,
        });
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        if (status === 409) {
          // Tag already exists - fetch again to retrieve its ID
          collectionTag = (await radarrAPI.getTags()).find((tag) =>
            tagMatches(tag.label)
          );
        }

        if (!collectionTag) {
          logger.error(
            `Failed to create tag for collection - continuing without tag`,
            {
              label: 'Arr Tag Utils',
              collection: config.name,
              tagName: autoTagLabel,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
          // Continue without the collection tag rather than blocking
          return tags;
        }
      }
    }

    if (collectionTag.id) {
      if (!tags?.find((v) => v === collectionTag?.id)) {
        tags?.push(collectionTag.id);
      }
    } else {
      logger.warn(`Collection has no tag and failed to add one`, {
        label: 'Arr Tag Utils',
        collection: config.name,
        radarrServer: radarrSettings.hostname + ':' + radarrSettings.port,
      });
    }
  }

  return tags;
}

/**
 * Get Sonarr tags including server defaults and auto-generated collection tag
 * Creates the tag in Sonarr if it doesn't exist
 */
export async function getSonarrTagsWithCollection(
  sonarrSettings: SonarrSettings,
  config: CollectionConfig,
  source: TagSource
): Promise<number[]> {
  const tags = [...(sonarrSettings.tags || [])];

  const autoTagLabel = generateCollectionTag(
    config,
    source,
    sonarrSettings.tagRequestsMode,
    sonarrSettings.tagRequests
  );

  const tagMatches = (label?: string): boolean =>
    !!autoTagLabel && label?.toLowerCase() === autoTagLabel.toLowerCase();

  if (autoTagLabel) {
    const sonarrAPI = getSonarrAPI(sonarrSettings.id);

    let collectionTag = (await sonarrAPI.getTags()).find((tag) =>
      tagMatches(tag.label)
    );

    if (!collectionTag) {
      logger.info(`Collection has no active tag. Creating new`, {
        label: 'Arr Tag Utils',
        collection: config.name,
        newTag: autoTagLabel,
      });
      try {
        collectionTag = await sonarrAPI.createTag({
          label: autoTagLabel,
        });
      } catch (error) {
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        if (status === 409) {
          collectionTag = (await sonarrAPI.getTags()).find((tag) =>
            tagMatches(tag.label)
          );
        }

        if (!collectionTag) {
          logger.error(
            `Failed to create tag for collection - continuing without tag`,
            {
              label: 'Arr Tag Utils',
              collection: config.name,
              tagName: autoTagLabel,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
          // Continue without the collection tag rather than blocking
          return tags;
        }
      }
    }

    if (collectionTag.id) {
      if (!tags?.find((v) => v === collectionTag?.id)) {
        tags?.push(collectionTag.id);
      }
    } else {
      logger.warn(`Collection has no tag and failed to add one`, {
        label: 'Arr Tag Utils',
        collection: config.name,
        sonarrServer: sonarrSettings.hostname + ':' + sonarrSettings.port,
      });
    }
  }

  return tags;
}

/**
 * Resolve the auto-generated collection tag ID in Radarr (creates if needed)
 * Returns just the auto-generated tag ID, or empty array if tag mode is off
 */
export async function getAutoGeneratedRadarrTagIds(
  radarrSettings: RadarrSettings,
  config: CollectionConfig,
  source: TagSource
): Promise<number[]> {
  const autoTagLabel = generateCollectionTag(
    config,
    source,
    radarrSettings.tagRequestsMode,
    radarrSettings.tagRequests
  );

  if (!autoTagLabel) {
    return [];
  }

  const radarrAPI = getRadarrAPI(radarrSettings.id);
  const tagMatches = (label?: string): boolean =>
    label?.toLowerCase() === autoTagLabel.toLowerCase();

  let collectionTag = (await radarrAPI.getTags()).find((tag) =>
    tagMatches(tag.label)
  );

  if (!collectionTag) {
    try {
      collectionTag = await radarrAPI.createTag({ label: autoTagLabel });
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 409) {
        collectionTag = (await radarrAPI.getTags()).find((tag) =>
          tagMatches(tag.label)
        );
      }
      if (!collectionTag) {
        logger.error('Failed to create auto-generated tag in Radarr', {
          label: 'Arr Tag Utils',
          collection: config.name,
          tagName: autoTagLabel,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return [];
      }
    }
  }

  return collectionTag.id ? [collectionTag.id] : [];
}

/**
 * Resolve the auto-generated collection tag ID in Sonarr (creates if needed)
 * Returns just the auto-generated tag ID, or empty array if tag mode is off
 */
export async function getAutoGeneratedSonarrTagIds(
  sonarrSettings: SonarrSettings,
  config: CollectionConfig,
  source: TagSource
): Promise<number[]> {
  const autoTagLabel = generateCollectionTag(
    config,
    source,
    sonarrSettings.tagRequestsMode,
    sonarrSettings.tagRequests
  );

  if (!autoTagLabel) {
    return [];
  }

  const sonarrAPI = getSonarrAPI(sonarrSettings.id);
  const tagMatches = (label?: string): boolean =>
    label?.toLowerCase() === autoTagLabel.toLowerCase();

  let collectionTag = (await sonarrAPI.getTags()).find((tag) =>
    tagMatches(tag.label)
  );

  if (!collectionTag) {
    try {
      collectionTag = await sonarrAPI.createTag({ label: autoTagLabel });
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      if (status === 409) {
        collectionTag = (await sonarrAPI.getTags()).find((tag) =>
          tagMatches(tag.label)
        );
      }
      if (!collectionTag) {
        logger.error('Failed to create auto-generated tag in Sonarr', {
          label: 'Arr Tag Utils',
          collection: config.name,
          tagName: autoTagLabel,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return [];
      }
    }
  }

  return collectionTag.id ? [collectionTag.id] : [];
}
