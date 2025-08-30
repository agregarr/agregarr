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

export interface Library {
  readonly key: string;
  readonly name: string;
  readonly type: 'show' | 'movie';
  readonly lastScan?: number;
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
    | 'letterboxd';
  readonly subtype: string; // Specific option like 'users', 'most_popular_plays', 'most_popular_duration', etc.
  readonly template: string;
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
  readonly isLinked?: boolean; // True if collection is actively linked to other collections
  readonly linkId?: number; // Group ID for linked collections (preserved even when isLinked=false)
  readonly isUnlinked?: boolean; // True if this collection was deliberately unlinked and should not be grouped with siblings
  everLibraryPromoted?: boolean; // True if this collection has ever been promoted to the promoted section (once true, stays true until sortTitle reset)
  readonly isPromotedToHub?: boolean; // True if collection exists as a promotable hub in Plex (appears in hub management list)
  readonly collectionRatingKey?: string; // Plex collection rating key (when created)
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
  readonly maxPositionToProcess?: number; // Only process items in positions 1-X of the list (0 = no limit)
  // Trakt custom list fields
  readonly traktCustomListUrl?: string; // Custom Trakt list URL (e.g., https://trakt.tv/users/username/lists/list-name)
  // TMDb custom list fields
  readonly tmdbCustomListUrl?: string; // Custom TMDb list/collection URL (e.g., https://www.themoviedb.org/list/123456)
  // IMDb custom list fields
  readonly imdbCustomListUrl?: string; // Custom IMDb list URL (e.g., https://www.imdb.com/list/ls123456789/)
  // Letterboxd custom list fields
  readonly letterboxdCustomListUrl?: string; // Custom Letterboxd list URL (e.g., https://letterboxd.com/username/list/list-name/)
  // Generic ordering options (applicable to all collection types)
  readonly reverseOrder?: boolean; // Reverse the order of items from the source
  readonly randomizeOrder?: boolean; // Randomize the order of items (mutually exclusive with reverseOrder)
  // Poster settings
  readonly customPoster?: string; // Path to custom poster image file
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
  customPoster?: string; // Path to custom poster image file
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
}

export interface ServiceUserSettings {
  userCreationMode: 'single' | 'per-service' | 'granular'; // How to create service users
}

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
  tagRequests: boolean;
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
  nextConfigId?: number; // Next sequential ID for collection configs (starts at 10000)
  // Global sync status tracking
  lastGlobalSyncAt?: string; // ISO string timestamp of last full collections sync
  globalSyncError?: string; // Last sync error message if any (master error)
  // External service data for template variables
  adminUsername?: string; // Admin's Plex username
  adminNickname?: string; // Admin's Plex title/display name
  externalApplicationUrl?: string; // External Overseerr URL
  externalApplicationTitle?: string; // External Overseerr title
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

export type JobId = 'plex-refresh-token' | 'plex-collections-sync';

