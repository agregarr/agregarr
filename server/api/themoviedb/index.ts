import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { sortBy } from 'lodash';
import type {
  TmdbCollection,
  TmdbCollectionResult,
  TmdbCompanySearchResponse,
  TmdbExternalIdResponse,
  TmdbGenre,
  TmdbGenresResult,
  TmdbImagesResponse,
  TmdbKeyword,
  TmdbKeywordSearchResponse,
  TmdbLanguage,
  TmdbList,
  TmdbMovieDetails,
  TmdbNetwork,
  TmdbPersonCombinedCredits,
  TmdbPersonDetails,
  TmdbProductionCompany,
  TmdbRegion,
  TmdbSearchMovieResponse,
  TmdbSearchMultiResponse,
  TmdbSearchTvResponse,
  TmdbSeasonWithEpisodes,
  TmdbTvDetails,
  TmdbUpcomingMoviesResponse,
  TmdbWatchProviderDetails,
  TmdbWatchProviderRegion,
} from './interfaces';

interface SearchOptions {
  query: string;
  page?: number;
  includeAdult?: boolean;
  language?: string;
}

interface SingleSearchOptions extends SearchOptions {
  year?: number;
}

export type SortOptions =
  | 'popularity.asc'
  | 'popularity.desc'
  | 'release_date.asc'
  | 'release_date.desc'
  | 'revenue.asc'
  | 'revenue.desc'
  | 'primary_release_date.asc'
  | 'primary_release_date.desc'
  | 'original_title.asc'
  | 'original_title.desc'
  | 'vote_average.asc'
  | 'vote_average.desc'
  | 'vote_count.asc'
  | 'vote_count.desc'
  | 'first_air_date.asc'
  | 'first_air_date.desc';

interface DiscoverMovieOptions {
  page?: number;
  includeAdult?: boolean;
  language?: string;
  primaryReleaseDateGte?: string;
  primaryReleaseDateLte?: string;
  releaseDateGte?: string;
  releaseDateLte?: string;
  withReleaseType?: string;
  withRuntimeGte?: string;
  withRuntimeLte?: string;
  voteAverageGte?: string;
  voteAverageLte?: string;
  voteCountGte?: string;
  voteCountLte?: string;
  originalLanguage?: string;
  genre?: string;
  studio?: string;
  keywords?: string;
  sortBy?: SortOptions;
  watchRegion?: string;
  watchProviders?: string;
}

interface DiscoverTvOptions {
  page?: number;
  language?: string;
  firstAirDateGte?: string;
  firstAirDateLte?: string;
  airDateGte?: string;
  airDateLte?: string;
  withRuntimeGte?: string;
  withRuntimeLte?: string;
  voteAverageGte?: string;
  voteAverageLte?: string;
  voteCountGte?: string;
  voteCountLte?: string;
  includeEmptyReleaseDate?: boolean;
  originalLanguage?: string;
  genre?: string;
  network?: number;
  keywords?: string;
  sortBy?: SortOptions;
  watchRegion?: string;
  watchProviders?: string;
}

class TheMovieDb extends ExternalAPI {
  private region?: string;
  private originalLanguage?: string;
  constructor({
    region,
    originalLanguage,
  }: { region?: string; originalLanguage?: string } = {}) {
    super(
      'https://api.themoviedb.org/3',
      {
        api_key: '74fc2350fc03cafb0ca5bffbff32e3b5',
      },
      {
        nodeCache: cacheManager.getCache('tmdb').data,
        rateLimit: {
          maxRequests: 9999, // High limit to effectively disable total request cap
          maxRPS: 40, // Slightly below TMDB's ~50 req/sec to be respectful
        },
      }
    );
    this.region = region;
    this.originalLanguage = originalLanguage;
  }

