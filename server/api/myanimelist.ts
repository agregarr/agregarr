// @server/api/myanimelist.ts
import { getSettings } from '@server/lib/settings';

const MAL_API_URL = 'https://api.myanimelist.net/v2';

// ---- Types ----
export type MALAnime = {
  id: number;
  title: string;
  main_picture?: {
    medium?: string;
    large?: string;
  };
  alternative_titles?: {
    synonyms?: string[];
    en?: string;
    ja?: string;
  };
  start_date?: string;
  end_date?: string;
  synopsis?: string;
  mean?: number;
  rank?: number;
  popularity?: number;
  num_list_users?: number;
  num_scoring_users?: number;
  media_type?: 'tv' | 'ova' | 'movie' | 'special' | 'ona' | 'music';
  status?: 'finished_airing' | 'currently_airing' | 'not_yet_aired';
  genres?: { id: number; name: string }[];
  num_episodes?: number;
  start_season?: {
    year: number;
    season: 'winter' | 'spring' | 'summer' | 'fall';
  };
  broadcast?: {
    day_of_the_week?: string;
    start_time?: string;
  };
  source?: string;
  average_episode_duration?: number;
  rating?: string;
  studios?: { id: number; name: string }[];
};

type MALRankingResponse = {
  data: {
    node: MALAnime;
    ranking: {
      rank: number;
    };
  }[];
  paging: {
    next?: string;
    previous?: string;
  };
};

// ---- Core fetch ----
async function fetchMALData<T>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const settings = getSettings();
  const apiKey = settings.myanimelist?.apiKey;

  if (!apiKey) {
    throw new Error('MyAnimeList API key is not configured');
  }

  const url = new URL(`${MAL_API_URL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
  });

  let response: globalThis.Response;

  try {
    response = await fetch(url.toString(), {
      headers: {
        'X-MAL-Client-ID': apiKey,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const networkError = new Error(
      `[MyAnimeList] Failed to reach API: ${message}`
    ) as Error & { status?: number; responseBody?: string };
    throw networkError;
  }

  if (!response.ok) {
    const errorText = (await response.text())?.trim() ?? '';
    let message = `[MyAnimeList] Request failed with status ${response.status}`;

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      message = 'Invalid API key - Authentication failed';
    } else if (response.status === 404) {
      message = 'MyAnimeList API endpoint not found';
    } else if (response.status === 429) {
      message = 'Rate limit exceeded - Try again later';
    } else if (errorText) {
      message = `[MyAnimeList] Request failed with status ${response.status}: ${errorText}`;
    }

    const requestError = new Error(message) as Error & {
      status?: number;
      responseBody?: string;
    };
    requestError.status = response.status;
    requestError.responseBody = errorText;
    throw requestError;
  }

  return (await response.json()) as T;
}

/**
 * Valid MAL ranking types
 * Based on https://myanimelist.net/topanime.php tabs
 */
export type MALRankingType =
  | 'all' // Top Anime Series
  | 'airing' // Top Airing Anime
  | 'tv' // Top Anime TV Series
  | 'ova' // Top Anime OVA Series
  | 'movie' // Top Anime Movies
  | 'special' // Top Anime Specials
  | 'bypopularity' // Most Popular Anime
  | 'favorite'; // Most Favorited Anime

/**
 * Get ranked anime by type
 */
export async function getRankedAnime(
  rankingType: MALRankingType = 'all',
  limit = 50,
  offset = 0
): Promise<MALRankingResponse> {
  const fields = [
    'id',
    'title',
    'main_picture',
    'alternative_titles',
    'start_date',
    'end_date',
    'synopsis',
    'mean',
    'rank',
    'popularity',
    'num_list_users',
    'num_scoring_users',
    'media_type',
    'status',
    'genres',
    'num_episodes',
    'start_season',
    'broadcast',
    'source',
    'average_episode_duration',
    'rating',
    'studios',
  ].join(',');

  return fetchMALData<MALRankingResponse>('anime/ranking', {
    ranking_type: rankingType,
    limit: Math.min(limit, 500), // MAL API max limit is 500
    offset,
    fields,
  });
}

/**
 * Get human-readable label for ranking type
 */
export function getRankingTypeLabel(rankingType: MALRankingType): string {
  const labels: Record<MALRankingType, string> = {
    all: 'Top Anime Series',
    airing: 'Top Airing Anime',
    tv: 'Top TV Series',
    ova: 'Top OVA Series',
    movie: 'Top Movies',
    special: 'Top Specials',
    bypopularity: 'Most Popular',
    favorite: 'Most Favorited',
  };

  return labels[rankingType];
}
