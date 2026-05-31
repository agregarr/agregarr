import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';

export interface JustWatchListItem {
  rank: number;
  title: string;
  points?: string;
  flixpatrolUrl?: string; // Backward-compatible metadata field used by Networks collections.
  type: 'movie' | 'tv';
  justwatchId?: string;
}

export interface JustWatchPlatformData {
  platform: string;
  region: string;
  date: string;
  tvShows: JustWatchListItem[];
  movies: JustWatchListItem[];
  platformLogo?: {
    spriteUrl: string;
    position: string;
  };
}

export interface JustWatchPlatformOption {
  value: string;
  label: string;
}

export interface JustWatchCountryOption {
  value: string;
  label: string;
}

interface JustWatchProvider {
  id: string;
  label: string;
  package: string;
  subtype: string;
}

interface JustWatchGraphQLError {
  message: string;
}

interface JustWatchStreamingChartsResponse {
  data?: {
    streamingCharts?: {
      edges?: {
        streamingChartInfo?: {
          rank?: number;
          trend?: string;
          trendDifference?: number;
          daysInTop10?: number;
          topRank?: number;
        };
        node?: {
          id?: string;
          objectId?: number;
          objectType?: 'MOVIE' | 'SHOW';
          content?: {
            title?: string;
            fullPath?: string;
          };
        };
      }[];
    };
  };
  errors?: JustWatchGraphQLError[];
}

const STREAMING_CHARTS_QUERY = `
  query StreamingCharts(
    $country: Country!
    $filter: StreamingChartsFilter!
    $first: Int!
  ) {
    streamingCharts(country: $country, filter: $filter, first: $first) {
      edges {
        streamingChartInfo {
          rank
          trend
          trendDifference
          daysInTop10
          topRank
        }
        node {
          id
          objectId
          objectType
          content(country: $country, language: "en") {
            title
            fullPath
          }
        }
      }
    }
  }
`;

const PROVIDERS: JustWatchProvider[] = [
  {
    id: 'netflix',
    label: 'Netflix',
    package: 'nfx',
    subtype: 'netflix_top_10',
  },
  {
    id: 'hbo',
    label: 'Max',
    package: 'mxx',
    subtype: 'hbo_top_10',
  },
  {
    id: 'disney',
    label: 'Disney+',
    package: 'dnp',
    subtype: 'disney_top_10',
  },
  {
    id: 'amazon-prime',
    label: 'Amazon Prime Video',
    package: 'amp',
    subtype: 'amazon_prime_top_10',
  },
  {
    id: 'apple-tv',
    label: 'Apple TV+',
    package: 'atp',
    subtype: 'apple_tv_top_10',
  },
  {
    id: 'paramount',
    label: 'Paramount+',
    package: 'ppp',
    subtype: 'paramount_top_10',
  },
  {
    id: 'peacock',
    label: 'Peacock',
    package: 'pct',
    subtype: 'peacock_top_10',
  },
  {
    id: 'crunchyroll',
    label: 'Crunchyroll',
    package: 'cru',
    subtype: 'crunchyroll_top_10',
  },
  {
    id: 'discovery-plus',
    label: 'Discovery+',
    package: 'dpu',
    subtype: 'discovery_plus_top_10',
  },
  {
    id: 'hulu',
    label: 'Hulu',
    package: 'hlu',
    subtype: 'hulu_top_10',
  },
];

const PROVIDER_ALIASES: Record<string, string> = {
  amazon: 'amazon-prime',
  amazon_prime: 'amazon-prime',
  'amazon-prime-video': 'amazon-prime',
  apple: 'apple-tv',
  apple_tv: 'apple-tv',
  'apple-tv-plus': 'apple-tv',
  disney_plus: 'disney',
  'disney-plus': 'disney',
  discovery: 'discovery-plus',
  discovery_plus: 'discovery-plus',
  hbo: 'hbo',
  'hbo-max': 'hbo',
  max: 'hbo',
  paramount_plus: 'paramount',
  'paramount-plus': 'paramount',
  'paramount-plus-premium': 'paramount',
  peacocktv: 'peacock',
};

