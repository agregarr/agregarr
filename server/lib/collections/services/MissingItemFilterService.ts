import ImdbRatingsAPI from '@server/api/imdbRatings';
import TheMovieDb from '@server/api/themoviedb';
import type { MissingItem } from '@server/lib/collections/core/types';
import type { CollectionConfig } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Results from filtering missing items
 */
export interface FilteredMissingItemsResult {
  /** Items that passed all filters */
  filteredItems: MissingItem[];
  /** IMDb ratings map for filtered items (tmdbId -> rating) */
  imdbRatingsMap: Map<number, number | null>;
  /** Items filtered by year */
  yearFilteredItems: string[];
  /** Items filtered by low IMDb rating */
  lowRatedItems: string[];
  /** Items filtered by excluded genres */
  excludedGenreItems: string[];
  /** Items filtered by excluded countries */
  excludedCountryItems: string[];
}

/**
 * Shared filtering service for missing items
 *
 * Provides common filtering logic for both auto-request and direct download services
 */
export class MissingItemFilterService {
  private tmdbAPI: TheMovieDb;
  private imdbRatingsAPI: ImdbRatingsAPI;

  constructor() {
    this.tmdbAPI = new TheMovieDb();
    this.imdbRatingsAPI = new ImdbRatingsAPI();
  }

  /**
   * Filter missing items based on collection configuration
   *
   * @param missingItems - Items to filter
   * @param config - Collection configuration with filter settings
   * @param serviceLabel - Label for logging (e.g., 'Auto Request Service', 'Direct Download Service')
   * @returns Filtered items with tracking arrays for logging
   */
  public async filterMissingItems(
    missingItems: MissingItem[],
    config: CollectionConfig,
    serviceLabel: string
  ): Promise<FilteredMissingItemsResult> {
    // Track filtered items for summary logging
    const yearFilteredItems: string[] = [];
    const lowRatedItems: string[] = [];
    const excludedGenreItems: string[] = [];
    const excludedCountryItems: string[] = [];

    // Step 1: Filter by media type and minimum year
    const yearFilteredMissingItems = missingItems.filter((item) => {
      // Check media type
      if (item.mediaType === 'movie' && !config.searchMissingMovies)
        return false;
      if (item.mediaType === 'tv' && !config.searchMissingTV) return false;
      if (item.mediaType !== 'movie' && item.mediaType !== 'tv') return false;

      // Check minimum year filter
      if (config.minimumYear && config.minimumYear > 0) {
        if (!item.year) {
          logger.debug(
            `Item "${item.title}" has no year data, allowing through year filter`,
            {
              label: serviceLabel,
              collection: config.name,
              tmdbId: item.tmdbId,
            }
          );
        } else if (item.year < config.minimumYear) {
          yearFilteredItems.push(
            `${item.title} (${item.year}) - below minimum ${config.minimumYear}`
          );
          return false;
        }
      }

      return true;
    });

    // Log year filtering summary
    if (yearFilteredItems.length > 0) {
      logger.info(
        `Filtered ${yearFilteredItems.length} items due to minimum year (${config.minimumYear})`,
        {
          label: serviceLabel,
          collection: config.name,
          minimumYear: config.minimumYear,
          filteredCount: yearFilteredItems.length,
          examples: yearFilteredItems.slice(0, 5),
          ...(yearFilteredItems.length > 5 && {
            additionalCount: yearFilteredItems.length - 5,
          }),
        }
      );
    }

    // Step 2: Bulk fetch IMDb ratings if filter is enabled
    const imdbRatingsMap = new Map<number, number | null>(); // tmdbId -> rating
    if (config.minimumImdbRating && config.minimumImdbRating > 0) {
      await this.bulkFetchImdbRatings(
        yearFilteredMissingItems,
        imdbRatingsMap,
        config,
        serviceLabel
      );
    }

    // Step 3: Apply all filters (IMDb rating, genres, countries)
    const fullyFilteredItems: MissingItem[] = [];

    for (const item of yearFilteredMissingItems) {
      // Check IMDb rating filter using cached ratings
      if (config.minimumImdbRating && config.minimumImdbRating > 0) {
        if (imdbRatingsMap.has(item.tmdbId)) {
          const rating = imdbRatingsMap.get(item.tmdbId);

          // If rating is null or undefined (no rating found), allow the item
          if (rating === null || rating === undefined) {
            logger.debug(
              `No IMDb rating found for ${item.title}, allowing item`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
              }
            );
          } else if (rating < config.minimumImdbRating) {
            // Rating exists but below threshold
            logger.debug(
              `${item.title} rating ${rating} below minimum ${config.minimumImdbRating}`,
              {
                label: serviceLabel,
                tmdbId: item.tmdbId,
                title: item.title,
                rating,
                minimumRating: config.minimumImdbRating,
              }
            );
            lowRatedItems.push(item.title);
            continue;
          }
          // else: rating >= minimum, allow the item (continue processing)
        }
        // If not in map (no IMDb ID found), allow the item (continue processing)
      }

      // Check excluded genres
      if (config.excludedGenres && config.excludedGenres.length > 0) {
        const hasExcluded = await this.hasExcludedGenres(
          item.tmdbId,
          item.mediaType,
          config.excludedGenres
        );
        if (hasExcluded) {
          excludedGenreItems.push(item.title);
          continue;
        }
      }

      // Check excluded countries
      if (config.excludedCountries && config.excludedCountries.length > 0) {
        const hasExcluded = await this.hasExcludedCountries(
          item.tmdbId,
          item.mediaType,
          config.excludedCountries
        );
        if (hasExcluded) {
          excludedCountryItems.push(item.title);
          continue;
        }
      }

      // Item passed all filters
      fullyFilteredItems.push(item);
    }

