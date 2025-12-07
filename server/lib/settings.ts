import { defaultHubConfigService } from '@server/lib/collections/services/DefaultHubConfigService';
import { preExistingCollectionConfigService } from '@server/lib/collections/services/PreExistingCollectionConfigService';
import logger from '@server/logger';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { merge } from 'lodash';
import path from 'path';

export enum CollectionType {
  DEFAULT_PLEX_HUB = 'default_plex_hub', // Built-in Plex algorithmic hubs
  AGREGARR_CREATED = 'agregarr_created', // Agregarr-managed collections
  PRE_EXISTING = 'pre_existing', // Pre-existing Plex collections
}

/**
 * Season grab order modes for TV shows
 */
export type SeasonGrabOrder = 'first' | 'latest' | 'airing';

/**
 * Sort order options for collection items
 */
export type CollectionSortOrder =
  | 'default' // As provided by source
  | 'reverse' // Reverse source order
  | 'random' // Fisher-Yates shuffle
  | 'imdb_rating_desc' // Highest to lowest IMDb rating
  | 'imdb_rating_asc'; // Lowest to highest IMDb rating

export interface Library {
  readonly key: string;
  readonly name: string;
  readonly type: 'show' | 'movie';
  readonly lastScan?: number;
}

/**
 * Smart Collection Sort Options
 */
export interface SmartCollectionSortOption {
  readonly value: string; // The sort parameter value (e.g., 'year:desc', 'titleSort', 'rating:desc')
  readonly label: string; // Human-readable label for the dropdown
}

export interface CollectionConfig {
  readonly id: string;
  readonly name: string;
  readonly type:
    | 'overseerr'
    | 'tautulli'
    | 'trakt'
    | 'tmdb'
    | 'imdb'
    | 'letterboxd'
    | 'mdblist'
    | 'networks'
    | 'originals'
    | 'myanimelist'
    | 'anilist'
    | 'plex_library'
    | 'multi-source'
    | 'radarrtag'
    | 'sonarrtag'
    | 'comingsoon'
    | 'filtered_hub';
  readonly subtype?: string; // Specific option like 'users', 'most_popular_plays', 'most_popular_duration', etc. Optional for types like recently_added
  readonly template: string; // Collection template
  readonly customMovieTemplate?: string; // Custom template for movie collections when mediaType is 'both'
  readonly customTVTemplate?: string; // Custom template for TV collections when mediaType is 'both'
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  readonly isActive: boolean; // Whether collection is currently active (time restrictions met)
  readonly missing?: boolean; // True if collection no longer exists in Plex
  // Sync status tracking fields
  readonly lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  readonly lastModifiedAt?: string; // ISO string timestamp when config was last modified
  readonly needsSync?: boolean; // true if modified since last sync
  readonly maxItems: number;
  readonly customDays?: number; // Number of days for Tautulli collections (required for Tautulli type)
  readonly minimumPlays?: number; // Minimum play count for Tautulli collections (defaults to 3 if not set, 1-100)
  readonly libraryId: string; // Library ID this collection belongs to
  readonly libraryName: string; // Library name for display
  readonly sortOrderHome?: number; // Order for Plex home screen (1+ for positioned items, 0 for void/unpositioned)
  readonly sortOrderLibrary?: number; // Order for Plex library tab (0 for A-Z section, 1+ for promoted section)
  readonly isLibraryPromoted?: boolean; // true = promoted section (uses exclamation marks), false = A-Z section (defaults to true for Agregarr collections)
  readonly randomizeHomeOrder?: boolean; // If true, randomize position amongst other randomized items on home screen
  readonly isLinked?: boolean; // True if collection is actively linked to other collections
  readonly linkId?: number; // Group ID for linked collections (preserved even when isLinked=false)
  readonly isUnlinked?: boolean; // True if this collection was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this collection has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  readonly isPromotedToHub?: boolean; // True if collection exists as a promotable hub in Plex (appears in hub management list)
  readonly collectionRatingKey?: string; // Plex collection rating key (when created)
  readonly showUnwatchedOnly?: boolean; // If true, create a smart collection that filters to unwatched items only
  readonly smartCollectionRatingKey?: string; // LEGACY: Old dual-collection system smart collection rating key (for migration only)
  readonly smartCollectionSort?: SmartCollectionSortOption; // Sort option for smart collections
  // Custom URL fields for external collections
  readonly tmdbCustomCollectionUrl?: string;
  // Trakt-specific fields
  readonly timePeriod?: string;
  readonly traktStatType?: 'trending' | 'popular' | 'watched';
  readonly tautulliStatType?: 'plays' | 'duration'; // Tautulli stat type: plays or duration
  // Download mode - either Overseerr requests OR direct *arr download (not both)
  readonly downloadMode?: 'overseerr' | 'direct'; // Download mode: 'overseerr' = create requests (default), 'direct' = download directly to *arr

