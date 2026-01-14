import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';

interface RTAlgoliaSearchResponse {
  results: {
    hits: RTAlgoliaHit[];
    index: 'content_rt' | 'people_rt';
  }[];
}

interface RTAlgoliaHit {
  emsId: string;
  emsVersionId: string;
  tmsId: string;
  type: string;
  title: string;
  titles: string[];
  description: string;
  releaseYear: number;
  rating: string;
  genres: string[];
  updateDate: string;
  isEmsSearchable: boolean;
  rtId: number;
  vanity: string;
  aka: string[];
  posterImageUrl: string;
  rottenTomatoes?: {
    audienceScore: number;
    criticsIconUrl: string;
    wantToSeeCount: number;
    audienceIconUrl: string;
    scoreSentiment: string;
    certifiedFresh: boolean;
    criticsScore: number;
  };
}

export interface RTRating {
  title: string;
  year: number;
  criticsRating: 'Certified Fresh' | 'Fresh' | 'Rotten';
  criticsScore: number;
  audienceRating?: 'Upright' | 'Spilled';
  audienceScore?: number;
  url: string;
}

/**
 * This is a best-effort API. The Rotten Tomatoes API is technically
 * private and getting access costs money/requires approval.
 *
 * They do, however, have a "public" api that they use to request the
 * data on their own site. We use this to get ratings for movies/tv shows.
 *
 * Unfortunately, we need to do it by searching for the movie name, so it's
 * not always accurate.
 */
