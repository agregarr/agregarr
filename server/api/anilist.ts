// @server/api/anilist.ts
const ANILIST_API_URL = 'https://graphql.anilist.co';

// ---- Types ----
type AniListPageInfo = {
  total: number | null;
  perPage: number;
  currentPage: number;
  lastPage: number;
  hasNextPage: boolean;
};

export type AniListMedia = {
  id: number;
  idMal?: number | null;
  title: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
  };
  description?: string | null;
  episodes?: number | null;
  genres?: string[] | null;
  averageScore?: number | null;
  popularity?: number | null;
  trending?: number | null;
  format?:
    | 'TV'
    | 'TV_SHORT'
    | 'OVA'
    | 'ONA'
    | 'SPECIAL'
    | 'MOVIE'
    | string
    | null;
  synonyms?: string[] | null;
  startDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
    medium?: string | null;
    color?: string | null;
  } | null;
  externalLinks?: { id: number; site: string; url?: string | null }[] | null;
};

type PageMediaResponse = {
  Page: {
    pageInfo: AniListPageInfo;
    media: AniListMedia[];
  };
};

export type AniListCustomListEntry = {
  status?: string | null;
  score?: number | null;
  media: AniListMedia;
};

export type AniListCustomList = {
  name: string;
  isCustomList?: boolean | null;
  entries: AniListCustomListEntry[];
};

type MediaListCollectionResponse = {
  MediaListCollection: {
    lists: AniListCustomList[];
  };
};

type GraphQLError = {
  message: string;
  locations?: { line: number; column: number }[];
  path?: (string | number)[];
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
};

// ---- Core fetch with GraphQL error handling and rate limiting ----
async function fetchAniListData<T>(
  query: string,
  variables: Record<
    string,
    string | number | boolean | string[] | null | undefined
  > = {}
): Promise<T> {
  const res = await fetch(ANILIST_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Agregarr/1.0',
    },
    body: JSON.stringify({ query, variables }),
  });

  // Handle rate limiting (429 status)
  if (res.status === 429) {
    // Check for Retry-After header, otherwise default to 1 second
    const retryAfter = res.headers.get('Retry-After');
    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000;

    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Retry the request after waiting
    return fetchAniListData(query, variables);
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `AniList API responded with status ${res.status}: ${errorText}`
    );
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json?.errors?.length) {
    const msg = json.errors.map((e) => e.message).join(' | ');
    throw new Error(`AniList GraphQL error: ${msg}`);
  }
  if (!json.data) {
    throw new Error('AniList API returned no data');
  }
  return json.data;
}

// ---- Shared fields ----
const MEDIA_FIELDS = `
fragment MediaFields on Media {
  id
  idMal
  title { romaji english native }
  averageScore
  popularity
  trending
  synonyms
  format
  startDate { year month day }
  coverImage {
    extraLarge
    large
    medium
    color
  }
  externalLinks {
    id
    site
    url
  }
}
`;

type FormatFilters = { format?: string | null; formatIn?: string[] | null };

/** One page of Popular */
export async function getPopularAnime(
  page = 1,
  perPage = 20,
  isAdult = false,
  filters: FormatFilters = {}
) {
  // Build the query based on whether filters are provided
  const hasFormatFilter = !!filters.format;
  const hasFormatInFilter = !!filters.formatIn;
  const hasFilters = hasFormatFilter || hasFormatInFilter;

  // Build query with only the filter parameters we're actually using
  let query: string;
  if (hasFormatFilter) {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int, $isAdult: Boolean, $format: MediaFormat) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, isAdult: $isAdult, sort: POPULARITY_DESC, format: $format) {
            ...MediaFields
          }
        }
      }
    `;
  } else if (hasFormatInFilter) {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int, $isAdult: Boolean, $formatIn: [MediaFormat]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, isAdult: $isAdult, sort: POPULARITY_DESC, format_in: $formatIn) {
            ...MediaFields
          }
        }
      }
    `;
  } else {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, sort: POPULARITY_DESC) {
            ...MediaFields
          }
        }
      }
    `;
  }

  // Build variables with only the parameters we're using
  const variables: Record<
    string,
    string | number | boolean | string[] | null | undefined
  > = { page, perPage };
  if (hasFilters) {
    variables.isAdult = isAdult;
    if (hasFormatFilter) {
      variables.format = filters.format;
    }
    if (hasFormatInFilter) {
      variables.formatIn = filters.formatIn;
    }
  }

  return fetchAniListData<PageMediaResponse>(query, variables);
}

/** One page of Trending */
export async function getTrendingAnime(
  page = 1,
  perPage = 20,
  isAdult = false,
  filters: FormatFilters = {}
) {
  // Build the query based on whether filters are provided
  const hasFormatFilter = !!filters.format;
  const hasFormatInFilter = !!filters.formatIn;
  const hasFilters = hasFormatFilter || hasFormatInFilter;

  // Build query with only the filter parameters we're actually using
  let query: string;
  if (hasFormatFilter) {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int, $isAdult: Boolean, $format: MediaFormat) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, isAdult: $isAdult, sort: TRENDING_DESC, format: $format) {
            ...MediaFields
          }
        }
      }
    `;
  } else if (hasFormatInFilter) {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int, $isAdult: Boolean, $formatIn: [MediaFormat]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, isAdult: $isAdult, sort: TRENDING_DESC, format_in: $formatIn) {
            ...MediaFields
          }
        }
      }
    `;
  } else {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, sort: TRENDING_DESC) {
            ...MediaFields
          }
        }
      }
    `;
  }

  // Build variables with only the parameters we're using
  const variables: Record<
    string,
    string | number | boolean | string[] | null | undefined
  > = { page, perPage };
  if (hasFilters) {
    variables.isAdult = isAdult;
    if (hasFormatFilter) {
      variables.format = filters.format;
    }
    if (hasFormatInFilter) {
      variables.formatIn = filters.formatIn;
    }
  }

  return fetchAniListData<PageMediaResponse>(query, variables);
}

