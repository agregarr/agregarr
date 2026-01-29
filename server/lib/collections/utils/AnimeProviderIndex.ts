import { getAllValues, lookupByMal } from '@server/api/animeIds';
import type { LibraryItemsCache } from '@server/lib/collections/core/CollectionUtilities';

/**
 * Plex GUID structure (e.g., { id: 'tmdb://12345' })
 */
export interface PlexGuid {
  id: string;
}

/**
 * Plex library item with GUID metadata
 */
export interface PlexLibraryItem {
  ratingKey: string;
  title: string;
  guid?: string | PlexGuid;
  Guid?: PlexGuid[]; // Capital G to match actual Plex API response
}

/**
 * Entry in a provider index map
 */
export interface ProviderIndexEntry {
  ratingKey: string;
  title: string;
  libraryKey: string;
  tvdbId?: number;
}

/**
 * Provider index containing maps for IMDb, TMDB, and TVDB lookups
 */
export interface ProviderIndex {
  imdb: Map<string, ProviderIndexEntry>;
  tmdb: Map<string, ProviderIndexEntry>;
  tvdb: Map<string, ProviderIndexEntry>;
}

/**
 * Build provider index maps from library cache for anime matching.
 * Shared between AniList and MyAnimeList collection sources.
 *
 * Indexes library items by their TMDb, IMDb, and TVDB IDs (extracted from Plex GUIDs)
 * and also resolves MyAnimeList agent GUIDs via the PlexAniBridge mapping.
 */
export function buildProviderIndex(
  libraryCache?: LibraryItemsCache
): ProviderIndex {
  const imdb = new Map<string, ProviderIndexEntry>();
  const tmdb = new Map<string, ProviderIndexEntry>();
  const tvdb = new Map<string, ProviderIndexEntry>();

  if (!libraryCache) return { imdb, tmdb, tvdb };

  const extractGuidString = (g: string | PlexGuid | undefined): string | null =>
    typeof g === 'string' ? g : g && typeof g.id === 'string' ? g.id : null;

  const take = (guid: string | null) => (guid ? [guid] : []);

  for (const libKey of Object.keys(libraryCache)) {
    for (const it of libraryCache[libKey] || []) {
      const plexItem = it as PlexLibraryItem;
      const guidField = plexItem.guid;
      const guidsField = plexItem.Guid; // Capital G!

      const allGuidStrings: string[] = [
        ...take(extractGuidString(guidField)),
        ...(Array.isArray(guidsField)
          ? (guidsField.map(extractGuidString).filter(Boolean) as string[])
          : []),
      ];

      // Extract tvdbId for this item to include in all index entries
      let itemTvdbId: number | undefined;
      for (const g of allGuidStrings) {
        const mTvdbId = g.match(/(?:^|agents\.thetvdb:\/\/|tvdb:\/\/)(\d+)\b/i);
        if (mTvdbId) {
          itemTvdbId = parseInt(mTvdbId[1], 10);
          break;
        }
      }

      for (const g of allGuidStrings) {
        // Common forms:
        //   tmdb://12345
        //   com.plexapp.agents.themoviedb://12345?lang=en
        //   tvdb://12345
        //   com.plexapp.agents.thetvdb://12345?lang=en
        //   imdb://tt1234567
        //   com.plexapp.agents.imdb://tt1234567?lang=en
        //   com.plexapp.agents.myanimelist://12345 (anime-specific)

        const mTmdb = g.match(
          /(?:^|agents\.themoviedb:\/\/|tmdb:\/\/)(\d+)\b/i
        );
        if (mTmdb)
          tmdb.set(mTmdb[1], {
            ratingKey: it.ratingKey,
            title: it.title,
            libraryKey: libKey,
            tvdbId: itemTvdbId,
          });

        const mImdb = g.match(/(?:^|agents\.imdb:\/\/|imdb:\/\/)(tt\d{6,})\b/i);
        if (mImdb)
          imdb.set(mImdb[1].toLowerCase(), {
            ratingKey: it.ratingKey,
            title: it.title,
            libraryKey: libKey,
            tvdbId: itemTvdbId,
          });

        const mTvdb = g.match(/(?:^|agents\.thetvdb:\/\/|tvdb:\/\/)(\d+)\b/i);
        if (mTvdb)
          tvdb.set(mTvdb[1], {
            ratingKey: it.ratingKey,
            title: it.title,
            libraryKey: libKey,
            tvdbId: itemTvdbId,
          });

        // MyAnimeList Agent: com.plexapp.agents.myanimelist://{mal_id}
        const mMalAgent = g.match(/myanimelist:\/\/(\d+)/i);
        if (mMalAgent) {
          const malId = parseInt(mMalAgent[1]);
          const map = lookupByMal(malId);
          if (map) {
            // Add all available IDs from PlexAniBridge mapping
            if (map.tvdb_id) {
              tvdb.set(String(map.tvdb_id), {
                ratingKey: it.ratingKey,
                title: it.title,
                libraryKey: libKey,
                tvdbId: itemTvdbId ?? Number(map.tvdb_id),
              });
            }
            if (map.tmdb_show_id) {
              tmdb.set(String(map.tmdb_show_id), {
                ratingKey: it.ratingKey,
                title: it.title,
                libraryKey: libKey,
                tvdbId:
                  itemTvdbId ?? (map.tvdb_id ? Number(map.tvdb_id) : undefined),
              });
            }
            // tmdb_movie_id can be array - add all values
            const tmdbMovieIds = getAllValues(map.tmdb_movie_id);
            for (const mid of tmdbMovieIds) {
              tmdb.set(String(mid), {
                ratingKey: it.ratingKey,
                title: it.title,
                libraryKey: libKey,
                tvdbId: itemTvdbId,
              });
            }
            // imdb_id can be array - add all values
            const imdbIds = getAllValues(map.imdb_id);
            for (const iid of imdbIds) {
              imdb.set(iid.toLowerCase(), {
                ratingKey: it.ratingKey,
                title: it.title,
                libraryKey: libKey,
                tvdbId:
                  itemTvdbId ?? (map.tvdb_id ? Number(map.tvdb_id) : undefined),
              });
            }
          }
        }
      }
    }
  }

  return { imdb, tmdb, tvdb };
}
