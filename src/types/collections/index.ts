/**
 * Collection configuration types for the Plex Collections UI
 * Extracted from SettingsPlex.tsx to improve maintainability
 */
// Types extracted from server to avoid importing server-side modules in client

export enum CollectionType {
  DEFAULT_PLEX_HUB = 'default_plex_hub', // Built-in Plex algorithmic hubs
  AGREGARR_CREATED = 'agregarr_created', // Agregarr-managed collections
  PRE_EXISTING = 'pre_existing', // Pre-existing Plex collections
}

/**
 * Sort order options for collection items
 */
export type CollectionSortOrder =
  | 'default' // As provided by source
  | 'reverse' // Reverse source order
  | 'random' // Fisher-Yates shuffle
  | 'imdb_rating_desc' // Highest to lowest IMDb rating
  | 'imdb_rating_asc' // Lowest to highest IMDb rating
  | 'release_date_desc' // Newest to oldest release date
  | 'release_date_asc' // Oldest to newest release date
  | 'date_added_desc' // Most recently added to Plex
  | 'date_added_asc' // Least recently added to Plex
  | 'alphabetical_asc' // A-Z alphabetical order
  | 'alphabetical_desc'; // Z-A alphabetical order

/**
 * Sonarr monitor types - determines which episodes are monitored when adding a series
 */
export type SonarrMonitorType =
  | 'all' // Monitor all episodes except specials
  | 'future' // Monitor episodes that have not aired yet
  | 'missing' // Monitor episodes that do not have files or have not aired yet
  | 'existing' // Monitor episodes that have files or have not aired yet
  | 'recent' // Monitor episodes aired within the last 90 days and future episodes
  | 'pilot' // Only monitor the first episode of the first season
  | 'firstSeason' // Monitor all episodes of the first season
  | 'lastSeason' // Monitor all episodes of the last season
  | 'none'; // No episodes will be monitored

export interface PlexHubConfig {
  id: string; // Generated unique identifier
  hubIdentifier: string; // Plex hub identifier (e.g., "movie.recentlyadded")
  name: string; // Display name (e.g., "Recently Added Movies")
  libraryId: string; // Library ID this hub belongs to
  libraryName: string; // Library display name
  mediaType: 'movie' | 'tv'; // Media type (hubs are always single type)
  sortOrderHome: number; // Position on Plex home screen
  sortOrderLibrary: number; // Position in library (0 for A-Z section, 1+ for promoted section)
  isLibraryPromoted: boolean; // true = promoted section (uses exclamation marks), false = A-Z section
  randomizeHomeOrder?: boolean; // If true, randomize position amongst other randomized items on home screen
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  isActive: boolean; // Whether hub is currently active (computed from time restrictions)
  collectionType: CollectionType;
  missing?: boolean; // True if hub no longer exists in Plex
  // Sync status tracking fields
  lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  lastModifiedAt?: string; // ISO string timestamp when config was last modified
  needsSync?: boolean; // true if modified since last sync
  isLinked?: boolean; // True if hub is actively linked to other hubs (set by backend linking logic)
  linkId?: number; // Group ID for linked hubs (set by backend linking logic)
  isUnlinked?: boolean; // True if this hub was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this hub has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  isPromotedToHub?: boolean; // True if hub exists as a promotable item in Plex (appears in hub management list)
  // Time restriction settings - all hub types can have time restrictions
  timeRestriction?: {
    alwaysActive: boolean; // If true, hub is always active (default)
    removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive (not available for default Plex hubs)
    inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    }; // Visibility settings to use when hub is inactive (only used if removeFromPlexWhenInactive is false)
    dateRanges?: readonly {
      startDate: string; // DD-MM format (e.g., "05-12" for 5th December)
      endDate: string; // DD-MM format (e.g., "26-12" for 26th December)
    }[];
    weeklySchedule?: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
  };
}

export interface PreExistingCollectionConfig {
  id: string; // Generated unique identifier
  collectionRatingKey: string; // Plex collection rating key (e.g., "35954")
  name: string; // Display name from Plex
  libraryId: string; // Library ID this collection belongs to
  libraryName: string; // Library display name
  mediaType: MediaType; // Media type based on library type
  titleSort?: string; // Plex sortTitle field for alphabetical ordering
  sortOrderHome: number; // Position on Plex home screen
  sortOrderLibrary: number; // Position in library (0 for A-Z section, 1+ for promoted section)
  isLibraryPromoted: boolean; // true = promoted section (uses exclamation marks), false = A-Z section
  randomizeHomeOrder?: boolean; // If true, randomize position amongst other randomized items on home screen
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  isActive: boolean; // Whether collection is currently active (computed from time restrictions)
  // Simplified categorization system (consistent with PlexHubConfig)
  collectionType: CollectionType;
  missing?: boolean; // True if collection no longer exists in Plex
  // Sync status tracking fields
  lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  lastModifiedAt?: string; // ISO string timestamp when config was last modified
  needsSync?: boolean; // true if modified since last sync
  isLinked?: boolean; // True if collection is actively linked to other collections (set by backend linking logic)
  linkId?: number; // Group ID for linked collections (set by backend linking logic)
  isUnlinked?: boolean; // True if this collection was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this collection has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  isPromotedToHub?: boolean; // True if collection exists as a promotable hub in Plex (appears in hub management list)
  // Time restriction settings
  timeRestriction?: {
    alwaysActive: boolean; // If true, collection is always active (default)
    removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive
    inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    }; // Visibility settings to use when collection is inactive
    dateRanges?: readonly {
      startDate: string; // DD-MM format (e.g., "05-12" for 5th December)
      endDate: string; // DD-MM format (e.g., "26-12" for 26th December)
    }[];
    weeklySchedule?: {
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    };
  };
  // Custom poster support
  customPoster?: string | Record<string, string>; // Path to custom poster image file, or per-library poster mapping
  autoPoster?: boolean; // Auto-generate poster during sync (same as CollectionFormConfig)
  autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
  // Wallpaper, summary, and theme support
  customWallpaper?: string | Record<string, string>; // Path to custom wallpaper (art) image file, or per-library wallpaper mapping
  customSummary?: string; // Custom summary/description text for the collection
  customTheme?: string | Record<string, string>; // Path to custom theme music file, or per-library theme mapping
  enableCustomWallpaper?: boolean; // Enable custom wallpaper sync to Plex
  enableCustomSummary?: boolean; // Enable custom summary sync to Plex
  enableCustomTheme?: boolean; // Enable custom theme sync to Plex
}

// Form metadata type for identifying config handling behavior
export type FormConfigType = 'collection' | 'hub' | 'preExisting';