const COUNTRY_OPTIONS: JustWatchCountryOption[] = [
  { value: 'us', label: 'United States' },
  { value: 'gb', label: 'United Kingdom' },
  { value: 'at', label: 'Austria' },
  { value: 'de', label: 'Germany' },
  { value: 'ch', label: 'Switzerland' },
  { value: 'fr', label: 'France' },
  { value: 'es', label: 'Spain' },
  { value: 'it', label: 'Italy' },
  { value: 'nl', label: 'Netherlands' },
  { value: 'be', label: 'Belgium' },
  { value: 'dk', label: 'Denmark' },
  { value: 'fi', label: 'Finland' },
  { value: 'no', label: 'Norway' },
  { value: 'se', label: 'Sweden' },
  { value: 'ie', label: 'Ireland' },
  { value: 'pt', label: 'Portugal' },
  { value: 'pl', label: 'Poland' },
  { value: 'cz', label: 'Czech Republic' },
  { value: 'hu', label: 'Hungary' },
  { value: 'ro', label: 'Romania' },
  { value: 'sk', label: 'Slovakia' },
  { value: 'si', label: 'Slovenia' },
  { value: 'hr', label: 'Croatia' },
  { value: 'bg', label: 'Bulgaria' },
  { value: 'gr', label: 'Greece' },
  { value: 'tr', label: 'Turkey' },
  { value: 'ca', label: 'Canada' },
  { value: 'mx', label: 'Mexico' },
  { value: 'br', label: 'Brazil' },
  { value: 'ar', label: 'Argentina' },
  { value: 'cl', label: 'Chile' },
  { value: 'co', label: 'Colombia' },
  { value: 'pe', label: 'Peru' },
  { value: 'ec', label: 'Ecuador' },
  { value: 'au', label: 'Australia' },
  { value: 'nz', label: 'New Zealand' },
  { value: 'jp', label: 'Japan' },
  { value: 'kr', label: 'South Korea' },
  { value: 'hk', label: 'Hong Kong' },
  { value: 'tw', label: 'Taiwan' },
  { value: 'sg', label: 'Singapore' },
  { value: 'my', label: 'Malaysia' },
  { value: 'ph', label: 'Philippines' },
  { value: 'id', label: 'Indonesia' },
  { value: 'th', label: 'Thailand' },
  { value: 'in', label: 'India' },
  { value: 'za', label: 'South Africa' },
  { value: 'eg', label: 'Egypt' },
  { value: 'il', label: 'Israel' },
];

const COUNTRY_ALIASES: Record<string, string> = {
  global: 'US',
  world: 'US',
  worldwide: 'US',
  uk: 'GB',
  'united-kingdom': 'GB',
  britain: 'GB',
  'great-britain': 'GB',
  'united-states': 'US',
  usa: 'US',
  america: 'US',
  'south-korea': 'KR',
  'hong-kong': 'HK',
  'new-zealand': 'NZ',
  'czech-republic': 'CZ',
  czechia: 'CZ',
  'south-africa': 'ZA',
};

class JustWatchAPI extends ExternalAPI {
  constructor() {
    super(
      'https://apis.justwatch.com',
      {},
      {
        headers: {
          Origin: 'https://www.justwatch.com',
          Referer: 'https://www.justwatch.com/',
        },
        nodeCache: cacheManager.getCache('justwatch').data,
        rateLimit: {
          maxRequests: 5,
          maxRPS: 5,
        },
      }
    );
  }

  public async getPlatformTop10(
    platform: string,
    region = 'global',
    requestedMediaType?: 'movie' | 'tv' | 'both'
  ): Promise<JustWatchPlatformData> {
    const provider = this.getProvider(platform);
    const country = this.normalizeCountry(region);
    const mediaType = requestedMediaType ?? 'both';
    const tasks: Promise<JustWatchListItem[]>[] = [];

    if (mediaType === 'movie' || mediaType === 'both') {
      tasks.push(this.fetchChart(provider, country, 'MOVIE'));
    } else {
      tasks.push(Promise.resolve([]));
    }

    if (mediaType === 'tv' || mediaType === 'both') {
      tasks.push(this.fetchChart(provider, country, 'SHOW'));
    } else {
      tasks.push(Promise.resolve([]));
    }

    const [movies, tvShows] = await Promise.all(tasks);

    logger.info(`Fetched JustWatch top 10 for ${provider.label}`, {
      label: 'JustWatch API',
      platform: provider.id,
      country,
      movies: movies.length,
      tvShows: tvShows.length,
    });

    return {
      platform: provider.label,
      region: country,
      date: new Date().toISOString().split('T')[0],
      movies,
      tvShows,
    };
  }

