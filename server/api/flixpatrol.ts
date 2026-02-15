import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import { JSDOM } from 'jsdom';

/**
 * FlixPatrol List Item interface
 */
export interface FlixPatrolListItem {
  rank: number;
  title: string;
  points?: string;
  flixpatrolUrl?: string;
  type: 'movie' | 'tv';
}

/**
 * FlixPatrol Platform Response interface
 */
export interface FlixPatrolPlatformData {
  platform: string;
  region: string;
  date: string;
  tvShows: FlixPatrolListItem[];
  movies: FlixPatrolListItem[];
  platformLogo?: {
    spriteUrl: string;
    position: string;
  };
}

/**
 * Platform option for frontend dropdowns
 */
export interface FlixPatrolPlatformOption {
  value: string;
  label: string;
}

/**
 * FlixPatrol Platforms enum for supported streaming services
 */
export enum FlixPatrolPlatform {
  NETFLIX = 'netflix',
  HBO = 'hbo',
  DISNEY = 'disney',
  AMAZON_PRIME = 'amazon-prime',
  APPLE_TV = 'apple-tv',
  PARAMOUNT = 'paramount',
  PEACOCK = 'peacock',
  CRUNCHYROLL = 'crunchyroll',
  DISCOVERY_PLUS = 'discovery-plus',
  HULU = 'hulu',
}

/**
 * FlixPatrol API client for fetching streaming top 10 lists
 *
 * Note: FlixPatrol doesn't have a public API for top 10 data, so this uses web scraping
 * for their publicly available top 10 charts. This is a best-effort implementation.
 */