export type TmdbAdvancedFilters = {
  readonly filterGroups?: readonly {
    readonly id: string;
    readonly operator: 'and' | 'or' | 'not'; // How this group combines with previous groups
    readonly filters: readonly {
      readonly id: string;
      readonly field: string; // e.g., 'with_genres', 'vote_average.gte'
      readonly operator: 'and' | 'or'; // For multi-value fields (comma vs pipe)
      readonly value: string | number | boolean;
    }[];
  }[];
};

export interface CollectionFormConfig {
  readonly id: string; // Generated unique identifier
  readonly name: string; // User-entered collection name
  readonly type?:
    | 'overseerr'
    | 'tautulli'
    | 'trakt'
    | 'tmdb'
    | 'imdb'
    | 'letterboxd'
    | 'anilist'
    | 'myanimelist'
    | 'plex'
    | 'mdblist'
    | 'networks'
    | 'originals'
    | 'multi-source'
    | 'radarrtag'
    | 'sonarrtag'
    | 'comingsoon'
    | 'filtered_hub';
  readonly subtype?: string; // Specific option like 'users', 'most_popular_plays', 'most_watched_plays', etc. - optional for hubs/pre-existing
  readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all'; // Time period for Trakt time-based subtypes
  readonly configType?: FormConfigType; // Metadata for form behavior identification
  readonly template?: string; // Collection title template (for preset templates or single media type) - optional for hubs/pre-existing
  readonly customMovieTemplate?: string; // Custom template for movie collections when mediaType is 'both'
  readonly customTVTemplate?: string; // Custom template for TV collections when mediaType is 'both'
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  readonly isActive: boolean; // Whether collection is currently active (time restrictions met) - computed by backend
  readonly missing?: boolean; // True if collection no longer exists in Plex
  // Sync status tracking fields
  readonly lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  readonly lastModifiedAt?: string; // ISO string timestamp when config was last modified
  readonly needsSync?: boolean; // true if modified since last sync
  readonly maxItems?: number; // Optional for hubs/pre-existing
  readonly mediaType?: MediaType;
  readonly libraryId: string; // Selected library ID - each config is for exactly one library
  readonly libraryName: string; // Selected library name for display
  readonly libraryIds?: string[]; // Temporary field for form UI when editing linked configs
  readonly libraryNames?: string[]; // Temporary field for form UI when editing linked configs
  readonly sortOrderHome?: number; // Order for Plex home screen (creation time based)
  readonly sortOrderLibrary?: number; // Order for Plex library tab (0 for A-Z section, 1+ for promoted section)
  readonly isLibraryPromoted?: boolean; // true = promoted section (uses exclamation marks), false = A-Z section (defaults to true for Agregarr collections)
  readonly randomizeHomeOrder?: boolean; // If true, randomize position amongst other randomized items on home screen
  readonly collectionRatingKey?: string; // Plex collection rating key for single-collection configs
  readonly collectionRatingKeys?: string[]; // Plex rating keys for multi-collection configs (e.g. seerr/users) — populated during sync
  readonly showUnwatchedOnly?: boolean; // Create smart collection that shows only unwatched items
  readonly smartCollectionRatingKey?: string; // LEGACY: Old dual-collection system smart collection rating key (for migration only)
  readonly smartCollectionSort?: SmartCollectionSortOption; // Sort option for smart collections
  readonly isLinked?: boolean; // True if collection is actively linked to other collections
  readonly linkId?: number; // Group ID for linked collections (preserved even when isLinked=false)
  readonly customSyncSchedule?: CustomSyncSchedule; // Individual sync timing
  readonly isMultiSource?: boolean; // Enable multi-source mode
  readonly sources?: readonly CollectionSourceConfig[]; // Array of source configurations
  readonly combineMode?: MultiSourceCombineMode; // How to combine multiple sources