/** One page of Top Rated (by average score) */
export async function getTopRatedAnime(
  page = 1,
  perPage = 20,
  isAdult = false,
  filters: FormatFilters = {}
) {
  // Build the query based on whether filters are provided
  const hasFormatFilter = !!filters.format;
  const hasFormatInFilter = !!filters.formatIn;
  const hasFilters = hasFormatFilter || hasFormatInFilter;

  // Build query with only the filter parameters we're actually using
  let query: string;
  if (hasFormatFilter) {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int, $isAdult: Boolean, $format: MediaFormat) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, isAdult: $isAdult, sort: SCORE_DESC, format: $format) {
            ...MediaFields
          }
        }
      }
    `;
  } else if (hasFormatInFilter) {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int, $isAdult: Boolean, $formatIn: [MediaFormat]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, isAdult: $isAdult, sort: SCORE_DESC, format_in: $formatIn) {
            ...MediaFields
          }
        }
      }
    `;
  } else {
    query = `
      ${MEDIA_FIELDS}
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total perPage currentPage lastPage hasNextPage }
          media(type: ANIME, sort: SCORE_DESC) {
            ...MediaFields
          }
        }
      }
    `;
  }

  // Build variables with only the parameters we're using
  const variables: Record<
    string,
    string | number | boolean | string[] | null | undefined
  > = { page, perPage };
  if (hasFilters) {
    variables.isAdult = isAdult;
    if (hasFormatFilter) {
      variables.format = filters.format;
    }
    if (hasFormatInFilter) {
      variables.formatIn = filters.formatIn;
    }
  }

  return fetchAniListData<PageMediaResponse>(query, variables);
}

// ---- Custom Lists (per user) ----
export async function getUserCustomLists(
  userName: string,
  type: 'ANIME' | 'MANGA' = 'ANIME'
) {
  const query = `
    ${MEDIA_FIELDS}
    query ($userName: String!, $type: MediaType!) {
      MediaListCollection(userName: $userName, type: $type) {
        lists {
          name
          isCustomList
          entries {
            status
            score
            media { ...MediaFields }
          }
        }
      }
    }
  `;
  const data = await fetchAniListData<MediaListCollectionResponse>(query, {
    userName,
    type,
  });
  return data.MediaListCollection.lists || [];
}

// ---- Convenience ----
export async function getFeedsFirstPage(perPage = 20, isAdult = false) {
  // Make requests sequential instead of concurrent to avoid rate limiting
  const popular = await getPopularAnime(1, perPage, isAdult);

  // Small delay between requests to be nice to the API
  await new Promise((resolve) => setTimeout(resolve, 100));
  const trending = await getTrendingAnime(1, perPage, isAdult);

  await new Promise((resolve) => setTimeout(resolve, 100));
  const topRated = await getTopRatedAnime(1, perPage, isAdult);

  return {
    popular: popular.Page.media,
    trending: trending.Page.media,
    topRated: topRated.Page.media,
    pageInfo: {
      popular: popular.Page.pageInfo,
      trending: trending.Page.pageInfo,
      topRated: topRated.Page.pageInfo,
    },
  };
}
