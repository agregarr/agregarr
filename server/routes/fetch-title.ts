import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import { rateLimiter, validateExternalUrl } from './collections';

const fetchTitleRoutes = Router();

/**
 * POST /api/v1/collections/fetch-title
 * Fetch title from external collection URL
 */
fetchTitleRoutes.post('/', isAuthenticated(), async (req, res) => {
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

    let title: string | null = null;
    let mediaType: 'movie' | 'tv' | 'both' | 'mixed' | null = null;
    let contentTypes: string[] = [];

    switch (type) {
      case 'trakt': {
        const TraktAPI = (await import('@server/api/trakt')).default;
        const settings = getSettings();

        if (!settings.trakt.apiKey) {
          return res.status(400).json({
            status: 'error',
            message: 'Trakt API key not configured',
          });
        }

        const traktClient = new TraktAPI(settings.trakt.apiKey);

        // Get list metadata to extract real title, then validate with items
        try {
          // First get the real list title from metadata
          const listMetadata = await traktClient.getListMetadata(sanitizedUrl);
          title = listMetadata.name || 'Trakt List';

          // Then validate list accessibility with first 10 items
          const listData = await traktClient.getCustomList(sanitizedUrl, 10);
          if (listData && listData.length >= 0) {
            // Quick media type detection from first 10 items
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
          return res.status(400).json({
            status: 'error',
            message: 'Invalid Trakt list URL or list not accessible',
          });
        }
        break;
      }

      case 'tmdb': {
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
            return res.status(400).json({
              status: 'error',
              message:
                'Invalid TMDB URL format. Expected: collection, list, network, or company URL',
            });
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message:
              'Invalid TMDB collection/list/network/company ID or not found',
          });
        }
        break;
      }

      case 'imdb': {
        // For IMDb, we'll need to scrape the title from the page
        const axios = (await import('axios')).default;

        try {
          const urlMatch = sanitizedUrl.match(/imdb\.com\/list\/(ls\d+)/);
          if (!urlMatch) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid IMDb list URL format',
            });
          }

          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

          // Extract title from HTML
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            let extractedTitle = titleMatch[1].replace(' - IMDb', '').trim();

            // Decode HTML entities (same as RandomListManager and Letterboxd)
            extractedTitle = extractedTitle
              .replace(/&lrm;/g, '') // Remove left-to-right mark
              .replace(/&rlm;/g, '') // Remove right-to-left mark
              .replace(/&bull;/g, '•') // Replace bullet entity with actual bullet
              .replace(/&ndash;/g, '–') // Replace en-dash
              .replace(/&mdash;/g, '—') // Replace em-dash
              .replace(/&hellip;/g, '…') // Replace ellipsis
              .replace(/&quot;/g, '"') // Replace quotes
              .replace(/&#39;/g, "'") // Replace apostrophe
              .replace(/&#x27;/g, "'") // Replace hex-encoded apostrophe
              .replace(/&amp;/g, '&') // Replace ampersand (do this last)
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>');

            title = extractedTitle;
          }

          // Try to detect media type from the page content by analyzing list items
          const htmlContent = response.data;

          // Try multiple approaches to find list items
          let listItemMatches = htmlContent.match(
            /<li[^>]*class="[^"]*ipc-metadata-list-summary-item[^"]*"[^>]*>.*?<\/li>/gs
          );

          // If the first pattern doesn't work, try alternative patterns
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
          let showCount = 0;
          let episodeCount = 0;

          // Analyze up to 1000 items to determine media type accurately
          listItemMatches.slice(0, 1000).forEach((item: string) => {
            // Look for title type indicators in the structured data or metadata
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
            // Check for episode indicators (more specific than shows)
            else if (
              lowerItem.includes('tv episode') ||
              lowerItem.includes('"@type":"episode"') ||
              lowerItem.includes('"@type":"tvepisode"') ||
              lowerItem.includes('(tv episode)') ||
              (lowerItem.includes('season') && lowerItem.includes('episode'))
            ) {
              episodeCount++;
            }
            // Check for TV show indicators (but not episodes)
            else if (
              lowerItem.includes('titletype-tv') ||
              lowerItem.includes('tv series') ||
              lowerItem.includes('tv mini-series') ||
              lowerItem.includes('tv movie') ||
              lowerItem.includes('"@type":"tvseries"') ||
              lowerItem.includes('(tv series)') ||
              lowerItem.includes('television')
            ) {
              showCount++;
            }
          });

          // Determine media type and content types based on what we found
          contentTypes = [];
          if (movieCount > 0) contentTypes.push('movies');
          if (showCount > 0) contentTypes.push('shows');
          if (episodeCount > 0) contentTypes.push('episodes');

          const totalTvContent = showCount + episodeCount;

          if (contentTypes.length > 1) {
            mediaType = 'mixed';
          } else if (movieCount > 0 && totalTvContent === 0) {
            mediaType = 'movie';
          } else if (totalTvContent > 0 && movieCount === 0) {
            mediaType = 'tv';
          } else if (movieCount > 0 && totalTvContent > 0) {
            mediaType = 'mixed';
          } else {
            // Fallback: try to detect from page title or description
            const lowerContent = htmlContent.toLowerCase();
            if (
              lowerContent.includes('movie list') ||
              lowerContent.includes('film list')
            ) {
              mediaType = 'movie';
              contentTypes = ['movies'];
            } else if (
              lowerContent.includes('tv list') ||
              lowerContent.includes('television list') ||
              lowerContent.includes('series list')
            ) {
              mediaType = 'tv';
              contentTypes = ['shows'];
            } else {
              mediaType = 'movie'; // Default when we can't determine
              contentTypes = ['movies'];
            }
          }
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Could not fetch IMDb list title',
          });
        }
        break;
      }

      case 'letterboxd': {
        // For Letterboxd, we'll need to scrape the title from the page
        const axios = (await import('axios')).default;

        try {
          const urlMatch = sanitizedUrl.match(
            /letterboxd\.com\/([^/]+)\/list\/([^/?]+)/
          );
          if (!urlMatch) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid Letterboxd list URL format',
            });
          }

          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

          // Extract title from HTML and clean it up
          const titleMatch = response.data.match(/<title>([^<]+)<\/title>/i);
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
              .replace(/&#39;/g, "'") // Replace apostrophe
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

          // For Letterboxd, assume movies by default since it's primarily a film platform
          mediaType = 'movie';
        } catch (error) {
          return res.status(400).json({
            status: 'error',
            message: 'Could not fetch Letterboxd list title',
          });
        }
        break;
      }
      case 'anilist': {
        // Fetch the AniList page and extract the HTML title
        const axios = (await import('axios')).default;

        try {
          const response = await axios.get(sanitizedUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
            timeout: 10000,
          });

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
          return res.status(400).json({
            status: 'error',
            message: 'Could not fetch AniList list title',
          });
        }

        break;
      }

      case 'mdblist': {
        const MDBListAPI = (await import('@server/api/mdblist')).default;
        const settings = getSettings();

        if (!settings.mdblist.apiKey) {
          return res.status(400).json({
            status: 'error',
            message: 'MDBList API key not configured',
          });
        }

        const mdblistClient = new MDBListAPI(settings.mdblist.apiKey);

        try {
          // Parse URL to get username and list name
          const parsedUrl = mdblistClient.parseListUrl(sanitizedUrl);
          if (!parsedUrl) {
            return res.status(400).json({
              status: 'error',
              message: 'Invalid MDBList URL format',
            });
          }

          // Get list metadata to extract title
          // Try two approaches: first try getting by username (for other users' public lists),
          // then fallback to getting own lists (for private lists or when username endpoint fails)
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

          // Validate list accessibility and get data with first 10 items
          const listData = await mdblistClient.getCustomList(sanitizedUrl, {
            limit: 10,
          });

          // Quick media type detection from first 10 items
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
          return res.status(400).json({
            status: 'error',
            message: 'Invalid MDBList list URL or list not accessible',
          });
        }
        break;
      }

      default:
        return res.status(400).json({
          status: 'error',
          message: 'Unsupported collection type',
        });
    }

    if (!title) {
      return res.status(400).json({
        status: 'error',
        message: 'Could not extract title from URL',
      });
    }

    return res.status(200).json({
      status: 'success',
      title: title,
      mediaType: mediaType,
      contentTypes: contentTypes,
    });
  } catch (error) {
    logger.error('Error fetching collection title', {
      label: 'Collections API',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });

    return res.status(500).json({
      status: 'error',
      message: 'Internal server error while fetching title',
    });
  }
});

export default fetchTitleRoutes;