  readonly [key: string]:
    | string
    | number
    | boolean
    | string[]
    | number[]
    | Record<string, string>
    | TmdbAdvancedFilters
    | null
    | {
        usersHome: boolean;
        serverOwnerHome: boolean;
        libraryRecommended: boolean;
      }
    | {
        readonly alwaysActive: boolean;
        readonly removeFromPlexWhenInactive?: boolean;
        readonly inactiveVisibilityConfig?: {
          usersHome: boolean;
          serverOwnerHome: boolean;
          libraryRecommended: boolean;
        };
        readonly dateRanges?: readonly {
          readonly startDate: string;
          readonly endDate: string;
        }[];
        readonly weeklySchedule?: {
          readonly monday: boolean;
          readonly tuesday: boolean;
          readonly wednesday: boolean;
          readonly thursday: boolean;
          readonly friday: boolean;
          readonly saturday: boolean;
          readonly sunday: boolean;
        };
      }
    | {
        readonly genres?: {
          readonly mode: 'exclude' | 'include';
          readonly values: number[];
        };
        readonly countries?: {
          readonly mode: 'exclude' | 'include';
          readonly values: string[];
        };
        readonly languages?: {
          readonly mode: 'exclude' | 'include';
          readonly values: string[];
        };
        readonly keywords?: {
          readonly mode: 'exclude' | 'include';
          readonly values: number[];
        };
      }
    | readonly CollectionSourceConfig[] // Multi-source configs
    | CustomSyncSchedule // Custom sync schedule
    | MultiSourceCombineMode // Combine mode
    | SmartCollectionSortOption // Smart collection sort option
    | undefined;
  readonly customDays?: number; // Number of days for Tautulli collections
  readonly minimumPlays?: number; // Minimum play count for Tautulli collections (defaults to 3 if not set, 1-100)
  readonly tautulliStatType?: 'plays' | 'duration'; // Tautulli stat type
  // Placeholder settings (for createPlaceholdersForMissing feature - unified for all collection types)
  readonly createPlaceholdersForMissing?: boolean; // Create placeholder files for missing items
  readonly placeholderReleasedDays?: number; // Days to keep orphaned placeholders after they fall off source list (from release date if released, otherwise from creation date) (default: 7)
  readonly placeholderDaysAhead?: number; // Days to look ahead for release dates (default: 360)
  readonly includeAllReleasedItems?: boolean; // If true, include all released items regardless of release date (default: true for new configs)
  // Placeholder filter settings (independent of auto-request filters)
  readonly placeholderMinimumYear?: number;
  readonly placeholderMinimumImdbRating?: number;
  readonly placeholderMinimumRottenTomatoesRating?: number;
  readonly placeholderMinimumRottenTomatoesAudienceRating?: number;
  readonly placeholderFilterSettings?: {
    readonly genres?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
    readonly countries?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly languages?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly keywords?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
  };
  readonly applyOverlaysDuringSync?: boolean; // Apply overlays immediately after sync (default: true for Coming Soon)
  // Download mode settings
  readonly downloadMode?: 'overseerr' | 'direct'; // Download mode: overseerr (requests) or direct (*arr)
  readonly searchMissingMovies?: boolean; // Auto-request missing movies
  readonly searchMissingTV?: boolean; // Auto-request missing TV shows
  readonly autoApproveMovies?: boolean; // Auto-approve movie requests
  readonly autoApproveTV?: boolean; // Auto-approve TV show requests
  readonly maxSeasonsToRequest?: number; // Max seasons for auto-approval
  readonly seasonsPerShowLimit?: number; // Limit each TV show to only the first X seasons (0 = all seasons)
  readonly seasonGrabOrder?: SeasonGrabOrder; // Order to grab seasons: first, latest, or airing (default: 'first')
  readonly maxPositionToProcess?: number; // Only process items in positions 1-X (0 = no limit)
  readonly minimumYear?: number; // Only process movies/TV shows released on or after this year (0 = no limit)
  readonly minimumImdbRating?: number; // Only process movies/TV shows with IMDb rating >= this value (0 = no limit)
  readonly minimumRottenTomatoesRating?: number; // Only process movies/TV shows with Rotten Tomatoes critics score >= this value (0 = no limit)
  readonly minimumRottenTomatoesAudienceRating?: number; // Only process movies/TV shows with Rotten Tomatoes audience score >= this value (0 = no limit)
  readonly filterSettings?: {
    readonly genres?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
    readonly countries?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly languages?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly keywords?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
  };
  // Direct download server selection (for downloadMode: 'direct')
  readonly directDownloadRadarrServerId?: number; // Selected Radarr server ID for movies
  readonly directDownloadRadarrProfileId?: number; // Selected Radarr profile ID for movies
  readonly directDownloadRadarrRootFolder?: string; // Selected Radarr root folder path for movies
  readonly directDownloadRadarrTags?: number[]; // Selected Radarr tags for movies
  readonly directDownloadRadarrMonitor?: boolean; // Override Radarr monitor setting for movies
  readonly directDownloadRadarrSearchOnAdd?: boolean; // Override Radarr search on add setting for movies
  readonly directDownloadSonarrServerId?: number; // Selected Sonarr server ID for TV shows
  readonly directDownloadSonarrProfileId?: number; // Selected Sonarr profile ID for TV shows
  readonly directDownloadSonarrRootFolder?: string; // Selected Sonarr root folder path for TV shows
  readonly directDownloadSonarrTags?: number[]; // Selected Sonarr tags for TV shows
  readonly directDownloadSonarrMonitor?: boolean; // Override Sonarr monitor setting for TV shows (deprecated, use monitorType)
  readonly directDownloadSonarrMonitorType?: SonarrMonitorType; // Override Sonarr monitor type for TV shows
  readonly directDownloadSonarrSearchOnAdd?: boolean; // Override Sonarr search on add setting for TV shows
  // Overseerr request configuration (for downloadMode: 'overseerr')
  readonly overseerrRadarrServerId?: number; // Override Radarr server ID for Overseerr movie requests
  readonly overseerrRadarrProfileId?: number; // Override Radarr profile ID for Overseerr movie requests
  readonly overseerrRadarrRootFolder?: string; // Override Radarr root folder path for Overseerr movie requests
  readonly overseerrRadarrTags?: number[]; // Override Radarr tags for Overseerr movie requests
  readonly overseerrSonarrServerId?: number; // Override Sonarr server ID for Overseerr TV requests
  readonly overseerrSonarrProfileId?: number; // Override Sonarr profile ID for Overseerr TV requests
  readonly overseerrSonarrRootFolder?: string; // Override Sonarr root folder path for Overseerr TV requests
  readonly overseerrSonarrTags?: number[]; // Override Sonarr tags for Overseerr TV requests
  // Trakt custom list fields
  readonly traktCustomListUrl?: string; // Custom Trakt list URL
  // TMDB custom list fields
  readonly tmdbCustomCollectionUrl?: string; // Custom TMDB list/collection URL
  // TMDB streaming service fields
  readonly watchProviderId?: number; // TMDB watch provider ID (e.g., 337 for Disney+)
  readonly region?: string; // Country region for streaming services (default: 'US')
  // TMDB discover sorting (for TMDB advanced_custom_tmdb advanced discover)
  readonly tmdbMovieSortBy?: string; // TMDB /discover/movie sort_by
  readonly tmdbTvSortBy?: string; // TMDB /discover/tv sort_by
  // TMDB advanced discover filters
  readonly tmdbAdvancedFilters?: TmdbAdvancedFilters;
  // IMDb custom list fields
  readonly imdbCustomListUrl?: string; // Custom IMDb list URL
  // Letterboxd custom list fields
  readonly letterboxdCustomListUrl?: string; // Custom Letterboxd list URL
  // Networks fields
  readonly networksCountry?: string; // Selected country for Networks collections
  // AniList custom list fields
  readonly anilistCustomListUrl?: string; // Custom AniList list URL
  // Radarr/Sonarr tag fields
  readonly radarrInstanceId?: number; // Selected Radarr instance ID for tag-based collections
  readonly sonarrInstanceId?: number; // Selected Sonarr instance ID for tag-based collections
  readonly radarrTagId?: number; // Selected Radarr tag ID for tag-based collections
  readonly sonarrTagId?: number; // Selected Sonarr tag ID for tag-based collections
  // Coming Soon "Monitored" server/tag filtering
  readonly comingSoonRadarrServerId?: number; // Selected Radarr server for coming soon monitored
  readonly comingSoonSonarrServerId?: number; // Selected Sonarr server for coming soon monitored
  readonly comingSoonFilterByTags?: boolean; // Enable tag filtering for coming soon monitored
  readonly comingSoonTagMode?: 'include' | 'exclude'; // Tag filter mode
  readonly comingSoonRadarrTagIds?: number[]; // Radarr tag IDs to filter by
  readonly comingSoonSonarrTagIds?: number[]; // Sonarr tag IDs to filter by
  // Generic ordering options (applicable to all collection types)
  readonly sortOrder?: CollectionSortOrder; // Sort order for collection items (default: 'default')
  // Unified person minimum items for plex/actors|directors
  readonly personMinimumItems?: number;
  // Plex Library separator settings for multi-collections (actors/directors)
  readonly useSeparator?: boolean; // Whether to create a separator collection for auto person collections
  readonly separatorTitle?: string; // Custom title for the separator collection
  // Collection exclusion settings
  readonly excludeFromCollections?: string[]; // Array of collection IDs to exclude items from (mutual exclusion)

  // Backend properties (from PlexHubConfig) - Present on hub configs from API
  readonly collectionType?: CollectionType; // Simplified categorization system
  readonly isUnlinked?: boolean; // True if this hub was deliberately unlinked
  everLibraryPromoted?: boolean; // True if this collection has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  readonly isPromotedToHub?: boolean; // True if collection exists as a promotable hub in Plex (appears in hub management list)