  public searchMulti = async ({
    query,
    page = 1,
    includeAdult = false,
    language = 'en',
  }: SearchOptions): Promise<TmdbSearchMultiResponse> => {
    try {
      const data = await this.get<TmdbSearchMultiResponse>('/search/multi', {
        params: { query, page, include_adult: includeAdult, language },
      });

      return data;
    } catch (e) {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  };

  public searchMovies = async ({
    query,
    page = 1,
    includeAdult = false,
    language = 'en',
    year,
  }: SingleSearchOptions): Promise<TmdbSearchMovieResponse> => {
    try {
      const data = await this.get<TmdbSearchMovieResponse>('/search/movie', {
        params: {
          query,
          page,
          include_adult: includeAdult,
          language,
          primary_release_year: year,
        },
      });

      return data;
    } catch (e) {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  };

  public searchTvShows = async ({
    query,
    page = 1,
    includeAdult = false,
    language = 'en',
    year,
  }: SingleSearchOptions): Promise<TmdbSearchTvResponse> => {
    try {
      const data = await this.get<TmdbSearchTvResponse>('/search/tv', {
        params: {
          query,
          page,
          include_adult: includeAdult,
          language,
          first_air_date_year: year,
        },
      });

      return data;
    } catch (e) {
      return {
        page: 1,
        results: [],
        total_pages: 1,
        total_results: 0,
      };
    }
  };

  public getPerson = async ({
    personId,
    language = 'en',
  }: {
    personId: number;
    language?: string;
  }): Promise<TmdbPersonDetails> => {
    try {
      const data = await this.get<TmdbPersonDetails>(`/person/${personId}`, {
        params: { language },
      });

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch person details: ${e.message}`);
    }
  };

  public getPersonCombinedCredits = async ({
    personId,
    language = 'en',
  }: {
    personId: number;
    language?: string;
  }): Promise<TmdbPersonCombinedCredits> => {
    try {
      const data = await this.get<TmdbPersonCombinedCredits>(
        `/person/${personId}/combined_credits`,
        {
          params: { language },
        }
      );

      return data;
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch person combined credits: ${e.message}`
      );
    }
  };

  public getMovie = async ({
    movieId,
    language = 'en',
  }: {
    movieId: number;
    language?: string;
  }): Promise<TmdbMovieDetails> => {
    try {
      const data = await this.get<TmdbMovieDetails>(
        `/movie/${movieId}`,
        {
          params: {
            language,
            append_to_response:
              'credits,external_ids,videos,keywords,release_dates,watch/providers',
            include_video_language: language + ', en',
          },
        },
        43200
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movie details: ${e.message}`);
    }
  };

  public getTvShow = async ({
    tvId,
    language = 'en',
  }: {
    tvId: number;
    language?: string;
  }): Promise<TmdbTvDetails> => {
    try {
      const data = await this.get<TmdbTvDetails>(
        `/tv/${tvId}`,
        {
          params: {
            language,
            append_to_response:
              'aggregate_credits,credits,external_ids,keywords,videos,content_ratings,watch/providers',
            include_video_language: language + ', en',
          },
        },
        1800 // 30 minutes cache - next_episode_to_air changes frequently when shows are airing
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV show details: ${e.message}`);
    }
  };

  public getTvSeason = async ({
    tvId,
    seasonNumber,
    language,
  }: {
    tvId: number;
    seasonNumber: number;
    language?: string;
  }): Promise<TmdbSeasonWithEpisodes> => {
    try {
      const data = await this.get<TmdbSeasonWithEpisodes>(
        `/tv/${tvId}/season/${seasonNumber}`,
        {
          params: {
            language,
            append_to_response: 'external_ids',
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV show details: ${e.message}`);
    }
  };

  public getMovieImages = async ({
    movieId,
    language,
  }: {
    movieId: number;
    language?: string;
  }): Promise<TmdbImagesResponse> => {
    try {
      const data = await this.get<TmdbImagesResponse>(
        `/movie/${movieId}/images`,
        {
          params: {
            language,
            include_image_language: language ? `${language},null` : undefined,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movie images: ${e.message}`);
    }
  };

  public getTvShowImages = async ({
    tvId,
    language,
  }: {
    tvId: number;
    language?: string;
  }): Promise<TmdbImagesResponse> => {
    try {
      const data = await this.get<TmdbImagesResponse>(`/tv/${tvId}/images`, {
        params: {
          language,
          include_image_language: language ? `${language},null` : undefined,
        },
      });

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV show images: ${e.message}`);
    }
  };

  public async getMovieRecommendations({
    movieId,
    page = 1,
    language = 'en',
  }: {
    movieId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchMovieResponse> {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/movie/${movieId}/recommendations`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover movies: ${e.message}`);
    }
  }

  public async getMovieSimilar({
    movieId,
    page = 1,
    language = 'en',
  }: {
    movieId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchMovieResponse> {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/movie/${movieId}/similar`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover movies: ${e.message}`);
    }
  }

  public async getMoviesByKeyword({
    keywordId,
    page = 1,
    language = 'en',
  }: {
    keywordId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchMovieResponse> {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/keyword/${keywordId}/movies`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movies by keyword: ${e.message}`);
    }
  }

  public async getTvRecommendations({
    tvId,
    page = 1,
    language = 'en',
  }: {
    tvId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchTvResponse> {
    try {
      const data = await this.get<TmdbSearchTvResponse>(
        `/tv/${tvId}/recommendations`,
        {
          params: {
            page,
            language,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch TV recommendations: ${e.message}`
      );
    }
  }

  public async getTvSimilar({
    tvId,
    page = 1,
    language = 'en',
  }: {
    tvId: number;
    page?: number;
    language?: string;
  }): Promise<TmdbSearchTvResponse> {
    try {
      const data = await this.get<TmdbSearchTvResponse>(`/tv/${tvId}/similar`, {
        params: {
          page,
          language,
        },
      });

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV similar: ${e.message}`);
    }
  }

  public getDiscoverMovies = async ({
    sortBy = 'popularity.desc',
    page = 1,
    includeAdult = false,
    language = 'en',
    primaryReleaseDateGte,
    primaryReleaseDateLte,
    releaseDateGte,
    releaseDateLte,
    withReleaseType,
    originalLanguage,
    genre,
    studio,
    keywords,
    withRuntimeGte,
    withRuntimeLte,
    voteAverageGte,
    voteAverageLte,
    voteCountGte,
    voteCountLte,
    watchProviders,
    watchRegion,
  }: DiscoverMovieOptions = {}): Promise<TmdbSearchMovieResponse> => {
    try {
      const defaultFutureDate = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * (365 * 1.5)
      )
        .toISOString()
        .split('T')[0];

      const defaultPastDate = new Date('1900-01-01')
        .toISOString()
        .split('T')[0];

      const data = await this.get<TmdbSearchMovieResponse>('/discover/movie', {
        params: {
          sort_by: sortBy,
          page,
          include_adult: includeAdult,
          language,
          region: this.region,
          with_original_language:
            originalLanguage && originalLanguage !== 'all'
              ? originalLanguage
              : originalLanguage === 'all'
              ? undefined
              : this.originalLanguage,
          // Set our release date values, but check if one is set and not the other,
          // so we can force a past date or a future date. TMDB Requires both values if one is set!
          'primary_release_date.gte':
            !primaryReleaseDateGte && primaryReleaseDateLte
              ? defaultPastDate
              : primaryReleaseDateGte,
          'primary_release_date.lte':
            !primaryReleaseDateLte && primaryReleaseDateGte
              ? defaultFutureDate
              : primaryReleaseDateLte,
          // Release date filters (used with with_release_type for specific release types)
          'release_date.gte': releaseDateGte,
          'release_date.lte': releaseDateLte,
          with_release_type: withReleaseType,
          with_genres: genre,
          with_companies: studio,
          with_keywords: keywords,
          'with_runtime.gte': withRuntimeGte,
          'with_runtime.lte': withRuntimeLte,
          'vote_average.gte': voteAverageGte,
          'vote_average.lte': voteAverageLte,
          'vote_count.gte': voteCountGte,
          'vote_count.lte': voteCountLte,
          watch_region: watchRegion,
          with_watch_providers: watchProviders,
        },
      });

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover movies: ${e.message}`);
    }
  };

  public getDiscoverTv = async ({
    sortBy = 'popularity.desc',
    page = 1,
    language = 'en',
    firstAirDateGte,
    firstAirDateLte,
    airDateGte,
    airDateLte,
    includeEmptyReleaseDate = false,
    originalLanguage,
    genre,
    network,
    keywords,
    withRuntimeGte,
    withRuntimeLte,
    voteAverageGte,
    voteAverageLte,
    voteCountGte,
    voteCountLte,
    watchProviders,
    watchRegion,
  }: DiscoverTvOptions = {}): Promise<TmdbSearchTvResponse> => {
    try {
      const defaultFutureDate = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * (365 * 1.5)
      )
        .toISOString()
        .split('T')[0];

      const defaultPastDate = new Date('1900-01-01')
        .toISOString()
        .split('T')[0];

      const data = await this.get<TmdbSearchTvResponse>('/discover/tv', {
        params: {
          sort_by: sortBy,
          page,
          language,
          region: this.region,
          // Set our release date values, but check if one is set and not the other,
          // so we can force a past date or a future date. TMDB Requires both values if one is set!
          'first_air_date.gte':
            !firstAirDateGte && firstAirDateLte
              ? defaultPastDate
              : firstAirDateGte,
          'first_air_date.lte':
            !firstAirDateLte && firstAirDateGte
              ? defaultFutureDate
              : firstAirDateLte,
          'air_date.gte': airDateGte,
          'air_date.lte': airDateLte,
          with_original_language:
            originalLanguage && originalLanguage !== 'all'
              ? originalLanguage
              : originalLanguage === 'all'
              ? undefined
              : this.originalLanguage,
          include_null_first_air_dates: includeEmptyReleaseDate,
          with_genres: genre,
          with_networks: network,
          with_keywords: keywords,
          'with_runtime.gte': withRuntimeGte,
          'with_runtime.lte': withRuntimeLte,
          'vote_average.gte': voteAverageGte,
          'vote_average.lte': voteAverageLte,
          'vote_count.gte': voteCountGte,
          'vote_count.lte': voteCountLte,
          with_watch_providers: watchProviders,
          watch_region: watchRegion,
        },
      });

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch discover TV: ${e.message}`);
    }
  };

  public getUpcomingMovies = async ({
    page = 1,
    language = 'en',
  }: {
    page: number;
    language: string;
  }): Promise<TmdbUpcomingMoviesResponse> => {
    try {
      const data = await this.get<TmdbUpcomingMoviesResponse>(
        '/movie/upcoming',
        {
          params: {
            page,
            language,
            region: this.region,
            originalLanguage: this.originalLanguage,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch upcoming movies: ${e.message}`);
    }
  };

  public getAllTrending = async ({
    page = 1,
    timeWindow = 'day',
    language = 'en',
  }: {
    page?: number;
    timeWindow?: 'day' | 'week';
    language?: string;
  } = {}): Promise<TmdbSearchMultiResponse> => {
    try {
      const data = await this.get<TmdbSearchMultiResponse>(
        `/trending/all/${timeWindow}`,
        {
          params: {
            page,
            language,
            region: this.region,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch all trending: ${e.message}`);
    }
  };

  public getMovieTrending = async ({
    page = 1,
    timeWindow = 'day',
  }: {
    page?: number;
    timeWindow?: 'day' | 'week';
  } = {}): Promise<TmdbSearchMovieResponse> => {
    try {
      const data = await this.get<TmdbSearchMovieResponse>(
        `/trending/movie/${timeWindow}`,
        {
          params: {
            page,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch all trending: ${e.message}`);
    }
  };

  public getTvTrending = async ({
    page = 1,
    timeWindow = 'day',
  }: {
    page?: number;
    timeWindow?: 'day' | 'week';
  } = {}): Promise<TmdbSearchTvResponse> => {
    try {
      const data = await this.get<TmdbSearchTvResponse>(
        `/trending/tv/${timeWindow}`,
        {
          params: {
            page,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch all trending: ${e.message}`);
    }
  };

  public async getByExternalId({
    externalId,
    type,
    language = 'en',
  }:
    | {
        externalId: string;
        type: 'imdb';
        language?: string;
      }
    | {
        externalId: number;
        type: 'tvdb';
        language?: string;
      }): Promise<TmdbExternalIdResponse> {
    try {
      const data = await this.get<TmdbExternalIdResponse>(
        `/find/${externalId}`,
        {
          params: {
            external_source: type === 'imdb' ? 'imdb_id' : 'tvdb_id',
            language,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to find by external ID: ${e.message}`);
    }
  }

  public async getMediaByImdbId({
    imdbId,
    language = 'en',
  }: {
    imdbId: string;
    language?: string;
  }): Promise<TmdbMovieDetails | TmdbTvDetails> {
    try {
      const extResponse = await this.getByExternalId({
        externalId: imdbId,
        type: 'imdb',
      });

      if (extResponse.movie_results[0]) {
        const movie = await this.getMovie({
          movieId: extResponse.movie_results[0].id,
          language,
        });

        return movie;
      }

      if (extResponse.tv_results[0]) {
        const tvshow = await this.getTvShow({
          tvId: extResponse.tv_results[0].id,
          language,
        });

        return tvshow;
      }

      throw new Error(`No movie or show returned from API for ID ${imdbId}`);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to find media using external IMDb ID: ${e.message}`
      );
    }
  }

  public async getShowByTvdbId({
    tvdbId,
    language = 'en',
  }: {
    tvdbId: number;
    language?: string;
  }): Promise<TmdbTvDetails> {
    try {
      const extResponse = await this.getByExternalId({
        externalId: tvdbId,
        type: 'tvdb',
      });

      if (extResponse.tv_results[0]) {
        const tvshow = await this.getTvShow({
          tvId: extResponse.tv_results[0].id,
          language,
        });

        return tvshow;
      }

      throw new Error(`No show returned from API for ID ${tvdbId}`);
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to get TV show using the external TVDB ID: ${e.message}`
      );
    }
  }

  public async getCollection({
    collectionId,
    language = 'en',
  }: {
    collectionId: number;
    language?: string;
  }): Promise<TmdbCollection> {
    try {
      const data = await this.get<TmdbCollection>(
        `/collection/${collectionId}`,
        {
          params: {
            language,
          },
        }
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch collection: ${e.message}`);
    }
  }

  public async getList({
    listId,
    language = 'en',
    page = 1,
  }: {
    listId: string;
    language?: string;
    page?: number;
  }): Promise<TmdbList> {
    try {
      const data = await this.get<TmdbList>(`/list/${listId}`, {
        params: {
          language,
          page,
        },
      });

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch list: ${e.message}`);
    }
  }

  /**
   * Get popular collections for discovery
   */
  public async getPopularCollections({
    page = 1,
    language = 'en',
  }: {
    page?: number;
    language?: string;
  } = {}): Promise<{
    results: {
      id: number;
      name: string;
      poster_path?: string;
      backdrop_path?: string;
    }[];
    total_pages: number;
    total_results: number;
  }> {
    try {
      // Note: TMDB doesn't have a direct popular collections endpoint
      // We'll discover collections through popular movies that belong to collections

      // Get movie details to access belongs_to_collection data
      const collections: {
        id: number;
        name: string;
        poster_path?: string;
        backdrop_path?: string;
      }[] = [];
      const seenCollectionIds = new Set<number>();

      // Fetch multiple pages of popular movies to find collections
      for (let currentPage = page; currentPage <= page + 2; currentPage++) {
        try {
          const discoverResult = await this.getDiscoverMovies({
            sortBy: 'popularity.desc',
            page: currentPage,
            language,
          });

          // For each popular movie, get details to see if it belongs to a collection
          for (const movie of discoverResult.results.slice(0, 10)) {
            // Limit to avoid too many API calls
            try {
              const movieDetails = await this.getMovie({
                movieId: movie.id,
                language,
              });
              if (
                movieDetails.belongs_to_collection &&
                !seenCollectionIds.has(movieDetails.belongs_to_collection.id)
              ) {
                seenCollectionIds.add(movieDetails.belongs_to_collection.id);
                collections.push({
                  id: movieDetails.belongs_to_collection.id,
                  name: movieDetails.belongs_to_collection.name,
                  poster_path: movieDetails.belongs_to_collection.poster_path,
                  backdrop_path:
                    movieDetails.belongs_to_collection.backdrop_path,
                });
              }
            } catch (error) {
              // Continue if individual movie fetch fails
              continue;
            }
          }
        } catch (error) {
          // Continue if page fetch fails
          continue;
        }
      }

      return {
        results: collections,
        total_pages: 1,
        total_results: collections.length,
      };
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch popular collections: ${e.message}`
      );
    }
  }

  /**
   * Search for collections
   */
  public async searchCollections({
    query,
    page = 1,
    language = 'en',
  }: {
    query: string;
    page?: number;
    language?: string;
  }): Promise<{
    results: TmdbCollectionResult[];
    total_pages: number;
    total_results: number;
  }> {
    try {
      const data = await this.get<{
        results: TmdbCollectionResult[];
        total_pages: number;
        total_results: number;
      }>('/search/collection', {
        params: {
          query,
          page,
          language,
        },
      });
      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to search collections: ${e.message}`);
    }
  }

  public async getRegions(): Promise<TmdbRegion[]> {
    try {
      const data = await this.get<TmdbRegion[]>(
        '/configuration/countries',
        {},
        86400 // 24 hours
      );

      const regions = sortBy(data, 'english_name');

      return regions;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch countries: ${e.message}`);
    }
  }

  public async getLanguages(): Promise<TmdbLanguage[]> {
    try {
      const data = await this.get<TmdbLanguage[]>(
        '/configuration/languages',
        {},
        86400 // 24 hours
      );

      const languages = sortBy(data, 'english_name');

      return languages;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch langauges: ${e.message}`);
    }
  }

  public async getStudio(studioId: number): Promise<TmdbProductionCompany> {
    try {
      const data = await this.get<TmdbProductionCompany>(
        `/company/${studioId}`
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movie studio: ${e.message}`);
    }
  }

  public async getNetwork(networkId: number): Promise<TmdbNetwork> {
    try {
      const data = await this.get<TmdbNetwork>(`/network/${networkId}`);

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV network: ${e.message}`);
    }
  }

  public async getMovieGenres({
    language = 'en',
  }: {
    language?: string;
  } = {}): Promise<TmdbGenre[]> {
    try {
      const data = await this.get<TmdbGenresResult>(
        '/genre/movie/list',
        {
          params: {
            language,
          },
        },
        86400 // 24 hours
      );

      if (
        !language.startsWith('en') &&
        data.genres.some((genre) => !genre.name)
      ) {
        const englishData = await this.get<TmdbGenresResult>(
          '/genre/movie/list',
          {
            params: {
              language: 'en',
            },
          },
          86400 // 24 hours
        );

        data.genres
          .filter((genre) => !genre.name)
          .forEach((genre) => {
            genre.name =
              englishData.genres.find(
                (englishGenre) => englishGenre.id === genre.id
              )?.name ?? '';
          });
      }

      const movieGenres = sortBy(
        data.genres.filter((genre) => genre.name),
        'name'
      );

      return movieGenres;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch movie genres: ${e.message}`);
    }
  }

  public async getTvGenres({
    language = 'en',
  }: {
    language?: string;
  } = {}): Promise<TmdbGenre[]> {
    try {
      const data = await this.get<TmdbGenresResult>(
        '/genre/tv/list',
        {
          params: {
            language,
          },
        },
        86400 // 24 hours
      );

      if (
        !language.startsWith('en') &&
        data.genres.some((genre) => !genre.name)
      ) {
        const englishData = await this.get<TmdbGenresResult>(
          '/genre/tv/list',
          {
            params: {
              language: 'en',
            },
          },
          86400 // 24 hours
        );

        data.genres
          .filter((genre) => !genre.name)
          .forEach((genre) => {
            genre.name =
              englishData.genres.find(
                (englishGenre) => englishGenre.id === genre.id
              )?.name ?? '';
          });
      }

      const tvGenres = sortBy(
        data.genres.filter((genre) => genre.name),
        'name'
      );

      return tvGenres;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch TV genres: ${e.message}`);
    }
  }

  public async getKeywordDetails({
    keywordId,
  }: {
    keywordId: number;
  }): Promise<TmdbKeyword> {
    try {
      const data = await this.get<TmdbKeyword>(
        `/keyword/${keywordId}`,
        undefined,
        604800 // 7 days
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to fetch keyword: ${e.message}`);
    }
  }

  public async searchKeyword({
    query,
    page = 1,
  }: {
    query: string;
    page?: number;
  }): Promise<TmdbKeywordSearchResponse> {
    try {
      const data = await this.get<TmdbKeywordSearchResponse>(
        '/search/keyword',
        {
          params: {
            query,
            page,
          },
        },
        86400 // 24 hours
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to search keyword: ${e.message}`);
    }
  }

  public async searchCompany({
    query,
    page = 1,
  }: {
    query: string;
    page?: number;
  }): Promise<TmdbCompanySearchResponse> {
    try {
      const data = await this.get<TmdbCompanySearchResponse>(
        '/search/company',
        {
          params: {
            query,
            page,
          },
        },
        86400 // 24 hours
      );

      return data;
    } catch (e) {
      throw new Error(`[TMDB] Failed to search companies: ${e.message}`);
    }
  }

  public async getAvailableWatchProviderRegions({
    language,
  }: {
    language?: string;
  }) {
    try {
      const data = await this.get<{ results: TmdbWatchProviderRegion[] }>(
        '/watch/providers/regions',
        {
          params: {
            language: language ?? this.originalLanguage,
          },
        },
        86400 // 24 hours
      );

      return data.results;
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch available watch regions: ${e.message}`
      );
    }
  }

  public async getMovieWatchProviders({
    language,
    watchRegion,
  }: {
    language?: string;
    watchRegion: string;
  }) {
    try {
      const data = await this.get<{ results: TmdbWatchProviderDetails[] }>(
        '/watch/providers/movie',
        {
          params: {
            language: language ?? this.originalLanguage,
            watch_region: watchRegion,
          },
        },
        86400 // 24 hours
      );

      return data.results;
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch movie watch providers: ${e.message}`
      );
    }
  }

  public async getTvWatchProviders({
    language,
    watchRegion,
  }: {
    language?: string;
    watchRegion: string;
  }) {
    try {
      const data = await this.get<{ results: TmdbWatchProviderDetails[] }>(
        '/watch/providers/tv',
        {
          params: {
            language: language ?? this.originalLanguage,
            watch_region: watchRegion,
          },
        },
        86400 // 24 hours
      );

      return data.results;
    } catch (e) {
      throw new Error(
        `[TMDB] Failed to fetch TV watch providers: ${e.message}`
      );
    }
  }
}

export default TheMovieDb;
