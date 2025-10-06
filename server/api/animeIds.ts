// @server/api/animeIds.ts
// Loads Kometa's Anime-IDs JSON and builds a reverse index by AniList ID.
// https://github.com/Kometa-Team/Anime-IDs

export type AnimeIdsRow = {
  tvdb_id?: number | string; // Series-level TVDb id
  imdb_id?: string; // e.g., "tt1234567"
  mal_id?: string | number; // can be "123" or "123,456"
  anilist_id?: string | number; // can be "123" or "123,456"
  tmdb_movie_id?: number | string;
  tmdb_show_id?: number | string;
};

type RawAnimeIds = Record<string, AnimeIdsRow>; // keyed by AniDB id

let _loadedAt = 0;
let _byAniList = new Map<number, AnimeIdsRow>();
let _byAniDB = new Map<number, AnimeIdsRow>(); // For AniDB lookups
let _loadInFlight: Promise<void> | null = null;

// Split a comma/space separated id field to ints
function parseIdList(v?: string | number): number[] {
  if (v == null) return [];
  const s = String(v);
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function loadAnimeIds(
  url = 'https://raw.githubusercontent.com/Kometa-Team/Anime-IDs/master/anime_ids.json'
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

  // Build both AniList and AniDB indices
  for (const [anidbIdStr, row] of Object.entries(json)) {
    const anidbId = parseInt(anidbIdStr);

    // Normalize numeric-ish fields to numbers where possible
    const normalized: AnimeIdsRow = {
      ...row,
      tmdb_movie_id:
        row.tmdb_movie_id != null ? Number(row.tmdb_movie_id) : undefined,
      tmdb_show_id:
        row.tmdb_show_id != null ? Number(row.tmdb_show_id) : undefined,
      tvdb_id: row.tvdb_id != null ? Number(row.tvdb_id) : undefined,
    };

    // Store by AniDB ID (the key)
    if (anidbId) {
      byAniDB.set(anidbId, normalized);
    }

    // Store by AniList ID(s)
    const alIds = parseIdList(row.anilist_id);
    for (const aid of alIds) {
      const prev = byAniList.get(aid) ?? {};
      // merge so we keep the most complete entry we see
      byAniList.set(aid, { ...prev, ...normalized });
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

/** Lookup Kometa row by MyAnimeList ID (mal_id). Returns first match. */
export function lookupByMal(malId: number): AnimeIdsRow | undefined {
  if (!malId) return undefined;
  for (const row of _byAniList.values()) {
    const malList = parseIdList(row.mal_id);
    if (malList.includes(malId)) return row;
  }
  return undefined;
}

/** Lookup Kometa row by AniDB ID (the primary key in anime_ids.json) */
export function lookupByAniDB(anidbId: number): AnimeIdsRow | undefined {
  return _byAniDB.get(anidbId);
}

export function animeIdsLoadedCount(): number {
  return _byAniList.size;
}
