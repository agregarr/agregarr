import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import {
  buildTraktRedirectUri,
  persistTraktTokens,
} from '@server/utils/traktAuth';
import { Router, type Response } from 'express';
import { rateLimiter, validateExternalUrl } from './collections';

const fetchTitleRoutes = Router();

/**
 * Helper to send SSE progress updates
 */
function sendProgress(res: Response, stage: string, message: string) {
  res.write(`data: ${JSON.stringify({ stage, message })}\n\n`);
}

/**
 * GET /api/v1/collections/fetch-title
 * Fetch title from external collection URL with SSE progress updates
 */
fetchTitleRoutes.get('/', isAuthenticated(), async (req, res) => {
  const { url, type } = req.query;

  if (!url || !type || typeof url !== 'string' || typeof type !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: 'URL and type are required',
    });
  }

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Check rate limiting (per user)
    const userId = req.user?.id?.toString() || req.ip || 'anonymous';
    if (!rateLimiter.isAllowed(userId)) {
      res.write(
        `data: ${JSON.stringify({
          status: 'error',
          message: 'Too many requests. Please wait before trying again.',
        })}\n\n`
      );
      return res.end();
    }

    sendProgress(res, 'validating', 'Validating URL...');

    // Validate and sanitize the URL
    const validation = validateExternalUrl(url, type);
    if (!validation.isValid) {
      res.write(
        `data: ${JSON.stringify({
          status: 'error',
          message: validation.error,
        })}\n\n`
      );
      return res.end();
    }

    if (!validation.sanitizedUrl) {
      res.write(
        `data: ${JSON.stringify({
          status: 'error',
          message: 'URL sanitization failed',
        })}\n\n`
      );
      return res.end();
    }
    const sanitizedUrl = validation.sanitizedUrl;

    let title: string | null = null;
    let mediaType: 'movie' | 'tv' | 'both' | 'mixed' | null = null;
    let contentTypes: string[] = [];

    switch (type) {
      case 'trakt': {
        sendProgress(res, 'connecting', 'Connecting to Trakt...');

        const TraktAPI = (await import('@server/api/trakt')).default;
        const settings = getSettings();

        const clientId = settings.trakt.clientId || settings.trakt.apiKey;
        const redirectUri = buildTraktRedirectUri(settings, req);
        if (!clientId) {
          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message: 'Trakt is not configured',
            })}\n\n`
          );
          return res.end();
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

        // Get list metadata to extract real title, then validate with items
        try {
          // First get the real list title from metadata
          sendProgress(res, 'metadata', 'Fetching list metadata...');
          const listMetadata = await traktClient.getListMetadata(sanitizedUrl);
          title = listMetadata.name || 'Trakt List';

          // Then validate list accessibility with first 100 items
          sendProgress(res, 'analyzing', 'Analyzing list content...');
          const listData = await traktClient.getCustomList(sanitizedUrl, 100);
          if (listData && listData.length >= 0) {
            // Comprehensive media type detection from first 100 items
            if (listData.length > 0) {
              const hasMovies = listData.some(
                (item) => item.type === 'movie' || item.movie
              );
              const hasShows = listData.some(
                (item) => (item.type === 'show' || item.show) && !item.episode
              );
              const hasEpisodes = listData.some((item) => item.episode);

              contentTypes = [];
              if (hasMovies) contentTypes.push('movies');
              if (hasShows) contentTypes.push('shows');
              if (hasEpisodes) contentTypes.push('episodes');

              if (contentTypes.length > 1) {
                mediaType = 'mixed'; // New type for mixed content
              } else if (hasMovies) {
                mediaType = 'movie';
              } else if (hasShows || hasEpisodes) {
                mediaType = 'tv';
              }
            }
          }
        } catch (error) {
          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message: 'Invalid Trakt list URL or list not accessible',
            })}\n\n`
          );
          return res.end();
        }
        break;
      }

      case 'tmdb': {
        sendProgress(res, 'connecting', 'Connecting to TMDb...');

        const TheMovieDb = (await import('@server/api/themoviedb')).default;
        const tmdbClient = new TheMovieDb();

        try {
          // Check if it's a collection URL
          const collectionMatch = sanitizedUrl.match(
            /themoviedb\.org\/collection\/(\d+)/
          );
          // Check if it's a list URL
          const listMatch = sanitizedUrl.match(/themoviedb\.org\/list\/(\d+)/);
          // Check if it's a network URL
          const networkMatch = sanitizedUrl.match(
            /themoviedb\.org\/network\/(\d+)/
          );
          // Check if it's a company URL
          const companyMatch = sanitizedUrl.match(
            /themoviedb\.org\/company\/(\d+)(?:-[^/]+)?\/(movie|tv)/
          );

          sendProgress(res, 'fetching', 'Fetching data...');

          if (collectionMatch) {
            const collectionId = parseInt(collectionMatch[1]);
            const collection = await tmdbClient.getCollection({ collectionId });
            title = collection.name;
            mediaType = 'movie'; // TMDB collections are always movies
          } else if (listMatch) {
            const listId = listMatch[1];
            const list = await tmdbClient.getList({ listId });
            title = list.name;

            // Detect media type from list content (similar to Trakt)
            if (list.items && list.items.length > 0) {
              const hasMovies = list.items.some(
                (item) => item.media_type === 'movie' || item.title
              );
              const hasShows = list.items.some(
                (item) => item.media_type === 'tv' || item.name
              );
              if (hasMovies && hasShows) {
                mediaType = 'both';
              } else if (hasMovies) {
                mediaType = 'movie';
              } else if (hasShows) {
                mediaType = 'tv';
              } else {
                mediaType = 'both'; // Fallback if we can't determine
              }
            } else {
              mediaType = 'both'; // Fallback for empty lists
            }
          } else if (networkMatch) {
            const networkId = parseInt(networkMatch[1]);
            const network = await tmdbClient.getNetwork(networkId);
            title = network.name;
            mediaType = 'tv'; // Networks are TV only
          } else if (companyMatch) {
            const companyId = parseInt(companyMatch[1]);
            const companyMediaType = companyMatch[2]; // 'movie' or 'tv'
            const company = await tmdbClient.getStudio(companyId);
            title = company.name;
            mediaType = companyMediaType === 'movie' ? 'movie' : 'tv';
          } else {
            res.write(
              `data: ${JSON.stringify({
                status: 'error',
                message:
                  'Invalid TMDB URL format. Expected: collection, list, network, or company URL',
              })}\n\n`
            );
            return res.end();
          }
        } catch (error) {
          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message:
                'Invalid TMDB collection/list/network/company ID or not found',
            })}\n\n`
          );
          return res.end();
        }
        break;
      }

      case 'imdb': {
        sendProgress(res, 'connecting', 'Connecting to IMDb...');

        const { ImdbAxiosClient } = await import(
          '@server/lib/collections/utils/ImdbAxiosClient'
        );
        const axios = await ImdbAxiosClient.getInstance();

        try {
          const listMatch = sanitizedUrl.match(/imdb\.com\/list\/(ls\d+)/);
          const watchlistMatch = sanitizedUrl.match(
            /imdb\.com\/user\/(ur\d+)\/watchlist/
          );
          if (!listMatch && !watchlistMatch) {
            res.write(
              `data: ${JSON.stringify({
                status: 'error',
                message:
                  'Invalid IMDb URL format. Expected list or watchlist URL',
              })}\n\n`
            );
            return res.end();
          }

          sendProgress(
            res,
            'challenge',
            'Solving IMDb bot protection challenge... (first request takes 10-20 seconds)'
          );

          const response = await axios.get(sanitizedUrl, {
            timeout: 30000, // Longer timeout for WAF challenge
          });

          sendProgress(res, 'parsing', 'Extracting list information...');

          // Extract __NEXT_DATA__ for accurate parsing
          const nextDataMatch = response.data.match(
            /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s
          );

          if (!nextDataMatch) {
            res.write(
              `data: ${JSON.stringify({
                status: 'error',
                message: 'Could not parse IMDb list data',
              })}\n\n`
            );
            return res.end();
          }

          const nextData = JSON.parse(nextDataMatch[1]);

          // Get list data (works for both lists and watchlists)
          let listData =
            nextData?.props?.pageProps?.mainColumnData?.list
              ?.titleListItemSearch;

          if (!listData || !listData.edges) {
            listData =
              nextData?.props?.pageProps?.mainColumnData?.predefinedList
                ?.titleListItemSearch;
          }

          if (!listData || !listData.edges) {
            res.write(
              `data: ${JSON.stringify({
                status: 'error',
                message: 'Could not find list items in IMDb data',
              })}\n\n`
            );
            return res.end();
          }

          // Extract title - use list name if available, otherwise from page title
          // Note: IMDb's name field can be an object with originalText property
          const listName =
            nextData?.props?.pageProps?.mainColumnData?.list?.name;
          const predefinedListName =
            nextData?.props?.pageProps?.mainColumnData?.predefinedList?.name;
          let rawTitle: string | undefined =
            (typeof listName === 'string'
              ? listName
              : listName?.originalText) ||
            (typeof predefinedListName === 'string'
              ? predefinedListName
              : predefinedListName?.originalText);

          if (!rawTitle) {
            const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) {
              rawTitle = titleMatch[1].replace(' - IMDb', '').trim();
            }
          }

          if (rawTitle && typeof rawTitle === 'string') {
            // Decode HTML entities (same as RandomListManager and Letterboxd)
            title = rawTitle
              .replace(/&lrm;/g, '') // Remove left-to-right mark
              .replace(/&rlm;/g, '') // Remove right-to-left mark
              .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
              .replace(/&ndash;/g, '–') // Replace en-dash
              .replace(/&mdash;/g, '—') // Replace em-dash
              .replace(/&hellip;/g, '…') // Replace ellipsis
              .replace(/&quot;/g, '"') // Replace quotes
              .replace(/&#0?39;/g, "'") // Replace apostrophe (with or without leading zero)
              .replace(/&#x27;/g, "'") // Replace hex-encoded apostrophe
              .replace(/&amp;/g, '&') // Replace ampersand (do this last)
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');
          }

          // Analyze items for media type using structured data
          let movieCount = 0;
          let showCount = 0;
          let episodeCount = 0;
          const unknownTypes: string[] = [];

          for (const edge of listData.edges) {
            const titleTypeId = edge.listItem?.titleType?.id;

            if (titleTypeId === 'movie' || titleTypeId === 'tvMovie') {
              movieCount++;
            } else if (titleTypeId === 'tvEpisode') {
              episodeCount++;
            } else if (
              titleTypeId === 'tvSeries' ||
              titleTypeId === 'tvMiniSeries' ||
              titleTypeId === 'tvShort' ||
              titleTypeId === 'tvSpecial'
            ) {
              showCount++;
            } else if (titleTypeId) {
              // Track unknown types for debugging
              if (!unknownTypes.includes(titleTypeId)) {
                unknownTypes.push(titleTypeId);
              }
            }
          }

          // Log unknown types for debugging
          if (unknownTypes.length > 0) {
            logger.warn('Unknown IMDb titleType IDs found', {
              label: 'Collections API',
              unknownTypes,
              url: sanitizedUrl,
            });
          }

          // Determine media type and content types based on what we found
          contentTypes = [];
          if (movieCount > 0) contentTypes.push('movies');
          if (showCount > 0) contentTypes.push('shows');
          if (episodeCount > 0) contentTypes.push('episodes');

          const totalTvContent = showCount + episodeCount;

          logger.info('IMDb media type detection', {
            label: 'Collections API',
            url: sanitizedUrl,
            totalItems: listData.edges.length,
            movieCount,
            showCount,
            episodeCount,
            unknownTypesCount: unknownTypes.length,
            detectedMediaType:
              contentTypes.length > 1
                ? 'mixed'
                : movieCount > 0 && totalTvContent === 0
                ? 'movie'
                : totalTvContent > 0 && movieCount === 0
                ? 'tv'
                : 'mixed/default',
          });

          if (contentTypes.length > 1) {
            mediaType = 'mixed';
          } else if (movieCount > 0 && totalTvContent === 0) {
            mediaType = 'movie';
          } else if (totalTvContent > 0 && movieCount === 0) {
            mediaType = 'tv';
          } else if (movieCount > 0 && totalTvContent > 0) {
            mediaType = 'mixed';
          } else {
            mediaType = 'movie'; // Default when we can't determine
            contentTypes = ['movies'];
          }
        } catch (error) {
          const isTimeout =
            error.code === 'ECONNABORTED' || error.message?.includes('timeout');
          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message: isTimeout
                ? 'Request timed out while fetching IMDb list. The list page may be loading slowly. Please try again.'
                : 'Could not fetch IMDb list title. Please verify the URL is correct and the list is publicly accessible.',
            })}\n\n`
          );
          return res.end();
        }
        break;
      }

      case 'letterboxd': {
        // For Letterboxd, we need Playwright to bypass Cloudflare protection
        sendProgress(res, 'connecting', 'Connecting to Letterboxd...');

        const { CloudflareSolver } = await import(
          '@server/lib/collections/utils/CloudflareSolver'
        );

        try {
          const watchlistMatch = sanitizedUrl.match(
            /letterboxd\.com\/([^/]+)\/watchlist/
          );
          const listMatch = sanitizedUrl.match(
            /letterboxd\.com\/([^/]+)\/list\/([^/?]+)/
          );
          const filmsMatch = sanitizedUrl.match(
            /letterboxd\.com\/([^/]+)\/films\/(.*)/
          );

          if (!watchlistMatch && !listMatch && !filmsMatch) {
            res.write(
              `data: ${JSON.stringify({
                status: 'error',
                message: 'Invalid Letterboxd URL format',
              })}\n\n`
            );
            return res.end();
          }

          sendProgress(
            res,
            'challenge',
            'Bypassing Cloudflare protection... (may take a few seconds)'
          );

          // Use Playwright to bypass Cloudflare and get page content
          const html = await CloudflareSolver.fetchPage(sanitizedUrl);

          sendProgress(res, 'parsing', 'Extracting list title...');

          if (watchlistMatch) {
            const username = watchlistMatch[1]
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase());
            title = `${username}'s Watchlist`;
          } else {
            // Extract title from HTML and clean it up
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);

            if (titleMatch) {
              let rawTitle = titleMatch[1];

              // Decode HTML entities
              rawTitle = rawTitle
                .replace(/&lrm;/g, '') // Remove left-to-right mark
                .replace(/&rlm;/g, '') // Remove right-to-left mark
                .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
                .replace(/&ndash;/g, '–') // Replace en-dash
                .replace(/&mdash;/g, '—') // Replace em-dash
                .replace(/&hellip;/g, '…') // Replace ellipsis
                .replace(/&quot;/g, '"') // Replace quotes
                .replace(/&#0?39;/g, "'") // Replace apostrophe (with or without leading zero)
                .replace(/&#x27;/g, "'") // Replace hex-encoded apostrophe
                .replace(/&amp;/g, '&') // Replace ampersand (do this last)
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');

              // Extract list name (everything before " • Letterboxd" or ", a list of films by")
              const patterns = [
                /^(.*?),\s*a\s+list\s+of\s+films?\s+by/i, // ", a list of films by"
                /^(.*?)\s*•\s*Letterboxd/i, // " • Letterboxd"
                /^(.*?)\s*-\s*Letterboxd/i, // " - Letterboxd"
                /^(.*?)\s*\|\s*Letterboxd/i, // " | Letterboxd"
              ];

              for (const pattern of patterns) {
                const match = rawTitle.match(pattern);
                if (match && match[1]) {
                  title = match[1].trim();
                  break;
                }
              }

              // If no pattern matched, use fallback cleanup
              if (!title) {
                title = rawTitle
                  .replace(/\s*•\s*Letterboxd.*$/i, '') // Remove " • Letterboxd" suffix
                  .replace(/\s*-\s*Letterboxd.*$/i, '') // Remove " - Letterboxd" suffix
                  .replace(/\s*\|\s*Letterboxd.*$/i, '') // Remove " | Letterboxd" suffix
                  .trim();
              }
            }
          }

          // For Letterboxd, assume movies by default since it's primarily a film platform
          mediaType = 'movie';
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          const isTimeout = errorMessage?.includes('timeout');

          logger.error('Letterboxd fetch error', {
            label: 'Letterboxd Collections',
            error: errorMessage,
          });

          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message: isTimeout
                ? 'Request timed out while fetching Letterboxd list'
                : `Could not fetch Letterboxd list title: ${errorMessage}`,
            })}\n\n`
          );
          return res.end();
        }
        break;
      }

      case 'anilist': {
        // Fetch the AniList page and extract the HTML title
        sendProgress(res, 'connecting', 'Connecting to AniList...');

        const anilistAxios = (await import('axios')).default;

        try {
          sendProgress(res, 'fetching', 'Fetching list information...');

          const response = await anilistAxios.get(sanitizedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 15000,
          });

          sendProgress(res, 'parsing', 'Extracting list title...');

          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            // Strip common suffixes like " - AniList"
            title = titleMatch[1].replace(/\s+-\s+AniList$/i, '').trim();
          }

          // Try to detect media type heuristically by looking for anime/manga links
          const html = response.data as string;
          if (html.includes('/anime/')) {
            mediaType = 'tv';
          } else if (html.includes('/manga/')) {
            mediaType = 'movie';
          } else {
            mediaType = 'tv'; // default to tv for AniList (anime)
          }
        } catch (error) {
          const isTimeout =
            error.code === 'ECONNABORTED' || error.message?.includes('timeout');
          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message: isTimeout
                ? 'Request timed out while fetching AniList list'
                : 'Could not fetch AniList list title',
            })}\n\n`
          );
          return res.end();
        }
        break;
      }

      case 'mdblist': {
        sendProgress(res, 'connecting', 'Connecting to MDBList...');

        const MDBListAPI = (await import('@server/api/mdblist')).default;
        const settings = getSettings();

        if (!settings.mdblist.apiKey) {
          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message: 'MDBList API key not configured',
            })}\n\n`
          );
          return res.end();
        }

        const mdblistClient = new MDBListAPI(settings.mdblist.apiKey);

        try {
          // Parse URL to get username and list name
          const parsedUrl = mdblistClient.parseListUrl(sanitizedUrl);
          if (!parsedUrl) {
            res.write(
              `data: ${JSON.stringify({
                status: 'error',
                message: 'Invalid MDBList URL format',
              })}\n\n`
            );
            return res.end();
          }

          // Get list metadata to extract title
          // Try two approaches: first try getting by username (for other users' public lists),
          // then fallback to getting own lists (for private lists or when username endpoint fails)
          sendProgress(res, 'fetching', 'Fetching list metadata...');

          if (
            parsedUrl.type === 'user' &&
            parsedUrl.username &&
            parsedUrl.listName
          ) {
            let userLists: Awaited<
              ReturnType<typeof mdblistClient.getUserLists>
            > = [];

            try {
              // First try: Get lists by username (works for other users' public lists)
              userLists = await mdblistClient.getUserListsByUsername(
                parsedUrl.username
              );
            } catch (usernameError) {
              // If that fails (404), try getting own lists (works for private lists)
              try {
                userLists = await mdblistClient.getUserLists();
              } catch (ownListsError) {
                // Both failed - we'll just skip title extraction
                logger.debug(
                  'Could not fetch MDBList metadata, will use fallback title',
                  {
                    label: 'Collections API',
                    usernameError:
                      usernameError instanceof Error
                        ? usernameError.message
                        : String(usernameError),
                    ownListsError:
                      ownListsError instanceof Error
                        ? ownListsError.message
                        : String(ownListsError),
                  }
                );
              }
            }

            const targetList = userLists.find(
              (list) =>
                list.slug === parsedUrl.listName ||
                list.name.toLowerCase().replace(/\s+/g, '-') ===
                  parsedUrl.listName
            );
            if (targetList) {
              title = targetList.name;
            }
          }

          // Validate list accessibility and get data with first 100 items
          sendProgress(res, 'analyzing', 'Analyzing list content...');

          const listData = await mdblistClient.getCustomList(sanitizedUrl, {
            limit: 100,
          });

          // Comprehensive media type detection from first 100 items
          const movies = listData.movies || [];
          const shows = listData.shows || [];

          if (movies.length > 0 && shows.length > 0) {
            mediaType = 'both';
          } else if (movies.length > 0) {
            mediaType = 'movie';
          } else if (shows.length > 0) {
            mediaType = 'tv';
          }
        } catch (error) {
          res.write(
            `data: ${JSON.stringify({
              status: 'error',
              message: 'Invalid MDBList list URL or list not accessible',
            })}\n\n`
          );
          return res.end();
        }
        break;
      }

      default:
        res.write(
          `data: ${JSON.stringify({
            status: 'error',
            message: 'Unsupported collection type',
          })}\n\n`
        );
        return res.end();
    }

    if (!title) {
      res.write(
        `data: ${JSON.stringify({
          status: 'error',
          message: 'Could not extract title from URL',
        })}\n\n`
      );
      return res.end();
    }

    sendProgress(res, 'complete', 'Complete!');

    // Send final result
    res.write(
      `data: ${JSON.stringify({
        status: 'success',
        title,
        mediaType,
        contentTypes,
      })}\n\n`
    );
    res.end();
  } catch (error) {
    logger.error('Error fetching collection title', {
      label: 'Collections API',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    res.write(
      `data: ${JSON.stringify({
        status: 'error',
        message: 'Internal server error while fetching title',
      })}\n\n`
    );
    res.end();
  }
});

export default fetchTitleRoutes;
