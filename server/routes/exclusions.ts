import TmdbAPI from '@server/api/themoviedb';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const exclusionsRoutes = Router();

interface EnrichedMovie {
  tmdbId: number;
  title: string;
  year?: number;
  posterPath?: string;
}

interface EnrichedShow {
  id: number;
  type: 'tmdb' | 'tvdb';
  title: string;
  year?: number;
  posterPath?: string;
}

/**
 * GET /api/v1/exclusions
 * Get all global exclusions with TMDB metadata
 */
exclusionsRoutes.get('/', isAuthenticated(), async (req, res) => {
  try {
    const settings = getSettings();
    const exclusions = settings.globalExclusions;
    const tmdbClient = new TmdbAPI();

    // Enrich movies with TMDB metadata
    const enrichedMovies: EnrichedMovie[] = await Promise.all(
      exclusions.movies.map(async (tmdbId) => {
        try {
          const movie = await tmdbClient.getMovie({ movieId: tmdbId });
          return {
            tmdbId,
            title: movie.title || 'Unknown',
            year: movie.release_date
              ? new Date(movie.release_date).getFullYear()
              : undefined,
            posterPath: movie.poster_path,
          };
        } catch (error) {
          logger.debug(`Failed to fetch TMDB data for movie ${tmdbId}`, {
            label: 'Exclusions API',
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            tmdbId,
            title: `Movie (TMDB: ${tmdbId})`,
          };
        }
      })
    );

    // Enrich TV shows with TMDB metadata (only for TMDB type)
    const enrichedShows: EnrichedShow[] = await Promise.all(
      exclusions.shows.map(async (show) => {
        if (show.type === 'tmdb') {
          try {
            const tvShow = await tmdbClient.getTvShow({ tvId: show.id });
            return {
              id: show.id,
              type: show.type,
              title: tvShow.name || 'Unknown',
              year: tvShow.first_air_date
                ? new Date(tvShow.first_air_date).getFullYear()
                : undefined,
              posterPath: tvShow.poster_path,
            };
          } catch (error) {
            logger.debug(`Failed to fetch TMDB data for TV show ${show.id}`, {
              label: 'Exclusions API',
              error: error instanceof Error ? error.message : String(error),
            });
            return {
              id: show.id,
              type: show.type,
              title: `TV Show (TMDB: ${show.id})`,
            };
          }
        } else {
          // TVDB - we don't have metadata for these
          return {
            id: show.id,
            type: show.type,
            title: `TV Show (TVDB: ${show.id})`,
          };
        }
      })
    );

    return res.status(200).json({
      movies: enrichedMovies,
      shows: enrichedShows,
    });
  } catch (error) {
    logger.error('Failed to get global exclusions', {
      label: 'Exclusions API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to get exclusions',
    });
  }
});

/**
 * POST /api/v1/exclusions
 * Add an item to global exclusions
 */
exclusionsRoutes.post('/', isAuthenticated(), (req, res) => {
  try {
    const { tmdbId, tvdbId, mediaType } = req.body;

    if (!mediaType || (mediaType !== 'movie' && mediaType !== 'tv')) {
      return res.status(400).json({
        error: 'Invalid mediaType, must be movie or tv',
      });
    }

    if (mediaType === 'movie') {
      if (!tmdbId) {
        return res.status(400).json({
          error: 'tmdbId is required for movies',
        });
      }
    } else {
      // TV shows require either tmdbId or tvdbId
      if (!tmdbId && !tvdbId) {
        return res.status(400).json({
          error: 'Either tmdbId or tvdbId is required for TV shows',
        });
      }
    }

    const settings = getSettings();
    const exclusions = settings.globalExclusions;

    if (mediaType === 'movie') {
      // Check if already excluded
      if (exclusions.movies.includes(tmdbId)) {
        return res.status(200).json(exclusions);
      }
      exclusions.movies.push(tmdbId);
    } else {
      // TV show
      const idToAdd = tmdbId || tvdbId;
      const typeToAdd = tmdbId ? 'tmdb' : 'tvdb';

      // Check if already excluded
      if (
        exclusions.shows.some(
          (show) => show.id === idToAdd && show.type === typeToAdd
        )
      ) {
        return res.status(200).json(exclusions);
      }

      exclusions.shows.push({
        id: idToAdd,
        type: typeToAdd,
      });
    }

    settings.globalExclusions = exclusions;
    settings.save();

    logger.info('Added item to global exclusions', {
      label: 'Exclusions API',
      mediaType,
      tmdbId,
      tvdbId,
    });

    return res.status(200).json(exclusions);
  } catch (error) {
    logger.error('Failed to add exclusion', {
      label: 'Exclusions API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to add exclusion',
    });
  }
});

/**
 * DELETE /api/v1/exclusions
 * Remove an item from global exclusions
 */
exclusionsRoutes.delete('/', isAuthenticated(), (req, res) => {
  try {
    const { tmdbId, tvdbId, mediaType } = req.body;

    if (!mediaType || (mediaType !== 'movie' && mediaType !== 'tv')) {
      return res.status(400).json({
        error: 'Invalid mediaType, must be movie or tv',
      });
    }

    if (mediaType === 'movie') {
      if (!tmdbId) {
        return res.status(400).json({
          error: 'tmdbId is required for movies',
        });
      }
    } else {
      // TV shows require either tmdbId or tvdbId
      if (!tmdbId && !tvdbId) {
        return res.status(400).json({
          error: 'Either tmdbId or tvdbId is required for TV shows',
        });
      }
    }

    const settings = getSettings();
    const exclusions = settings.globalExclusions;

    if (mediaType === 'movie') {
      exclusions.movies = exclusions.movies.filter((id) => id !== tmdbId);
    } else {
      // TV show
      const idToRemove = tmdbId || tvdbId;
      const typeToRemove = tmdbId ? 'tmdb' : 'tvdb';

      exclusions.shows = exclusions.shows.filter(
        (show) => !(show.id === idToRemove && show.type === typeToRemove)
      );
    }

    settings.globalExclusions = exclusions;
    settings.save();

    logger.info('Removed item from global exclusions', {
      label: 'Exclusions API',
      mediaType,
      tmdbId,
      tvdbId,
    });

    return res.status(200).json(exclusions);
  } catch (error) {
    logger.error('Failed to remove exclusion', {
      label: 'Exclusions API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to remove exclusion',
    });
  }
});

export default exclusionsRoutes;
