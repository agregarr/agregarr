// PushoverAPI removed - notification system not needed
import GithubAPI from '@server/api/github';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { getSettings, getTmdbLanguage } from '@server/lib/settings';
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
import anilistRoutes from './anilist';
import authRoutes from './auth';
import collectionsRoutes from './collections';
import dashboardRoutes from './dashboard';
import defaultHubsRoutes from './defaulthubs';
import discoveryRoutes from './discovery';
import exclusionsRoutes from './exclusions';
import filesystemRoutes from './filesystem';
import fontsRoutes from './fonts';
import hubsRoutes from './hubs';
import mediaRoutes from './media';
import missingItemsRoutes from './missing-items';
import myanimelistRoutes from './myanimelist';
import overlayLibraryConfigsRoutes from './overlayLibraryConfigs';
import overlaySettingsRoutes from './overlaySettings';
import overlayTemplatesRoutes from './overlayTemplates';
import overlayTestRoutes from './overlayTest';
import postersRoutes from './posters';
import preExistingRoutes from './preexisting';
import ratingsRoutes from './ratings';
import reorderRoutes from './reorder';
import searchRoutes from './search';
import sourceColorsRoutes from './sourceColors';
import traktOAuthRoutes from './trakt-oauth';

// Import createTmdbWithRegionLanguage function directly from discover (inline)

export const createTmdbWithRegionLanguage = async (): Promise<TheMovieDb> => {
  return new TheMovieDb({ originalLanguage: await getTmdbLanguage() });
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
      if (filteredCommits[0].sha !== commitTag) {
        updateAvailable = true;
      }

      const commitIndex = filteredCommits.findIndex(
        (commit) => commit.sha === commitTag
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
// Public Trakt OAuth endpoints (no auth required for OAuth callback flow)
router.use('/trakt', traktOAuthRoutes);
router.use('/settings', isAuthenticated(), settingsRoutes);
router.use('/dashboard', isAuthenticated(), dashboardRoutes);
router.use('/filesystem', isAuthenticated(), filesystemRoutes);
router.use('/overseerr', isAuthenticated(), overseerrRoutes);
// Search, movie, and TV routes removed - discovery functionality not needed in Agregarr
router.use('/media', isAuthenticated(), mediaRoutes);
router.use('/missing-items', isAuthenticated(), missingItemsRoutes);
router.use('/collections', isAuthenticated(), collectionsRoutes);
router.use('/defaulthubs', isAuthenticated(), defaultHubsRoutes);
router.use('/discovery', isAuthenticated(), discoveryRoutes);
router.use('/exclusions', isAuthenticated(), exclusionsRoutes);
router.use('/fonts', isAuthenticated(), fontsRoutes);
router.use('/hubs', isAuthenticated(), hubsRoutes);
router.use('/overlay-templates', isAuthenticated(), overlayTemplatesRoutes);
router.use(
  '/overlay-library-configs',
  isAuthenticated(),
  overlayLibraryConfigsRoutes
);
router.use('/overlay-settings', isAuthenticated(), overlaySettingsRoutes);
router.use('/overlay-test', isAuthenticated(), overlayTestRoutes);
router.use('/plex', isAuthenticated(), searchRoutes);
router.use('/posters', isAuthenticated(), postersRoutes);
router.use('/preexisting', isAuthenticated(), preExistingRoutes);
router.use('/ratings', isAuthenticated(), ratingsRoutes);
router.use('/reorder', isAuthenticated(), reorderRoutes);
router.use('/service', isAuthenticated(), serviceRoutes);
router.use('/source-colors', isAuthenticated(), sourceColorsRoutes);
router.use('/auth', authRoutes);
router.use('/anilist', anilistRoutes);
router.use('/myanimelist', myanimelistRoutes);

router.get<{ id: string }>('/movie/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const movie = await tmdb.getMovie({ movieId: Number(req.params.id) });

    return res.status(200).json(movie);
  } catch (e) {
    logger.debug('Something went wrong retrieving movie', {
      label: 'API',
      errorMessage: e.message,
      movieId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie.',
    });
  }
});