interface AllSettings {
  clientId: string;
  main: MainSettings;
  plex: PlexSettings;
  tautulli: TautulliSettings;
  overseerr: OverseerrSettings;
  serviceUser: ServiceUserSettings;
  trakt: TraktSettings;
  radarr: RadarrSettings[];
  sonarr: SonarrSettings[];
  public: PublicSettings;
  jobs: Record<JobId, JobSettings>;
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
      serviceUser: {
        userCreationMode: 'per-service', // Default to per-service users
      },
      trakt: {},
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
      },
    };
    if (initialSettings) {
      this.data = merge(this.data, initialSettings);
    }
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

  get overseerr(): OverseerrSettings {
    return this.data.overseerr;
  }

  set overseerr(data: OverseerrSettings) {
    this.data.overseerr = data;
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
   * Migrate default hub configs for v1.0.4 ordering consistency
   * - Default Plex hubs should have sortOrderLibrary = 0 (void) since they cannot appear in library tabs
   * - Default Plex hubs should have sortOrderHome = 0 (void) if not visible on home/recommended screens
   */
  public migrateDefaultHubConfigsV104(): void {
    const migrationId = 'default-hub-library-ordering-v1.0.4';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Check if migration already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    let fixedCount = 0;

    // Fix hub configs
    if (this.data.plex.hubConfigs) {
      this.data.plex.hubConfigs = this.data.plex.hubConfigs.map((config) => {
        if (config.collectionType === CollectionType.DEFAULT_PLEX_HUB) {
          // Check if any fields need fixing
          const hasInvalidLibrarySettings =
            config.sortOrderLibrary > 0 ||
            config.isLibraryPromoted === true ||
            config.everLibraryPromoted === true;

          // Check if sortOrderHome should be void (not visible on home/recommended screens)
          const visibleOnHomeScreens =
            config.visibilityConfig?.usersHome ||
            config.visibilityConfig?.serverOwnerHome ||
            config.visibilityConfig?.libraryRecommended;
          const hasInvalidHomeOrdering =
            !visibleOnHomeScreens && (config.sortOrderHome || 0) > 0;

          if (hasInvalidLibrarySettings || hasInvalidHomeOrdering) {
            fixedCount++;
            return {
              ...config,
              sortOrderLibrary: 0, // Void for reordering (cannot appear in library tabs)
              isLibraryPromoted: false, // Cannot be promoted in library tabs
              everLibraryPromoted: false, // Reset promotion history
              sortOrderHome: visibleOnHomeScreens ? config.sortOrderHome : 0, // Set to void if not visible
            };
          }
        }
        return config;
      });
    }

    // Mark migration as completed and save
    this.data.completedMigrations.push(migrationId);
    this.save();

    if (fixedCount > 0) {
      logger.info(
        `v1.0.4 Migration: Fixed ${fixedCount} default hub configs for library ordering consistency`,
        { label: 'Settings Migration' }
      );
    } else {
      logger.debug('v1.0.4 Migration: No default hub configs required fixing', {
        label: 'Settings Migration',
      });
    }
  }

  /**
   * Migrate collections to set initial isPromotedToHub values for discovery compatibility
   * Note: isPromotedToHub is now calculated dynamically, but we set initial values for pre-existing collections
   */
  public migratePromotionStatusV104(): void {
    const migrationId = 'promotion-status-v1.0.4';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Check if migration already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    let fixedCount = 0;

    // Fix hub configs - default hubs are always promoted
    if (this.data.plex.hubConfigs) {
      this.data.plex.hubConfigs = this.data.plex.hubConfigs.map((config) => {
        // Only set if isPromotedToHub is undefined (not explicitly set)
        if (config.isPromotedToHub === undefined) {
          fixedCount++;
          return {
            ...config,
            // Default hubs are always promoted (can't be deleted)
            isPromotedToHub:
              config.collectionType === CollectionType.DEFAULT_PLEX_HUB,
          };
        }

        return config;
      });
    }

    // Fix pre-existing collection configs - preserve discovery source
    if (this.data.plex.preExistingCollectionConfigs) {
      this.data.plex.preExistingCollectionConfigs =
        this.data.plex.preExistingCollectionConfigs.map((config) => {
          // Only set if isPromotedToHub is undefined (not explicitly set)
          if (config.isPromotedToHub === undefined) {
            // For pre-existing collections, default to false (collections API only)
            // Will be set to true by discovery if found in hub management
            fixedCount++;
            return {
              ...config,
              isPromotedToHub: false,
            };
          }

          return config;
        });
    }

    // For Agregarr collections, isPromotedToHub is now calculated dynamically
    // No migration needed - calculation handles all cases

    // Mark migration as completed and save
    this.data.completedMigrations.push(migrationId);
    this.save();

    if (fixedCount > 0) {
      logger.info(
        `v1.0.4 Migration: Set initial isPromotedToHub status for ${fixedCount} items`,
        { label: 'Settings Migration' }
      );
    } else {
      logger.debug(
        'v1.0.4 Migration: No items required promotion status initialization',
        { label: 'Settings Migration' }
      );
    }
  }

  /**
   * Migrate collection sortOrderHome values based on visibility settings
   * Collections should only have sortOrderHome > 0 if they're visible on home/recommended screens
   */
  public migrateVisibilityBasedSortOrdersV104(): void {
    const migrationId = 'visibility-based-sort-orders-v1.0.4';

    // Initialize completedMigrations if it doesn't exist
    if (!this.data.completedMigrations) {
      this.data.completedMigrations = [];
    }

    // Check if migration already completed
    if (this.data.completedMigrations.includes(migrationId)) {
      return;
    }

    let fixedCount = 0;

    // Fix collection configs
    if (this.data.plex.collectionConfigs) {
      this.data.plex.collectionConfigs = this.data.plex.collectionConfigs.map(
        (config) => {
          // Check if collection should have sortOrderHome = 0 (void)
          const visibleOnHomeScreens =
            config.visibilityConfig?.usersHome ||
            config.visibilityConfig?.serverOwnerHome ||
            config.visibilityConfig?.libraryRecommended;

          // If not visible on home/recommended screens but has sortOrderHome > 0, fix it
          if (!visibleOnHomeScreens && (config.sortOrderHome || 0) > 0) {
            fixedCount++;
            return {
              ...config,
              sortOrderHome: 0, // Set to void
            };
          }

          return config;
        }
      );
    }

    // Mark migration as completed and save
    this.data.completedMigrations.push(migrationId);
    this.save();

    if (fixedCount > 0) {
      logger.info(
        `v1.0.4 Migration: Fixed ${fixedCount} collection configs for visibility-based sortOrderHome consistency`,
        { label: 'Settings Migration' }
      );
    } else {
      logger.debug(
        'v1.0.4 Migration: No collection configs required sortOrderHome fixing',
        { label: 'Settings Migration' }
      );
    }
  }
}

let settings: Settings | undefined;

export const getSettings = (initialSettings?: AllSettings): Settings => {
  if (!settings) {
    settings = new Settings(initialSettings);
  }

  return settings;
};

export default Settings;
