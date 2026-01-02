import type { PlexLibraryItem } from '@server/api/plexapi';
import PlexAPI from '@server/api/plexapi';
import logger from '@server/logger';
import { Router } from 'express';

const searchRouter = Router();

interface PlexSearchResult {
  ratingKey: string;
  title: string;
  year?: number;
  type: 'movie' | 'show';
  thumb?: string;
  libraryId: string;
  libraryName: string;
}

/**
 * Search across all Plex libraries
 * GET /api/v1/plex/search?query=...&limit=20
 */
searchRouter.get('/search', async (req, res) => {
  try {
    const query = req.query.query as string;
    const limit = parseInt((req.query.limit as string) || '20', 10);

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // Get admin user for Plex API access
    const { getAdminUser } = await import(
      '@server/lib/collections/core/CollectionUtilities'
    );
    const admin = await getAdminUser();

    if (!admin) {
      return res.status(500).json({ error: 'No admin user found' });
    }

    // Get Plex settings to construct full image URLs
    const { getSettings } = await import('@server/lib/settings');
    const settings = getSettings();
    const plexSettings = settings.plex;

    const plexApi = new PlexAPI({ plexToken: admin.plexToken });

    // Construct base URL for Plex images
    const protocol = plexSettings.useSsl ? 'https' : 'http';
    const plexBaseUrl = `${protocol}://${plexSettings.ip}:${plexSettings.port}`;

    // Perform search using Plex's global search
    // Note: /hubs/search returns results grouped in "Hub" objects, each containing Metadata
    const searchResults = await plexApi['plexClient'].query<{
      MediaContainer?: {
        Hub?: {
          Metadata?: PlexLibraryItem[];
        }[];
      };
    }>(`/hubs/search?query=${encodeURIComponent(query)}&limit=${limit * 2}`);

    logger.debug('Plex search raw response', {
      label: 'PlexSearch',
      query,
      hasMediaContainer: !!searchResults.MediaContainer,
      hubCount: searchResults.MediaContainer?.Hub?.length || 0,
    });

    // Extract all metadata from all hubs
    const rawResults: PlexLibraryItem[] = [];
    if (searchResults.MediaContainer?.Hub) {
      for (const hub of searchResults.MediaContainer.Hub) {
        if (hub.Metadata) {
          // Filter out results with a "reason" field - these are related matches, not direct title matches
          // Direct matches won't have a reason field
          const directMatches = hub.Metadata.filter(
            (item) => !(item as { reason?: string }).reason
          );
          rawResults.push(...directMatches);
        }
      }
    }

    // Filter to only movies and shows, and extract library information
    const filteredResults: PlexSearchResult[] = [];

    for (const item of rawResults) {
      // Only include movies and shows (exclude episodes, seasons, artists, etc.)
      if (item.type !== 'movie' && item.type !== 'show') {
        continue;
      }

      // Get library information
      const libraryId =
        (item as { librarySectionID?: string }).librarySectionID?.toString() ||
        '';
      let libraryName =
        (item as { librarySectionTitle?: string }).librarySectionTitle ||
        'Unknown Library';

      // Try to get library name from section if not available
      if (
        !(item as { librarySectionTitle?: string }).librarySectionTitle &&
        libraryId
      ) {
        try {
          const libraries = await plexApi.getLibraries();
          const library = libraries.find((lib) => lib.key === libraryId);
          libraryName = library?.title || 'Unknown Library';
        } catch (error) {
          logger.debug('Failed to fetch library name', {
            label: 'PlexSearch',
            libraryId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Construct full URL for thumb if available
      const thumbPath = (item as { thumb?: string }).thumb;
      const fullThumbUrl = thumbPath
        ? `${plexBaseUrl}${thumbPath}?X-Plex-Token=${admin.plexToken}`
        : undefined;

      filteredResults.push({
        ratingKey: item.ratingKey,
        title: item.title,
        year: item.year,
        type: item.type as 'movie' | 'show',
        thumb: fullThumbUrl,
        libraryId,
        libraryName,
      });

      // Stop if we have enough results
      if (filteredResults.length >= limit) {
        break;
      }
    }

    logger.info('Plex search completed', {
      label: 'PlexSearch',
      query,
      totalResults: rawResults.length,
      filteredResults: filteredResults.length,
    });

    return res.status(200).json({
      results: filteredResults,
      totalResults: filteredResults.length,
    });
  } catch (error) {
    logger.error('Failed to search Plex', {
      label: 'PlexSearch',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return res.status(500).json({
      error: 'Failed to search Plex',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default searchRouter;