router.get('/discover/watch-providers/movie', async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const region = req.query.region ? String(req.query.region) : 'US';
    const providers = await tmdb.getMovieWatchProviders({ watchRegion: region });

    return res.status(200).json(providers);
  } catch (e) {
    logger.debug('Something went wrong retrieving movie watch providers', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie watch providers.',
    });
  }
});

router.get('/discover/watch-providers/tv', async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const region = req.query.region ? String(req.query.region) : 'US';
    const providers = await tmdb.getTvWatchProviders({ watchRegion: region });

    return res.status(200).json(providers);
  } catch (e) {
    logger.debug('Something went wrong retrieving TV watch providers', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve TV watch providers.',
    });
  }
});

router.get('/discover/genres/movie', async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const language = req.query.language ? String(req.query.language) : 'en-US';
    const genres = await tmdb.getMovieGenres({ language });

    return res.status(200).json({ genres });
  } catch (e: any) {
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

router.get('/discover/genres/tv', async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const language = req.query.language ? String(req.query.language) : 'en-US';
    const genres = await tmdb.getTvGenres({ language });

    return res.status(200).json({ genres });
  } catch (e: any) {
    logger.debug('Something went wrong retrieving TV genres', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve TV genres.',
    });
  }
});

router.get('/configuration', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const configuration = await tmdb.getConfiguration();

    return res.status(200).json(configuration);
  } catch (e) {
    logger.debug('Something went wrong retrieving TMDB configuration', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve TMDB configuration.',
    });
  }
});

router.get('/countries', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const countries = await tmdb.getCountries();

    return res.status(200).json(countries);
  } catch (e) {
    logger.debug('Something went wrong retrieving countries', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve countries.',
    });
  }
});

router.get('/movie-certifications', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const certifications = await tmdb.getMovieCertifications();

    return res.status(200).json(certifications);
  } catch (e) {
    logger.debug('Something went wrong retrieving movie certifications', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie certifications.',
    });
  }
});

router.get<{ id: string }>('/tv/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const tv = await tmdb.getTvShow({ tvId: Number(req.params.id) });

    return res.status(200).json(tv);
  } catch (e) {
    logger.debug('Something went wrong retrieving TV show', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve TV show.',
    });
  }
});

router.get<{ id: string }>('/studio/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

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
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

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
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

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
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

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

router.get('/genres/combined', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    const [movieGenres, tvGenres] = await Promise.all([
      tmdb.getMovieGenres({
        language: (req.query.language as string) ?? req.locale,
      }),
      tmdb.getTvGenres({
        language: (req.query.language as string) ?? req.locale,
      }),
    ]);

    // Merge and deduplicate by ID
    const genreMap = new Map<number, string>();
    movieGenres.forEach((g) => genreMap.set(g.id, g.name));
    tvGenres.forEach((g) => genreMap.set(g.id, g.name));

    const combined = Array.from(genreMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json(combined);
  } catch (e) {
    logger.debug('Failed to retrieve combined genres', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve genres.',
    });
  }
});

router.get('/countries/combined', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    // Fetch all countries from TMDB configuration
    const regions = await tmdb.getRegions();

    // Map TMDB region format to our format and sort by name
    const combined = regions
      .map((region) => ({
        code: region.iso_3166_1,
        name: region.english_name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json(combined);
  } catch (e) {
    logger.debug('Failed to retrieve combined countries', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve countries.',
    });
  }
});

router.get('/languages/combined', isAuthenticated(), async (req, res, next) => {
  const tmdb = new TheMovieDb({ originalLanguage: await getTmdbLanguage() });

  try {
    // Fetch all languages from TMDB configuration
    const languages = await tmdb.getLanguages();

    // Map TMDB language format to our format and sort by name
    const combined = languages
      .map((language) => ({
        code: language.iso_639_1,
        name: language.english_name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json(combined);
  } catch (e) {
    logger.debug('Failed to retrieve combined languages', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve languages.',
    });
  }
});

router.get('/backdrops', async (req, res, next) => {
  const tmdb = await createTmdbWithRegionLanguage();

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
  const tmdb = await createTmdbWithRegionLanguage();

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
