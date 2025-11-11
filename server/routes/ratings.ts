import type { ImdbRatingResponse } from '@server/api/imdbRatings';
import ImdbRatingsAPI from '@server/api/imdbRatings';
import type { RTRating } from '@server/api/rottentomatoes';
import RottenTomatoes from '@server/api/rottentomatoes';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const ratingsRoutes = Router();

/**
 * GET /api/v1/ratings/movie/:tmdbId
 * Get ratings for a movie (IMDB + RT)
 */
ratingsRoutes.get('/movie/:tmdbId', isAuthenticated(), async (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId);
    const title = req.query.title as string;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const imdbId = req.query.imdbId as string | undefined;

    if (!tmdbId) {
      return res.status(400).json({ error: 'tmdbId is required' });
    }

    const imdbClient = new ImdbRatingsAPI();
    const rtClient = new RottenTomatoes();

    let imdbRating: ImdbRatingResponse | null = null;
    let rtRating: RTRating | null = null;

    // Fetch IMDB rating if we have an IMDB ID
    if (imdbId) {
      try {
        imdbRating = await imdbClient.getRating(imdbId);
        logger.debug('IMDb rating fetched successfully', {
          label: 'Ratings API',
          imdbId,
          rating: imdbRating?.rating,
        });
      } catch (error) {
        logger.error('Failed to fetch IMDB rating', {
          label: 'Ratings API',
          imdbId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    // Fetch RT rating if we have title and year
    if (title && year) {
      try {
        rtRating = await rtClient.getMovieRatings(title, year);
      } catch (error) {
        logger.debug('Failed to fetch RT rating', {
          label: 'Ratings API',
          title,
          year,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return res.status(200).json({
      imdb: imdbRating,
      rt: rtRating,
    });
  } catch (error) {
    logger.error('Failed to fetch movie ratings', {
      label: 'Ratings API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to fetch ratings',
    });
  }
});

/**
 * GET /api/v1/ratings/tv/:tmdbId
 * Get ratings for a TV show (IMDB + RT)
 */
ratingsRoutes.get('/tv/:tmdbId', isAuthenticated(), async (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId);
    const title = req.query.title as string;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const imdbId = req.query.imdbId as string | undefined;

    if (!tmdbId) {
      return res.status(400).json({ error: 'tmdbId is required' });
    }

    const imdbClient = new ImdbRatingsAPI();
    const rtClient = new RottenTomatoes();

    let imdbRating: ImdbRatingResponse | null = null;
    let rtRating: RTRating | null = null;

    // Fetch IMDB rating if we have an IMDB ID
    if (imdbId) {
      try {
        imdbRating = await imdbClient.getRating(imdbId);
        logger.debug('IMDb rating fetched successfully', {
          label: 'Ratings API',
          imdbId,
          rating: imdbRating?.rating,
        });
      } catch (error) {
        logger.error('Failed to fetch IMDB rating', {
          label: 'Ratings API',
          imdbId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }

    // Fetch RT rating if we have title
    if (title) {
      try {
        rtRating = await rtClient.getTVRatings(title, year);
      } catch (error) {
        logger.debug('Failed to fetch RT rating', {
          label: 'Ratings API',
          title,
          year,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return res.status(200).json({
      imdb: imdbRating,
      rt: rtRating,
    });
  } catch (error) {
    logger.error('Failed to fetch TV ratings', {
      label: 'Ratings API',
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(500).json({
      error: 'Failed to fetch ratings',
    });
  }
});

export default ratingsRoutes;