  // Hub-specific properties (present when config represents a hub)
  readonly hubIdentifier?: string; // Plex hub identifier (e.g., "movie.recentlyadded")

  // Poster settings
  readonly customPoster?: string | Record<string, string>; // Path to custom poster image file, or per-library poster mapping
  readonly autoPoster?: boolean; // Auto-generate poster during sync (only available for Overseerr user collections)
  readonly autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
  readonly useTmdbFranchisePoster?: boolean; // Use TMDB franchise poster instead of auto-generated poster (only for TMDB auto_franchise collections)
  readonly hideIndividualItems?: boolean; // Hide individual items, show collection (collectionMode = 1, supported for Coming Soon and TMDB auto_franchise collections)
  // Wallpaper, summary, and theme settings
  readonly customWallpaper?: string | Record<string, string>; // Path to custom wallpaper (art) image file, or per-library wallpaper mapping
  readonly customSummary?: string; // Custom summary/description text for the collection
  readonly customTheme?: string | Record<string, string>; // Path to custom theme music file, or per-library theme mapping
  readonly enableCustomWallpaper?: boolean; // Enable custom wallpaper sync to Plex
  readonly enableCustomSummary?: boolean; // Enable custom summary sync to Plex
  readonly enableCustomTheme?: boolean; // Enable custom theme sync to Plex
  // Time restriction settings
  readonly timeRestriction?: {
    readonly alwaysActive: boolean; // If true, collection is always active (default)
    readonly removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive (old behavior)
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    };
    readonly dateRanges?: readonly {
      readonly startDate: string; // DD-MM format (e.g., "05-12" for 5th December)
      readonly endDate: string; // DD-MM format (e.g., "26-12" for 26th December)
    }[];
    readonly weeklySchedule?: {
      readonly monday: boolean;
      readonly tuesday: boolean;
      readonly wednesday: boolean;
      readonly thursday: boolean;
      readonly friday: boolean;
      readonly saturday: boolean;
      readonly sunday: boolean;
    };
  };
}

/**
 * Collection configuration for creation requests
 * Excludes backend-computed fields like isActive
 * Matches CollectionConfigCreate OpenAPI schema
 */
export interface CollectionConfigCreateRequest {
  readonly id: string; // Empty string for new collections (backend assigns sequential number)
  readonly name: string; // User-entered collection name
  readonly type?:
    | 'overseerr'
    | 'tautulli'
    | 'trakt'
    | 'tmdb'
    | 'imdb'
    | 'letterboxd'
    | 'anilist'
    | 'myanimelist'
    | 'plex'
    | 'mdblist'
    | 'networks'
    | 'originals'
    | 'multi-source'
    | 'radarrtag'
    | 'sonarrtag'
    | 'comingsoon'
    | 'filtered_hub';
  readonly subtype?: string;
  readonly template?: string;
  readonly customMovieTemplate?: string;
  readonly customTVTemplate?: string;
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  // Note: isActive is NOT included - backend computes from timeRestriction
  readonly maxItems?: number;
  readonly mediaType?: MediaType;
  readonly libraryId?: string;
  readonly libraryName?: string;
  readonly libraryIds?: string[];
  readonly libraryNames?: string[];
  readonly sortOrderHome?: number;
  readonly sortOrderLibrary?: number;
  readonly randomizeHomeOrder?: boolean;
  readonly customDays?: number;
  readonly minimumPlays?: number;
  readonly tautulliStatType?: 'plays' | 'duration';
  // Placeholder settings (unified for all collection types)
  readonly createPlaceholdersForMissing?: boolean;
  readonly placeholderReleasedDays?: number;
  readonly placeholderDaysAhead?: number;
  readonly placeholderMinimumYear?: number;
  readonly placeholderMinimumImdbRating?: number;
  readonly placeholderMinimumRottenTomatoesRating?: number;
  readonly placeholderMinimumRottenTomatoesAudienceRating?: number;
  readonly placeholderFilterSettings?: {
    readonly genres?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
    readonly countries?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly languages?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly keywords?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
  };
  readonly includeAllReleasedItems?: boolean;
  readonly applyOverlaysDuringSync?: boolean;
  // Download mode settings
  readonly downloadMode?: 'overseerr' | 'direct';
  readonly searchMissingMovies?: boolean;
  readonly searchMissingTV?: boolean;
  readonly autoApproveMovies?: boolean;
  readonly autoApproveTV?: boolean;
  readonly maxSeasonsToRequest?: number;
  readonly seasonsPerShowLimit?: number;
  readonly seasonGrabOrder?: SeasonGrabOrder;
  readonly maxPositionToProcess?: number;
  readonly minimumYear?: number;
  readonly minimumImdbRating?: number;
  readonly minimumRottenTomatoesRating?: number;
  readonly minimumRottenTomatoesAudienceRating?: number;
  readonly filterSettings?: {
    readonly genres?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
    readonly countries?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly languages?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly keywords?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
  };
  // Direct download server selection (for downloadMode: 'direct')
  readonly directDownloadRadarrServerId?: number;
  readonly directDownloadRadarrProfileId?: number;
  readonly directDownloadRadarrRootFolder?: string;
  readonly directDownloadRadarrTags?: number[];
  readonly directDownloadRadarrMonitor?: boolean;
  readonly directDownloadRadarrSearchOnAdd?: boolean;
  readonly directDownloadSonarrServerId?: number;
  readonly directDownloadSonarrProfileId?: number;
  readonly directDownloadSonarrRootFolder?: string;
  readonly directDownloadSonarrTags?: number[];
  readonly directDownloadSonarrMonitor?: boolean;
  readonly directDownloadSonarrMonitorType?: SonarrMonitorType;
  readonly directDownloadSonarrSearchOnAdd?: boolean;
  // Overseerr request configuration (for downloadMode: 'overseerr')
  readonly overseerrRadarrServerId?: number;
  readonly overseerrRadarrProfileId?: number;
  readonly overseerrRadarrRootFolder?: string;
  readonly overseerrRadarrTags?: number[];
  readonly overseerrSonarrServerId?: number;
  readonly overseerrSonarrProfileId?: number;
  readonly overseerrSonarrRootFolder?: string;
  readonly overseerrSonarrTags?: number[];
  readonly traktCustomListUrl?: string;
  readonly tmdbCustomCollectionUrl?: string;
  readonly tmdbMovieSortBy?: string;
  readonly tmdbTvSortBy?: string;
  readonly tmdbAdvancedFilters?: Record<string, unknown>;
  readonly imdbCustomListUrl?: string;
  readonly letterboxdCustomListUrl?: string;
  readonly networksCountry?: string;
  readonly anilistCustomListUrl?: string;
  readonly radarrInstanceId?: number;
  readonly sonarrInstanceId?: number;
  readonly radarrTagId?: number;
  readonly sonarrTagId?: number;
  // Coming Soon "Monitored" server/tag filtering
  readonly comingSoonRadarrServerId?: number;
  readonly comingSoonSonarrServerId?: number;
  readonly comingSoonFilterByTags?: boolean;
  readonly comingSoonTagMode?: 'include' | 'exclude';
  readonly comingSoonRadarrTagIds?: number[];
  readonly comingSoonSonarrTagIds?: number[];
  readonly sortOrder?: CollectionSortOrder;
  // Unified person minimum items for plex actors/directors
  readonly personMinimumItems?: number;
  // Plex Library separator settings for auto person multi-collections
  readonly useSeparator?: boolean;
  readonly separatorTitle?: string;
  readonly excludeFromCollections?: string[];
  readonly timeRestriction?: {
    readonly alwaysActive: boolean;
    readonly removeFromPlexWhenInactive?: boolean;
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    };
    readonly dateRanges?: readonly {
      readonly startDate: string;
      readonly endDate: string;
    }[];
    readonly weeklySchedule?: {
      readonly monday: boolean;
      readonly tuesday: boolean;
      readonly wednesday: boolean;
      readonly thursday: boolean;
      readonly friday: boolean;
      readonly saturday: boolean;
      readonly sunday: boolean;
    };
  };
  readonly customPoster?: string | Record<string, string>;
  readonly autoPoster?: boolean; // Auto-generate poster during sync (only available for Overseerr user collections)
  readonly autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
  readonly useTmdbFranchisePoster?: boolean; // Use TMDB franchise poster instead of auto-generated poster (only for TMDB auto_franchise collections)
  readonly hideIndividualItems?: boolean; // Hide individual items, show collection (collectionMode = 1, supported for Coming Soon and TMDB auto_franchise collections)
  // Wallpaper, summary, and theme settings
  readonly customWallpaper?: string | Record<string, string>; // Path to custom wallpaper (art) image file, or per-library wallpaper mapping
  readonly customSummary?: string; // Custom summary/description text for the collection
  readonly customTheme?: string | Record<string, string>; // Path to custom theme music file, or per-library theme mapping
  readonly enableCustomWallpaper?: boolean; // Enable custom wallpaper sync to Plex
  readonly enableCustomSummary?: boolean; // Enable custom summary sync to Plex
  readonly enableCustomTheme?: boolean; // Enable custom theme sync to Plex
  readonly showUnwatchedOnly?: boolean; // If true, create a smart collection that filters to unwatched items only
  readonly smartCollectionSort?: SmartCollectionSortOption; // Sort option for smart collections
  readonly isMultiSource?: boolean;
  readonly sources?: readonly CollectionSourceConfig[];
  readonly combineMode?: MultiSourceCombineMode;
  readonly customSyncSchedule?: CustomSyncSchedule;
}

