// PushoverAPI removed - notification system not needed
import GithubAPI from '@server/api/github';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import { mapProductionCompany } from '@server/models/Movie';
import { mapNetwork } from '@server/models/Tv';
import settingsRoutes from '@server/routes/settings';
import { appDataPath, appDataStatus } from '@server/utils/appDataVolume';
import { getAppVersion, getCommitTag } from '@server/utils/appVersion';
import restartFlag from '@server/utils/restartFlag';
import { isPerson } from '@server/utils/typeHelpers';
import { Router } from 'express';
import authRoutes from './auth';
import collectionsRoutes from './collections';
import dashboardRoutes from './dashboard';
import defaultHubsRoutes from './defaulthubs';
import discoveryRoutes from './discovery';
import hubsRoutes from './hubs';
import mediaRoutes from './media';
import missingItemsRoutes from './missing-items';
import postersRoutes from './posters';
import preExistingRoutes from './preexisting';
import reorderRoutes from './reorder';

// Import createTmdbWithRegionLanguage function directly from discover (inline)

export const createTmdbWithRegionLanguage = (): TheMovieDb => {
  return new TheMovieDb();
};
// Movie, search, and TV routes removed - discovery functionality not needed
import overseerrRoutes from './overseerr';
import serviceRoutes from './service';
import user from './user';

const router = Router();

router.use(checkUser);

router.get('/status', async (_req, res) => {
  const githubApi = new GithubAPI();

  const currentVersion = getAppVersion();
  const commitTag = getCommitTag();
  let updateAvailable = false;
  let commitsBehind = 0;

  if (currentVersion.startsWith('develop-') && commitTag !== 'local') {
    const commits = await githubApi.getAgregarrCommits();

    if (commits.length) {
      const filteredCommits = commits.filter(
        (commit) => !commit.commit.message.includes('[skip ci]')
      );
      if (filteredCommits[0].sha.substring(0, 7) !== commitTag) {
        updateAvailable = true;
      }

      const commitIndex = filteredCommits.findIndex(
        (commit) => commit.sha.substring(0, 7) === commitTag
      );

      if (updateAvailable) {
        commitsBehind = commitIndex;
      }
    }
  } else if (commitTag !== 'local') {
    const releases = await githubApi.getAgregarrReleases();

    if (releases.length) {
      const latestVersion = releases[0];

      if (!latestVersion.name.includes(currentVersion)) {
        updateAvailable = true;
      }
    }
  }

  return res.status(200).json({
    version: getAppVersion(),
    commitTag: getCommitTag(),
    updateAvailable,
    commitsBehind,
    restartRequired: restartFlag.isSet(),
  });
});

router.get('/status/appdata', (_req, res) => {
  return res.status(200).json({
    appData: appDataStatus(),
    appDataPath: appDataPath(),
  });
});

router.get('/request/count', (_req, res) => {
  // Request system removed for Agregarr - return zero counts
  return res.status(200).json({
    pending: 0,
    approved: 0,
    processing: 0,
    unavailable: 0,
    failed: 0,
    total: 0,
  });
});

router.get('/issue/count', (_req, res) => {
  // Issue system removed for Agregarr - return zero counts
  return res.status(200).json({
    total: 0,
    video: 0,
    audio: 0,
    subtitles: 0,
    other: 0,
  });
});

router.use('/user', isAuthenticated(), user);
router.get('/settings/public', async (req, res) => {
  const settings = getSettings();

  // Notification types removed - always return full public settings
  return res.status(200).json(settings.fullPublicSettings);
});
// Pushover notification route removed - notification system not needed
router.use('/settings', isAuthenticated(), settingsRoutes);
router.use('/dashboard', isAuthenticated(), dashboardRoutes);
router.use('/overseerr', isAuthenticated(), overseerrRoutes);
// Search, movie, and TV routes removed - discovery functionality not needed in Agregarr
router.use('/media', isAuthenticated(), mediaRoutes);
router.use('/missing-items', isAuthenticated(), missingItemsRoutes);
router.use('/collections', isAuthenticated(), collectionsRoutes);
router.use('/defaulthubs', isAuthenticated(), defaultHubsRoutes);
router.use('/discovery', isAuthenticated(), discoveryRoutes);
router.use('/hubs', isAuthenticated(), hubsRoutes);
router.use('/posters', isAuthenticated(), postersRoutes);
router.use('/preexisting', isAuthenticated(), preExistingRoutes);
router.use('/reorder', isAuthenticated(), reorderRoutes);
router.use('/service', isAuthenticated(), serviceRoutes);
router.use('/auth', authRoutes);

router.get<{ id: string }>('/studio/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const studio = await tmdb.getStudio(Number(req.params.id));

    return res.status(200).json(mapProductionCompany(studio));
  } catch (e) {
    logger.debug('Something went wrong retrieving studio', {
      label: 'API',
      errorMessage: e.message,
      studioId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve studio.',
    });
  }
});

router.get<{ id: string }>('/network/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const network = await tmdb.getNetwork(Number(req.params.id));

    return res.status(200).json(mapNetwork(network));
  } catch (e) {
    logger.debug('Something went wrong retrieving network', {
      label: 'API',
      errorMessage: e.message,
      networkId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve network.',
    });
  }
});

router.get('/genres/movie', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const genres = await tmdb.getMovieGenres({
      language: (req.query.language as string) ?? req.locale,
    });

    return res.status(200).json(genres);
  } catch (e) {
    logger.debug('Something went wrong retrieving movie genres', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie genres.',
    });
  }
});

router.get('/genres/tv', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const genres = await tmdb.getTvGenres({
      language: (req.query.language as string) ?? req.locale,
    });

    return res.status(200).json(genres);
  } catch (e) {
    logger.debug('Something went wrong retrieving series genres', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series genres.',
    });
  }
});

router.get('/backdrops', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage();

  try {
    const data = (
      await tmdb.getAllTrending({
        page: 1,
        timeWindow: 'week',
      })
    ).results.filter((result) => !isPerson(result)) as (
      | TmdbMovieResult
      | TmdbTvResult
    )[];

    return res
      .status(200)
      .json(
        data
          .map((result) => result.backdrop_path)
          .filter((backdropPath) => !!backdropPath)
      );
  } catch (e) {
    logger.debug('Something went wrong retrieving backdrops', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve backdrops.',
    });
  }
});

router.get('/keyword/:keywordId', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage();

  try {
    const result = await tmdb.getKeywordDetails({
      keywordId: Number(req.params.keywordId),
    });

    return res.status(200).json(result);
  } catch (e) {
    logger.debug('Something went wrong retrieving keyword data', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve keyword data.',
    });
  }
});

router.get('/', (_req, res) => {
  return res.status(200).json({
    api: 'Agregarr API',
    version: '1.0',
  });
});

export default router;