  public async getAvailableCountries(): Promise<JustWatchCountryOption[]> {
    return COUNTRY_OPTIONS;
  }

  public async getAvailablePlatformsForCountry(
    country: string
  ): Promise<JustWatchPlatformOption[]> {
    logger.debug(`Returning JustWatch providers for ${country}`, {
      label: 'JustWatch API',
      country,
      count: PROVIDERS.length,
    });

    return PROVIDERS.map((provider) => ({
      value: provider.subtype,
      label: `${provider.label} Top 10`,
    }));
  }

  public static getPlatformLabel(platform: string): string {
    const normalized = JustWatchAPI.normalizePlatformId(platform);
    const provider = PROVIDERS.find((p) => p.id === normalized);
    return provider ? `${provider.label} Top 10` : 'Streaming Top 10';
  }

  private async fetchChart(
    provider: JustWatchProvider,
    country: string,
    objectType: 'MOVIE' | 'SHOW'
  ): Promise<JustWatchListItem[]> {
    const response = await this.post<JustWatchStreamingChartsResponse>(
      '/graphql',
      {
        query: STREAMING_CHARTS_QUERY,
        variables: {
          country,
          first: 10,
          filter: {
            category: 'WEEKLY_POPULARITY_SAME_CONTENT_TYPE',
            nextTitles: 0,
            objectType,
            packages: [provider.package],
            previousTitles: 0,
          },
        },
      },
      undefined,
      3600
    );

    if (response.errors?.length) {
      throw new Error(
        `JustWatch GraphQL error: ${response.errors
          .map((error) => error.message)
          .join('; ')}`
      );
    }

    const edges = response.data?.streamingCharts?.edges ?? [];
    const itemType = objectType === 'MOVIE' ? 'movie' : 'tv';

    return edges
      .map((edge, index): JustWatchListItem | null => {
        const title = edge.node?.content?.title?.trim();

        if (!title) {
          return null;
        }

        const justwatchPath = edge.node?.content?.fullPath;
        const justwatchUrl = justwatchPath
          ? `https://www.justwatch.com${justwatchPath}`
          : undefined;
        const rank = index + 1;
        const chartRank = edge.streamingChartInfo?.rank;
        const daysInTop10 = edge.streamingChartInfo?.daysInTop10;
        const points = [
          chartRank ? `JW rank #${chartRank}` : undefined,
          typeof daysInTop10 === 'number' ? `${daysInTop10} days` : undefined,
        ]
          .filter(Boolean)
          .join(' | ');

        return {
          rank,
          title,
          points: points || undefined,
          flixpatrolUrl: justwatchUrl,
          type: itemType,
          justwatchId: edge.node?.id,
        };
      })
      .filter((item): item is JustWatchListItem => item !== null);
  }

  private getProvider(platform: string): JustWatchProvider {
    const normalized = JustWatchAPI.normalizePlatformId(platform);
    const provider = PROVIDERS.find((p) => p.id === normalized);

    if (!provider) {
      throw new Error(`Unsupported JustWatch provider: ${platform}`);
    }

    return provider;
  }

  private normalizeCountry(country: string): string {
    const normalized = country.trim().toLowerCase().replace(/_/g, '-');

    if (COUNTRY_ALIASES[normalized]) {
      return COUNTRY_ALIASES[normalized];
    }

    if (/^[a-z]{2}$/.test(normalized)) {
      return normalized.toUpperCase();
    }

    const option = COUNTRY_OPTIONS.find(
      (entry) => entry.label.toLowerCase().replace(/\s+/g, '-') === normalized
    );

    if (option) {
      return option.value.toUpperCase();
    }

    throw new Error(`Unsupported JustWatch country/region: ${country}`);
  }

  private static normalizePlatformId(platform: string): string {
    const normalized = platform
      .replace(/_top_10$/, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
    const dashed = normalized.replace(/_/g, '-');

    return PROVIDER_ALIASES[normalized] || PROVIDER_ALIASES[dashed] || dashed;
  }
}

export default JustWatchAPI;