/**
 * Convert CollectionFormConfig to CollectionConfigCreateRequest
 * Strips out backend-computed fields for clean API calls
 */
export const toCollectionCreateRequest = (
  config: CollectionFormConfig
): CollectionConfigCreateRequest => {
  return {
    id: config.id || '', // Empty string for new collections
    name: config.name,
    type: config.type,
    subtype: config.subtype,
    template: config.template,
    customMovieTemplate: config.customMovieTemplate,
    customTVTemplate: config.customTVTemplate,
    visibilityConfig: config.visibilityConfig,
    // Explicitly exclude isActive - backend computes this
    maxItems: config.maxItems,
    mediaType: config.mediaType,
    libraryId: config.libraryId,
    libraryName: config.libraryName,
    libraryIds: config.libraryIds,
    libraryNames: config.libraryNames,
    sortOrderHome: config.sortOrderHome,
    sortOrderLibrary: config.sortOrderLibrary,
    randomizeHomeOrder: config.randomizeHomeOrder,
    customDays: config.customDays,
    minimumPlays: config.minimumPlays,
    tautulliStatType: config.tautulliStatType,
    createPlaceholdersForMissing: config.createPlaceholdersForMissing,
    placeholderReleasedDays: config.placeholderReleasedDays,
    placeholderDaysAhead: config.placeholderDaysAhead,
    placeholderMinimumYear: config.placeholderMinimumYear,
    placeholderMinimumImdbRating: config.placeholderMinimumImdbRating,
    placeholderMinimumRottenTomatoesRating:
      config.placeholderMinimumRottenTomatoesRating,
    placeholderMinimumRottenTomatoesAudienceRating:
      config.placeholderMinimumRottenTomatoesAudienceRating,
    placeholderFilterSettings: config.placeholderFilterSettings,
    includeAllReleasedItems: config.includeAllReleasedItems,
    applyOverlaysDuringSync: config.applyOverlaysDuringSync,
    downloadMode: config.downloadMode,
    searchMissingMovies: config.searchMissingMovies,
    searchMissingTV: config.searchMissingTV,
    autoApproveMovies: config.autoApproveMovies,
    autoApproveTV: config.autoApproveTV,
    maxSeasonsToRequest: config.maxSeasonsToRequest,
    seasonsPerShowLimit: config.seasonsPerShowLimit,
    seasonGrabOrder: config.seasonGrabOrder,
    maxPositionToProcess: config.maxPositionToProcess,
    minimumYear: config.minimumYear,
    minimumImdbRating: config.minimumImdbRating,
    minimumRottenTomatoesRating: config.minimumRottenTomatoesRating,
    minimumRottenTomatoesAudienceRating:
      config.minimumRottenTomatoesAudienceRating,
    filterSettings: config.filterSettings,
    directDownloadRadarrServerId: config.directDownloadRadarrServerId,
    directDownloadRadarrProfileId: config.directDownloadRadarrProfileId,
    directDownloadRadarrRootFolder: config.directDownloadRadarrRootFolder,
    directDownloadRadarrTags: config.directDownloadRadarrTags,
    directDownloadRadarrMonitor: config.directDownloadRadarrMonitor,
    directDownloadRadarrSearchOnAdd: config.directDownloadRadarrSearchOnAdd,
    directDownloadSonarrServerId: config.directDownloadSonarrServerId,
    directDownloadSonarrProfileId: config.directDownloadSonarrProfileId,
    directDownloadSonarrRootFolder: config.directDownloadSonarrRootFolder,
    directDownloadSonarrTags: config.directDownloadSonarrTags,
    directDownloadSonarrMonitor: config.directDownloadSonarrMonitor,
    directDownloadSonarrMonitorType: config.directDownloadSonarrMonitorType,
    directDownloadSonarrSearchOnAdd: config.directDownloadSonarrSearchOnAdd,
    overseerrRadarrServerId: config.overseerrRadarrServerId,
    overseerrRadarrProfileId: config.overseerrRadarrProfileId,
    overseerrRadarrRootFolder: config.overseerrRadarrRootFolder,
    overseerrRadarrTags: config.overseerrRadarrTags,
    overseerrSonarrServerId: config.overseerrSonarrServerId,
    overseerrSonarrProfileId: config.overseerrSonarrProfileId,
    overseerrSonarrRootFolder: config.overseerrSonarrRootFolder,
    overseerrSonarrTags: config.overseerrSonarrTags,
    traktCustomListUrl: config.traktCustomListUrl,
    tmdbCustomCollectionUrl: config.tmdbCustomCollectionUrl,
    tmdbMovieSortBy: config.tmdbMovieSortBy,
    tmdbTvSortBy: config.tmdbTvSortBy,
    tmdbAdvancedFilters: config.tmdbAdvancedFilters as unknown as
      | Record<string, unknown>
      | undefined,
    imdbCustomListUrl: config.imdbCustomListUrl,
    letterboxdCustomListUrl: config.letterboxdCustomListUrl,
    networksCountry: config.networksCountry,
    anilistCustomListUrl: config.anilistCustomListUrl,
    radarrInstanceId: config.radarrInstanceId,
    sonarrInstanceId: config.sonarrInstanceId,
    radarrTagId: config.radarrTagId,
    sonarrTagId: config.sonarrTagId,
    comingSoonRadarrServerId: config.comingSoonRadarrServerId,
    comingSoonSonarrServerId: config.comingSoonSonarrServerId,
    comingSoonFilterByTags: config.comingSoonFilterByTags,
    comingSoonTagMode: config.comingSoonTagMode,
    comingSoonRadarrTagIds: config.comingSoonRadarrTagIds,
    comingSoonSonarrTagIds: config.comingSoonSonarrTagIds,
    sortOrder: config.sortOrder,
    personMinimumItems: config.personMinimumItems,
    excludeFromCollections: config.excludeFromCollections,
    timeRestriction: config.timeRestriction,
    customPoster: config.customPoster,
    autoPoster: config.autoPoster,
    autoPosterTemplate: config.autoPosterTemplate,
    useSeparator: config.useSeparator,
    separatorTitle: config.separatorTitle,
    useTmdbFranchisePoster: config.useTmdbFranchisePoster,
    hideIndividualItems: config.hideIndividualItems,
    // Wallpaper, summary, and theme settings
    customWallpaper: config.customWallpaper,
    customSummary: config.customSummary,
    customTheme: config.customTheme,
    enableCustomWallpaper: config.enableCustomWallpaper,
    enableCustomSummary: config.enableCustomSummary,
    enableCustomTheme: config.enableCustomTheme,
    // Smart collection support
    showUnwatchedOnly: config.showUnwatchedOnly,
    smartCollectionSort: config.smartCollectionSort,
    // Multi-source fields
    isMultiSource: config.isMultiSource,
    sources: config.sources,
    combineMode: config.combineMode,
    customSyncSchedule: config.customSyncSchedule,
  };
};

