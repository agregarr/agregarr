import type PlexAPI from '@server/api/plexapi';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

/**
 * Template placeholders that can be used in collection names
 */
export interface TemplateContext {
  mediaType?: 'movie' | 'tv';
  days?: number;
  customdays?: number;
  statType?: string;
  servername?: string;
  subtype?: string;
  domain?: string;
  nickname?: string;
  username?: string;
  displayName?: string;
  // User-specific placeholders for compatibility with templateUtils
  user?: string; // User display name (for {user} placeholder)
  appTitle?: string; // Application title (for {appTitle} placeholder)
  // Time-based placeholders
  currentDate?: string; // Current date in DD-MM format
  currentMonth?: string; // Current month name
  currentYear?: string; // Current year
  currentDay?: string; // Current day name
  isWeekend?: boolean; // Whether current day is weekend
}

/**
 * Template Engine for processing collection name templates
 *
 * Handles placeholder replacement for collection names across all sync sources.
 * Supports template inheritance where custom templates can override base templates.
 */
export class TemplateEngine {
  private settings = getSettings();

  /**
   * Process a template with the given context
   *
   * @param template - The template string with placeholders like {mediaType}
   * @param context - Context object containing values for placeholder replacement
   * @returns Processed template with placeholders replaced
   */
  public processTemplate(template: string, context: TemplateContext): string {
    if (!template) {
      return '';
    }

    // Debug logging to see what context we're getting
    logger.debug('Template processing', {
      label: 'Template Engine',
      template,
      context: {
        domain: context.domain,
        appTitle: context.appTitle,
        nickname: context.nickname,
        username: context.username,
        servername: context.servername,
        mediaType: context.mediaType,
      },
    });

    let processed = template;

    // Replace all known placeholders
    if (context.mediaType !== undefined) {
      const mediaTypeLabel = this.getMediaTypeLabel(context.mediaType);
      const mediaTypePluralLabel = this.getMediaTypePluralLabel(
        context.mediaType
      );

      // Replace {mediaType}s first (plural), then {mediaType} (singular)
      processed = processed.replace(/{mediaType}s/g, mediaTypePluralLabel);
      processed = processed.replace(/{mediaType}/g, mediaTypeLabel);
    }

    if (context.days !== undefined) {
      processed = processed.replace(/{days}/g, context.days.toString());
    }

    if (context.customdays !== undefined) {
      processed = processed.replace(
        /{customdays}/g,
        context.customdays.toString()
      );
    }

    if (context.statType !== undefined) {
      processed = processed.replace(/{statType}/g, context.statType);
    }

    if (context.servername !== undefined) {
      processed = processed.replace(/{servername}/g, context.servername);
    }

    if (context.subtype !== undefined) {
      processed = processed.replace(/{subtype}/g, context.subtype);
    }

    if (context.domain !== undefined) {
      processed = processed.replace(/{domain}/g, context.domain);
    }

    if (context.nickname !== undefined) {
      processed = processed.replace(/{nickname}/g, context.nickname);
    }

    if (context.username !== undefined) {
      processed = processed.replace(/{username}/g, context.username);
    }

    if (context.displayName !== undefined) {
      processed = processed.replace(/{displayName}/g, context.displayName);
    }

    // User-specific placeholders for compatibility with templateUtils
    if (context.user !== undefined) {
      processed = processed.replace(/{user}/g, context.user);
    }

    if (context.appTitle !== undefined) {
      processed = processed.replace(/{appTitle}/g, context.appTitle);
    }

    // Time-based placeholders
    if (context.currentDate !== undefined) {
      processed = processed.replace(/{currentDate}/g, context.currentDate);
    }

    if (context.currentMonth !== undefined) {
      processed = processed.replace(/{currentMonth}/g, context.currentMonth);
    }

    if (context.currentYear !== undefined) {
      processed = processed.replace(/{currentYear}/g, context.currentYear);
    }

    if (context.currentDay !== undefined) {
      processed = processed.replace(/{currentDay}/g, context.currentDay);
    }

    if (context.isWeekend !== undefined) {
      processed = processed.replace(
        /{isWeekend}/g,
        context.isWeekend ? 'Weekend' : 'Weekday'
      );
    }

    // Debug logging to see the final result
    logger.debug('Template processing result', {
      label: 'Template Engine',
      originalTemplate: template,
      processedTemplate: processed,
      wasChanged: template !== processed,
    });

    return processed;
  }