  // Common auto-download settings (apply to both modes)
  readonly searchMissingMovies?: boolean; // Auto-handle missing movies
  readonly searchMissingTV?: boolean; // Auto-handle missing TV shows
  readonly autoApproveMovies?: boolean; // Auto-approve/download movies
  readonly autoApproveTV?: boolean; // Auto-approve/download TV shows
  readonly maxSeasonsToRequest?: number; // Max seasons for auto-approval/download (TV shows with more seasons require manual approval or are skipped)
  readonly seasonsPerShowLimit?: number; // Limit each TV show to only the first X seasons (0 = all seasons)
  readonly seasonGrabOrder?: SeasonGrabOrder; // Order to grab seasons: first, latest, or airing (default: 'first')
  readonly maxPositionToProcess?: number; // Only process items in positions 1-X of the list (0 = no limit)
  readonly minimumYear?: number; // Only process movies/TV shows released on or after this year (0 = no limit)
  readonly minimumImdbRating?: number; // Only process movies/TV shows with IMDb rating >= this value (0 = no limit)
  readonly minimumRottenTomatoesRating?: number; // Only process movies/TV shows with Rotten Tomatoes critics score >= this value (0 = no limit)
  readonly excludedGenres?: number[]; // @deprecated Use filterSettings.genres - Exclude items with these TMDB genre IDs from missing items search
  readonly excludedCountries?: string[]; // @deprecated Use filterSettings.countries - Exclude items with these ISO 3166-1 country codes from missing items search
  readonly excludedLanguages?: string[]; // @deprecated Use filterSettings.languages - Exclude items with these ISO 639-1 language codes from missing items search
  // New unified filter settings with include/exclude modes
  readonly filterSettings?: {
    readonly genres?: {
      readonly mode: 'exclude' | 'include'; // Default: 'exclude'
      readonly values: number[]; // TMDB genre IDs
    };
    readonly countries?: {
      readonly mode: 'exclude' | 'include'; // Default: 'exclude'
      readonly values: string[]; // ISO 3166-1 country codes
    };
    readonly languages?: {
      readonly mode: 'exclude' | 'include'; // Default: 'exclude'
      readonly values: string[]; // ISO 639-1 language codes
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
  readonly directDownloadSonarrMonitor?: boolean; // Override Sonarr monitor setting for TV shows
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
  readonly traktCustomListUrl?: string; // Custom Trakt list URL (e.g., https://trakt.tv/users/username/lists/list-name or https://trakt.tv/lists/official/collection-name)
  // IMDb custom list fields
  readonly imdbCustomListUrl?: string; // Custom IMDb list URL (e.g., https://www.imdb.com/list/ls123456789/)
  // Letterboxd custom list fields
  readonly letterboxdCustomListUrl?: string; // Custom Letterboxd list URL (e.g., https://letterboxd.com/username/list/list-name/)
  // MDBList custom list fields
  readonly mdblistCustomListUrl?: string; // Custom MDBList list URL (e.g., https://mdblist.com/lists/123456 or https://mdblist.com/lists/username/list-name)
  // Networks (FlixPatrol) fields
  readonly networksCountry?: string; // Country/region for Networks collections (e.g., 'world', 'us', 'uk')
  // AniList custom list fields
  readonly anilistCustomListUrl?: string; // Custom AniList list URL
  // Radarr/Sonarr tag fields
  readonly radarrTagId?: number; // Selected Radarr tag ID for tag-based collections
  readonly radarrInstanceId?: number; // Selected Radarr instance ID for tag-based collections
  readonly sonarrTagId?: number; // Selected Sonarr tag ID for tag-based collections
  readonly sonarrInstanceId?: number; // Selected Sonarr instance ID for tag-based collections
  // Generic ordering options (applicable to all collection types)
  readonly sortOrder?: CollectionSortOrder; // Sort order for collection items (default: 'default')
  // Plex Library director settings (for plex_library/directors)
  readonly directorMinimumItems?: number; // Minimum items required to create a director collection (default: 3)
  // Collection exclusion settings
  readonly excludeFromCollections?: string[]; // Array of collection IDs to exclude items from (mutual exclusion)
  // Poster settings
  readonly customPoster?: string | Record<string, string>; // Path to custom poster image file, or per-library poster mapping
  readonly autoPoster?: boolean; // Auto-generate poster during sync (only available for Overseerr user collections)
  readonly autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
  readonly useTmdbFranchisePoster?: boolean; // Use TMDB franchise poster instead of auto-generated poster (only for TMDB auto_franchise collections)
  readonly useTmdbDirectorPoster?: boolean; // Use TMDB director poster instead of auto-generated poster (only for plex_library/directors collections)
  readonly hideIndividualItems?: boolean; // Hide individual items, show collection (collectionMode = 1, only for TMDB auto_franchise collections)
  // Wallpaper, summary, and theme settings
  readonly customWallpaper?: string | Record<string, string>; // Path to custom wallpaper (art) image file, or per-library wallpaper mapping
  readonly customSummary?: string; // Custom summary/description text for the collection
  readonly customTheme?: string | Record<string, string>; // Path to custom theme music file, or per-library theme mapping
  readonly enableCustomWallpaper?: boolean; // Enable custom wallpaper sync to Plex
  readonly enableCustomSummary?: boolean; // Enable custom summary sync to Plex
  readonly enableCustomTheme?: boolean; // Enable custom theme sync to Plex
  // Placeholder settings (for createPlaceholdersForMissing feature)
  readonly createPlaceholdersForMissing?: boolean; // If true, create placeholder files in Plex for missing items instead of auto-requesting
  readonly placeholderReleasedDays?: number; // Days to keep released items with overlay (default: 7). After this window, original posters are restored.
  readonly placeholderDaysAhead?: number; // Number of days to look ahead for release dates (default: 360)
  // Legacy Coming Soon fields (for backward compatibility during migration)
  readonly comingSoonReleasedDays?: number; // @deprecated Use placeholderReleasedDays
  readonly comingSoonDays?: number; // @deprecated Use placeholderDaysAhead
  // Overlay sync option
  readonly applyOverlaysDuringSync?: boolean; // If true, apply overlays to collection items immediately after sync (default: true for Coming Soon, false for others)
  // Time restriction settings
  readonly timeRestriction?: {
    readonly alwaysActive: boolean; // If true, collection is always active (default)
    readonly removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive (old behavior)
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    }; // Visibility settings to use when collection is inactive (only used if removeFromPlexWhenInactive is false)
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
  // Multi-source specific properties (only present when type === 'multi-source')
  readonly isMultiSource?: boolean; // Enable multi-source mode
  readonly sources?: readonly {
    readonly id: string;
    readonly type: string;
    readonly subtype?: string;
    readonly customUrl?: string;
    readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
    readonly priority: number;
    readonly isExpanded?: boolean; // UI state for expandable sections
    readonly customDays?: number;
    readonly minimumPlays?: number;
    readonly networksCountry?: string; // Selected country for Networks collections
    readonly radarrTagServerId?: number; // Radarr instance ID for radarrtag sources
    readonly radarrTagId?: number; // Radarr tag ID for radarrtag sources
    readonly radarrTagLabel?: string; // Radarr tag label for display
    readonly sonarrTagServerId?: number; // Sonarr instance ID for sonarrtag sources
    readonly sonarrTagId?: number; // Sonarr tag ID for sonarrtag sources
    readonly sonarrTagLabel?: string; // Sonarr tag label for display
  }[];
  readonly combineMode?:
    | 'interleaved'
    | 'list_order'
    | 'randomised'
    | 'cycle_lists';
  // Individual sync scheduling
  readonly customSyncSchedule?: CustomSyncSchedule;
}

/**
 * Configuration for Plex built-in hubs (Recently Added, Continue Watching, etc.)
 */
export interface PlexHubConfig {
  id: string; // Generated unique identifier
  hubIdentifier: string; // Plex hub identifier (e.g., "movie.recentlyadded")
  name: string; // Display name (e.g., "Recently Added Movies")
  libraryId: string; // Library ID this hub belongs to
  libraryName: string; // Library display name
  mediaType: 'movie' | 'tv'; // Media type (hubs are always single type)
  sortOrderHome: number; // Position on Plex home screen (1+ for positioned items, 0 for void)
  sortOrderLibrary: number; // Position in library (0 for A-Z section, 1+ for promoted section)
  isLibraryPromoted: boolean; // true = promoted section (uses exclamation marks), false = A-Z section
  randomizeHomeOrder?: boolean; // If true, randomize position amongst other randomized items on home screen
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  isActive: boolean; // Whether hub is currently active (computed from time restrictions)
  missing?: boolean; // True if hub no longer exists in Plex
  // Sync status tracking fields
  lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  lastModifiedAt?: string; // ISO string timestamp when config was last modified
  needsSync?: boolean; // true if modified since last sync
  // Simplified categorization system
  collectionType: CollectionType;
  isLinked?: boolean; // True if hub is actively linked to other hubs (set by backend linking logic)
  linkId?: number; // Group ID for linked hubs (set by backend linking logic)
  isUnlinked?: boolean; // True if this hub was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this hub has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  isPromotedToHub?: boolean; // True if hub exists as a promotable item in Plex (appears in hub management list)
  // Time restriction settings - all hub types can have time restrictions
  timeRestriction?: {
    readonly alwaysActive: boolean; // If true, hub is always active (default)
    readonly removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive (not available for default Plex hubs)
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    }; // Visibility settings to use when hub is inactive (only used if removeFromPlexWhenInactive is false)
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
 * Configuration for pre-existing Plex collections (not created by Agregarr)
 */
export interface PreExistingCollectionConfig {
  id: string; // Generated unique identifier
  collectionRatingKey: string; // Plex collection rating key (e.g., "35954")
  name: string; // Display name from Plex
  libraryId: string; // Library ID this collection belongs to
  libraryName: string; // Library display name
  mediaType: 'movie' | 'tv'; // Media type based on library type
  titleSort?: string; // Plex sortTitle field for alphabetical ordering
  sortOrderHome: number; // Position on Plex home screen (1+ for positioned items, 0 for void)
  sortOrderLibrary: number; // Position in library (0 for A-Z section, 1+ for promoted section)
  isLibraryPromoted: boolean; // true = promoted section (uses exclamation marks), false = A-Z section
  randomizeHomeOrder?: boolean; // If true, randomize position amongst other randomized items on home screen
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  isActive: boolean; // Whether collection is currently active (computed from time restrictions)
  missing?: boolean; // True if collection no longer exists in Plex
  // Sync status tracking fields
  lastSyncedAt?: string; // ISO string timestamp of last successful sync to Plex
  lastModifiedAt?: string; // ISO string timestamp when config was last modified
  needsSync?: boolean; // true if modified since last sync
  // Simplified categorization system (consistent with PlexHubConfig)
  collectionType: CollectionType;
  isLinked?: boolean; // True if collection is actively linked to other collections (set by backend linking logic)
  linkId?: number; // Group ID for linked collections (set by backend linking logic)
  isUnlinked?: boolean; // True if this collection was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this collection has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  isPromotedToHub?: boolean; // True if collection exists as a promotable hub in Plex (appears in hub management list)
  // Time restriction settings
  readonly timeRestriction?: {
    readonly alwaysActive: boolean; // If true, collection is always active (default)
    readonly removeFromPlexWhenInactive?: boolean; // If true, completely remove from Plex when inactive
    readonly inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    }; // Visibility settings to use when collection is inactive
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
  // Custom poster support
  customPoster?: string | Record<string, string>; // Path to custom poster image file, or per-library poster mapping
  autoPoster?: boolean; // Auto-generate poster during sync (same as CollectionConfig)
  autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
}

export interface PlexSettings {
  name: string;
  machineId?: string;
  ip: string;
  port: number;
  useSsl?: boolean;
  libraries: Library[];
  webAppUrl?: string;
  collectionConfigs?: CollectionConfig[]; // Agregarr-created collections
  hubConfigs?: PlexHubConfig[]; // Plex built-in hub configurations
  preExistingCollectionConfigs?: PreExistingCollectionConfig[]; // Pre-existing Plex collections discovered by hub discovery
  usersHomeUnlocked?: boolean; // Secret unlock for Users Home collections
}

export interface TraktSettings {
  apiKey?: string;
}

export interface MDBListSettings {
  apiKey?: string;
}

export interface MyAnimeListSettings {
  apiKey?: string;
}

export interface TautulliSettings {
  hostname?: string;
  port?: number;
  useSsl?: boolean;
  urlBase?: string;
  apiKey?: string;
  externalUrl?: string;
}

export interface OverseerrSettings {
  hostname?: string;
  port?: number;
  useSsl?: boolean;
  urlBase?: string;
  apiKey?: string;
  externalUrl?: string;
  // Movie defaults (Radarr)
  radarrServerId?: number;
  radarrProfileId?: number;
  radarrRootFolder?: string;
  radarrTags?: number[];
  // TV defaults (Sonarr)
  sonarrServerId?: number;
  sonarrProfileId?: number;
  sonarrRootFolder?: string;
  sonarrTags?: number[];
}

export interface ServiceUserSettings {
  userCreationMode: 'single' | 'per-service' | 'granular'; // How to create service users
}

export type TagRequestsMode = 'off' | 'single' | 'per-service' | 'granular';

export interface DVRSettings {
  id: number;
  name: string;
  hostname: string;
  port: number;
  apiKey: string;
  useSsl: boolean;
  baseUrl?: string;
  activeProfileId: number;
  activeProfileName: string;
  activeDirectory: string;
  tags: number[];
  is4k: boolean;
  isDefault: boolean;
  externalUrl?: string;
  syncEnabled: boolean;
  preventSearch: boolean;
  monitorByDefault?: boolean; // Whether to monitor items when added (defaults to true)
  searchOnAdd?: boolean; // Whether to immediately search for items when added (defaults to true)
  tagRequests?: boolean;
  tagRequestsMode?: TagRequestsMode;
}

export interface RadarrSettings extends DVRSettings {
  minimumAvailability: string;
}

export interface SonarrSettings extends DVRSettings {
  seriesType: 'standard' | 'daily' | 'anime';
  animeSeriesType: 'standard' | 'daily' | 'anime';
  activeAnimeProfileId?: number;
  activeAnimeProfileName?: string;
  activeAnimeDirectory?: string;
  activeAnimeLanguageProfileId?: number;
  activeLanguageProfileId?: number;
  animeTags?: number[];
  enableSeasonFolders: boolean;
}

// Quota interface removed - request system not needed in Agregarr

export interface MainSettings {
  apiKey: string;
  applicationTitle: string;
  applicationUrl: string;
  csrfProtection: boolean;
  localLogin: boolean;
  newPlexLogin: boolean;
  trustProxy: boolean;
  locale: string;
  tmdbLanguage?: string; // Language for TMDB API calls (poster metadata, etc.) - defaults to 'en'
  nextConfigId?: number; // Next sequential ID for collection configs (starts at 10000)
  // Global sync status tracking
  lastGlobalSyncAt?: string; // ISO string timestamp of last full collections sync
  globalSyncError?: string; // Last sync error message if any (master error)
  syncCounter?: number; // Counter for alternating Plex hub ordering methods (prevents precision convergence)
  // External service data for template variables
  adminUsername?: string; // Admin's Plex username
  adminNickname?: string; // Admin's Plex title/display name
  externalApplicationUrl?: string; // External Overseerr URL
  externalApplicationTitle?: string; // External Overseerr title
  // Overseerr user label state tracking
  overseerrLabelsApplied?: boolean; // True if Overseerr user filter labels are currently applied to Plex users
  // Placeholder root folders
  placeholderMovieRootFolder?: string; // Root folder path for movie placeholders
  placeholderTVRootFolder?: string; // Root folder path for TV show placeholders
}

interface PublicSettings {
  initialized: boolean;
}

interface FullPublicSettings extends PublicSettings {
  applicationTitle: string;
  applicationUrl: string;
  localLogin: boolean;
  movie4kEnabled: boolean;
  series4kEnabled: boolean;
  locale: string;
  newPlexLogin: boolean;
}

// Notification system removed - not needed in Agregarr collections management

// Notification agents and settings removed - not needed in Agregarr

interface JobSettings {
  schedule: string;
}

export type JobId =
  | 'plex-refresh-token'
  | 'plex-collections-sync'
  | 'plex-randomize-home-order'
  | 'overlay-application';

export interface GlobalExclusions {
  movies: number[]; // TMDB IDs for excluded movies
  shows: { id: number; type: 'tmdb' | 'tvdb' }[]; // TMDB or TVDB IDs for excluded TV shows
}

interface AllSettings {
  clientId: string;
  main: MainSettings;
  plex: PlexSettings;
  tautulli: TautulliSettings;
  overseerr: OverseerrSettings;
  myanimelist: MyAnimeListSettings;
  serviceUser: ServiceUserSettings;
  trakt: TraktSettings;
  mdblist: MDBListSettings;
  radarr: RadarrSettings[];
  sonarr: SonarrSettings[];
  public: PublicSettings;
  jobs: Record<JobId, JobSettings>;
  globalExclusions?: GlobalExclusions; // Global item exclusions for collections
  completedMigrations?: string[]; // Track completed migrations
}

const SETTINGS_PATH = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/settings.json`
  : path.join(__dirname, '../../config/settings.json');

class Settings {
  private data: AllSettings;

  constructor(initialSettings?: AllSettings) {
    this.data = {
      clientId: randomUUID(),
      main: {
        apiKey: '',
        applicationTitle: 'Agregarr',
        applicationUrl: '',
        csrfProtection: false,
        localLogin: false,
        newPlexLogin: true,
        trustProxy: false,
        locale: 'en',
        tmdbLanguage: 'en',
      },
      plex: {
        name: '',
        ip: '',
        port: 32400,
        useSsl: false,
        libraries: [],
        collectionConfigs: [],
        hubConfigs: [],
        preExistingCollectionConfigs: [],
        usersHomeUnlocked: false,
      },
      tautulli: {},
      overseerr: {},
      myanimelist: {},
      serviceUser: {
        userCreationMode: 'per-service', // Default to per-service users
      },
      trakt: {},
      mdblist: {},
      radarr: [],
      sonarr: [],
      public: {
        initialized: false,
      },
      jobs: {
        'plex-refresh-token': {
          schedule: '0 0 5 * * *',
        },
        'plex-collections-sync': {
          schedule: '0 0 */12 * * *',
        },
        'plex-randomize-home-order': {
          schedule: '0 0 6 * * *',
        },
        'overlay-application': {
          schedule: '0 0 0 * * *', // Every 24 hours at midnight
        },
      },
      globalExclusions: {
        movies: [],
        shows: [],
      },
    };
    if (initialSettings) {
      this.data = merge(this.data, initialSettings);
    }

    this.normalizeTagSettings();
  }

  private normalizeTagSettings(): void {
    let modified = false;

    this.data.radarr = this.data.radarr.map((radarrInstance) => {
      const currentMode =
        radarrInstance.tagRequestsMode ??
        (radarrInstance.tagRequests ? 'per-service' : 'off');

      const normalizedMode: TagRequestsMode = (
        ['off', 'single', 'per-service', 'granular'] as TagRequestsMode[]
      ).includes(currentMode as TagRequestsMode)
        ? (currentMode as TagRequestsMode)
        : 'off';

      if (
        radarrInstance.tagRequestsMode !== normalizedMode ||
        (radarrInstance.tagRequests ?? false) !== (normalizedMode !== 'off')
      ) {
        modified = true;
      }

      return {
        ...radarrInstance,
        tagRequestsMode: normalizedMode,
        tagRequests: normalizedMode !== 'off',
      };
    });

    this.data.sonarr = this.data.sonarr.map((sonarrInstance) => {
      const currentMode =
        sonarrInstance.tagRequestsMode ??
        (sonarrInstance.tagRequests ? 'per-service' : 'off');

      const normalizedMode: TagRequestsMode = (
        ['off', 'single', 'per-service', 'granular'] as TagRequestsMode[]
      ).includes(currentMode as TagRequestsMode)
        ? (currentMode as TagRequestsMode)
        : 'off';

      if (
        sonarrInstance.tagRequestsMode !== normalizedMode ||
        (sonarrInstance.tagRequests ?? false) !== (normalizedMode !== 'off')
      ) {
        modified = true;
      }

      return {
        ...sonarrInstance,
        tagRequestsMode: normalizedMode,
        tagRequests: normalizedMode !== 'off',
      };
    });

    if (modified) {
      this.save();
    }
  }

  /**
   * Migrate legacy reverseOrder/randomizeOrder boolean flags to sortOrder enum
   * This is a one-time migration for users upgrading from older versions
   */
  public migrateSortOrderToEnum(): void {
    const migrationId = 'sort-order-to-enum';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Skip if already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    if (!this.data.plex.collectionConfigs) {
      this.data.completedMigrations.push(migrationId);
      this.save();
      return;
    }

    let migratedCount = 0;

    this.data.plex.collectionConfigs = this.data.plex.collectionConfigs.map(
      (config) => {
        // Skip if already using new format
        if (config.sortOrder) {
          return config;
        }

        // Check if config has legacy fields (using type assertion for detection)
        const legacyConfig = config as unknown as {
          reverseOrder?: boolean;
          randomizeOrder?: boolean;
        };

        const hasLegacy =
          legacyConfig.reverseOrder !== undefined ||
          legacyConfig.randomizeOrder !== undefined;

        if (!hasLegacy) {
          return config; // No legacy fields to migrate
        }

        // Determine new sortOrder value from legacy fields
        let sortOrder: CollectionSortOrder = 'default';
        if (legacyConfig.randomizeOrder === true) {
          sortOrder = 'random';
        } else if (legacyConfig.reverseOrder === true) {
          sortOrder = 'reverse';
        }

        migratedCount++;
        logger.info(`Migrating collection "${config.name}" to sortOrder enum`, {
          label: 'Settings Migration',
          configId: config.id,
        });

        // Return collection with new format, removing old fields
        return {
          ...config,
          sortOrder,
          reverseOrder: undefined,
          randomizeOrder: undefined,
        };
      }
    );

    if (migratedCount > 0) {
      logger.info(
        `Migrated ${migratedCount} collection(s) to sortOrder enum format`,
        {
          label: 'Settings Migration',
        }
      );
    }

    this.data.completedMigrations.push(migrationId);
    this.save();
  }

  get main(): MainSettings {
    if (!this.data.main.apiKey) {
      this.data.main.apiKey = this.generateApiKey();
      this.save();
    }
    return this.data.main;
  }

  set main(data: MainSettings) {
    this.data.main = data;
  }

  get plex(): PlexSettings {
    return this.data.plex;
  }

  set plex(data: PlexSettings) {
    this.data.plex = data;
  }

  get tautulli(): TautulliSettings {
    return this.data.tautulli;
  }

  set tautulli(data: TautulliSettings) {
    this.data.tautulli = data;
  }

  get trakt(): TraktSettings {
    return this.data.trakt;
  }

  set trakt(data: TraktSettings) {
    this.data.trakt = data;
  }

  get mdblist(): MDBListSettings {
    return this.data.mdblist;
  }

  set mdblist(data: MDBListSettings) {
    this.data.mdblist = data;
  }

  get overseerr(): OverseerrSettings {
    return this.data.overseerr;
  }

  set overseerr(data: OverseerrSettings) {
    this.data.overseerr = data;
  }

  get myanimelist(): MyAnimeListSettings {
    return this.data.myanimelist;
  }

  set myanimelist(data: MyAnimeListSettings) {
    this.data.myanimelist = data;
  }

  get serviceUser(): ServiceUserSettings {
    return this.data.serviceUser;
  }

  set serviceUser(data: ServiceUserSettings) {
    this.data.serviceUser = data;
  }

  get radarr(): RadarrSettings[] {
    return this.data.radarr;
  }

  set radarr(data: RadarrSettings[]) {
    this.data.radarr = data;
  }

  get sonarr(): SonarrSettings[] {
    return this.data.sonarr;
  }

  set sonarr(data: SonarrSettings[]) {
    this.data.sonarr = data;
  }

  get public(): PublicSettings {
    return this.data.public;
  }

  set public(data: PublicSettings) {
    this.data.public = data;
  }

  get fullPublicSettings(): FullPublicSettings {
    return {
      ...this.data.public,
      applicationTitle: this.data.main.applicationTitle,
      applicationUrl: this.data.main.applicationUrl,
      localLogin: this.data.main.localLogin,
      movie4kEnabled: this.data.radarr.some(
        (radarr) => radarr.is4k && radarr.isDefault
      ),
      series4kEnabled: this.data.sonarr.some(
        (sonarr) => sonarr.is4k && sonarr.isDefault
      ),
      locale: this.data.main.locale,
      newPlexLogin: this.data.main.newPlexLogin,
    };
  }

  // Notification methods removed - not needed in Agregarr

  get jobs(): Record<JobId, JobSettings> {
    return this.data.jobs;
  }

  set jobs(data: Record<JobId, JobSettings>) {
    this.data.jobs = data;
  }

  get globalExclusions(): GlobalExclusions {
    if (!this.data.globalExclusions) {
      this.data.globalExclusions = {
        movies: [],
        shows: [],
      };
    }
    return this.data.globalExclusions;
  }

  set globalExclusions(data: GlobalExclusions) {
    this.data.globalExclusions = data;
  }

  get clientId(): string {
    if (!this.data.clientId) {
      this.data.clientId = randomUUID();
      this.save();
    }

    return this.data.clientId;
  }

  // VAPID keys methods removed - push notifications not needed in Agregarr

  public regenerateApiKey(): MainSettings {
    this.main.apiKey = this.generateApiKey();
    this.save();
    return this.main;
  }

  private generateApiKey(): string {
    return Buffer.from(`${Date.now()}${randomUUID()}`).toString('base64');
  }

  // generateVapidKeys method removed - push notifications not needed in Agregarr

  /**
   * Settings Load
   *
   * This will load settings from file unless an optional argument of the object structure
   * is passed in.
   * @param overrideSettings If passed in, will override all existing settings with these
   * values
   */
  public load(overrideSettings?: AllSettings): Settings {
    if (overrideSettings) {
      this.data = overrideSettings;
      return this;
    }

    if (!fs.existsSync(SETTINGS_PATH)) {
      this.save();
    }
    const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');

    if (data) {
      this.data = merge(this.data, JSON.parse(data));
      this.save();
    }
    return this;
  }

  public save(): void {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.data, undefined, ' '));
  }

  /**
   * Update admin Plex user information for template variables
   */
  public updateAdminPlexInfo(username?: string, nickname?: string): void {
    if (username) {
      this.data.main.adminUsername = username;
    }
    if (nickname) {
      this.data.main.adminNickname = nickname;
    }
    this.save();
  }

  /**
   * Update external Overseerr information for template variables
   */
  public updateExternalOverseerrInfo(
    applicationUrl?: string,
    applicationTitle?: string
  ): void {
    if (applicationUrl) {
      this.data.main.externalApplicationUrl = applicationUrl;
    }
    if (applicationTitle) {
      this.data.main.externalApplicationTitle = applicationTitle;
    }
    this.save();
  }

  /**
   * Set Overseerr user filter label state
   * Used to track whether labels are currently applied to Plex users
   */
  public setOverseerrLabelsApplied(applied: boolean): void {
    this.data.main.overseerrLabelsApplied = applied;
    this.save();
  }

  /**
   * Collection Sync Status Tracking Methods
   */

  /**
   * Mark a collection as modified (needs sync)
   */
  public markCollectionModified(
    collectionId: string,
    collectionType: 'collection' | 'hub' | 'preExisting'
  ): void {
    const now = new Date().toISOString();

    // Find and update the appropriate collection
    switch (collectionType) {
      case 'collection':
        if (this.data.plex.collectionConfigs) {
          const config = this.data.plex.collectionConfigs.find(
            (c) => c.id === collectionId
          );
          if (config) {
            Object.assign(config, { needsSync: true, lastModifiedAt: now });
          }
        }
        break;

      case 'hub':
        if (this.data.plex.hubConfigs) {
          const config = this.data.plex.hubConfigs.find(
            (c) => c.id === collectionId
          );
          if (config) {
            config.needsSync = true;
            config.lastModifiedAt = now;
          }
        }
        break;

      case 'preExisting':
        if (this.data.plex.preExistingCollectionConfigs) {
          const config = this.data.plex.preExistingCollectionConfigs.find(
            (c) => c.id === collectionId
          );
          if (config) {
            config.needsSync = true;
            config.lastModifiedAt = now;
          }
        }
        break;
    }

    this.save();
  }

  /**
   * Mark a collection as successfully synced
   */
  public markCollectionSynced(
    collectionId: string,
    collectionType: 'collection' | 'hub' | 'preExisting'
  ): void {
    const now = new Date().toISOString();

    // Find and update the appropriate collection
    switch (collectionType) {
      case 'collection':
        if (this.data.plex.collectionConfigs) {
          const config = this.data.plex.collectionConfigs.find(
            (c) => c.id === collectionId
          );
          if (config) {
            Object.assign(config, { needsSync: false, lastSyncedAt: now });
          }
        }
        break;

      case 'hub':
        if (this.data.plex.hubConfigs) {
          const config = this.data.plex.hubConfigs.find(
            (c) => c.id === collectionId
          );
          if (config) {
            config.needsSync = false;
            config.lastSyncedAt = now;
          }
        }
        break;

      case 'preExisting':
        if (this.data.plex.preExistingCollectionConfigs) {
          const config = this.data.plex.preExistingCollectionConfigs.find(
            (c) => c.id === collectionId
          );
          if (config) {
            config.needsSync = false;
            config.lastSyncedAt = now;
          }
        }
        break;
    }

    this.save();
  }

  /**
   * Set global sync error message
   */
  public setGlobalSyncError(error: string): void {
    this.data.main.globalSyncError = error;
    this.save();
  }

  /**
   * Mark global sync as completed successfully
   */
  public setGlobalSyncComplete(): void {
    this.data.main.lastGlobalSyncAt = new Date().toISOString();
    this.data.main.globalSyncError = undefined; // Clear any previous errors
    this.save();
  }

  /**
   * Get global sync status for UI display
   */
  public getGlobalSyncStatus(): {
    lastGlobalSyncAt?: string;
    globalSyncError?: string;
    collectionsNeedingSync: number;
  } {
    let collectionsNeedingSync = 0;

    // Count collections that need sync
    if (this.data.plex.collectionConfigs) {
      collectionsNeedingSync += this.data.plex.collectionConfigs.filter(
        (c) => 'needsSync' in c && (c as { needsSync?: boolean }).needsSync
      ).length;
    }
    if (this.data.plex.hubConfigs) {
      collectionsNeedingSync += this.data.plex.hubConfigs.filter(
        (c) => c.needsSync
      ).length;
    }
    if (this.data.plex.preExistingCollectionConfigs) {
      collectionsNeedingSync +=
        this.data.plex.preExistingCollectionConfigs.filter(
          (c) => c.needsSync
        ).length;
    }

    return {
      lastGlobalSyncAt: this.data.main.lastGlobalSyncAt,
      globalSyncError: this.data.main.globalSyncError,
      collectionsNeedingSync,
    };
  }

  /**
   * Initialize sync status for existing collections (migration helper)
   */
  public initializeSyncStatusForExistingCollections(): void {
    const now = new Date().toISOString();

    // Initialize sync status for existing collections
    if (this.data.plex.collectionConfigs) {
      this.data.plex.collectionConfigs.forEach((config) => {
        if (!('needsSync' in config)) {
          Object.assign(config, { needsSync: true, lastModifiedAt: now });
        }
      });
    }

    if (this.data.plex.hubConfigs) {
      this.data.plex.hubConfigs.forEach((config) => {
        if (config.needsSync === undefined) {
          config.needsSync = true;
          config.lastModifiedAt = now;
        }
      });
    }

    if (this.data.plex.preExistingCollectionConfigs) {
      this.data.plex.preExistingCollectionConfigs.forEach((config) => {
        if (config.needsSync === undefined) {
          config.needsSync = true;
          config.lastModifiedAt = now;
        }
      });
    }

    this.save();
  }

  /**
   * Complete collection data normalization migration for v1.1.0
   * Replaces 4 incomplete migrations with comprehensive field normalization across all config types
   */
  public migrateCollectionDataNormalizationV110(): void {
    const migrationId = 'collection-data-normalization-v1.1.0';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Check if migration already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    const stats = {
      hubs: 0,
      collections: 0,
      preExisting: 0,
      duplicatesFixed: 0,
    };

    // Step 1: Normalize all hub configs
    stats.hubs = this.normalizeHubConfigs();

    // Step 2: Normalize all collection configs
    stats.collections = this.normalizeCollectionConfigs();

    // Step 3: Normalize all pre-existing configs
    stats.preExisting = this.normalizePreExistingConfigs();

    // Step 4: Fix duplicates per library
    for (const library of this.data.plex.libraries) {
      stats.duplicatesFixed += this.fixDuplicateSortOrdersForLibrary(
        library.key
      );
    }

    // Step 5: Save and log
    this.data.completedMigrations.push(migrationId);
    this.save();

    logger.info(
      `v1.1.0 Migration: Normalized ${
        stats.hubs + stats.collections + stats.preExisting
      } configs, fixed ${stats.duplicatesFixed} duplicates`,
      {
        label: 'Settings Migration',
        stats,
      }
    );
  }

  /**
   * Migrate poster templates to unified layering system for v1.3.2
   */
  public async migratePosterTemplatesV132(): Promise<void> {
    const migrationId = 'poster-template-unified-layers-v1.3.2';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Check if migration already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    try {
      // Import and run the migration
      const { runPosterTemplateMigration } = await import(
        './migrations/posterTemplateMigrationV132'
      );
      await runPosterTemplateMigration();

      // Mark migration as completed
      this.data.completedMigrations.push(migrationId);
      this.save();

      logger.info(
        'v1.3.2 Migration: Poster templates migrated to unified layering system',
        {
          label: 'Settings Migration',
          migrationId,
        }
      );
    } catch (error) {
      logger.error('v1.3.2 Migration failed:', error);
      throw error;
    }
  }

  /**
   * Normalize hub configs with hub-specific business rules
   */
  private normalizeHubConfigs(): number {
    let fixedCount = 0;

    if (!this.data.plex.hubConfigs) {
      return fixedCount;
    }

    this.data.plex.hubConfigs = this.data.plex.hubConfigs.map((config) => {
      const isVisibleOnHome =
        config.visibilityConfig?.usersHome ||
        config.visibilityConfig?.serverOwnerHome ||
        config.visibilityConfig?.libraryRecommended;

      // Check if normalization is needed
      const needsNormalization =
        config.sortOrderLibrary !== 0 ||
        config.isLibraryPromoted !== false ||
        config.everLibraryPromoted !== false ||
        (!isVisibleOnHome && config.sortOrderHome > 0) ||
        (config.collectionType === CollectionType.DEFAULT_PLEX_HUB &&
          config.isPromotedToHub !== true) ||
        config.isPromotedToHub === undefined;

      if (needsNormalization) {
        fixedCount++;
        return {
          ...config,
          // Business rule: Hubs CANNOT appear in library tabs
          sortOrderLibrary: 0,
          isLibraryPromoted: false,
          everLibraryPromoted: false,
          // Visibility rule: Only visible hubs get home positioning
          sortOrderHome: isVisibleOnHome ? config.sortOrderHome : 0,
          // Discovery rule: All default hubs are promotable
          isPromotedToHub:
            config.collectionType === CollectionType.DEFAULT_PLEX_HUB
              ? true
              : config.isPromotedToHub ?? true,
        };
      }

      return config;
    });

    return fixedCount;
  }

  /**
   * Normalize collection configs with collection business rules
   */
  private normalizeCollectionConfigs(): number {
    let fixedCount = 0;

    if (!this.data.plex.collectionConfigs) {
      return fixedCount;
    }

    this.data.plex.collectionConfigs = this.data.plex.collectionConfigs.map(
      (config) => {
        let updatedConfig = { ...config };
        let changed = false;

        // Ensure plex_library/directors configs carry required defaults
        if (
          updatedConfig.type === 'plex_library' &&
          updatedConfig.subtype === 'directors'
        ) {
          if (updatedConfig.directorMinimumItems === undefined) {
            updatedConfig.directorMinimumItems = 3;
            changed = true;
          }
          // Standardize template/name so placeholder text doesn't leak through
          if (!updatedConfig.template || updatedConfig.template === 'Collection') {
            updatedConfig.template = '{director}';
            changed = true;
          }
          if (
            updatedConfig.name === '{director}' ||
            !updatedConfig.name ||
            updatedConfig.name === 'Collection'
          ) {
            updatedConfig.name = 'Auto Director Collections';
            changed = true;
          }
        }

        const isVisibleOnHome =
          updatedConfig.visibilityConfig?.usersHome ||
          updatedConfig.visibilityConfig?.serverOwnerHome ||
          updatedConfig.visibilityConfig?.libraryRecommended;

        // Check if normalization is needed
        const needsNormalization =
          (!isVisibleOnHome &&
            updatedConfig.sortOrderHome &&
            updatedConfig.sortOrderHome > 0) ||
          (updatedConfig.isLibraryPromoted === true &&
            (!updatedConfig.sortOrderLibrary ||
              updatedConfig.sortOrderLibrary === 0)) ||
          (updatedConfig.isLibraryPromoted === false &&
            updatedConfig.sortOrderLibrary &&
            updatedConfig.sortOrderLibrary > 0) ||
          updatedConfig.everLibraryPromoted === undefined;

        if (needsNormalization) {
          updatedConfig = {
            ...updatedConfig,
            // Visibility rule: Only visible collections get positioning
            sortOrderHome: isVisibleOnHome ? config.sortOrderHome : 0,
            // Consistency rule: Library positioning matches promotion status
            sortOrderLibrary: updatedConfig.isLibraryPromoted
              ? updatedConfig.sortOrderLibrary
              : 0,
            // Historical rule: Track promotion history
            everLibraryPromoted:
              updatedConfig.isLibraryPromoted ||
              (updatedConfig.everLibraryPromoted ?? false),
            // No isPromotedToHub changes (calculated dynamically)
          };
          changed = true;
        }

        if (changed) {
          fixedCount++;
        }

        return updatedConfig;
      }
    );

    return fixedCount;
  }

  /**
   * Migrate comingsoon/recently_added configs to standalone recently_added type
   * This is a one-time migration for users upgrading from older versions
   */
  public migrateComingSoonRecentlyAddedToStandalone(): void {
    const migrationId = 'comingsoon-recently-added-to-standalone';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Skip if already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    if (!this.data.plex.collectionConfigs) {
      this.data.completedMigrations.push(migrationId);
      this.save();
      return;
    }

    let migratedCount = 0;

    this.data.plex.collectionConfigs = this.data.plex.collectionConfigs.map(
      (config) => {
        // Check if this is a comingsoon/recently_added config that needs migration
        if (
          config.type === 'comingsoon' &&
          config.subtype === 'recently_added'
        ) {
          migratedCount++;
          logger.info(
            `Migrating comingsoon/recently_added config "${config.name}" to filtered_hub type with subtype recently_added`,
            {
              label: 'Settings Migration',
              configId: config.id,
            }
          );

          return {
            ...config,
            type: 'filtered_hub' as const,
            subtype: 'recently_added', // filtered_hub requires a subtype
          };
        }

        return config;
      }
    );

    if (migratedCount > 0) {
      logger.info(
        `Migrated ${migratedCount} comingsoon/recently_added config(s) to filtered_hub type`,
        {
          label: 'Settings Migration',
        }
      );
    }

    this.data.completedMigrations.push(migrationId);
    this.save();
  }

  /**
   * Migrate recently_added type to filtered_hub with subtype recently_added
   * This is a one-time migration for the filtered hub refactoring
   */
  public migrateRecentlyAddedToFilteredHub(): void {
    const migrationId = 'recently-added-to-filtered-hub';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Skip if already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    if (!this.data.plex.collectionConfigs) {
      this.data.completedMigrations.push(migrationId);
      this.save();
      return;
    }

    let migratedCount = 0;

    this.data.plex.collectionConfigs = this.data.plex.collectionConfigs.map(
      (config) => {
        // Check if this is a recently_added config that needs migration
        // Type assertion needed because 'recently_added' is a legacy type
        if ((config.type as string) === 'recently_added') {
          migratedCount++;
          logger.info(
            `Migrating recently_added config "${config.name}" to filtered_hub type with subtype recently_added`,
            {
              label: 'Settings Migration',
              configId: config.id,
            }
          );

          return {
            ...config,
            type: 'filtered_hub' as const,
            subtype: 'recently_added', // Set subtype to recently_added
          };
        }

        return config;
      }
    );

    if (migratedCount > 0) {
      logger.info(
        `Migrated ${migratedCount} recently_added config(s) to filtered_hub type`,
        {
          label: 'Settings Migration',
        }
      );
    }

    this.data.completedMigrations.push(migrationId);
    this.save();
  }

  /**
   * Migrate old filter format (excludedGenres, excludedCountries, excludedLanguages)
   * to new unified filterSettings format with include/exclude modes
   * This is a one-time migration for users upgrading from older versions
   */
  public migrateToUnifiedFilterSettings(): void {
    const migrationId = 'unified-filter-settings';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Skip if already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    if (!this.data.plex.collectionConfigs) {
      this.data.completedMigrations.push(migrationId);
      this.save();
      return;
    }

    let migratedCount = 0;

    this.data.plex.collectionConfigs = this.data.plex.collectionConfigs.map(
      (config) => {
        // Skip if already using new format
        if (config.filterSettings) {
          return config;
        }

        // Check if collection has any old-format filters
        const hasOldFilters =
          (config.excludedGenres && config.excludedGenres.length > 0) ||
          (config.excludedCountries && config.excludedCountries.length > 0) ||
          (config.excludedLanguages && config.excludedLanguages.length > 0);

        if (!hasOldFilters) {
          return config; // No filters to migrate
        }

        // Build new filterSettings object
        const filterSettings: {
          genres?: { mode: 'exclude' | 'include'; values: number[] };
          countries?: { mode: 'exclude' | 'include'; values: string[] };
          languages?: { mode: 'exclude' | 'include'; values: string[] };
        } = {};

        if (config.excludedGenres && config.excludedGenres.length > 0) {
          filterSettings.genres = {
            mode: 'exclude',
            values: config.excludedGenres,
          };
        }

        if (config.excludedCountries && config.excludedCountries.length > 0) {
          filterSettings.countries = {
            mode: 'exclude',
            values: config.excludedCountries,
          };
        }

        if (config.excludedLanguages && config.excludedLanguages.length > 0) {
          filterSettings.languages = {
            mode: 'exclude',
            values: config.excludedLanguages,
          };
        }

        migratedCount++;
        logger.info(
          `Migrating collection "${config.name}" to unified filter settings`,
          {
            label: 'Settings Migration',
            configId: config.id,
          }
        );

        // Return collection with new format, removing old fields
        return {
          ...config,
          filterSettings,
          excludedGenres: undefined,
          excludedCountries: undefined,
          excludedLanguages: undefined,
        };
      }
    );

    if (migratedCount > 0) {
      logger.info(
        `Migrated ${migratedCount} collection(s) to unified filter settings format`,
        {
          label: 'Settings Migration',
        }
      );
    }

    this.data.completedMigrations.push(migrationId);
    this.save();
  }

  /**
   * Ensure plex_library/directors configs have required defaults and naming
   */
  public migratePlexLibraryDirectorsDefaults(): void {
    const migrationId = 'plex-library-directors-defaults-v1';

    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    const fixed = this.normalizeCollectionConfigs();

    this.data.completedMigrations.push(migrationId);

    if (fixed > 0) {
      logger.info(
        `Applied director defaults to ${fixed} plex_library/directors config(s)`,
        { label: 'Settings Migration' }
      );
      this.save();
    } else {
      this.save();
    }
  }

  /**
   * Normalize pre-existing configs with pre-existing collection business rules
   */
  private normalizePreExistingConfigs(): number {
    let fixedCount = 0;

    const preExistingConfigs = preExistingCollectionConfigService.getConfigs();
    const updatedConfigs: PreExistingCollectionConfig[] = [];

    for (const config of preExistingConfigs) {
      const isVisibleOnHome =
        config.visibilityConfig?.usersHome ||
        config.visibilityConfig?.serverOwnerHome ||
        config.visibilityConfig?.libraryRecommended;

      // Check if normalization is needed
      const needsNormalization =
        (!isVisibleOnHome && config.sortOrderHome > 0) ||
        (config.isLibraryPromoted === true && config.sortOrderLibrary === 0) ||
        (config.isLibraryPromoted === false && config.sortOrderLibrary > 0) ||
        config.everLibraryPromoted === undefined ||
        config.isPromotedToHub === undefined;

      if (needsNormalization) {
        fixedCount++;
        updatedConfigs.push({
          ...config,
          // Same as Collections (identical business rules)
          sortOrderHome: isVisibleOnHome ? config.sortOrderHome : 0,
          sortOrderLibrary: config.isLibraryPromoted
            ? config.sortOrderLibrary
            : 0,
          everLibraryPromoted:
            config.isLibraryPromoted || (config.everLibraryPromoted ?? false),
          // Discovery rule: Default to collections API only
          isPromotedToHub: config.isPromotedToHub ?? false,
        });
      } else {
        updatedConfigs.push(config);
      }
    }

    // Save updated configs if any changes were made
    if (fixedCount > 0) {
      preExistingCollectionConfigService.saveConfigs(updatedConfigs);
    }

    return fixedCount;
  }

  /**
   * Fix duplicate sort orders for a specific library
   */
  private fixDuplicateSortOrdersForLibrary(libraryKey: string): number {
    // Get all configs for this library
    const libraryCollections = (this.data.plex.collectionConfigs || []).filter(
      (config) => {
        const belongsToLibrary = Array.isArray(config.libraryId)
          ? config.libraryId.includes(libraryKey)
          : config.libraryId === libraryKey;
        return belongsToLibrary;
      }
    );

    const libraryHubs = defaultHubConfigService
      .getConfigs()
      .filter((config: PlexHubConfig) => {
        return config.libraryId === libraryKey;
      });

    const libraryPreExisting = preExistingCollectionConfigService
      .getConfigs()
      .filter((config: PreExistingCollectionConfig) => {
        return config.libraryId === libraryKey;
      });

    let totalFixed = 0;

    // Fix home screen duplicates
    totalFixed += this.fixDuplicateSortOrdersInContext(
      libraryCollections,
      libraryHubs,
      libraryPreExisting,
      'sortOrderHome'
    );

    // Fix library tab duplicates
    totalFixed += this.fixDuplicateSortOrdersInContext(
      libraryCollections,
      libraryHubs,
      libraryPreExisting,
      'sortOrderLibrary'
    );

    return totalFixed;
  }

  /**
   * Fix duplicate sort orders in a specific context (home or library)
   */
  private fixDuplicateSortOrdersInContext(
    collections: CollectionConfig[],
    hubs: PlexHubConfig[],
    preExisting: PreExistingCollectionConfig[],
    sortOrderField: 'sortOrderHome' | 'sortOrderLibrary'
  ): number {
    // Combine all items that should be positioned (including promoted items with 0 values)
    const allItems = [
      ...collections
        .filter(
          (c) =>
            (c[sortOrderField] || 0) > 0 ||
            (sortOrderField === 'sortOrderLibrary' && c.isLibraryPromoted) ||
            (sortOrderField === 'sortOrderHome' &&
              (c.visibilityConfig?.usersHome ||
                c.visibilityConfig?.serverOwnerHome ||
                c.visibilityConfig?.libraryRecommended))
        )
        .map((c) => ({ ...c, configType: 'collection' as const })),
      ...hubs
        .filter(
          (h) =>
            (h[sortOrderField] || 0) > 0 ||
            (sortOrderField === 'sortOrderHome' &&
              (h.visibilityConfig?.usersHome ||
                h.visibilityConfig?.serverOwnerHome ||
                h.visibilityConfig?.libraryRecommended))
        )
        .map((h) => ({ ...h, configType: 'hub' as const })),
      ...preExisting
        .filter(
          (p) =>
            (p[sortOrderField] || 0) > 0 ||
            (sortOrderField === 'sortOrderLibrary' && p.isLibraryPromoted) ||
            (sortOrderField === 'sortOrderHome' &&
              (p.visibilityConfig?.usersHome ||
                p.visibilityConfig?.serverOwnerHome ||
                p.visibilityConfig?.libraryRecommended))
        )
        .map((p) => ({ ...p, configType: 'preExisting' as const })),
    ];

    if (allItems.length === 0) {
      return 0;
    }

    // Sort by current position to preserve relative ordering
    allItems.sort(
      (a, b) => (a[sortOrderField] || 0) - (b[sortOrderField] || 0)
    );

    // Assign sequential positions and track changes
    let fixedCount = 0;
    const updatedCollections: CollectionConfig[] = [];
    const updatedHubs: PlexHubConfig[] = [];
    const updatedPreExisting: PreExistingCollectionConfig[] = [];

    allItems.forEach((item, index) => {
      const newPosition = index + 1;
      const currentPosition = item[sortOrderField] || 0;

      if (currentPosition !== newPosition) {
        fixedCount++;
        const updatedItem = { ...item, [sortOrderField]: newPosition };

        if (item.configType === 'collection') {
          updatedCollections.push(updatedItem as CollectionConfig);
        } else if (item.configType === 'hub') {
          updatedHubs.push(updatedItem as PlexHubConfig);
        } else {
          updatedPreExisting.push(updatedItem as PreExistingCollectionConfig);
        }
      }
    });

    // Apply updates
    if (updatedCollections.length > 0) {
      updatedCollections.forEach((updatedConfig) => {
        const index = (this.data.plex.collectionConfigs || []).findIndex(
          (c) => c.id === updatedConfig.id
        );
        if (index >= 0 && this.data.plex.collectionConfigs) {
          this.data.plex.collectionConfigs[index] = updatedConfig;
        }
      });
    }

    if (updatedHubs.length > 0) {
      const allHubConfigs = defaultHubConfigService
        .getConfigs()
        .map((config) => {
          const updated = updatedHubs.find((u) => u.id === config.id);
          return updated || config;
        });
      defaultHubConfigService.saveExistingConfigs(allHubConfigs);
    }

    if (updatedPreExisting.length > 0) {
      const allPreExistingConfigs = preExistingCollectionConfigService
        .getConfigs()
        .map((config) => {
          const updated = updatedPreExisting.find((u) => u.id === config.id);
          return updated || config;
        });
      preExistingCollectionConfigService.saveConfigs(allPreExistingConfigs);
    }

    return fixedCount;
  }
}

let settings: Settings | undefined;

// Multi-source collection types
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
  | 'anilist'
  | 'myanimelist'
  | 'radarrtag'
  | 'sonarrtag'
  | 'comingsoon';

export interface SourceDefinition {
  readonly id: string;
  readonly type: MultiSourceType;
  readonly subtype: string;
  readonly customUrl?: string;
  readonly timePeriod?: 'daily' | 'weekly' | 'monthly' | 'all';
  readonly customDays?: number;
  readonly minimumPlays?: number;
  readonly priority: number;
  readonly networksCountry?: string;
  readonly radarrTagServerId?: number;
  readonly radarrTagId?: number;
  readonly radarrTagLabel?: string;
  readonly sonarrTagServerId?: number;
  readonly sonarrTagId?: number;
  readonly sonarrTagLabel?: string;
}

export interface MultiSourceCollectionConfig {
  readonly id: string;
  readonly name: string;
  readonly type: 'multi-source';
  readonly visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  readonly mediaType?: 'movie' | 'tv';
  readonly libraryId: string;
  readonly libraryName: string;
  readonly maxItems?: number;
  readonly template?: string;
  readonly sources: readonly SourceDefinition[];
  readonly combineMode: MultiSourceCombineMode;
  readonly customSyncSchedule?: CustomSyncSchedule;
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
  readonly autoPosterTemplate?: number | null; // Template ID for auto-generated posters (null for default template)
  readonly applyOverlaysDuringSync?: boolean; // Apply item overlays during sync (for Coming Soon collections)
  // Placeholder creation settings (shared with CollectionConfig)
  readonly createPlaceholdersForMissing?: boolean; // Enable placeholder creation for missing items
  readonly placeholderDaysAhead?: number; // How many days ahead to create placeholders
  readonly placeholderReleasedDays?: number; // How many days after release to keep placeholders
  // Missing items / auto-download settings (same as CollectionConfig)
  readonly downloadMode?: 'overseerr' | 'direct';
  readonly searchMissingMovies?: boolean;
  readonly searchMissingTV?: boolean;
  readonly autoApproveMovies?: boolean;
  readonly autoApproveTV?: boolean;
  readonly maxSeasonsToRequest?: number;
  readonly seasonsPerShowLimit?: number;
  readonly maxPositionToProcess?: number;
  readonly minimumYear?: number;
  readonly minimumImdbRating?: number;
  readonly minimumRottenTomatoesRating?: number;
  readonly excludedGenres?: number[];
  readonly excludedCountries?: string[];
  readonly excludedLanguages?: string[];
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
  readonly directDownloadSonarrSearchOnAdd?: boolean;
  readonly overseerrRadarrServerId?: number;
  readonly overseerrRadarrProfileId?: number;
  readonly overseerrRadarrRootFolder?: string;
  readonly overseerrRadarrTags?: number[];
  readonly overseerrSonarrServerId?: number;
  readonly overseerrSonarrProfileId?: number;
  readonly overseerrSonarrRootFolder?: string;
  readonly overseerrSonarrTags?: number[];
  readonly collectionRatingKey?: string; // Plex collection rating key (regular or smart collection)
  readonly smartCollectionRatingKey?: string; // LEGACY: Old dual-collection system smart collection rating key (for migration only)
  // Smart collection settings (unwatched filter feature)
  readonly showUnwatchedOnly?: boolean; // If true, create a smart collection that filters to unwatched items only
  readonly smartCollectionSort?: SmartCollectionSortOption; // Sort option for smart collections
}

export const getSettings = (initialSettings?: AllSettings): Settings => {
  if (!settings) {
    settings = new Settings(initialSettings);
  }

  return settings;
};

/**
 * Get the configured TMDB language for API calls
 * Returns 'en' (English) as default if not configured
 */
export const getTmdbLanguage = (): string => {
  const settings = getSettings();
  return settings.main.tmdbLanguage || 'en';
};

export default Settings;