/**
 * CollectionFormConfig with additional metadata for form editing
 * These properties are computed/added when configs are passed to forms
 */
export interface CollectionFormConfigForEditing extends CollectionFormConfig {
  readonly libraryIds?: string[]; // Temporary field for form UI when editing linked configs
  readonly libraryNames?: string[]; // Temporary field for form UI when editing linked configs
}

/**
 * Simple hash function to convert hubIdentifier strings to consistent numeric group IDs
 */
export function hash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) + 1000; // Add 1000 to avoid conflicts with user collection group IDs
}

/**
 * Utility functions for determining collection states
 * These replace the inconsistent computed properties
 */
export const CollectionFormConfigUtils = {
  /**
   * Check if this is a pre-existing (user-created) collection
   */
  isPreExisting: (config: CollectionFormConfig): boolean => {
    return config.collectionType === CollectionType.PRE_EXISTING;
  },

  /**
   * Check if this is a built-in Plex hub
   */
  isDefaultPlexHub: (config: CollectionFormConfig): boolean => {
    return config.collectionType === CollectionType.DEFAULT_PLEX_HUB;
  },

  /**
   * Check if enhanced form should be shown
   * Enhanced form is shown for: pre-existing collections, default Plex hubs, or linked configs
   */
  shouldShowEnhancedForm: (config: CollectionFormConfigForEditing): boolean => {
    return (
      CollectionFormConfigUtils.isPreExisting(config) ||
      CollectionFormConfigUtils.isDefaultPlexHub(config) ||
      Boolean(config.isLinked)
    );
  },

  /**
   * Check if collection can be linked to other libraries
   */
  canLinkCollection: (config: CollectionFormConfigForEditing): boolean => {
    // Can't link if already linked
    if (config.isLinked) return false;

    // Pre-existing collections cannot be linked - they're existing Plex collections not created by us
    if (CollectionFormConfigUtils.isPreExisting(config)) return false;

    // Allow linking for Agregarr-created collections and default Plex hubs
    return true;
  },
};

export interface TemplatePreset {
  label: string;
  value: string;
}

export interface VisibilityCheckboxState {
  enabled: boolean;
  label: string;
  description?: string;
}

export interface SubtypeOption {
  label: string;
  value: string;
  description?: string;
}

export interface Library {
  readonly key: string;
  readonly name: string;
  readonly type: 'movie' | 'show';
}

export interface CollectionConfigFormProps {
  config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig;
  onSave: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  onCancel: () => void;
  onUnlink?: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  onLink?: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  isEditing?: boolean;
  libraries: Library[];
  // Additional data needed for link/unlink detection
  allCollectionConfigs?: CollectionFormConfig[];
  allHubConfigs?: PlexHubConfig[];
}

export interface CollectionSettingsProps {
  libraries?: Library[]; // Optional - component can fetch directly from Plex
  onUpdateConfigs: (configs: CollectionFormConfig[]) => void;
  filterTab?: 'home' | 'recommended' | 'library'; // Filter to show only specific tab content
}

// PlexHubConfig is now defined above to match the server interface while avoiding client-side imports

export type CollectionSourceType =
  | 'overseerr'
  | 'tautulli'
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'networks'
  | 'originals'
  | 'anilist'
  | 'myanimelist'
  | 'plex'
  | 'multi-source'
  | 'radarrtag'
  | 'sonarrtag'
  | 'comingsoon'
  | 'filtered_hub';
export type MediaType = 'movie' | 'tv';

/**
 * Season grab order modes for TV shows
 */
export type SeasonGrabOrder = 'first' | 'latest' | 'airing';

/**
 * Smart Collection Sort Options
 */
export interface SmartCollectionSortOption {
  readonly value: string; // The sort parameter value (e.g., 'year:desc', 'titleSort', 'rating:desc')
  readonly label: string; // Human-readable label for the dropdown
}

