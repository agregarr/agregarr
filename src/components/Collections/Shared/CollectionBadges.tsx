import HomeStarIcon from '@app/assets/icons/homeWithStar.svg';
import LibraryBookmarkIcon from '@app/assets/icons/libraryRecommended.svg';
import ThreeHomesIcon from '@app/assets/icons/threeHomes.svg';
import Badge from '@app/components/Common/Badge';
import type { CollectionFormConfig } from '@app/types/collections';
import { formatSyncScheduleBadge } from '@app/utils/collections/collectionUtils';
import {
  ArrowPathIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  LinkIcon as LinkIconHeroicon,
  LinkSlashIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  plexDefault: 'Plex Default',
  preExisting: 'Pre-Existing',
  items: 'Items: {maxItems}',
  grabMissingItems: 'Grab Missing Items',
  timeRestrictionsSet: 'Time Restrictions Set',
  unwatched: 'Unwatched',
  createPlaceholders: 'Create Placeholders',
});

// This file contains shared badge and UI components used across LibraryCollectionGroup and AllCollectionsView

// Helper component for horizontal split icons
export const HorizontalSplitIcon = ({
  Icon,
  activeState,
  inactiveState,
  removeWhenInactive,
  title,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  activeState: boolean;
  inactiveState: boolean;
  removeWhenInactive: boolean;
  title: string;
}) => (
  <div className="relative isolate h-5 w-5" title={title}>
    {/* Background icon (inactive state) */}
    <Icon
      className={`absolute inset-0 h-5 w-5 ${
        removeWhenInactive
          ? 'text-gray-700 opacity-20' // Much darker when removed from Plex
          : inactiveState
          ? 'text-gray-400' // Regular inactive color
          : 'text-gray-500 opacity-40' // Slightly lighter than previous inactive
      }`}
    />
    {/* Top half mask for active state */}
    <div className="absolute inset-0 isolate overflow-hidden">
      <div
        className="absolute inset-0 bg-stone-900"
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)',
        }}
      />
      <Icon
        className={`absolute inset-0 h-5 w-5 ${
          activeState ? 'text-gray-400' : 'text-gray-500 opacity-40'
        }`}
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)',
        }}
      />
    </div>
  </div>
);

export const getVisibilityIcons = (
  visibilityConfig?: {
    usersHome?: boolean;
    serverOwnerHome?: boolean;
    libraryRecommended?: boolean;
  },
  timeRestriction?: {
    alwaysActive: boolean;
    removeFromPlexWhenInactive?: boolean;
    inactiveVisibilityConfig?: {
      usersHome: boolean;
      serverOwnerHome: boolean;
      libraryRecommended: boolean;
    };
  }
) => {
  const hasTimeRestriction = timeRestriction && !timeRestriction.alwaysActive;
  const removeWhenInactive = Boolean(
    timeRestriction?.removeFromPlexWhenInactive
  );

  // Default to false if no visibilityConfig
  const activeVisibility = visibilityConfig || {
    usersHome: false,
    serverOwnerHome: false,
    libraryRecommended: false,
  };
  const inactiveVisibility = timeRestriction?.inactiveVisibilityConfig || {
    usersHome: false,
    serverOwnerHome: false,
    libraryRecommended: false,
  };

  return (
    <div className="flex w-20 items-center space-x-1">
      {/* Server Owner Home icon - fixed position */}
      <div
        className="flex h-5 w-5 items-center justify-center"
        title={
          hasTimeRestriction
            ? `Server Owner Home - Active: ${
                activeVisibility.serverOwnerHome ? 'On' : 'Off'
              }, Inactive: ${inactiveVisibility.serverOwnerHome ? 'On' : 'Off'}`
            : `Server Owner Home - ${
                activeVisibility.serverOwnerHome ? 'On' : 'Off'
              }`
        }
      >
        {hasTimeRestriction ? (
          <HorizontalSplitIcon
            Icon={HomeStarIcon}
            activeState={Boolean(activeVisibility.serverOwnerHome)}
            inactiveState={Boolean(inactiveVisibility.serverOwnerHome)}
            removeWhenInactive={removeWhenInactive}
            title=""
          />
        ) : (
          <HomeStarIcon
            className={`h-5 w-5 flex-shrink-0 ${
              activeVisibility.serverOwnerHome
                ? 'text-gray-400'
                : 'text-gray-500 opacity-40'
            }`}
          />
        )}
      </div>

      {/* Users Home icon - fixed position */}
      <div
        className="flex h-5 w-5 items-center justify-center"
        title={
          hasTimeRestriction
            ? `Users Home - Active: ${
                activeVisibility.usersHome ? 'On' : 'Off'
              }, Inactive: ${inactiveVisibility.usersHome ? 'On' : 'Off'}`
            : `Users Home - ${activeVisibility.usersHome ? 'On' : 'Off'}`
        }
      >
        {hasTimeRestriction ? (
          <HorizontalSplitIcon
            Icon={ThreeHomesIcon}
            activeState={Boolean(activeVisibility.usersHome)}
            inactiveState={Boolean(inactiveVisibility.usersHome)}
            removeWhenInactive={removeWhenInactive}
            title=""
          />
        ) : (
          <ThreeHomesIcon
            className={`h-5 w-5 ${
              activeVisibility.usersHome
                ? 'text-gray-400'
                : 'text-gray-500 opacity-40'
            }`}
          />
        )}
      </div>

      {/* Library Recommended icon - fixed position */}
      <div
        className="flex h-5 w-5 items-center justify-center"
        title={
          hasTimeRestriction
            ? `Library Recommended - Active: ${
                activeVisibility.libraryRecommended ? 'On' : 'Off'
              }, Inactive: ${
                inactiveVisibility.libraryRecommended ? 'On' : 'Off'
              }`
            : `Library Recommended - ${
                activeVisibility.libraryRecommended ? 'On' : 'Off'
              }`
        }
      >
        {hasTimeRestriction ? (
          <HorizontalSplitIcon
            Icon={LibraryBookmarkIcon}
            activeState={Boolean(activeVisibility.libraryRecommended)}
            inactiveState={Boolean(inactiveVisibility.libraryRecommended)}
            removeWhenInactive={removeWhenInactive}
            title=""
          />
        ) : (
          <LibraryBookmarkIcon
            className={`h-5 w-5 ${
              activeVisibility.libraryRecommended
                ? 'text-gray-400'
                : 'text-gray-500 opacity-40'
            }`}
          />
        )}
      </div>
    </div>
  );
};

