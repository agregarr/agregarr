import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { rateLimiter, validateExternalUrl } from './collections';
import { buildTraktRedirectUri, persistTraktTokens } from '@server/utils/traktAuth';

const mediaTypeRoutes = Router();

/**
 * POST /api/v1/collections/detect-media-type
 * Comprehensively analyze media type from external collection URL
 */
mediaTypeRoutes.post('/', isAuthenticated(), async (req, res) => {
  try {
    const { url, type } = req.body;

    if (!url || !type) {
      return res.status(400).json({
        status: 'error',
        message: 'URL and type are required',
      });
    }

    // Check rate limiting (per user)
    const userId = req.user?.id?.toString() || req.ip || 'anonymous';
    if (!rateLimiter.isAllowed(userId)) {
      return res.status(429).json({
        status: 'error',
        message: 'Too many requests. Please wait before trying again.',
      });
    }

    // Validate and sanitize the URL
    const validation = validateExternalUrl(url, type);
    if (!validation.isValid) {
      return res.status(400).json({
        status: 'error',
        message: validation.error,
      });
    }

    if (!validation.sanitizedUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'URL sanitization failed',
      });
    }
    const sanitizedUrl = validation.sanitizedUrl;

    let mediaType: 'movie' | 'tv' | 'both' | null = null;

    switch (type) {
      case 'trakt': {
        const TraktAPI = (await import('@server/api/trakt')).default;
        const settings = getSettings();

        const clientId = settings.trakt.clientId || settings.trakt.apiKey;
        const redirectUri = buildTraktRedirectUri(settings, req);
        if (!clientId) {
          return res.status(400).json({
            status: 'error',
            message: 'Trakt client ID not configured',
          });
        }

        const traktClient = new TraktAPI({
          clientId,
          accessToken: settings.trakt.accessToken,
          clientSecret: settings.trakt.clientSecret,
          refreshToken: settings.trakt.refreshToken,
          tokenExpiresAt: settings.trakt.tokenExpiresAt,
          redirectUri,
          onTokenRefreshed: (tokens) => persistTraktTokens(settings, tokens),
        });

        // Comprehensive media type analysis with full list (up to 1000 items)
        try {
          const listData = await traktClient.getCustomList(sanitizedUrl, 1000);
          if (listData && listData.length > 0) {
            const hasMovies = listData.some(
              (item) => item.type === 'movie' || item.movie
            );
            const hasShows = listData.some(
              (item) => item.type === 'show' || item.show
            );

            if (hasMovies && hasShows) {
              mediaType = 'both';
            } else if (hasMovies) {
              mediaType = 'movie';
            } else if (hasShows) {
              mediaType = 'tv';
            }
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Failed to analyze list content',
          });
        }
        break;
      }

      case 'imdb': {
        // For IMDb, we'll need to scrape and analyze the comprehensive content
        const axios = (await import('axios')).default;

        try {
          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

          const htmlContent = response.data;

          // Try multiple approaches to find list items
          let listItemMatches = htmlContent.match(
            /<li[^>]*class="[^"]*ipc-metadata-list-summary-item[^"]*"[^>]*>.*?<\/li>/gs
          );

          if (!listItemMatches) {
            listItemMatches =
              htmlContent.match(
                /<div[^>]*class="[^"]*titleColumn[^"]*"[^>]*>.*?<\/div>/gs
              ) ||
              htmlContent.match(
                /<div[^>]*class="[^"]*list[^"]*item[^"]*"[^>]*>.*?<\/div>/gs
              ) ||
              [];
          }

          let movieCount = 0;
          let tvCount = 0;

          // Analyze up to 1000 items to determine media type accurately
          listItemMatches.slice(0, 1000).forEach((item: string) => {
            const lowerItem = item.toLowerCase();

            // Check for movie indicators
            if (
              lowerItem.includes('titletype-movie') ||
              lowerItem.includes('feature') ||
              lowerItem.includes('film') ||
              lowerItem.includes('"@type":"movie"') ||
              lowerItem.includes('(movie)') ||
              lowerItem.includes('feature film') ||
              lowerItem.includes('short film')
            ) {
              movieCount++;
            }

            // Check for TV indicators
            if (
              lowerItem.includes('titletype-tv') ||
              lowerItem.includes('tv series') ||
              lowerItem.includes('tv episode') ||
              lowerItem.includes('tv mini-series') ||
              lowerItem.includes('tv movie') ||
              lowerItem.includes('"@type":"tvseries"') ||
              lowerItem.includes('"@type":"episode"') ||
              lowerItem.includes('(tv series)') ||
              lowerItem.includes('(tv episode)') ||
              lowerItem.includes('television')
            ) {
              tvCount++;
            }
          });

          // Determine media type based on comprehensive analysis
          if (movieCount > 0 && tvCount === 0) {
            mediaType = 'movie';
          } else if (tvCount > 0 && movieCount === 0) {
            mediaType = 'tv';
          } else if (movieCount > 0 && tvCount > 0) {
            mediaType = 'both';
          } else {
            // Fallback: try to detect from page title or description
            const lowerContent = htmlContent.toLowerCase();
            if (
              lowerContent.includes('movie list') ||
              lowerContent.includes('film list')
            ) {
              mediaType = 'movie';
            } else if (
              lowerContent.includes('tv list') ||
              lowerContent.includes('television list') ||
              lowerContent.includes('series list')
            ) {
              mediaType = 'tv';
            } else {
              mediaType = 'both'; // Default when we can't determine
            }
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Failed to analyze IMDb list content',
          });
        }
        break;
      }

      case 'tmdb': {
        // TMDB collections are always movies
        mediaType = 'movie';
        break;
      }

      case 'letterboxd': {
        // Letterboxd is primarily a film platform
        mediaType = 'movie';
        break;
      }

      default:
        return res.status(400).json({
          status: 'error',
          message: 'Unsupported collection type',
        });
    }

    return res.status(200).json({
      status: 'success',
      mediaType: mediaType,
    });
  } catch (error) {
    logger.error('Error detecting media type', {
      label: 'Collections API',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      status: 'error',
      message: 'Internal server error while detecting media type',
    });
  }
});

export default mediaTypeRoutes;
