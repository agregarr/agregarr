// @server/api/animeIds.ts
// Loads PlexAniBridge Anime ID mappings (improved over Kometa's Anime-IDs)
// https://github.com/eliasbenb/PlexAniBridge-Mappings

export type AnimeIdsRow = {
  anidb_id?: number; // AniDB ID
  anilist_id?: number; // AniList ID (also the primary key)
  mal_id?: number | number[]; // MyAnimeList ID(s) - can be single or array
  imdb_id?: string | string[]; // IMDB ID(s) - format: "tt1234567" - can be single or array
  tmdb_movie_id?: number | number[]; // TMDB Movie ID(s) - can be single or array
  tmdb_show_id?: number; // TMDB Show ID - always single
  tvdb_id?: number; // TVDB ID - always single
  tmdb_mappings?: Record<string, string>; // TMDB season mappings (e.g., {"s1": "e1-e12|2"})
  tvdb_mappings?: Record<string, string>; // TVDB season mappings
};

type RawAnimeIds = Record<string, AnimeIdsRow>; // keyed by AniList ID

let _loadedAt = 0;
let _byAniList = new Map<number, AnimeIdsRow>();
let _byAniDB = new Map<number, AnimeIdsRow>(); // For AniDB lookups
let _loadInFlight: Promise<void> | null = null;

// Normalize array fields to always be arrays for consistent handling
function normalizeToArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// Get first value from a field that can be single value or array
export function getFirstValue<T>(value: T | T[] | undefined): T | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

// Get all values from a field that can be single value or array
export function getAllValues<T>(value: T | T[] | undefined): T[] {
  return normalizeToArray(value);
}

export async function loadAnimeIds(
  url = 'https://raw.githubusercontent.com/eliasbenb/PlexAniBridge-Mappings/refs/heads/v2/mappings.json'
): Promise<void> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    // be explicit that we want fresh-ish
    cache: 'no-store' as RequestCache,
  });
  if (!res.ok) throw new Error(`Anime-IDs fetch failed: ${res.status}`);
  const json = (await res.json()) as RawAnimeIds;

  const byAniList = new Map<number, AnimeIdsRow>();
  const byAniDB = new Map<number, AnimeIdsRow>();

  // Build indices - keys are now AniList IDs directly!
  for (const [anilistIdStr, row] of Object.entries(json)) {
    // Skip metadata keys like "$includes"
    if (anilistIdStr.startsWith('$')) continue;

    const anilistId = parseInt(anilistIdStr);
    if (!anilistId || !Number.isFinite(anilistId)) continue;

    // Store the row as-is (already well-structured)
    const normalized: AnimeIdsRow = {
      ...row,
      anilist_id: anilistId, // Add the key as a field for completeness
    };

    // Store by AniList ID (primary key)
    byAniList.set(anilistId, normalized);

    // Also index by AniDB ID if present
    if (row.anidb_id) {
      byAniDB.set(row.anidb_id, normalized);
    }
  }

  _byAniList = byAniList;
  _byAniDB = byAniDB;
  _loadedAt = Date.now();
}

export async function ensureAnimeIdsLoaded(
  ttlMs = 12 * 60 * 60 * 1000
): Promise<void> {
  const stale = Date.now() - _loadedAt > ttlMs;
  if (_byAniList.size > 0 && !stale) return;
  if (_loadInFlight) return _loadInFlight;
  _loadInFlight = loadAnimeIds().finally(() => (_loadInFlight = null));
  return _loadInFlight;
}

export function lookupByAniList(anilistId: number): AnimeIdsRow | undefined {
  return _byAniList.get(anilistId);
}

/** Lookup PlexAniBridge row by MyAnimeList ID (mal_id). Returns first match. */
export function lookupByMal(malId: number): AnimeIdsRow | undefined {
  if (!malId) return undefined;
  for (const row of _byAniList.values()) {
    const malIds = normalizeToArray(row.mal_id);
    if (malIds.includes(malId)) return row;
  }
  return undefined;
}

/** Lookup PlexAniBridge row by AniDB ID */
export function lookupByAniDB(anidbId: number): AnimeIdsRow | undefined {
  return _byAniDB.get(anidbId);
}

export function animeIdsLoadedCount(): number {
  return _byAniList.size;
}