/**
 * Available smart collection sort options
 */
export const SMART_COLLECTION_SORT_OPTIONS: readonly SmartCollectionSortOption[] =
  [
    { value: 'titleSort', label: 'Title (A-Z)' },
    { value: 'titleSort:desc', label: 'Title (Z-A)' },
    { value: 'year', label: 'Year (Oldest First)' },
    { value: 'year:desc', label: 'Year (Newest First)' },
    { value: 'originallyAvailableAt', label: 'Release Date (Oldest First)' },
    {
      value: 'originallyAvailableAt:desc',
      label: 'Release Date (Newest First)',
    },
    { value: 'rating', label: 'Rating (Lowest First)' },
    { value: 'rating:desc', label: 'Rating (Highest First)' },
    { value: 'audienceRating', label: 'Audience Rating (Lowest First)' },
    { value: 'audienceRating:desc', label: 'Audience Rating (Highest First)' },
    { value: 'userRating', label: 'User Rating (Lowest First)' },
    { value: 'userRating:desc', label: 'User Rating (Highest First)' },
    { value: 'contentRating', label: 'Content Rating (Lowest First)' },
    { value: 'contentRating:desc', label: 'Content Rating (Highest First)' },
    { value: 'duration', label: 'Duration (Shortest First)' },
    { value: 'duration:desc', label: 'Duration (Longest First)' },
    { value: 'viewOffset', label: 'Progress (Least Watched)' },
    { value: 'viewOffset:desc', label: 'Progress (Most Watched)' },
    { value: 'viewCount', label: 'View Count (Least Watched)' },
    { value: 'viewCount:desc', label: 'View Count (Most Watched)' },
    { value: 'addedAt', label: 'Date Added (Oldest First)' },
    { value: 'addedAt:desc', label: 'Date Added (Newest First)' },
    { value: 'lastViewedAt', label: 'Last Viewed (Oldest First)' },
    { value: 'lastViewedAt:desc', label: 'Last Viewed (Newest First)' },
    { value: 'mediaHeight', label: 'Resolution (Lowest First)' },
    { value: 'mediaHeight:desc', label: 'Resolution (Highest First)' },
    { value: 'mediaBitrate', label: 'Bitrate (Lowest First)' },
    { value: 'mediaBitrate:desc', label: 'Bitrate (Highest First)' },
    { value: 'random', label: 'Random' },
    { value: 'random:desc', label: 'Random (Reverse)' },
  ] as const;

/**
 * Collection config for API submission - excludes read-only fields computed by backend
 */
export type CollectionConfigForSubmission = Omit<
  CollectionFormConfig,
  'isActive' | 'missing'
>;

/**
 * Hub config for API submission - excludes only truly computed fields
 * isActive is computed by backend based on time restrictions and current time
 * collectionType is determined during discovery
 * missing is computed during validation/discovery
 * All other fields (including isLinked/linkId) should be preserved
 */
export type PlexHubConfigForSubmission = Omit<
  PlexHubConfig,
  'isActive' | 'collectionType' | 'missing'
>;

/**
 * Pre-existing collection config for API submission - excludes only truly computed fields
 * isActive is computed by backend based on time restrictions and current time
 * collectionType is determined during discovery
 * missing is computed during validation/discovery
 * All other fields (including isLinked/linkId) should be preserved
 */
export type PreExistingCollectionConfigForSubmission = Omit<
  PreExistingCollectionConfig,
  'isActive' | 'collectionType' | 'missing'
>;

/**
 * Multi-Source Collection Configuration Types
 * Support for collections that combine multiple list sources
 */

/**
 * Individual source configuration for multi-source collections
 */
export interface CollectionSourceConfig {
  readonly id: string; // Unique identifier for this source within the collection
  readonly type: CollectionSourceType;
  readonly subtype?: string;
  readonly customUrl?: string; // For custom lists (Trakt, TMDB, IMDb, Letterboxd)
  readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
  readonly priority: number; // Order priority when combining (0 = highest)
  readonly isExpanded?: boolean; // UI state for expandable sections

  // Tautulli-specific configuration (per source)
  readonly customDays?: number; // Number of days to look back for statistics
  readonly minimumPlays?: number; // Minimum play count required
  // Networks-specific configuration
  readonly networksCountry?: string; // Selected country for Networks collections
  // Radarr/Sonarr tag source configuration
  readonly radarrTagServerId?: number;
  readonly radarrTagId?: number;
  readonly radarrTagLabel?: string;
  readonly sonarrTagServerId?: number;
  readonly sonarrTagId?: number;
  readonly sonarrTagLabel?: string;
}

/**
 * Multi-source combining modes
 */
export type MultiSourceCombineMode =
  | 'interleaved'
  | 'list_order'
  | 'randomised'
  | 'cycle_lists';

/**
 * Sync schedule preset options
 */
export const SYNC_SCHEDULE_PRESETS = [
  { key: '10m', label: 'Every 10 minutes', intervalHours: 1 / 6 },
  { key: '15m', label: 'Every 15 minutes', intervalHours: 1 / 4 },
  { key: '30m', label: 'Every 30 minutes', intervalHours: 0.5 },
  { key: '1h', label: 'Every hour', intervalHours: 1 },
  { key: '2h', label: 'Every 2 hours', intervalHours: 2 },
  { key: '3h', label: 'Every 3 hours', intervalHours: 3 },
  { key: '6h', label: 'Every 6 hours', intervalHours: 6 },
  { key: '12h', label: 'Every 12 hours', intervalHours: 12 },
  { key: '1d', label: 'Once daily', intervalHours: 24 },
  { key: '2d', label: 'Every 2 days', intervalHours: 48 },
  { key: '3d', label: 'Every 3 days', intervalHours: 72 },
  { key: '1w', label: 'Once weekly', intervalHours: 168 },
  { key: '2w', label: 'Every 2 weeks', intervalHours: 336 },
  { key: '1m', label: 'Once monthly', intervalHours: 720 }, // ~30 days
  { key: '3m', label: 'Every 3 months', intervalHours: 2160 }, // ~90 days
  { key: '6m', label: 'Every 6 months', intervalHours: 4320 }, // ~180 days
  { key: '1y', label: 'Once yearly', intervalHours: 8760 }, // ~365 days
] as const;

/**
 * Custom sync schedule configuration
 */
export interface CustomSyncSchedule {
  readonly enabled: boolean;
  readonly scheduleType: 'preset' | 'custom'; // Type of schedule: preset dropdown or custom cron
  readonly intervalHours?: number; // Legacy field for backward compatibility (when scheduleType === 'preset')
  readonly preset?: string; // Preset option key (e.g., '10m', '30m', '1h', '6h', '1d', '1w')
  readonly customCron?: string; // Custom cron expression (when scheduleType === 'custom')
  readonly startNow: boolean; // If true, start immediately; if false, use startDate
  readonly startDate?: string; // Start date in DD-MM format (e.g., "01-01" for January 1st)
  readonly startTime?: string; // Start time in HH:MM format (e.g., "09:00")
  firstSyncAt?: string; // ISO timestamp of when this schedule was first created (for persistence across restarts) - mutable for system updates
}

