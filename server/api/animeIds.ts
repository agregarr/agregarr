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
  tmdb_mappings?: Record; // TMDB season mappings (e.g., {"s1": "e1-e12|2"})
  tvdb_mappings?: Record; // TVDB season mappings
};

type RawAnimeIds = Record; // keyed by AniList ID

let _loadedAt = 0;
let _byAniList = new Map();
let _byAniDB = new Map(); // For AniDB lookups
let _loadInFlight: Promise | null = null;

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

// Maximum response size (50MB) and timeout (30s)
const MAX_RESPONSE_SIZE = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;

export async function loadAnimeIds(
  url = 'https://raw.githubusercontent.com/eliasbenb/PlexAniBridge-Mappings/refs/heads/v2/mappings.json'
): Promise {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store' as RequestCache,
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Anime-IDs fetch failed: ${res.status}`);

    // Check content-length header first
    const contentLength = res.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large: ${contentLength} bytes`);
    }

    // Stream response with real-time size enforcement
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Response body not readable');

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.length;
        if (totalBytes > MAX_RESPONSE_SIZE) {
          controller.abort();
          throw new Error(`Response exceeded ${MAX_RESPONSE_SIZE} bytes`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Combine chunks and parse
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const json = JSON.parse(new TextDecoder().decode(combined)) as RawAnimeIds;

    const byAniList = new Map();
    const byAniDB = new Map();

    for (const [anilistIdStr, row] of Object.entries(json)) {
      if (anilistIdStr.startsWith('$')) continue;

      const anilistId = parseInt(anilistIdStr);
      if (!anilistId || !Number.isFinite(anilistId)) continue;

      const normalized: AnimeIdsRow = {
        ...row,
        anilist_id: anilistId,
      };

      byAniList.set(anilistId, normalized);

      if (row.anidb_id) {
        byAniDB.set(row.anidb_id, normalized);
      }
    }

    _byAniList = byAniList;
    _byAniDB = byAniDB;
    _loadedAt = Date.now();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function ensureAnimeIdsLoaded(
  ttlMs = 12 * 60 * 60 * 1000
): Promise {
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