export const getSubtypeLabel = (type: string, subtype?: string): string => {
  if (!subtype) return '';

  switch (type) {
    case 'trakt':
      switch (subtype) {
        case 'trending':
          return 'Trending';
        case 'popular':
          return 'Popular';
        case 'played':
          return 'Most Played';
        case 'watched':
          return 'Most Watched';
        case 'collected':
          return 'Most Collected';
        case 'favorited':
          return 'Most Favorited';
        case 'boxoffice':
          return 'Box Office';
        case 'custom':
          return 'Custom List';
        case 'watched_daily':
          return 'Watched Daily';
        case 'watched_weekly':
          return 'Watched Weekly';
        case 'watched_monthly':
          return 'Watched Monthly';
        case 'watched_all':
          return 'Most Watched All Time';
        case 'played_daily':
          return 'Played Daily';
        case 'played_weekly':
          return 'Played Weekly';
        case 'played_monthly':
          return 'Played Monthly';
        case 'played_all':
          return 'Most Played All Time';
        case 'collected_daily':
          return 'Collected Daily';
        case 'collected_weekly':
          return 'Collected Weekly';
        case 'collected_monthly':
          return 'Collected Monthly';
        case 'collected_all':
          return 'Most Collected All Time';
        case 'favorited_daily':
          return 'Favorited Daily';
        case 'favorited_weekly':
          return 'Favorited Weekly';
        case 'favorited_monthly':
          return 'Favorited Monthly';
        case 'favorited_all':
          return 'Most Favorited All Time';
        case 'recommendations':
          return 'Recommendations';
        case 'watchlist':
          return 'Watchlist';
        default:
          return subtype
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase());
      }
    case 'tmdb':
      switch (subtype) {
        case 'trending_day':
          return 'Trending Today';
        case 'trending_week':
          return 'Trending This Week';
        case 'popular':
          return 'Popular';
        case 'top_rated':
          return 'Top Rated';
        case 'auto_franchise':
          return 'Auto Franchise Collections';
        case 'custom':
          return 'Custom Collection';
        default:
          return subtype;
      }
    case 'imdb':
      switch (subtype) {
        case 'top_250':
          return 'Top 250';
        case 'top_250_english':
          return 'Top 250 English';
        case 'popular':
          return 'Popular';
        case 'most_popular':
          return 'Most Popular';
        case 'custom':
          return 'Custom List';
        default:
          return subtype;
      }
    case 'mdblist':
      switch (subtype) {
        case 'custom':
          return 'Custom List';
        default:
          return subtype;
      }
    case 'overseerr':
      switch (subtype) {
        case 'users':
          return 'Individual Users';
        case 'server_owner':
          return 'Server Owner';
        case 'global':
          return 'All Requests';
        default:
          return subtype;
      }
    case 'tautulli':
      switch (subtype) {
        case 'most_popular_plays':
          return 'Most Popular (Plays)';
        case 'most_popular_duration':
          return 'Most Popular (Duration)';
        case 'most_watched_plays':
          return 'Most Watched (Plays)';
        case 'most_watched_duration':
          return 'Most Watched (Duration)';
        default:
          return subtype;
      }
    case 'letterboxd':
      switch (subtype) {
        case 'custom':
          return 'Custom List';
        default:
          return subtype;
      }
    case 'anilist':
      switch (subtype) {
        case 'trending':
          return 'Trending Anime';
        case 'popular':
          return 'Popular Anime';
        case 'top_rated':
          return 'Top Rated Anime';
        case 'custom':
          return 'Custom List';
        default:
          return subtype;
      }
    case 'myanimelist':
      switch (subtype) {
        case 'all':
          return 'Top Anime';
        case 'airing':
          return 'Top Airing Anime';
        case 'tv':
          return 'Top TV';
        case 'movie':
          return 'Top Movies';
        case 'ova':
          return 'Top OVA';
        case 'special':
          return 'Top Specials';
        case 'bypopularity':
          return 'Most Popular Anime';
        case 'favorite':
          return 'Most Favorited Anime';
        default:
          return subtype;
      }
    case 'comingsoon':
      switch (subtype) {
        case 'monitored':
          return 'Monitored';
        case 'trakt_anticipated':
          return 'Trakt Anticipated';
        case 'tmdb_anticipated':
          return 'TMDB Anticipated';
        case 'recently_added':
          return 'Recently Added';
        default:
          return subtype;
      }
    case 'plex':
      switch (subtype) {
        case 'directors':
          return 'Directors Auto Collections';
        case 'actors':
          return 'Actors Auto Collections';
        default:
          return subtype;
      }
    case 'filtered_hub':
      switch (subtype) {
        case 'recently_added':
          return 'Recently Added';
        case 'recently_released':
          return 'Recently Released';
        case 'recently_released_episodes':
          return 'Recently Added Episodes';
        default:
          return subtype;
      }
    case 'networks':
      // Format platform names like "netflix_top_10" -> "Netflix"
      // and "neon-tv" -> "Neon TV"
      return subtype
        .split('_')[0] // Take first part before underscore (removes "_top_10" etc)
        .split('-') // Split on dashes
        .map((word) => {
          // Special case for TV to maintain proper capitalization
          if (word.toLowerCase() === 'tv') {
            return 'TV';
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
    case 'originals':
      // Format provider names like "netflix_originals" -> "Netflix"
      // and "apple_originals" -> "Apple TV+"
      return subtype
        .replace('_originals', '') // Remove "_originals" suffix
        .split('_')[0] // Take first part before underscore
        .split('-') // Split on dashes
        .map((word) => {
          // Special case for TV to maintain proper capitalization
          if (word.toLowerCase() === 'tv') {
            return 'TV+';
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
    default:
      return subtype;
  }
};

export const getTypeLabel = (type: string): string => {
  return type === 'trakt'
    ? 'Trakt'
    : type === 'tmdb'
    ? 'TMDB'
    : type === 'imdb'
    ? 'IMDb'
    : type === 'mdblist'
    ? 'MDBList'
    : type === 'letterboxd'
    ? 'Letterboxd'
    : type === 'anilist'
    ? 'AniList'
    : type === 'myanimelist'
    ? 'MyAnimeList'
    : type === 'tautulli'
    ? 'Tautulli'
    : type === 'radarrtag'
    ? 'Radarr Tag'
    : type === 'sonarrtag'
    ? 'Sonarr Tag'
    : type === 'overseerr'
    ? 'Seerr'
    : type === 'networks'
    ? 'Networks'
    : type === 'originals'
    ? 'Originals'
    : type === 'plex'
    ? 'Plex Library'
    : type === 'multi-source'
    ? 'Multi-Source'
    : type === 'comingsoon'
    ? 'Coming Soon'
    : type === 'filtered_hub'
    ? 'Filtered Hub'
    : type || '';
};

// Collection Type Badge - for Plex Default Hubs
export const PlexDefaultBadge: React.FC = () => {
  const intl = useIntl();
  return (
    <Badge badgeType="default" className="text-xs">
      {intl.formatMessage(messages.plexDefault)}
    </Badge>
  );
};

// Collection Type Badge - for Pre-Existing Collections
interface PreExistingBadgeProps {
  withBorder?: boolean;
}

export const PreExistingBadge: React.FC<PreExistingBadgeProps> = ({
  withBorder = false,
}) => {
  const intl = useIntl();
  return (
    <Badge
      badgeType={withBorder ? 'default' : 'warning'}
      className={
        withBorder
          ? '!border !border-orange-500 !bg-stone-600/20 text-xs !text-stone-300'
          : 'text-xs'
      }
    >
      {intl.formatMessage(messages.preExisting)}
    </Badge>
  );
};

// Enhanced Source & Subtype Badge
interface SourceSubtypeBadgeProps {
  type: string;
  subtype?: string;
}

export const SourceSubtypeBadge: React.FC<SourceSubtypeBadgeProps> = ({
  type,
  subtype,
}) => {
  const typeLabel = getTypeLabel(type);
  const subtypeLabel = getSubtypeLabel(type, subtype);
  const displayText = subtypeLabel
    ? `${typeLabel} - ${subtypeLabel}`
    : typeLabel;

  return (
    <Badge badgeType="primary" className="!bg-opacity-60">
      {displayText}
    </Badge>
  );
};

// Item Count Badge
interface ItemCountBadgeProps {
  maxItems: number;
}

export const ItemCountBadge: React.FC<ItemCountBadgeProps> = ({ maxItems }) => {
  const intl = useIntl();

  return (
    <Badge badgeType="default" className="!bg-opacity-30">
      {intl.formatMessage(messages.items, { maxItems })}
    </Badge>
  );
};

// Missing Items Badge - Shows when grab missing is enabled
interface MissingItemsBadgeProps {
  searchMissingMovies?: boolean;
  searchMissingTV?: boolean;
}

export const MissingItemsBadge: React.FC<MissingItemsBadgeProps> = ({
  searchMissingMovies,
  searchMissingTV,
}) => {
  const intl = useIntl();
  const hasGrabMissing = searchMissingMovies || searchMissingTV;

  if (!hasGrabMissing) return null;

  return (
    <Badge badgeType="default" className="!bg-opacity-30">
      {intl.formatMessage(messages.grabMissingItems)}
    </Badge>
  );
};

// Time Restrictions Badge
interface TimeRestrictionsBadgeProps {
  timeRestriction?: {
    alwaysActive: boolean;
  };
}

export const TimeRestrictionsBadge: React.FC<TimeRestrictionsBadgeProps> = ({
  timeRestriction,
}) => {
  const intl = useIntl();
  if (!timeRestriction || timeRestriction.alwaysActive) return null;

  return (
    <Badge badgeType="default" className="!bg-opacity-30">
      {intl.formatMessage(messages.timeRestrictionsSet)}
    </Badge>
  );
};

// Custom Sync Schedule Badge
interface CustomSyncScheduleBadgeProps {
  customSyncSchedule?: CollectionFormConfig['customSyncSchedule'];
}

export const CustomSyncScheduleBadge: React.FC<
  CustomSyncScheduleBadgeProps
> = ({ customSyncSchedule }) => {
  const syncBadgeText = formatSyncScheduleBadge(customSyncSchedule);

  if (!syncBadgeText) return null;

  return (
    <Badge badgeType="warning" className="!bg-opacity-40">
      {syncBadgeText}
    </Badge>
  );
};

// Unwatched Badge
interface UnwatchedBadgeProps {
  showUnwatchedOnly?: boolean;
}

export const UnwatchedBadge: React.FC<UnwatchedBadgeProps> = ({
  showUnwatchedOnly,
}) => {
  const intl = useIntl();
  if (!showUnwatchedOnly) return null;

  return (
    <Badge badgeType="default" className="!bg-opacity-30">
      {intl.formatMessage(messages.unwatched)}
    </Badge>
  );
};

// Placeholders Badge - Shows when create placeholders for missing items is enabled
interface PlaceholdersBadgeProps {
  createPlaceholdersForMissing?: boolean;
}

export const PlaceholdersBadge: React.FC<PlaceholdersBadgeProps> = ({
  createPlaceholdersForMissing,
}) => {
  const intl = useIntl();
  if (!createPlaceholdersForMissing) return null;

  return (
    <Badge badgeType="default" className="!bg-opacity-30">
      {intl.formatMessage(messages.createPlaceholders)}
    </Badge>
  );
};

// Missing Indicator - shown when collection no longer exists in Plex
interface MissingIndicatorProps {
  missing?: boolean;
  configType: 'collection' | 'hub' | 'preExisting';
}

export const MissingIndicator: React.FC<MissingIndicatorProps> = ({
  missing,
  configType,
}) => {
  if (!missing) return null;

  const itemType =
    configType === 'hub'
      ? 'hub'
      : configType === 'preExisting'
      ? 'pre-existing collection'
      : 'collection';

  return (
    <div title={`This ${itemType} no longer exists in Plex`}>
      <ExclamationTriangleIcon className="h-6 w-6 text-red-500" />
    </div>
  );
};

// Sync Status - Three-state system
interface SyncStatusProps {
  needsSync?: boolean;
  isActive?: boolean;
  onIndividualSync?: (collectionId: string) => Promise<void>;
  collectionId?: string;
  isSyncing?: boolean;
}

export const SyncStatus: React.FC<SyncStatusProps> = ({
  needsSync,
  isActive,
  onIndividualSync,
  collectionId,
  isSyncing,
}) => {
  return (
    <div className="flex w-12 justify-center">
      {needsSync ? (
        onIndividualSync && collectionId ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onIndividualSync(collectionId);
            }}
            disabled={isSyncing}
            className="group -m-1 rounded p-1 transition-colors hover:bg-gray-700/50"
            title={
              isSyncing ? 'Syncing...' : 'Click to sync this collection now'
            }
          >
            <ArrowPathIcon
              className={`h-4 w-4 transition-colors ${
                isSyncing
                  ? 'animate-spin text-yellow-400'
                  : 'text-red-400 group-hover:text-red-300'
              }`}
            />
          </button>
        ) : (
          <ArrowPathIcon
            className="h-4 w-4 text-red-400"
            title="Needs Sync - Collection has been modified and needs to be synced to Plex"
          />
        )
      ) : isActive ? (
        <CheckIcon
          className="h-4 w-4 text-gray-400"
          title="Synced and Active - Collection is up to date and currently active"
        />
      ) : (
        <XMarkIcon
          className="h-4 w-4 text-gray-400"
          title="Inactive - Collection is disabled by time restrictions"
        />
      )}
    </div>
  );
};

// Link Icon - Shows linking status
interface LinkIconProps {
  isLinked?: boolean;
  isUnlinked?: boolean;
  configType: 'collection' | 'hub' | 'preExisting';
}

export const LinkIcon: React.FC<LinkIconProps> = ({
  isLinked,
  isUnlinked,
  configType,
}) => {
  const itemType =
    configType === 'hub'
      ? 'Hub'
      : configType === 'preExisting'
      ? 'Pre-existing Collection'
      : 'Collection';

  return (
    <div className="flex w-6 justify-center">
      {isUnlinked ? (
        // Show unlink icon for deliberately unlinked collections
        <LinkSlashIcon
          className="h-4 w-4 text-gray-400"
          title={`Unlinked ${itemType} - was deliberately unlinked from group`}
        />
      ) : isLinked ? (
        // Show active link icon for linked collections
        <LinkIconHeroicon
          className="h-4 w-4 text-gray-400"
          title={`Linked ${itemType} - applies to all compatible libraries`}
        />
      ) : (
        // Show shaded link icon for unlinked collections (false state)
        <LinkIconHeroicon
          className="h-4 w-4 text-gray-600 opacity-30"
          title={`${itemType} not linked to other libraries`}
        />
      )}
    </div>
  );
};

// Library Badge - Unique to AllCollectionsView
interface LibraryBadgeProps {
  libraryName: string;
}

export const LibraryBadge: React.FC<LibraryBadgeProps> = ({ libraryName }) => (
  <Badge
    badgeType="default"
    className="!border !border-gray-500 !bg-transparent text-xs !text-gray-300"
  >
    {libraryName}
  </Badge>
);