class FlixPatrolAPI extends ExternalAPI {
  constructor() {
    super(
      'https://flixpatrol.com',
      {}, // URL params
      {
        headers: {
          // Override the default JSON headers that trigger bot detection
          'Content-Type': undefined, // Remove the application/json content-type
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Sec-Ch-Ua':
            '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        nodeCache: cacheManager.getCache('flixpatrol').data,
      }
    );
  }

  /**
   * Get top 10 lists for a specific platform
   */
  public async getPlatformTop10(
    platform: string,
    region = 'global',
    requestedMediaType?: 'movie' | 'tv' | 'both'
  ): Promise<FlixPatrolPlatformData> {
    try {
      // Parse platform to extract base platform and requested section filter
      // Format: "netflix-kids_top_10" -> platform: "netflix", filter: "kids"
      //         "netflix_top_10" -> platform: "netflix", filter: undefined (all content)
      //         "hbo-max_top_10" -> platform: "hbo-max", filter: undefined (hbo-max is the platform name)
      //         "apple-tv_top_10" -> platform: "apple-tv", filter: undefined (apple-tv is the platform name)

      // List of platforms that have dashes in their names (not filters)
      const multiPartPlatforms = [
        'hbo-max',
        'apple-tv',
        'amazon-prime',
        'apple-tv-store',
        'google-tv',
      ];

      let basePlatform = platform;
      let contentFilter: 'kids' | undefined;

      // Check if this is a multi-part platform name
      const isMultiPartPlatform = multiPartPlatforms.some((p) =>
        platform.startsWith(p)
      );

      if (isMultiPartPlatform) {
        // For multi-part platforms, extract the full platform name
        const matchedPlatform = multiPartPlatforms.find((p) =>
          platform.startsWith(p)
        );
        if (matchedPlatform) {
          basePlatform = matchedPlatform;
        }
      } else {
        // For single-part platforms, check for content filters
        const platformMatch = platform.match(/^([^-]+)(?:-(.+?))?_top_10$/);
        if (platformMatch) {
          basePlatform = platformMatch[1];
          if (platformMatch[2] === 'kids') {
            contentFilter = 'kids';
          }
        }
      }

      logger.debug(`Parsed platform request`, {
        label: 'FlixPatrol API',
        original: platform,
        basePlatform,
        contentFilter,
      });

      // Try today's date first, then yesterday if needed
      const dates = this.getDatesToTry(region);

      for (const dateInfo of dates) {
        try {
          // Construct URL based on region
          let url: string;
          if (region === 'global') {
            url = '/top10';
          } else {
            url = `/top10/streaming/${region}/${dateInfo.date}/`;
          }

          // This ensures movie/tv/both requests are cached separately
          if (requestedMediaType) {
            url += `#${requestedMediaType}`;
          }

          logger.debug(
            `Fetching FlixPatrol streaming overview for platform: ${platform}`,
            {
              label: 'FlixPatrol API',
              platform,
              region,
              url,
              attemptedDate: dateInfo.date,
              isRetry: dateInfo.isYesterday,
            }
          );

          // Bypass ExternalAPI and use direct axios request to avoid bot detection
          const response = await this.axios.get(url, {
            headers: {
              // Completely override all headers to look like a real browser
              'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
              'Sec-Ch-Ua':
                '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"macOS"',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
              'Sec-Fetch-User': '?1',
              'Upgrade-Insecure-Requests': '1',
            },
            timeout: 30000,
          });

          const result = await this.parseStreamingOverviewHtml(
            response.data,
            basePlatform,
            region,
            requestedMediaType,
            contentFilter
          );

          // Check if we got any data
          const hasData = result.movies.length > 0 || result.tvShows.length > 0;

          if (!hasData && dateInfo.isYesterday === false) {
            // Today's data is empty, try yesterday
            logger.warn(
              `No data found for today (${dateInfo.date}), trying yesterday`,
              {
                label: 'FlixPatrol API',
                platform,
                region,
              }
            );
            continue;
          }

          if (dateInfo.isYesterday) {
            logger.info(
              `Successfully fetched data using yesterday's date (${dateInfo.date})`,
              {
                label: 'FlixPatrol API',
                platform,
                region,
                movies: result.movies.length,
                tvShows: result.tvShows.length,
              }
            );
          }

          return result;
        } catch (error) {
          // If this is today's attempt and we have yesterday to try, continue to next date
          if (dateInfo.isYesterday === false && dates.length > 1) {
            logger.warn(
              `Failed to fetch data for today (${dateInfo.date}), trying yesterday`,
              {
                label: 'FlixPatrol API',
                platform,
                region,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
            continue;
          }

          // If this is yesterday's attempt or we only had one date, throw the error
          throw error;
        }
      }

      // If we get here, all attempts failed
      throw new Error('Failed to fetch data for both today and yesterday');
    } catch (error) {
      logger.error(
        `Failed to fetch FlixPatrol streaming overview for ${platform}:`,
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          platform,
          region,
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw new Error(
        `Failed to fetch FlixPatrol streaming overview: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get dates to try (today and yesterday) for FlixPatrol data fetching
   */
  private getDatesToTry(
    region: string
  ): { date: string; isYesterday: boolean }[] {
    // For global region, we don't use dates in the URL
    if (region === 'global') {
      return [{ date: '', isYesterday: false }];
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    return [
      {
        date: today.toISOString().split('T')[0], // YYYY-MM-DD format
        isYesterday: false,
      },
      {
        date: yesterday.toISOString().split('T')[0], // YYYY-MM-DD format
        isYesterday: true,
      },
    ];
  }

  /**
   * Get available platforms that have data (static global list)
   */
  public async getAvailablePlatforms(): Promise<string[]> {
    // These are the platforms we know work from our testing
    return [
      FlixPatrolPlatform.NETFLIX,
      FlixPatrolPlatform.HBO,
      FlixPatrolPlatform.DISNEY,
      FlixPatrolPlatform.AMAZON_PRIME,
      FlixPatrolPlatform.APPLE_TV,
      FlixPatrolPlatform.PARAMOUNT,
      FlixPatrolPlatform.PEACOCK,
      FlixPatrolPlatform.CRUNCHYROLL,
      FlixPatrolPlatform.DISCOVERY_PLUS,
      FlixPatrolPlatform.HULU,
    ];
  }

  /**
   * Get available countries by scraping FlixPatrol main page
   * Cached for 24 hours
   */
  public async getAvailableCountries(): Promise<string[]> {
    const cacheKey = 'flixpatrol:countries:v5'; // v5 to bust cache with direct axios

    // Check cache first
    const cached = this.cache?.get<string[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached countries list', {
        label: 'FlixPatrol API',
        count: cached.length,
      });
      return cached;
    }

    try {
      logger.debug('Scraping countries list from FlixPatrol', {
        label: 'FlixPatrol API',
      });

      // Bypass ExternalAPI and use direct axios request to avoid bot detection
      const response = await this.axios.get('/top10/streaming/', {
        headers: {
          // Completely override all headers to look like a real browser
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Sec-Ch-Ua':
            '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 30000,
      });
      const html = response.data;
      const countries = this.parseCountriesFromHtml(html);

      // Cache for 24 hours
      this.cache?.set(cacheKey, countries, 86400);

      logger.info(`Scraped ${countries.length} countries from FlixPatrol`, {
        label: 'FlixPatrol API',
        count: countries.length,
        sample: countries.slice(0, 5),
      });

      return countries;
    } catch (error) {
      logger.error('Failed to scrape countries from FlixPatrol:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // No fallback - propagate the error
      throw error;
    }
  }

  /**
   * Get available platforms for a specific country (on-demand caching)
   * Cached for 24 hours per country
   */
  public async getAvailablePlatformsForCountry(
    country: string
  ): Promise<FlixPatrolPlatformOption[]> {
    // For global, return our static list
    if (country === 'global') {
      return this.getGlobalPlatformOptions();
    }

    const cacheKey = `flixpatrol:platforms:${country}`;

    // Check cache first
    const cached = this.cache?.get<FlixPatrolPlatformOption[]>(cacheKey);
    if (cached) {
      logger.debug(`Returning cached platforms for ${country}`, {
        label: 'FlixPatrol API',
        country,
        count: cached.length,
      });
      return cached;
    }

    try {
      logger.debug(`Scraping platforms for ${country} from FlixPatrol`, {
        label: 'FlixPatrol API',
        country,
      });

      const url = `/top10/streaming/${country}/`;

      // Bypass ExternalAPI and use direct axios request to avoid bot detection
      const response = await this.axios.get(url, {
        headers: {
          // Completely override all headers to look like a real browser
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'Sec-Ch-Ua':
            '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 30000,
      });
      const html = response.data;

      const platforms = this.parsePlatformsFromHtml(html, country);

      // Cache for 24 hours
      this.cache?.set(cacheKey, platforms, 86400);

      logger.info(`Scraped ${platforms.length} platforms for ${country}`, {
        label: 'FlixPatrol API',
        country,
        count: platforms.length,
        sample: platforms.slice(0, 5).map((p) => p.label),
      });

      return platforms;
    } catch (error) {
      logger.error(`Failed to scrape platforms for ${country}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        country,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new Error(`Failed to load platforms for ${country}`);
    }
  }

  /**
   * Parse streaming overview HTML to extract specific platform section
   */
  private async parseStreamingOverviewHtml(
    html: string,
    platform: string,
    region: string,
    requestedMediaType?: 'movie' | 'tv' | 'both',
    contentFilter?: 'kids'
  ): Promise<FlixPatrolPlatformData> {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Extract date from page title
    const pageTitle = document.querySelector('title')?.textContent || '';
    const date = this.extractDateFromTitle(pageTitle);

    const result: FlixPatrolPlatformData = {
      platform: this.formatDynamicPlatformName(platform),
      region: region.charAt(0).toUpperCase() + region.slice(1),
      date: date || 'Unknown',
      tvShows: [],
      movies: [],
    };

    // Find the platform section header (H2)
    const platformName = this.extractPlatformNameFromSubtype(platform);
    const headings = document.querySelectorAll('h2');

    let platformSection = null;
    for (const heading of headings) {
      const headingText = heading.textContent || '';

      // Handle both formats:
      // Country-specific: "PLATFORM TOP 10" (e.g., "NETFLIX TOP 10")
      // Global: "TOP Movies on PLATFORM" (e.g., "TOP Movies on Netflix")
      let actualPlatformName = null;

      if (headingText.toLowerCase().includes('top 10')) {
        // Country-specific format: "PLATFORM TOP 10"
        const match = headingText.match(/^(.+?)\s+TOP 10/i);
        if (match) {
          actualPlatformName = match[1].trim();
        }
      } else if (
        headingText.toLowerCase().includes('top movies on') ||
        headingText.toLowerCase().includes('top tv shows on')
      ) {
        // Global format: Check if heading contains any of our mapped platform names
        const possibleNames = this.mapPlatformIdToFlixPatrolName(platformName);

        // Instead of parsing, just check if the heading contains our platform names
        for (const possibleName of possibleNames) {
          if (headingText.toLowerCase().includes(possibleName.toLowerCase())) {
            actualPlatformName = possibleName; // Use the mapped name directly
            break;
          }
        }
      }

      if (actualPlatformName) {
        const normalizedActual = actualPlatformName
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/\+/g, '')
          .replace(/&/g, 'and')
          .replace(/[^a-z0-9-]/g, '');

        let isMatch = false;

        // For country-specific pages (with "TOP 10"), use the original logic
        if (headingText.toLowerCase().includes('top 10')) {
          const normalizedPlatform = platformName
            .toLowerCase()
            .replace(/_/g, '-'); // Keep the original underscore-to-dash conversion
          isMatch = normalizedActual === normalizedPlatform;
        } else {
          // For global pages, use the new mapping logic
          const possibleNames =
            this.mapPlatformIdToFlixPatrolName(platformName);
          isMatch = possibleNames.some((name) => {
            const normalizedName = name
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/\+/g, '')
              .replace(/&/g, 'and')
              .replace(/[^a-z0-9-]/g, '');
            return normalizedActual === normalizedName;
          });
        }

        // Compare normalized platform names and media type
        if (isMatch) {
          // For global pages, also check if this section matches the requested media type
          if (!headingText.toLowerCase().includes('top 10')) {
            // Global page - check media type match
            const isMovieSection = headingText
              .toLowerCase()
              .includes('top movies on');
            const isTvSection = headingText
              .toLowerCase()
              .includes('top tv shows on');

            // Only use this section if it matches the requested media type
            if (requestedMediaType === 'movie' && !isMovieSection) {
              continue; // Skip this section, look for movies section
            }
            if (requestedMediaType === 'tv' && !isTvSection) {
              continue; // Skip this section, look for TV section
            }
            // For 'both' or unspecified, use any matching platform section
          }

          logger.debug(`Found platform section: ${headingText}`, {
            label: 'FlixPatrol API',
            platform,
            headingText,
            actualPlatformName,
            normalizedActual,
            platformName,
            requestedMediaType,
            format: headingText.toLowerCase().includes('top 10')
              ? 'country'
              : 'global',
            matchingMethod: headingText.toLowerCase().includes('top 10')
              ? 'original'
              : 'mapping',
          });
          platformSection = heading;
          break;
        }
      }
    }

    if (!platformSection) {
      logger.warn(`Platform section not found for ${platform}`, {
        label: 'FlixPatrol API',
        platform,
        platformName,
        region,
      });
      return result;
    }

    // For global pages, use the simpler card-table parsing
    if (region === 'global') {
      return this.parseGlobalPlatformData(platformSection, result, platform);
    }

    // Extract platform logo information from the platform section
    const platformLogo = await this.extractPlatformLogo(platformSection);
    if (platformLogo) {
      result.platformLogo = platformLogo;
      logger.debug(`Extracted platform logo for ${platform}`, {
        label: 'FlixPatrol API',
        platform,
        spriteUrl: platformLogo.spriteUrl,
        position: platformLogo.position,
      });
    }

    // Dynamically find and parse all content sections between platform headers
    let currentElement = platformSection.nextElementSibling;

    while (currentElement) {
      // Stop if we hit another H2 (next platform section)
      if (currentElement.tagName === 'H2') {
        break;
      }

      // Pattern 1: H3 subsection headers
      if (currentElement.tagName === 'H3') {
        const h3Text = currentElement.textContent?.toLowerCase() || '';
        const isKidsSection = h3Text.includes('kids');

        // Apply content filter if specified
        if (contentFilter === 'kids' && !isKidsSection) {
          // User wants kids only, skip non-kids sections
          logger.debug(`Skipping non-kids section "${h3Text}"`, {
            label: 'FlixPatrol API',
            platform,
            contentFilter,
          });
          currentElement = currentElement.nextElementSibling;
          continue;
        } else if (contentFilter === undefined && isKidsSection) {
          // User wants regular content only (no filter), skip kids sections
          logger.debug(`Skipping kids section "${h3Text}"`, {
            label: 'FlixPatrol API',
            platform,
          });
          currentElement = currentElement.nextElementSibling;
          continue;
        }

        // Find the table that follows this H3
        let tableElement = currentElement.nextElementSibling;
        let searchDepth = 0;

        while (tableElement && searchDepth < 5) {
          if (tableElement.tagName === 'TABLE') {
            const items = this.parseTopListTable(tableElement, 'movie');

            if (items.length > 0) {
              this.assignItemsToResultByContent(
                items,
                h3Text,
                result,
                requestedMediaType,
                platform,
                `H3 section "${h3Text}"`
              );
            }
            break;
          }

          // Stop if we hit another H3 or H2
          if (tableElement.tagName?.match(/^H[23]$/)) {
            break;
          }

          tableElement = tableElement.nextElementSibling;
          searchDepth++;
        }
      }

      // Pattern 2: DIV containing tables directly
      else if (currentElement.tagName === 'DIV') {
        const divText = currentElement.textContent?.toLowerCase() || '';

        // Check if this DIV contains top 10 content
        if (divText.includes('top 10')) {
          const tablesInDiv = currentElement.querySelectorAll('table');

          // Look for section indicators within the DIV to identify individual table types
          const sections = this.identifyTableSections(
            divText,
            tablesInDiv.length
          );

          // Collect overall content as fallback
          let overallItems: FlixPatrolListItem[] = [];

          tablesInDiv.forEach((table, tableIndex) => {
            const items = this.parseTopListTable(table, 'movie');

            if (items.length > 0) {
              const sectionType = sections[tableIndex] || 'unknown';
              const sectionLower = sectionType.toLowerCase();
              const isKidsSection = sectionLower.includes('kids');

              // Apply content filter if specified
              if (contentFilter === 'kids' && !isKidsSection) {
                // User wants kids only, skip non-kids sections
                logger.debug(
                  `Skipping non-kids DIV table section "${sectionType}"`,
                  {
                    label: 'FlixPatrol API',
                    platform,
                    contentFilter,
                    tableIndex: tableIndex + 1,
                  }
                );
                return; // Skip this table
              } else if (contentFilter === undefined && isKidsSection) {
                // User wants regular content only (no filter), skip kids sections
                logger.debug(
                  `Skipping kids DIV table section "${sectionType}"`,
                  {
                    label: 'FlixPatrol API',
                    platform,
                    tableIndex: tableIndex + 1,
                  }
                );
                return; // Skip this table
              }

              // Handle specific sections immediately
              if (
                sectionLower.includes('movies') ||
                sectionLower.includes('films') ||
                sectionLower.includes('tv') ||
                sectionLower.includes('shows') ||
                sectionLower.includes('series')
              ) {
                this.assignItemsToResultByContent(
                  items,
                  sectionType,
                  result,
                  requestedMediaType,
                  platform,
                  `DIV table ${tableIndex + 1}`
                );
              } else if (
                sectionLower.includes('overall') ||
                sectionLower.includes('combined') ||
                sectionLower.includes('all')
              ) {
                // Store overall content for potential fallback use
                overallItems = [...overallItems, ...items];
                logger.debug(
                  `Stored overall section with ${items.length} items as potential fallback`,
                  {
                    label: 'FlixPatrol API',
                    platform,
                    context: `DIV table ${tableIndex + 1}`,
                    sectionType,
                  }
                );
              }
            }
          });

          // Apply fallback logic: use overall content only if specific content wasn't found
          if (overallItems.length > 0) {
            if (requestedMediaType === 'tv' && result.tvShows.length === 0) {
              result.tvShows = overallItems.map((item) => ({
                ...item,
                type: 'tv' as const,
              }));
              logger.debug(
                `Using overall section as fallback for TV shows: ${overallItems.length} items`,
                {
                  label: 'FlixPatrol API',
                  platform,
                  requestedMediaType,
                }
              );
            } else if (
              requestedMediaType === 'movie' &&
              result.movies.length === 0
            ) {
              result.movies = overallItems.map((item) => ({
                ...item,
                type: 'movie' as const,
              }));
              logger.debug(
                `Using overall section as fallback for movies: ${overallItems.length} items`,
                {
                  label: 'FlixPatrol API',
                  platform,
                  requestedMediaType,
                }
              );
            } else if (requestedMediaType === 'both') {
              // For "both", always include overall content
              result.movies = [
                ...(result.movies || []),
                ...overallItems.map((item) => ({
                  ...item,
                  type: 'movie' as const,
                })),
              ];
              result.tvShows = [
                ...(result.tvShows || []),
                ...overallItems.map((item) => ({
                  ...item,
                  type: 'tv' as const,
                })),
              ];
              logger.debug(
                `Adding overall section to both categories: ${overallItems.length} items`,
                {
                  label: 'FlixPatrol API',
                  platform,
                  requestedMediaType,
                }
              );
            }
          }
        }
      }

      currentElement = currentElement.nextElementSibling;
    }

    logger.debug(`Parsed FlixPatrol streaming overview for ${platform}`, {
      label: 'FlixPatrol API',
      platform,
      tvShows: result.tvShows.length,
      movies: result.movies.length,
    });

    return result;
  }

  /**
   * Parse HTML from a platform's top 10 page (legacy method for dedicated platform pages)
   */
  private parsePlatformHtml(
    html: string,
    platform: string,
    region: string
  ): FlixPatrolPlatformData {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Extract date from page title
    const pageTitle = document.querySelector('title')?.textContent || '';
    const date = this.extractDateFromTitle(pageTitle);

    const tables = document.querySelectorAll('table');

    const result: FlixPatrolPlatformData = {
      platform: this.formatPlatformName(platform),
      region: region.charAt(0).toUpperCase() + region.slice(1),
      date: date || 'Unknown',
      tvShows: [],
      movies: [],
    };

    if (tables.length >= 2) {
      // First table is typically TV shows, second is movies
      result.tvShows = this.parseTopListTable(tables[0], 'tv');
      result.movies = this.parseTopListTable(tables[1], 'movie');

      logger.debug(`Parsed FlixPatrol data for ${platform}`, {
        label: 'FlixPatrol API',
        platform,
        tvShows: result.tvShows.length,
        movies: result.movies.length,
      });
    } else if (tables.length === 1) {
      // Sometimes there's only one combined table - we'll need to infer type
      const combinedItems = this.parseTopListTable(tables[0], 'movie'); // Default to movie
      result.movies = combinedItems;

      logger.debug(`Parsed FlixPatrol data for ${platform} (single table)`, {
        label: 'FlixPatrol API',
        platform,
        items: combinedItems.length,
      });
    }

    return result;
  }

  /**
   * Parse a single table containing ranking data
   */
  private parseTopListTable(
    table: Element,
    defaultType: 'movie' | 'tv'
  ): FlixPatrolListItem[] {
    const items: FlixPatrolListItem[] = [];
    const rows = table.querySelectorAll('tr');

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');

      let rankCell, titleCell, pointsCell;

      if (cells.length >= 4) {
        // Neon-style table: [Rank] [Change] [Title] [Days]
        rankCell = cells[0];
        titleCell = cells[2]; // Skip change indicator, get actual title
        pointsCell = cells[3];
      } else if (cells.length >= 3) {
        // Simpler table structure: [Rank] [Title] [Points]
        rankCell = cells[0];
        titleCell = cells[1];
        pointsCell = cells[2];
      } else {
        return; // Skip rows with insufficient columns
      }

      // Extract ranking
      const rankText = rankCell?.textContent?.trim() || '';
      const rankMatch = rankText.match(/^(\d+)\./);
      const rank = rankMatch ? parseInt(rankMatch[1]) : null;

      // Extract title and URL
      const titleLink = titleCell?.querySelector('a');
      const title =
        titleLink?.textContent?.trim() || titleCell?.textContent?.trim();
      const flixpatrolUrl = titleLink?.getAttribute('href');

      // Extract points
      const points = pointsCell?.textContent?.trim();

      // Individual poster extraction removed - autoPoster will handle poster generation

      if (
        rank &&
        title &&
        title !== '–' &&
        title !== '+1' &&
        title !== '-1' &&
        title !== '+2' &&
        title !== '-2' &&
        title !== 'n/a'
      ) {
        items.push({
          rank,
          title,
          points: points || undefined,
          flixpatrolUrl: flixpatrolUrl
            ? `https://flixpatrol.com${flixpatrolUrl}`
            : undefined,
          type: defaultType,
        });
      }
    });

    return items;
  }

  /**
   * Extract date from page title
   */
  private extractDateFromTitle(title: string): string | null {
    // Extract date from title like "TOP 10 on Netflix in the World on September 5, 2025 • FlixPatrol"
    const match = title.match(/on ([^•]+)/);
    return match ? match[1].trim() : null;
  }

  /**
   * Format platform name for display
   */
  private formatPlatformName(platform: string): string {
    switch (platform) {
      case FlixPatrolPlatform.NETFLIX:
        return 'Netflix';
      case FlixPatrolPlatform.HBO:
        return 'HBO';
      case FlixPatrolPlatform.DISNEY:
        return 'Disney+';
      case FlixPatrolPlatform.AMAZON_PRIME:
        return 'Amazon Prime';
      case FlixPatrolPlatform.APPLE_TV:
        return 'Apple TV+';
      case FlixPatrolPlatform.PARAMOUNT:
        return 'Paramount+';
      case FlixPatrolPlatform.PEACOCK:
        return 'Peacock';
      case FlixPatrolPlatform.CRUNCHYROLL:
        return 'Crunchyroll';
      case FlixPatrolPlatform.DISCOVERY_PLUS:
        return 'Discovery+';
      case FlixPatrolPlatform.HULU:
        return 'Hulu';
      default:
        return platform.charAt(0).toUpperCase() + platform.slice(1);
    }
  }

  /**
   * Get the platform display name
   */
  public static getPlatformLabel(platform: FlixPatrolPlatform): string {
    switch (platform) {
      case FlixPatrolPlatform.NETFLIX:
        return 'Netflix Top 10';
      case FlixPatrolPlatform.HBO:
        return 'HBO Top 10';
      case FlixPatrolPlatform.DISNEY:
        return 'Disney+ Top 10';
      case FlixPatrolPlatform.AMAZON_PRIME:
        return 'Amazon Prime Top 10';
      case FlixPatrolPlatform.APPLE_TV:
        return 'Apple TV+ Top 10';
      case FlixPatrolPlatform.PARAMOUNT:
        return 'Paramount+ Top 10';
      case FlixPatrolPlatform.PEACOCK:
        return 'Peacock Top 10';
      case FlixPatrolPlatform.CRUNCHYROLL:
        return 'Crunchyroll Top 10';
      case FlixPatrolPlatform.DISCOVERY_PLUS:
        return 'Discovery+ Top 10';
      case FlixPatrolPlatform.HULU:
        return 'Hulu Top 10';
      default:
        return 'Streaming Top 10';
    }
  }

  /**
   * Validate if a platform is supported
   */
  public static isSupportedPlatform(platform: string): boolean {
    return Object.values(FlixPatrolPlatform).includes(
      platform as FlixPatrolPlatform
    );
  }

  /**
   * Format platform name for display (dynamic version)
   */
  private formatDynamicPlatformName(platform: string): string {
    // Extract platform name from subtype (e.g., "neon-tv_top_10" -> "Neon TV")
    const platformName = this.extractPlatformNameFromSubtype(platform);
    return platformName
      .split(/[-_]/)
      .map((word) => {
        // Special case for TV to maintain proper capitalization
        if (word.toLowerCase() === 'tv') {
          return 'TV';
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  /**
   * Extract clean platform name from subtype
   */
  private extractPlatformNameFromSubtype(platform: string): string {
    // Remove "_top_10" suffix and return the platform identifier
    return platform.replace(/_top_10$/, '');
  }

  /**
   * Map our platform IDs to FlixPatrol HTML platform names
   */
  private mapPlatformIdToFlixPatrolName(platformId: string): string[] {
    // Only platforms actually found in FlixPatrol /top10 page test data
    const mappings: { [key: string]: string[] } = {
      netflix: ['Netflix'],
      hbo: ['HBO'],
      disney: ['Disney+'], // "TOP Movies on Disney+ on September 6, 2025"
      amazon_prime: ['Amazon Prime'], // "TOP Movies on Amazon Prime on September 6, 2025"
      'amazon-prime': ['Amazon Prime'],
      apple_tv: ['Apple'], // "TOP Movies on Apple on September 6, 2025"
      'apple-tv': ['Apple'],
      paramount: ['Paramount+'], // "TOP TV Shows on Paramount+ on September 6, 2025"
      amazon: ['Amazon'], // "TOP Movies on Amazon on September 6, 2025" (different from Prime)
    };

    const normalized = platformId.toLowerCase().replace(/_/g, '-');
    return mappings[normalized] || [platformId];
  }

  /**
   * Identify what type of content each table contains by analyzing the text structure
   */
  private identifyTableSections(divText: string, tableCount: number): string[] {
    const sections: string[] = [];

    // Split by "TOP 10" headers to find each section
    const topSections = divText
      .split(/TOP 10/i)
      .filter((part) => part.trim().length > 0);

    logger.debug(`Analyzing table sections`, {
      label: 'FlixPatrol API',
      tableCount,
      topSectionsFound: topSections.length,
      topSections: topSections
        .slice(0, 3)
        .map((s) => s.substring(0, 50).trim() + '...'),
    });

    // Analyze each section after "TOP 10"
    for (let i = 0; i < tableCount; i++) {
      let sectionType = 'unknown';

      if (i < topSections.length) {
        const sectionText = topSections[i].toLowerCase().trim();

        // Look for explicit content type indicators immediately after "TOP 10"
        if (sectionText.startsWith('overall')) {
          sectionType = 'overall';
        } else if (
          sectionText.startsWith('movies') ||
          sectionText.startsWith('films')
        ) {
          sectionType = 'movies';
        } else if (
          sectionText.startsWith('tv shows') ||
          sectionText.startsWith('shows') ||
          sectionText.startsWith('tv') ||
          sectionText.startsWith('series')
        ) {
          sectionType = 'tv shows';
        } else {
          // Check for these keywords anywhere in the section
          // Preserve "kids" prefix if present
          if (sectionText.includes('movies') || sectionText.includes('films')) {
            sectionType = sectionText.includes('kids')
              ? 'kids movies'
              : 'movies';
          } else if (
            sectionText.includes('tv shows') ||
            sectionText.includes('shows') ||
            sectionText.includes('series')
          ) {
            sectionType = sectionText.includes('kids')
              ? 'kids tv shows'
              : 'tv shows';
          } else if (
            sectionText.includes('overall') ||
            sectionText.includes('combined')
          ) {
            sectionType = 'overall';
          } else {
            // Position-based fallback for Amazon Prime pattern: Overall, Movies, TV Shows
            if (tableCount === 3) {
              sectionType =
                i === 0 ? 'overall' : i === 1 ? 'movies' : 'tv shows';
            } else if (tableCount === 2) {
              sectionType = i === 0 ? 'movies' : 'tv shows';
            } else {
              sectionType = 'overall';
            }
          }
        }
      } else {
        // Not enough text sections, use position-based fallback
        if (tableCount === 3) {
          sectionType = i === 0 ? 'overall' : i === 1 ? 'movies' : 'tv shows';
        } else if (tableCount === 2) {
          sectionType = i === 0 ? 'movies' : 'tv shows';
        } else {
          sectionType = 'overall';
        }
      }

      sections.push(sectionType);

      logger.debug(`Table ${i + 1} identified as: ${sectionType}`, {
        label: 'FlixPatrol API',
        tableIndex: i,
        sectionType,
        analyzedText: topSections[i]?.substring(0, 100) || 'no text available',
      });
    }

    return sections;
  }

  /**
   * Assign parsed items to the appropriate result category with priority logic:
   * 1. Use specific lists (Movies/TV) when available and requested
   * 2. Fall back to Overall lists only if specific lists don't exist
   */
  private assignItemsToResultByContent(
    items: FlixPatrolListItem[],
    sectionType: string,
    result: FlixPatrolPlatformData,
    requestedMediaType?: 'movie' | 'tv' | 'both',
    platform?: string,
    context?: string
  ): void {
    const sectionLower = sectionType.toLowerCase();

    // Priority 1: Use specific content type lists
    if (sectionLower.includes('movies') || sectionLower.includes('films')) {
      result.movies = [
        ...(result.movies || []),
        ...items.map((item) => ({ ...item, type: 'movie' as const })),
      ];
      logger.debug(`Found movies section with ${items.length} items`, {
        label: 'FlixPatrol API',
        platform,
        context,
        sectionType,
        totalMovies: result.movies.length,
      });
    } else if (
      sectionLower.includes('tv') ||
      sectionLower.includes('shows') ||
      sectionLower.includes('series')
    ) {
      result.tvShows = [
        ...(result.tvShows || []),
        ...items.map((item) => ({ ...item, type: 'tv' as const })),
      ];
      logger.debug(`Found TV shows section with ${items.length} items`, {
        label: 'FlixPatrol API',
        platform,
        context,
        sectionType,
        totalTvShows: result.tvShows.length,
      });
    } else if (
      sectionLower.includes('overall') ||
      sectionLower.includes('combined') ||
      sectionLower.includes('all')
    ) {
      // Priority 2: Overall sections - only use if no specific sections were found
      // Store in temporary variable and apply at the end of parsing to avoid overriding specific lists
      logger.debug(
        `Found overall section with ${items.length} items - will use as fallback if needed`,
        {
          label: 'FlixPatrol API',
          platform,
          context,
          sectionType,
          requestedMediaType,
        }
      );

      // For now, don't assign overall content - let the calling logic handle fallback
      // This will be handled in the main parsing function
    } else {
      // Unknown section type - treat as overall for fallback purposes
      logger.debug(
        `Found unknown section type "${sectionType}" with ${items.length} items - treating as fallback`,
        {
          label: 'FlixPatrol API',
          platform,
          context,
          sectionType,
          requestedMediaType,
        }
      );
    }
  }

  /**
   * Get global platform options (static list for world/global)
   */
  private getGlobalPlatformOptions(): FlixPatrolPlatformOption[] {
    return [
      { value: 'netflix_top_10', label: 'Netflix Top 10' },
      { value: 'hbo_top_10', label: 'HBO Top 10' },
      { value: 'disney_top_10', label: 'Disney+ Top 10' },
      { value: 'amazon_prime_top_10', label: 'Amazon Prime Top 10' },
      { value: 'apple_tv_top_10', label: 'Apple TV+ Top 10' },
      { value: 'paramount_top_10', label: 'Paramount+ Top 10' },
      { value: 'peacock_top_10', label: 'Peacock Top 10' },
      { value: 'crunchyroll_top_10', label: 'Crunchyroll Top 10' },
      { value: 'discovery_plus_top_10', label: 'Discovery+ Top 10' },
      { value: 'hulu_top_10', label: 'Hulu Top 10' },
    ];
  }

  /**
   * Parse countries from FlixPatrol streaming page HTML
   */
  private parseCountriesFromHtml(html: string): string[] {
    try {
      logger.debug(`Parsing HTML of length: ${html.length}`, {
        label: 'FlixPatrol API',
      });

      const dom = new JSDOM(html);
      const document = dom.window.document;

      const countries = new Set<string>();

      // Look for streaming links with country codes
      // Format: /top10/streaming/{country}/2025-09-05/
      const streamingLinks = document.querySelectorAll(
        'a[href*="/streaming/"]'
      );

      logger.debug(
        `Found ${streamingLinks.length} links with /streaming/ in href`,
        {
          label: 'FlixPatrol API',
        }
      );

      let matchCount = 0;
      streamingLinks.forEach((link, index) => {
        const href = link.getAttribute('href') || '';
        const text = link.textContent?.trim() || '';

        // Extract country from URLs like /top10/streaming/united-states/2025-09-05/
        const countryMatch = href.match(/\/streaming\/([a-z-]+)(?:\/|$)/);
        if (countryMatch && countryMatch[1]) {
          const country = countryMatch[1].toLowerCase();

          // Filter out non-country paths
          if (country !== 'streaming' && country.length >= 2) {
            countries.add(country);
            matchCount++;

            if (matchCount <= 5) {
              logger.debug(
                `Match ${matchCount}: "${text}" -> "${country}" from "${href}"`,
                {
                  label: 'FlixPatrol API',
                }
              );
            }
          }
        } else if (index < 5) {
          logger.debug(`No match for link: "${text}" -> "${href}"`, {
            label: 'FlixPatrol API',
          });
        }
      });

      // Always include 'global' as the global option at the top
      const result = ['global', ...Array.from(countries).sort()];

      logger.debug(`Total unique countries found: ${result.length}`, {
        label: 'FlixPatrol API',
        totalLinks: streamingLinks.length,
        matches: matchCount,
      });

      if (result.length <= 1) {
        logger.error(
          'Very few countries found, this indicates a scraping issue',
          {
            label: 'FlixPatrol API',
            countries: result,
            htmlSnippet: html.substring(0, 500),
          }
        );
      }

      logger.debug(
        `Parsed ${result.length} countries from FlixPatrol streaming page`,
        {
          label: 'FlixPatrol API',
          sample: result.slice(0, 10),
        }
      );

      return result;
    } catch (error) {
      logger.error('Failed to parse countries from HTML:', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // No fallback - if we can't get real data, we fail
      throw error;
    }
  }

  /**
   * Get the current FlixPatrol platform sprite URL by fetching their CSS
   */
  private async getCurrentSpriteUrl(): Promise<string | null> {
    const cacheKey = 'flixpatrol:sprite-url:v1';

    // Check cache first (cache for 1 hour)
    const cached = this.cache?.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // First get the current CSS version from the HTML page
      const htmlResponse = await this.axios.get('/top10/streaming/', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        timeout: 10000,
      });

      // Extract the CSS version from the HTML
      const cssVersionMatch = htmlResponse.data.match(
        /all\.min\.css\?v=([^"']*)/
      );
      const cssVersion = cssVersionMatch ? cssVersionMatch[1] : 'a72ef60e';

      // Fetch the versioned CSS file to get the current sprite URL
      const cssResponse = await this.axios.get(
        `/static/dist/all.min.css?v=${cssVersion}`,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          timeout: 10000,
        }
      );

      const cssContent = cssResponse.data;

      // Look for the bg-platform rule with the sprite URL
      const bgPlatformMatch = cssContent.match(
        /\.bg-platform\s*\{[^}]*background-image:\s*var\([^,]*,\s*url\('([^']+)'\)/
      );

      if (bgPlatformMatch) {
        const relativeUrl = bgPlatformMatch[1];

        // Convert relative URL to absolute
        // CSS is at /static/dist/all.min.css, so ../img/platforms/ resolves to /static/img/platforms/
        let absoluteUrl: string;
        if (relativeUrl.startsWith('../')) {
          absoluteUrl =
            'https://flixpatrol.com/static/' + relativeUrl.replace('../', '');
        } else if (relativeUrl.startsWith('/')) {
          absoluteUrl = 'https://flixpatrol.com' + relativeUrl;
        } else {
          absoluteUrl = relativeUrl;
        }

        // Cache for 1 hour
        this.cache?.set(cacheKey, absoluteUrl, 3600);

        logger.debug('Extracted current FlixPatrol sprite URL', {
          label: 'FlixPatrol API',
          spriteUrl: absoluteUrl,
        });

        return absoluteUrl;
      }

      // No sprite URL found in CSS
      logger.warn('No bg-platform sprite URL found in CSS', {
        label: 'FlixPatrol API',
      });

      return null;
    } catch (error) {
      logger.warn('Failed to fetch current sprite URL, using fallback', {
        label: 'FlixPatrol API',
        error: error instanceof Error ? error.message : String(error),
      });

      // Return null to disable sprite extraction when fetch fails
      return null;
    }
  }

  /**
   * Extract platform logo information from FlixPatrol platform section
   */
  private async extractPlatformLogo(
    platformSection: Element
  ): Promise<{ spriteUrl: string; position: string } | null> {
    try {
      // Look for the bg-platform span within the platform section header
      const bgPlatformSpan = platformSection.querySelector('span.bg-platform');
      if (!bgPlatformSpan) {
        logger.debug('No bg-platform span found in platform section', {
          label: 'FlixPatrol API',
        });
        return null;
      }

      // Extract the CSS custom property --fp-percents from the style attribute
      const style = bgPlatformSpan.getAttribute('style') || '';
      const fpPercentsMatch = style.match(/--fp-percents:\s*([^;]+)/);

      if (!fpPercentsMatch) {
        logger.debug('No --fp-percents found in platform span style', {
          label: 'FlixPatrol API',
          style,
        });
        return null;
      }

      const position = fpPercentsMatch[1].trim();

      // Get the current sprite URL dynamically
      const spriteUrl = await this.getCurrentSpriteUrl();

      if (!spriteUrl) {
        logger.debug('No sprite URL available', {
          label: 'FlixPatrol API',
        });
        return null;
      }

      return {
        spriteUrl,
        position,
      };
    } catch (error) {
      logger.warn('Failed to extract platform logo', {
        label: 'FlixPatrol API',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Parse platforms from country-specific FlixPatrol page HTML
   */
  private parsePlatformsFromHtml(
    html: string,
    country: string
  ): FlixPatrolPlatformOption[] {
    try {
      logger.debug(
        `Parsing platforms HTML for ${country}, length: ${html.length}`,
        {
          label: 'FlixPatrol API',
          country,
        }
      );

      const dom = new JSDOM(html);
      const document = dom.window.document;

      const platforms: FlixPatrolPlatformOption[] = [];

      // Look for actual platform sections (H2 headings with "TOP 10")
      // This ensures we only return platforms that actually have data on this page
      const h2Headings = document.querySelectorAll('h2');

      logger.debug(`Found ${h2Headings.length} H2 headings for ${country}`, {
        label: 'FlixPatrol API',
        country,
      });

      h2Headings.forEach((heading) => {
        const headingText = heading.textContent?.trim() || '';

        // Look for platform section headers like "Netflix TOP 10 in New Zealand"
        if (headingText.toLowerCase().includes('top 10')) {
          // Extract platform name (everything before "TOP 10")
          const match = headingText.match(/^(.+?)\s+TOP 10/i);
          if (match) {
            const platformName = match[1].trim();

            // Convert platform name to code format
            const platformCode = platformName
              .toLowerCase()
              .replace(/\s+/g, '-') // spaces to hyphens
              .replace(/\+/g, '') // remove + symbols
              .replace(/&/g, 'and') // & to 'and'
              .replace(/[^a-z0-9-]/g, ''); // remove other special chars

            // Check for H3 subsections under this H2
            // H3 elements can be direct siblings OR inside a DIV sibling
            const subsections: string[] = [];
            let nextElement = heading.nextElementSibling;

            while (nextElement && nextElement.tagName !== 'H2') {
              if (nextElement.tagName === 'H3') {
                const h3Text = nextElement.textContent?.trim() || '';
                if (h3Text.toLowerCase().startsWith('top 10')) {
                  subsections.push(h3Text);
                }
              } else if (nextElement.tagName === 'DIV') {
                // Check for H3 elements inside this DIV
                const h3InDiv = nextElement.querySelectorAll('h3');
                h3InDiv.forEach((h3) => {
                  const h3Text = h3.textContent?.trim() || '';
                  if (h3Text.toLowerCase().startsWith('top 10')) {
                    subsections.push(h3Text);
                  }
                });
              }
              nextElement = nextElement.nextElementSibling;
            }

            // If there are subsections, check if we should group them or create separate options
            if (subsections.length > 0) {
              // Check if there are kids sections
              const hasKidsContent = subsections.some((s) =>
                s.toLowerCase().includes('kids')
              );
              const hasRegularContent = subsections.some(
                (s) => !s.toLowerCase().includes('kids')
              );

              // If there are kids sections, create two options: regular and kids
              if (hasKidsContent) {
                // Option 1: Regular content (Movies + TV Shows combined)
                if (hasRegularContent) {
                  const platformValue = `${platformCode}_top_10`;
                  const platformLabel = `${platformName} Top 10`;

                  if (!platforms.find((p) => p.value === platformValue)) {
                    platforms.push({
                      value: platformValue,
                      label: platformLabel,
                    });

                    logger.debug(
                      `Found platform with subsections (combined regular): "${platformName}" -> ${platformValue}`,
                      {
                        label: 'FlixPatrol API',
                        country,
                        platformName,
                      }
                    );
                  }
                }

                // Option 2: Kids content (Kids Movies + Kids TV Shows combined)
                const platformValue = `${platformCode}-kids_top_10`;
                const platformLabel = `${platformName} Top 10 Kids`;

                if (!platforms.find((p) => p.value === platformValue)) {
                  platforms.push({
                    value: platformValue,
                    label: platformLabel,
                  });

                  logger.debug(
                    `Found platform with kids subsections: "${platformName}" -> ${platformValue}`,
                    {
                      label: 'FlixPatrol API',
                      country,
                      platformName,
                    }
                  );
                }
              } else {
                // No kids content, just create single option (Movies + TV combined)
                const platformValue = `${platformCode}_top_10`;
                const platformLabel = `${platformName} Top 10`;

                if (!platforms.find((p) => p.value === platformValue)) {
                  platforms.push({
                    value: platformValue,
                    label: platformLabel,
                  });

                  logger.debug(
                    `Found platform with subsections (no kids): "${platformName}" -> ${platformValue}`,
                    {
                      label: 'FlixPatrol API',
                      country,
                      platformName,
                    }
                  );
                }
              }
            } else {
              // No subsections, use the platform overall
              const platformValue = `${platformCode}_top_10`;
              const platformLabel = `${platformName} Top 10`;

              if (!platforms.find((p) => p.value === platformValue)) {
                platforms.push({
                  value: platformValue,
                  label: platformLabel,
                });

                logger.debug(
                  `Found platform section: "${headingText}" -> ${platformValue}`,
                  {
                    label: 'FlixPatrol API',
                    country,
                    platformName,
                    platformCode,
                  }
                );
              }
            }
          }
        }
      });

      logger.info(`Scraped ${platforms.length} platforms for ${country}`, {
        label: 'FlixPatrol API',
        country,
        count: platforms.length,
        sample: platforms.slice(0, 5).map((p) => p.label),
      });

      return platforms;
    } catch (error) {
      logger.warn(`Failed to parse platforms for ${country}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        country,
      });

      // Return empty array - let the calling method handle the error
      return [];
    }
  }

  /**
   * Parse global platform data using card-table structure
   * Simple method focused only on global pages to avoid breaking country logic
   */
  private parseGlobalPlatformData(
    platformSection: Element,
    result: FlixPatrolPlatformData,
    platform: string
  ): FlixPatrolPlatformData {
    logger.debug(`Parsing global platform data for ${platform}`, {
      label: 'FlixPatrol API',
      platform,
    });

    // The card tables exist in the document, but not directly after headings
    // Search the entire document for card-table elements and associate them with platforms
    const document = platformSection.ownerDocument;
    const allCardTables = document?.querySelectorAll('table.card-table') || [];

    logger.debug(
      `Found ${allCardTables.length} total card tables in document`,
      {
        label: 'FlixPatrol API',
        platform,
      }
    );

    // Find all global platform headings (exclude country breakdown)
    const allHeadings = Array.from(document?.querySelectorAll('h2') || []);
    const globalPlatformHeadings = allHeadings.filter((h) => {
      const text = h.textContent?.toLowerCase() || '';
      return (
        (text.includes('top movies on') || text.includes('top tv shows on')) &&
        !text.includes('by country')
      );
    });

    // Group headings by platform (Movies + TV pairs)
    const platformGroups: { movies: Element | null; tv: Element | null }[] = [];
    const platforms: string[] = [];

    globalPlatformHeadings.forEach((heading) => {
      const text = heading.textContent?.toLowerCase() || '';
      // Extract platform name from heading like "TOP Movies on Netflix on September 6, 2025"
      const platformMatch = text.match(
        /top (?:movies|tv shows) on (.+?) on \w+/
      );
      if (platformMatch) {
        const platformName = platformMatch[1].trim();
        let platformGroup = platformGroups.find(
          (_, index) => platforms[index] === platformName
        );

        if (!platformGroup) {
          platforms.push(platformName);
          platformGroup = { movies: null, tv: null };
          platformGroups.push(platformGroup);
        }

        if (text.includes('movies')) {
          platformGroup.movies = heading;
        } else if (text.includes('tv shows')) {
          platformGroup.tv = heading;
        }
      }
    });

    // Find which platform group our section belongs to
    const currentPlatformGroupIndex = platformGroups.findIndex(
      (group) =>
        group.movies === platformSection || group.tv === platformSection
    );

    // Determine if this is a movies or TV section
    const isMoviesSection =
      platformGroups[currentPlatformGroupIndex]?.movies === platformSection;
    const isTvSection =
      platformGroups[currentPlatformGroupIndex]?.tv === platformSection;

    if (currentPlatformGroupIndex >= 0) {
      // Each platform gets 2 sequential tables from the global card-table list
      // Filter out country breakdown tables (they have many rows, typically >50)
      const globalCardTables = Array.from(allCardTables).filter((table) => {
        const rows = table.querySelectorAll('tr');
        return rows.length <= 20; // Global platform tables have ~10 rows each
      });

      // Each platform has 2 tables in the HTML following the document order of their headings
      // We need to determine which heading (movies or TV) appears first in the document
      // to know which table corresponds to which content type
      const platformBaseTableIndex = currentPlatformGroupIndex * 2;

      const currentGroup = platformGroups[currentPlatformGroupIndex];

      // Find the indices of the movies and TV headings in the globalPlatformHeadings array
      let moviesHeadingIndex = -1;
      let tvHeadingIndex = -1;

      for (let i = 0; i < globalPlatformHeadings.length; i++) {
        if (globalPlatformHeadings[i] === currentGroup.movies) {
          moviesHeadingIndex = i;
        }
        if (globalPlatformHeadings[i] === currentGroup.tv) {
          tvHeadingIndex = i;
        }
      }

      // Determine table indices based on document order of headings
      const moviesComesFirst =
        moviesHeadingIndex >= 0 &&
        tvHeadingIndex >= 0 &&
        moviesHeadingIndex < tvHeadingIndex;

      let tableIndex: number;
      if (isMoviesSection) {
        // If movies heading comes first, it gets the first table; otherwise second
        tableIndex = moviesComesFirst
          ? platformBaseTableIndex
          : platformBaseTableIndex + 1;
      } else if (isTvSection) {
        // If TV heading comes first, it gets the first table; otherwise second
        tableIndex = moviesComesFirst
          ? platformBaseTableIndex + 1
          : platformBaseTableIndex;
      } else {
        // Shouldn't happen, but default to first table
        tableIndex = platformBaseTableIndex;
      }

      const startTableIndex = tableIndex;
      const endTableIndex = tableIndex + 1; // Process only one table

      logger.debug(
        `Platform ${platform} should use tables ${startTableIndex}-${
          endTableIndex - 1
        }`,
        {
          label: 'FlixPatrol API',
          platform,
          currentPlatformGroupIndex,
          totalPlatformGroups: platformGroups.length,
          globalCardTablesCount: globalCardTables.length,
          platformName: platforms[currentPlatformGroupIndex],
        }
      );

      for (
        let i = startTableIndex;
        i < endTableIndex && i < globalCardTables.length;
        i++
      ) {
        const table = globalCardTables[i];
        const items = this.parseCardTable(table);

        // Use the heading we matched to determine if this is movies or TV
        // Each platform gets 2 tables - all tables for a movies heading are movies,
        // all tables for a TV heading are TV
        if (isMoviesSection) {
          result.movies.push(
            ...items.map((item) => ({ ...item, type: 'movie' as const }))
          );
        } else if (isTvSection) {
          result.tvShows.push(
            ...items.map((item) => ({ ...item, type: 'tv' as const }))
          );
        } else {
          logger.warn(
            `Could not determine content type - not movies or TV section`,
            {
              label: 'FlixPatrol API',
              platform,
              isMoviesSection,
              isTvSection,
            }
          );
        }

        logger.debug(`Processed table ${i} for ${platform}`, {
          label: 'FlixPatrol API',
          platform,
          tableIndex: i,
          itemsCount: items.length,
          contentType: isMoviesSection
            ? 'movies'
            : isTvSection
            ? 'tv'
            : 'unknown',
        });
      }

      logger.debug(`Parsed platform data for ${platform}`, {
        label: 'FlixPatrol API',
        platform,
        movieCount: result.movies.length,
        tvCount: result.tvShows.length,
        tablesUsed: `${startTableIndex}-${endTableIndex - 1}`,
      });
    }

    return result;
  }

  /**
   * Parse a single card-table element to extract ranking items
   */
  private parseCardTable(table: Element): FlixPatrolListItem[] {
    const items: FlixPatrolListItem[] = [];
    const rows = table.querySelectorAll('tr');

    rows.forEach((row, index) => {
      const cells = row.querySelectorAll('td');

      if (cells.length >= 3) {
        const rankText = cells[0].textContent?.trim() || '';
        const titleElement = cells[1].querySelector('a');
        const pointsText = cells[2].textContent?.trim() || '';

        // Extract rank number
        const rankMatch = rankText.match(/(\d+)/);
        const rank = rankMatch ? parseInt(rankMatch[1], 10) : index + 1;

        // Extract title
        const title =
          titleElement?.textContent?.trim() ||
          cells[1].textContent?.trim() ||
          '';

        // Extract FlixPatrol URL
        const flixpatrolUrl = titleElement?.getAttribute('href') || undefined;

        // Extract points
        const points = pointsText;

        if (title) {
          items.push({
            rank,
            title,
            points,
            flixpatrolUrl,
            type: 'movie', // Default - will be determined by context or backend
          });
        }
      }
    });

    return items;
  }
}

export default FlixPatrolAPI;