/**
 * Distinct multi-source collection configuration type
 * According to Orchestrator Method plan: multi-source is a separate collection type
 */
export interface MultiSourceCollectionConfig {
  // Copy essential fields from CollectionFormConfig
  readonly id: string;
  readonly name: string;
  readonly type: 'multi-source'; // Distinct type
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  readonly mediaType?: 'movie' | 'tv';
  readonly libraryId: string;
  readonly libraryName: string;
  readonly libraryIds?: string[]; // Temporary field for form UI when editing linked configs
  readonly libraryNames?: string[]; // Temporary field for form UI when editing linked configs
  readonly maxItems?: number;
  readonly template?: string;
  // Multi-source specific fields
  readonly sources: readonly SourceDefinition[]; // Required sources array
  readonly combineMode: MultiSourceCombineMode; // Required combine mode
  readonly customSyncSchedule?: CustomSyncSchedule;
  // Optional fields from parent
  readonly isActive?: boolean;
  readonly sortOrderHome?: number;
  readonly sortOrderLibrary?: number;
  readonly isLibraryPromoted?: boolean;
  readonly timeRestriction?: {
    readonly alwaysActive: boolean;
    readonly removeFromPlexWhenInactive?: boolean;
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    };
  };
  readonly customPoster?: string | Record<string, string>;
  readonly autoPoster?: boolean;
  // Placeholder creation settings (shared with CollectionConfig)
  readonly createPlaceholdersForMissing?: boolean;
  readonly placeholderDaysAhead?: number;
  readonly placeholderReleasedDays?: number;
  readonly includeAllReleasedItems?: boolean;
  // Placeholder filter settings (independent of auto-request filters)
  readonly placeholderMinimumYear?: number;
  readonly placeholderMinimumImdbRating?: number;
  readonly placeholderMinimumRottenTomatoesRating?: number;
  readonly placeholderMinimumRottenTomatoesAudienceRating?: number;
  readonly placeholderFilterSettings?: {
    readonly genres?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
    readonly countries?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly languages?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly keywords?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
  };
  // Missing items / auto-download settings (same as CollectionConfig)
  readonly downloadMode?: 'overseerr' | 'direct';
  readonly searchMissingMovies?: boolean;
  readonly searchMissingTV?: boolean;
  readonly autoApproveMovies?: boolean;
  readonly autoApproveTV?: boolean;
  readonly maxSeasonsToRequest?: number;
  readonly seasonsPerShowLimit?: number;
  readonly seasonGrabOrder?: SeasonGrabOrder;
  readonly maxPositionToProcess?: number;
  readonly minimumYear?: number;
  readonly filterSettings?: {
    readonly genres?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
    readonly countries?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly languages?: {
      readonly mode: 'exclude' | 'include';
      readonly values: string[];
    };
    readonly keywords?: {
      readonly mode: 'exclude' | 'include';
      readonly values: number[];
    };
  };
  readonly directDownloadRadarrServerId?: number;
  readonly directDownloadRadarrProfileId?: number;
  readonly directDownloadRadarrRootFolder?: string;
  readonly directDownloadRadarrTags?: number[];
  readonly directDownloadRadarrMonitor?: boolean;
  readonly directDownloadRadarrSearchOnAdd?: boolean;
  readonly directDownloadSonarrServerId?: number;
  readonly directDownloadSonarrProfileId?: number;
  readonly directDownloadSonarrRootFolder?: string;
  readonly directDownloadSonarrTags?: number[];
  readonly directDownloadSonarrMonitor?: boolean;
  readonly directDownloadSonarrMonitorType?: SonarrMonitorType;
  readonly directDownloadSonarrSearchOnAdd?: boolean;
  readonly overseerrRadarrServerId?: number;
  readonly overseerrRadarrProfileId?: number;
  readonly overseerrRadarrRootFolder?: string;
  readonly overseerrRadarrTags?: number[];
  readonly overseerrSonarrServerId?: number;
  readonly overseerrSonarrProfileId?: number;
  readonly overseerrSonarrRootFolder?: string;
  readonly overseerrSonarrTags?: number[];
}

/**
 * Valid source types for multi-source collections (excludes 'hub' and 'multi-source')
 */
export type MultiSourceType =
  | 'trakt'
  | 'tmdb'
  | 'imdb'
  | 'letterboxd'
  | 'mdblist'
  | 'tautulli'
  | 'overseerr'
  | 'networks'
  | 'originals'
  | 'radarrtag'
  | 'sonarrtag'
  | 'anilist'
  | 'myanimelist'
  | 'comingsoon'
  | 'filtered_hub';

/**
 * Source definition for multi-source collections
 * Alias for CollectionSourceConfig with stricter typing
 */
export interface SourceDefinition {
  readonly id: string;
  readonly type: MultiSourceType;
  readonly subtype: string;
  readonly customUrl?: string;
  readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
  readonly customDays?: number;
  readonly minimumPlays?: number;
  readonly priority: number;
  readonly networksCountry?: string; // Selected country for Networks collections
  readonly radarrTagServerId?: number; // Radarr instance ID for radarrtag source
  readonly radarrTagId?: number; // Radarr tag ID for radarrtag source
  readonly radarrTagLabel?: string; // Radarr tag label for display
  readonly sonarrTagServerId?: number; // Sonarr instance ID for sonarrtag source
  readonly sonarrTagId?: number; // Sonarr tag ID for sonarrtag source
  readonly sonarrTagLabel?: string; // Sonarr tag label for display
}

/**
 * Extended CollectionFormConfig with multi-source support (backward compatibility)
 * Uses intersection type to avoid index signature conflicts
 */
export type MultiSourceCollectionFormConfig = CollectionFormConfig & {
  readonly isMultiSource?: boolean; // Enable multi-source mode
  readonly sources?: readonly CollectionSourceConfig[]; // Array of source configurations
  readonly combineMode?: MultiSourceCombineMode; // How to combine multiple sources
  readonly customSyncSchedule?: CustomSyncSchedule; // Individual sync timing
};

/**
 * Extended CollectionConfigCreateRequest with multi-source support
 */
export interface MultiSourceCollectionConfigCreateRequest
  extends CollectionConfigCreateRequest {
  readonly isMultiSource?: boolean;
  readonly sources?: readonly CollectionSourceConfig[];
  readonly combineMode?: MultiSourceCombineMode;
  readonly customSyncSchedule?: CustomSyncSchedule;
}
