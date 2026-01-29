import SonarrAPI from '@server/api/servarr/sonarr';
import {
  generateCollectionTag,
  type TagSource,
} from '@server/lib/collections/services/ArrTagUtils';
import type { SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const sonarrRoutes = Router();

sonarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();

  res.status(200).json(settings.sonarr);
});

sonarrRoutes.post('/', (req, res) => {
  const settings = getSettings();

  const newSonarr = req.body as SonarrSettings;
  const lastItem = settings.sonarr[settings.sonarr.length - 1];
  newSonarr.id = lastItem ? lastItem.id + 1 : 0;

  // If we are setting this as the default, clear any previous defaults for the same type first
  // ex: if is4k is true, it will only remove defaults for other servers that have is4k set to true
  // and are the default
  if (req.body.isDefault) {
    settings.sonarr
      .filter((sonarrInstance) => sonarrInstance.is4k === req.body.is4k)
      .forEach((sonarrInstance) => {
        sonarrInstance.isDefault = false;
      });
  }

  settings.sonarr = [...settings.sonarr, newSonarr];
  settings.save();

  return res.status(201).json(newSonarr);
});

sonarrRoutes.post('/test', async (req, res, next) => {
  try {
    const sonarr = new SonarrAPI({
      apiKey: req.body.apiKey,
      url: SonarrAPI.buildUrl(req.body, '/api/v3'),
    });

    const urlBase = await sonarr
      .getSystemStatus()
      .then((value) => value.urlBase)
      .catch(() => req.body.baseUrl);
    const profiles = await sonarr.getProfiles();
    const folders = await sonarr.getRootFolders();
    const languageProfiles = await sonarr.getLanguageProfiles();
    const tags = await sonarr.getTags();

    return res.status(200).json({
      profiles,
      rootFolders: folders.map((folder) => ({
        id: folder.id,
        path: folder.path,
      })),
      languageProfiles,
      tags,
      urlBase,
    });
  } catch (e) {
    logger.error('Failed to test Sonarr', {
      label: 'Sonarr',
      message: e.message,
    });

    next({ status: 500, message: 'Failed to connect to Sonarr' });
  }
});

sonarrRoutes.put<{ id: string }>('/:id', (req, res) => {
  const settings = getSettings();

  const sonarrIndex = settings.sonarr.findIndex(
    (r) => r.id === Number(req.params.id)
  );

  if (sonarrIndex === -1) {
    return res
      .status(404)
      .json({ status: '404', message: 'Settings instance not found' });
  }

  // If we are setting this as the default, clear any previous defaults for the same type first
  // ex: if is4k is true, it will only remove defaults for other servers that have is4k set to true
  // and are the default
  if (req.body.isDefault) {
    settings.sonarr
      .filter((sonarrInstance) => sonarrInstance.is4k === req.body.is4k)
      .forEach((sonarrInstance) => {
        sonarrInstance.isDefault = false;
      });
  }

  settings.sonarr[sonarrIndex] = {
    ...req.body,
    id: Number(req.params.id),
  } as SonarrSettings;
  settings.save();

  return res.status(200).json(settings.sonarr[sonarrIndex]);
});

sonarrRoutes.get<{ id: string }>('/:id/profiles', async (req, res, next) => {
  const settings = getSettings();

  const sonarrSettings = settings.sonarr.find(
    (s) => s.id === Number(req.params.id)
  );

  if (!sonarrSettings) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const sonarr = new SonarrAPI({
    apiKey: sonarrSettings.apiKey,
    url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
  });

  const profiles = await sonarr.getProfiles();

  return res.status(200).json(
    profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    }))
  );
});

sonarrRoutes.get<{ id: string }>('/:id/rootfolders', async (req, res, next) => {
  const settings = getSettings();

  const sonarrSettings = settings.sonarr.find(
    (s) => s.id === Number(req.params.id)
  );

  if (!sonarrSettings) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const sonarr = new SonarrAPI({
    apiKey: sonarrSettings.apiKey,
    url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
  });

  const folders = await sonarr.getRootFolders();

  return res.status(200).json(
    folders.map((folder) => ({
      id: folder.id,
      path: folder.path,
    }))
  );
});