    return {
      filteredItems: fullyFilteredItems,
      imdbRatingsMap,
      yearFilteredItems,
      lowRatedItems,
      excludedGenreItems,
      excludedCountryItems,
    };
  }

  /**
   * Bulk fetch IMDb ratings for missing items
   */
  private async bulkFetchImdbRatings(
    items: MissingItem[],
    ratingsMap: Map<number, number | null>,
    config: CollectionConfig,
    serviceLabel: string
  ): Promise<void> {
    try {
      // First, fetch all IMDb IDs from TMDB
      const tmdbToImdbMap = new Map<number, string>(); // tmdbId -> imdbId

      await Promise.all(
        items.map(async (item) => {
          try {
            let imdbId: string | undefined;
            if (item.mediaType === 'movie') {
              const movie = await this.tmdbAPI.getMovie({
                movieId: item.tmdbId,
              });
              imdbId = movie.imdb_id;
            } else if (item.mediaType === 'tv') {
              const tvShow = await this.tmdbAPI.getTvShow({
                tvId: item.tmdbId,
              });
              imdbId = tvShow.external_ids?.imdb_id;
            }

            if (imdbId) {
              tmdbToImdbMap.set(item.tmdbId, imdbId);
            }
          } catch (error) {
            logger.debug(
              `Failed to get IMDb ID for TMDB ${item.tmdbId}, will allow item`,
              {
                label: serviceLabel,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
          }
        })
      );

      // Bulk fetch all IMDb ratings
      if (tmdbToImdbMap.size > 0) {
        const imdbIds = Array.from(tmdbToImdbMap.values());
        logger.debug(`Bulk fetching ${imdbIds.length} IMDb ratings`, {
          label: serviceLabel,
          collection: config.name,
          count: imdbIds.length,
        });

        const ratings = await this.imdbRatingsAPI.getRatings(imdbIds);

        // Map ratings back to TMDB IDs
        const imdbToRating = new Map<string, number | null>();
        ratings.forEach((r) => {
          imdbToRating.set(r.imdbId, r.rating);
        });

        // Create final TMDB ID -> rating map
        tmdbToImdbMap.forEach((imdbId, tmdbId) => {
          const rating = imdbToRating.get(imdbId) ?? null;
          ratingsMap.set(tmdbId, rating);
        });

        logger.debug(`Cached ${ratingsMap.size} IMDb ratings for filtering`, {
          label: serviceLabel,
          collection: config.name,
          cachedCount: ratingsMap.size,
        });
      }
    } catch (error) {
      logger.warn(
        `Failed to bulk fetch IMDb ratings, will skip rating filter`,
        {
          label: serviceLabel,
          collection: config.name,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
    }
  }

  /**
   * Check if an item has any excluded genres
   */
  private async hasExcludedGenres(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    excludedGenres: number[]
  ): Promise<boolean> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        return movie.genres.some((genre) => excludedGenres.includes(genre.id));
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        return tvShow.genres.some((genre) => excludedGenres.includes(genre.id));
      }
    } catch (error) {
      logger.warn(
        `Failed to check genres for TMDB ID ${tmdbId}, allowing item`,
        {
          label: 'Missing Item Filter Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false; // If we can't check genres, don't exclude the item
    }
  }

  /**
   * Check if an item has any excluded origin countries
   */
  private async hasExcludedCountries(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    excludedCountries: string[]
  ): Promise<boolean> {
    try {
      if (mediaType === 'movie') {
        const movie = await this.tmdbAPI.getMovie({ movieId: tmdbId });
        // Movies use production_countries array
        if (movie.production_countries) {
          return movie.production_countries.some((country) =>
            excludedCountries.includes(country.iso_3166_1)
          );
        }
        return false;
      } else {
        const tvShow = await this.tmdbAPI.getTvShow({ tvId: tmdbId });
        // TV shows use origin_country array
        if (tvShow.origin_country) {
          return tvShow.origin_country.some((country) =>
            excludedCountries.includes(country)
          );
        }
        return false;
      }
    } catch (error) {
      logger.warn(
        `Failed to check origin countries for TMDB ID ${tmdbId}, allowing item`,
        {
          label: 'Missing Item Filter Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false; // If we can't check countries, don't exclude the item
    }
  }

  /**
   * Get the number of seasons for a TV show
   */
  public async getTvSeasonCount(tmdbId: number): Promise<number> {
    try {
      const tmdb = new (await import('@server/api/themoviedb')).default();
      const tvShow = await tmdb.getTvShow({ tvId: tmdbId });
      // Filter out season 0 (specials) when counting
      return (
        tvShow.seasons?.filter((season) => season.season_number > 0).length || 1
      );
    } catch (error) {
      logger.warn(
        `Failed to get season count for TMDB ID ${tmdbId}, assuming 1 season`,
        {
          label: 'Missing Item Filter Service',
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return 1; // Default to 1 season if we can't determine
    }
  }

  /**
   * Log filtering summary for excluded items
   */
  public logFilteringSummary(
    result: FilteredMissingItemsResult,
    config: CollectionConfig,
    source: string
  ): void {
    const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);

    // Log summary of items excluded by genre
    if (result.excludedGenreItems.length > 0) {
      logger.info(`Items skipped due to excluded genres`, {
        label: `${sourceLabel} Collections`,
        collection: config.name,
        count: result.excludedGenreItems.length,
        titles: result.excludedGenreItems.slice(0, 10),
        ...(result.excludedGenreItems.length > 10 && {
          additionalCount: result.excludedGenreItems.length - 10,
        }),
      });
    }

    // Log summary of items excluded by country
    if (result.excludedCountryItems.length > 0) {
      logger.info(`Items skipped due to excluded countries`, {
        label: `${sourceLabel} Collections`,
        collection: config.name,
        count: result.excludedCountryItems.length,
        titles: result.excludedCountryItems.slice(0, 10),
        ...(result.excludedCountryItems.length > 10 && {
          additionalCount: result.excludedCountryItems.length - 10,
        }),
      });
    }

    // Log summary of items excluded by IMDb rating
    if (result.lowRatedItems.length > 0) {
      logger.info(
        `Items skipped due to IMDb rating below ${config.minimumImdbRating}`,
        {
          label: `${sourceLabel} Collections`,
          collection: config.name,
          minimumRating: config.minimumImdbRating,
          count: result.lowRatedItems.length,
          titles: result.lowRatedItems.slice(0, 10),
          ...(result.lowRatedItems.length > 10 && {
            additionalCount: result.lowRatedItems.length - 10,
          }),
        }
      );
    }
  }
}

// Export singleton instance
export const missingItemFilterService = new MissingItemFilterService();