  /**
   * Process template with media type-specific custom templates
   *
   * @param baseTemplate - Base template to use
   * @param customMovieTemplate - Custom template to use for movies (when mediaType is 'both')
   * @param customTVTemplate - Custom template to use for TV shows (when mediaType is 'both')
   * @param context - Template context
   * @returns Processed template
   */
  public processTemplateWithCustom(
    baseTemplate: string,
    customMovieTemplate: string | undefined,
    customTVTemplate: string | undefined,
    context: TemplateContext
  ): string {
    let templateToUse = baseTemplate;

    // Use custom templates when processing 'both' media types
    if (context.mediaType === 'movie' && customMovieTemplate) {
      templateToUse = customMovieTemplate;
    } else if (context.mediaType === 'tv' && customTVTemplate) {
      templateToUse = customTVTemplate;
    }

    return this.processTemplate(templateToUse, context);
  }

  /**
   * Get default template context values from settings
   */
  public getDefaultContext(): Partial<TemplateContext> {
    // Use external service data if available, fallback to local settings
    const domainUrl =
      this.settings.main.externalApplicationUrl ||
      this.settings.main.applicationUrl ||
      '';
    const appTitle =
      this.settings.main.externalApplicationTitle ||
      this.settings.main.applicationTitle ||
      'Overseerr';

    return {
      servername: this.settings.plex.name || 'Plex Server',
      domain: this.extractDomainFromUrl(domainUrl),
      appTitle: appTitle,
      // Include stored admin info for user template examples
      username: this.settings.main.adminUsername || 'username',
      nickname: this.settings.main.adminNickname || 'nickname',
    };
  }