sonarrRoutes.get<{ id: string }>('/:id/tags', async (req, res, next) => {
  const settings = getSettings();

  const sonarrSettings = settings.sonarr.find(
    (s) => s.id === Number(req.params.id)
  );

  if (!sonarrSettings) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const sonarr = new SonarrAPI({
    apiKey: sonarrSettings.apiKey,
    url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
  });

  const tags = await sonarr.getTags();

  return res.status(200).json(tags);
});

sonarrRoutes.post<{ id: string }, unknown, { label: string }>(
  '/:id/tags',
  async (req, res, next) => {
    const settings = getSettings();

    const sonarrSettings = settings.sonarr.find(
      (s) => s.id === Number(req.params.id)
    );

    if (!sonarrSettings) {
      return next({ status: '404', message: 'Settings instance not found' });
    }

    const sonarr = new SonarrAPI({
      apiKey: sonarrSettings.apiKey,
      url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
    });

    try {
      const newTag = await sonarr.createTag({ label: req.body.label });
      return res.status(201).json(newTag);
    } catch (e) {
      logger.error('Failed to create Sonarr tag', {
        label: 'Sonarr',
        message: e.message,
      });
      return next({ status: 500, message: 'Failed to create tag' });
    }
  }
);

sonarrRoutes.get<
  { id: string },
  { label: string | null },
  unknown,
  { source?: string; subtype?: string; name?: string }
>('/:id/autotag', (req, res, next) => {
  const settings = getSettings();

  const sonarrSettings = settings.sonarr.find(
    (s) => s.id === Number(req.params.id)
  );

  if (!sonarrSettings) {
    return next({ status: '404', message: 'Settings instance not found' });
  }

  const { source, subtype, name } = req.query;

  // Validate source is a valid TagSource
  const validSources: TagSource[] = [
    'trakt',
    'tmdb',
    'imdb',
    'letterboxd',
    'anilist',
    'myanimelist',
    'mdblist',
    'networks',
    'originals',
    'multi-source',
    'tautulli',
    'overseerr',
    'radarrtag',
    'sonarrtag',
  ];

  if (!source || !validSources.includes(source as TagSource)) {
    return res.status(200).json({ label: null });
  }

  const label = generateCollectionTag(
    { subtype, name },
    source as TagSource,
    sonarrSettings.tagRequestsMode,
    sonarrSettings.tagRequests
  );

  return res.status(200).json({ label });
});

sonarrRoutes.delete<{ id: string }>('/:id', (req, res) => {
  const settings = getSettings();

  const sonarrIndex = settings.sonarr.findIndex(
    (r) => r.id === Number(req.params.id)
  );

  if (sonarrIndex === -1) {
    return res
      .status(404)
      .json({ status: '404', message: 'Settings instance not found' });
  }

  const removed = settings.sonarr.splice(sonarrIndex, 1);
  settings.save();

  return res.status(200).json(removed[0]);
});

sonarrRoutes.get('/alltags', async (_req, res) => {
  const settings = getSettings();
  const allTags: { id: number; label: string }[] = [];
  const seenLabels = new Set<string>();

  // Fetch tags from all Sonarr instances
  for (const sonarrSettings of settings.sonarr) {
    if (!sonarrSettings.hostname) continue;

    try {
      const sonarr = new SonarrAPI({
        apiKey: sonarrSettings.apiKey,
        url: SonarrAPI.buildUrl(sonarrSettings, '/api/v3'),
      });

      const tags = await sonarr.getTags();

      // Add unique tags (deduplicate by label)
      for (const tag of tags) {
        if (!seenLabels.has(tag.label)) {
          seenLabels.add(tag.label);
          allTags.push(tag);
        }
      }
    } catch (e) {
      logger.debug('Failed to fetch tags from Sonarr instance', {
        label: 'Sonarr',
        hostname: sonarrSettings.hostname,
        message: e.message,
      });
      // Continue with other instances
    }
  }

  return res.status(200).json(allTags);
});

export default sonarrRoutes;