class RottenTomatoes extends ExternalAPI {
  constructor() {
    const settings = getSettings();
    super(
      'https://79frdp12pn-dsn.algolia.net/1/indexes/*',
      {
        'x-algolia-agent':
          'Algolia%20for%20JavaScript%20(4.14.3)%3B%20Browser%20(lite)',
        'x-algolia-api-key': '175588f6e5f8319b27702e4cc4013561',
        'x-algolia-application-id': '79FRDP12PN',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-algolia-usertoken': settings.clientId,
        },
        nodeCache: cacheManager.getCache('rt').data,
      }
    );
  }

  /**
   * Convert Roman numerals to Arabic numerals in a string
   */
  private convertRomanToArabic(str: string): string {
    const romanMap: Record<string, number> = {
      I: 1,
      II: 2,
      III: 3,
      IV: 4,
      V: 5,
      VI: 6,
      VII: 7,
      VIII: 8,
      IX: 9,
      X: 10,
      XI: 11,
      XII: 12,
      XIII: 13,
      XIV: 14,
      XV: 15,
      XVI: 16,
      XVII: 17,
      XVIII: 18,
      XIX: 19,
      XX: 20,
    };

    let result = str;
    // Match Roman numerals with word boundaries
    const romanRegex = /\b(X{0,2})(IX|IV|V?I{0,3})\b/gi;

    result = result.replace(romanRegex, (match) => {
      const upper = match.toUpperCase();
      return romanMap[upper] !== undefined ? romanMap[upper].toString() : match;
    });

    return result;
  }

  /**
   * Convert Arabic numerals to Roman numerals in a string
   */
  private convertArabicToRoman(str: string): string {
    const arabicMap: [number, string][] = [
      [20, 'XX'],
      [19, 'XIX'],
      [18, 'XVIII'],
      [17, 'XVII'],
      [16, 'XVI'],
      [15, 'XV'],
      [14, 'XIV'],
      [13, 'XIII'],
      [12, 'XII'],
      [11, 'XI'],
      [10, 'X'],
      [9, 'IX'],
      [8, 'VIII'],
      [7, 'VII'],
      [6, 'VI'],
      [5, 'V'],
      [4, 'IV'],
      [3, 'III'],
      [2, 'II'],
      [1, 'I'],
    ];

    let result = str;
    // Match 1-20 as standalone numbers or at end of string
    result = result.replace(/\b([1-9]|1[0-9]|20)\b/g, (match) => {
      const num = parseInt(match);
      const found = arabicMap.find(([n]) => n === num);
      return found ? found[1] : match;
    });

    return result;
  }

  /**
   * Search the RT algolia api for the movie title
   *
   * We compare the release date to make sure its the correct
   * match. But it's not guaranteed to have results.
   *
   * @param name Movie name
   * @param year Release Year
   */
  public async getMovieRatings(
    name: string,
    year: number
  ): Promise<RTRating | null> {
    try {
      const data = await this.post<RTAlgoliaSearchResponse>('/queries', {
        requests: [
          {
            indexName: 'content_rt',
            query: name,
            params: 'filters=isEmsSearchable%20%3D%201&hitsPerPage=20',
          },
        ],
      });

      const contentResults = data.results.find((r) => r.index === 'content_rt');

      if (!contentResults) {
        return null;
      }

      const nameLower = name.toLowerCase();

      // 1. Exact case-insensitive title + exact year (highest confidence)
      let movie = contentResults.hits.find(
        (movie) =>
          movie.releaseYear === year && movie.title.toLowerCase() === nameLower
      );

      // 2. Exact case-insensitive title + ±1 year (handles RT data discrepancies)
      if (!movie) {
        movie = contentResults.hits.find(
          (movie) =>
            Math.abs(movie.releaseYear - year) <= 1 &&
            movie.title.toLowerCase() === nameLower
        );
      }

      // 3. Partial case-insensitive title + exact year
      if (!movie) {
        movie = contentResults.hits.find(
          (movie) =>
            movie.releaseYear === year &&
            movie.title.toLowerCase().includes(nameLower)
        );
      }

      // 4. Partial case-insensitive title + ±1 year
      if (!movie) {
        movie = contentResults.hits.find(
          (movie) =>
            Math.abs(movie.releaseYear - year) <= 1 &&
            movie.title.toLowerCase().includes(nameLower)
        );
      }

      // 5. Exact case-insensitive title only (no year constraint)
      if (!movie) {
        movie = contentResults.hits.find(
          (movie) => movie.title.toLowerCase() === nameLower
        );
      }

      // 6. Try Roman numeral conversion in both directions
      if (!movie) {
        const nameWithArabic = this.convertRomanToArabic(nameLower);
        const nameWithRoman = this.convertArabicToRoman(nameLower);

        movie = contentResults.hits.find((movie) => {
          const titleLower = movie.title.toLowerCase();
          const titleWithArabic = this.convertRomanToArabic(titleLower);
          const titleWithRoman = this.convertArabicToRoman(titleLower);

          return (
            Math.abs(movie.releaseYear - year) <= 1 &&
            (titleWithArabic === nameWithArabic ||
              titleWithRoman === nameWithRoman ||
              titleLower === nameWithArabic ||
              titleLower === nameWithRoman)
          );
        });
      }

      if (!movie) {
        return null;
      }

      // Check if RT ratings data exists
      if (!movie.rottenTomatoes) {
        return null;
      }

      return {
        title: movie.title,
        url: `https://www.rottentomatoes.com/m/${movie.vanity}`,
        criticsRating: movie.rottenTomatoes.certifiedFresh
          ? 'Certified Fresh'
          : movie.rottenTomatoes.criticsScore >= 60
          ? 'Fresh'
          : 'Rotten',
        criticsScore: movie.rottenTomatoes.criticsScore,
        audienceRating:
          movie.rottenTomatoes.audienceScore >= 60 ? 'Upright' : 'Spilled',
        audienceScore: movie.rottenTomatoes.audienceScore,
        year: Number(movie.releaseYear),
      };
    } catch (e) {
      throw new Error(
        `[RT API] Failed to retrieve movie ratings: ${e.message}`
      );
    }
  }

  public async getTVRatings(
    name: string,
    year?: number
  ): Promise<RTRating | null> {
    try {
      const data = await this.post<RTAlgoliaSearchResponse>('/queries', {
        requests: [
          {
            indexName: 'content_rt',
            query: name,
            params: 'filters=isEmsSearchable%20%3D%201&hitsPerPage=20',
          },
        ],
      });

      const contentResults = data.results.find((r) => r.index === 'content_rt');

      if (!contentResults) {
        return null;
      }

      const nameLower = name.toLowerCase();
      let tvshow: RTAlgoliaHit | undefined;

      if (year) {
        // 1. Exact case-insensitive title + exact year (highest confidence)
        tvshow = contentResults.hits.find(
          (series) =>
            series.releaseYear === year &&
            series.title.toLowerCase() === nameLower
        );

        // 2. Exact case-insensitive title + ±1 year (handles RT data discrepancies)
        if (!tvshow) {
          tvshow = contentResults.hits.find(
            (series) =>
              Math.abs(series.releaseYear - year) <= 1 &&
              series.title.toLowerCase() === nameLower
          );
        }

        // 3. Partial case-insensitive title + exact year
        if (!tvshow) {
          tvshow = contentResults.hits.find(
            (series) =>
              series.releaseYear === year &&
              series.title.toLowerCase().includes(nameLower)
          );
        }

        // 4. Partial case-insensitive title + ±1 year
        if (!tvshow) {
          tvshow = contentResults.hits.find(
            (series) =>
              Math.abs(series.releaseYear - year) <= 1 &&
              series.title.toLowerCase().includes(nameLower)
          );
        }

        // 5. Exact case-insensitive title only (no year constraint)
        if (!tvshow) {
          tvshow = contentResults.hits.find(
            (series) => series.title.toLowerCase() === nameLower
          );
        }

        // 6. Try Roman numeral conversion in both directions
        if (!tvshow) {
          const nameWithArabic = this.convertRomanToArabic(nameLower);
          const nameWithRoman = this.convertArabicToRoman(nameLower);

          tvshow = contentResults.hits.find((series) => {
            const titleLower = series.title.toLowerCase();
            const titleWithArabic = this.convertRomanToArabic(titleLower);
            const titleWithRoman = this.convertArabicToRoman(titleLower);

            return (
              Math.abs(series.releaseYear - year) <= 1 &&
              (titleWithArabic === nameWithArabic ||
                titleWithRoman === nameWithRoman ||
                titleLower === nameWithArabic ||
                titleLower === nameWithRoman)
            );
          });
        }
      } else {
        // If no year provided, use exact case-insensitive title match
        tvshow = contentResults.hits.find(
          (series) => series.title.toLowerCase() === nameLower
        );

        // Try Roman numeral conversion if no exact match
        if (!tvshow) {
          const nameWithArabic = this.convertRomanToArabic(nameLower);
          const nameWithRoman = this.convertArabicToRoman(nameLower);

          tvshow = contentResults.hits.find((series) => {
            const titleLower = series.title.toLowerCase();
            const titleWithArabic = this.convertRomanToArabic(titleLower);
            const titleWithRoman = this.convertArabicToRoman(titleLower);

            return (
              titleWithArabic === nameWithArabic ||
              titleWithRoman === nameWithRoman ||
              titleLower === nameWithArabic ||
              titleLower === nameWithRoman
            );
          });
        }
      }

      if (!tvshow) {
        return null;
      }

      // Check if RT ratings data exists
      if (!tvshow.rottenTomatoes) {
        return null;
      }

      return {
        title: tvshow.title,
        url: `https://www.rottentomatoes.com/tv/${tvshow.vanity}`,
        criticsRating:
          tvshow.rottenTomatoes.criticsScore >= 60 ? 'Fresh' : 'Rotten',
        criticsScore: tvshow.rottenTomatoes.criticsScore,
        audienceRating:
          tvshow.rottenTomatoes.audienceScore >= 60 ? 'Upright' : 'Spilled',
        audienceScore: tvshow.rottenTomatoes.audienceScore,
        year: Number(tvshow.releaseYear),
      };
    } catch (e) {
      throw new Error(`[RT API] Failed to retrieve tv ratings: ${e.message}`);
    }
  }
}

export default RottenTomatoes;