  /**
   * Get default context with external Overseerr settings for template variables
   * Used specifically for Overseerr collections to pull domain/appTitle from external instance
   */
  public async getOverseerrDefaultContext(): Promise<Partial<TemplateContext>> {
    try {
      // Import the service to avoid circular dependencies
      const { overseerrCollectionService } = await import(
        '@server/lib/collections/external/overseerr'
      );
      const overseerrSettings =
        await overseerrCollectionService.getOverseerrSettings();

      if (overseerrSettings) {
        return {
          servername: this.settings.plex.name || 'Plex Server',
          domain: this.extractDomainFromUrl(
            overseerrSettings.applicationUrl || ''
          ),
          appTitle: overseerrSettings.applicationTitle || 'Overseerr',
        };
      }
    } catch (error) {
      // Fall back to local settings if external fetch fails
      logger.warn(
        'Failed to fetch external Overseerr settings for template context, using local settings',
        {
          label: 'TemplateEngine',
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // Fallback to local settings
    return this.getDefaultContext();
  }

  /**
   * Create context for Tautulli collections
   */
  public createTautulliContext(
    mediaType: 'movie' | 'tv',
    timeRangeDays: number,
    statType: string,
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      days: timeRangeDays,
      customdays: timeRangeDays,
      statType: this.getStatTypeLabel(statType),
      subtype: this.getTautulliSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for Trakt collections
   */
  public createTraktContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getTraktSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for TMDb collections
   */
  public createTmdbContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getTmdbSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for IMDb collections
   */
  public createImdbContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getImdbSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for Letterboxd collections
   */
  public createLetterboxdContext(
    mediaType: 'movie' | 'tv',
    subtype: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getLetterboxdSubtypeLabel(subtype),
    };
  }

  /**
   * Create context for Networks collections
   */
  public createNetworksContext(
    mediaType: 'movie' | 'tv',
    platform: string,
    statType: string
  ): TemplateContext {
    return {
      ...this.getDefaultContext(),
      mediaType,
      subtype: this.getNetworksSubtypeLabel(platform),
      statType,
    };
  }

  /**
   * Create context for Overseerr collections
   */
  public createOverseerrContext(
    mediaType: 'movie' | 'tv',
    user: {
      displayName?: string;
      username?: string;
      plexUsername?: string;
      plexTitle?: string;
      email?: string;
      plexId?: number;
      id?: number;
    }
  ): TemplateContext {
    // Calculate user display name using the same logic as templateUtils
    const userDisplayName =
      user.displayName ||
      user.plexUsername ||
      user.username ||
      user.email ||
      `User ${user.plexId || user.id}`;

    const context: TemplateContext = {
      ...this.getDefaultContext(),
      mediaType,
      nickname:
        user.plexTitle ||
        user.displayName ||
        user.username ||
        user.plexUsername ||
        'User',
      username: user.username || user.plexUsername || 'User',
      displayName:
        user.displayName || user.username || user.plexUsername || 'User',
      user: userDisplayName, // Add {user} placeholder support
    };

    return context;
  }

  /**
   * Create enhanced context for Overseerr collections with external data
   * Fetches domain/appTitle from external Overseerr and plexTitle from Plex
   */
  public async createEnhancedOverseerrContext(
    mediaType: 'movie' | 'tv',
    user: {
      displayName?: string;
      username?: string;
      plexUsername?: string;
      plexTitle?: string;
      email?: string;
      plexId?: number;
      id?: number;
    },
    plexClient?: PlexAPI,
    isServerOwner?: boolean
  ): Promise<TemplateContext> {
    // Get external Overseerr settings for domain/appTitle
    const defaultContext = await this.getOverseerrDefaultContext();

    // Try to fetch plexTitle from Plex if we have a plexId and plexClient
    const enhancedUser = { ...user };
    if (plexClient && user.plexId) {
      try {
        const plexTitle = await plexClient.getPlexUserTitle(
          user.plexId.toString()
        );
        if (plexTitle) {
          enhancedUser.plexTitle = plexTitle;
        }
      } catch (error) {
        logger.warn(`Failed to fetch plexTitle for user ${user.plexId}`, {
          label: 'TemplateEngine',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Calculate user display name using the same logic as templateUtils
    const userDisplayName =
      enhancedUser.displayName ||
      enhancedUser.plexUsername ||
      enhancedUser.username ||
      enhancedUser.email ||
      `User ${enhancedUser.plexId || enhancedUser.id}`;

    // Check if this is the admin user - use adminNickname from settings
    // For server_owner collections, always use admin nickname from settings
    const isAdminUser =
      isServerOwner ||
      enhancedUser.username === this.settings.main.adminUsername;

    // Debug logging to understand admin user detection
    logger.debug('Admin user detection in TemplateEngine', {
      label: 'TemplateEngine',
      userUsername: enhancedUser.username,
      adminUsername: this.settings.main.adminUsername,
      isAdminUser: isAdminUser,
      isServerOwner: isServerOwner,
      adminNickname: this.settings.main.adminNickname,
    });

    const context: TemplateContext = {
      ...defaultContext,
      mediaType,
      nickname: isAdminUser
        ? this.settings.main.adminNickname || 'Admin'
        : enhancedUser.plexTitle ||
          enhancedUser.displayName ||
          enhancedUser.username ||
          enhancedUser.plexUsername ||
          'User',
      username: enhancedUser.username || enhancedUser.plexUsername || 'User',
      displayName:
        enhancedUser.displayName ||
        enhancedUser.username ||
        enhancedUser.plexUsername ||
        'User',
      user: userDisplayName, // Add {user} placeholder support
    };

    return context;
  }

  /**
   * Create context for global collections (no specific user)
   * Equivalent to generateGlobalCollectionName() logic
   */
  public createGlobalContext(mediaType?: 'movie' | 'tv'): TemplateContext {
    const context: TemplateContext = {
      ...this.getDefaultContext(),
      mediaType,
    };

    return context;
  }

  /**
   * Convert media type to human-readable label
   */
  private getMediaTypeLabel(mediaType: 'movie' | 'tv'): string {
    switch (mediaType) {
      case 'movie':
        return 'Movie';
      case 'tv':
        return 'TV Show';
      default:
        return 'Media';
    }
  }

  /**
   * Convert media type to human-readable plural label
   */
  private getMediaTypePluralLabel(mediaType: 'movie' | 'tv'): string {
    switch (mediaType) {
      case 'movie':
        return 'Movies';
      case 'tv':
        return 'TV Shows';
      default:
        return 'Media';
    }
  }

  /**
   * Convert stat type to readable label
   */
  private getStatTypeLabel(statType: string): string {
    switch (statType) {
      case 'plays':
        return 'Play Count';
      case 'duration':
        return 'Watch Duration';
      default:
        return statType;
    }
  }

  /**
   * Get readable label for Tautulli subtype
   */
  private getTautulliSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'most_popular_plays':
      case 'most_popular_duration':
        return 'Most Popular';
      default:
        return subtype;
    }
  }

  /**
   * Get human-readable label for Trakt subtype
   */
  private getTraktSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'trending':
        return 'Trending Last 7 Days';
      case 'popular':
        return 'Popular';
      case 'played':
        return 'Most Played';
      case 'watched':
        return 'Most Watched';
      case 'collected':
        return 'Most Collected';
      case 'boxoffice':
        return 'Box Office';
      case 'custom':
        return 'Custom List';

      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Get human-readable label for TMDb subtype
   */
  private getTmdbSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'trending_day':
        return 'Trending Today';
      case 'trending_week':
        return 'Trending This Week';
      case 'popular':
        return 'Popular';
      case 'top_rated':
        return 'Top Rated';
      case 'custom':
        return 'Custom Collection';
      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Get human-readable label for IMDb subtype
   */
  private getImdbSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'top_250':
        return 'Top 250';
      case 'popular':
        return 'Popular';
      case 'most_popular':
        return 'Most Popular';
      case 'custom':
        return 'Custom List';
      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Get human-readable label for Letterboxd subtype
   */
  private getLetterboxdSubtypeLabel(subtype: string): string {
    switch (subtype) {
      case 'custom':
        return 'Custom List';
      default:
        return subtype
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Get human-readable label for Networks platform
   */
  private getNetworksSubtypeLabel(platform: string): string {
    switch (platform) {
      case 'netflix':
        return 'Netflix';
      case 'hbo':
        return 'HBO';
      case 'disney':
        return 'Disney+';
      case 'amazon-prime':
        return 'Amazon Prime';
      case 'apple-tv':
        return 'Apple TV+';
      case 'paramount':
        return 'Paramount+';
      case 'peacock':
        return 'Peacock';
      case 'crunchyroll':
        return 'Crunchyroll';
      case 'discovery-plus':
        return 'Discovery+';
      case 'hulu':
        return 'Hulu';
      default:
        return platform
          .replace(/_/g, ' ')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
    }
  }

  /**
   * Extract domain name from URL
   */
  private extractDomainFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch {
      // Fallback for invalid URLs
      return url.replace(/^https?:\/\//, '').split('/')[0];
    }
  }

  /**
   * Create time-based template context with current date/time information
   *
   * @param currentDate - Optional date to use (defaults to current date)
   * @returns TemplateContext with time-based placeholders
   */
  public createTimeBasedContext(currentDate?: Date): Partial<TemplateContext> {
    const now = currentDate || new Date();

    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear().toString();

    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    const dayNames = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ];

    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday

    return {
      currentDate: `${day}-${month}`,
      currentMonth: monthNames[now.getMonth()],
      currentYear: year,
      currentDay: dayNames[dayOfWeek],
      isWeekend,
    };
  }

  /**
   * Enhance any template context with time-based information
   *
   * @param baseContext - Base template context
   * @param currentDate - Optional date to use (defaults to current date)
   * @returns Enhanced context with time-based placeholders
   */
  public enhanceContextWithTime(
    baseContext: TemplateContext,
    currentDate?: Date
  ): TemplateContext {
    const timeContext = this.createTimeBasedContext(currentDate);
    return {
      ...baseContext,
      ...timeContext,
    };
  }
}

// Export singleton instance
export const templateEngine = new TemplateEngine();
