import Button from '@app/components/Common/Button';
import type {
  MultiSourceCollectionConfig,
  MultiSourceCombineMode,
  MultiSourceType,
} from '@app/types/collections';
import { validateApiKeysForCollectionType } from '@app/utils/apiKeyValidation';
import type {
  MainSettings,
  MDBListSettings,
  MyAnimeListSettings,
  OverseerrSettings,
  PlexSettings,
  RadarrSettings,
  SonarrSettings,
  TautulliSettings,
  TraktSettings,
} from '@server/lib/settings';
import { Field } from 'formik';
import React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

import ApiKeyWarning from './ApiKeyWarning';

const messages = defineMessages({
  sourceType: 'Source Type',
  sourceSubtype: 'Collection Sub-Type',
  selectSource: 'Select Source...',
  selectSubtype: 'Select sub-type...',
  networksCountry: 'Country/Region',
  networksPlatform: 'Streaming Platform',
  selectCountry: 'Select country...',
  selectPlatform: 'Select platform...',
  loadingPlatforms: 'Loading platforms...',
  customUrl: 'Custom URL',
  customUrlPlaceholder: 'Enter custom list URL',
  timePeriod: 'Time Period',
  customDays: 'Number of Days',
  minimumPlays: 'Minimum Play Count',
  combineMode: 'Combine Mode',
  addSource: 'Add Source',
  validateUrl: 'Validate URL',
  validatingUrl: 'Validating...',
  urlValid: 'Valid',
  urlInvalid: 'Invalid',
  mixedContentWarning:
    'Warning: Conflicting episodes/TV show lists detected across sources. Only "Cycle Lists" mode is available to prevent collection type conflicts.',
  // Radarr/Sonarr tag messages
  radarrInstance: 'Radarr Instance',
  sonarrInstance: 'Sonarr Instance',
  selectInstance: 'Select instance...',
  loadingInstances: 'Loading instances...',
  radarrTag: 'Radarr Tag',
  sonarrTag: 'Sonarr Tag',
  selectTag: 'Select tag...',
  loadingTags: 'Loading tags...',
  selectInstanceFirst: 'Select an instance first',
  loadPlatformsError: 'Failed to load platforms. Please try again.',
  loadInstancesError: 'Failed to load instances. Please try again.',
  loadTagsError: 'Failed to load tags. Please try again.',
  sources: 'Sources ({count})',
  noSourcesConfigured:
    'No sources configured. Click Add Source to get started.',
  sourceNumber: 'Source {number}',
  remove: 'Remove',
  overseerrRequests: 'Overseerr Requests',
  tautulliStatistics: 'Tautulli Statistics',
  traktLists: 'Trakt Lists',
  letterboxdLists: 'Letterboxd Lists',
  tmdbLists: 'TMDB Lists',
  imdbLists: 'IMDb Lists',
  mdblistLists: 'MDBList Lists',
  networks: 'Networks',
  streamingOriginals: 'Streaming Originals',
  radarrTags: 'Radarr Tags',
  sonarrTags: 'Sonarr Tags',
  anilist: 'AniList',
  myAnimeList: 'MyAnimeList',
  comingSoon: 'Coming Soon',
  contains: 'Contains: {types}',
  global: 'Global',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  allTime: 'All Time',
  detectedContentTypes: 'Detected content types: {types}',
  disabledMixedContent: '(Disabled - mixed content detected)',
});

interface SubtypeOption {
  value: string;
  label: string;
  description?: string;
}

interface ArrTag {
  id: number;
  label: string;
}

type SetMultiSourceFieldValue = (
  field: string,
  value: string | number | boolean | string[] | object | undefined
) => void;

// Simple component for networks platform selection (follows NetworksConfigSection pattern)
const NetworksPlatformSelect = ({
  country,
  value,
  onChange,
  index,
}: {
  country: string;
  value: string;
  onChange: (value: string) => void;
  index: number;
}) => {
  const intl = useIntl();

  // Always call useSWR but conditionally pass URL (fixes React Hooks rules)
  const platformsUrl = country
    ? `/api/v1/collections/networks/platforms?country=${encodeURIComponent(
        country
      )}`
    : null;

  const { data: platforms, error: platformsError } = useSWR<
    { value: string; label: string }[]
  >(
    platformsUrl,
    platformsUrl ? (url) => fetch(url).then((res) => res.json()) : null
  );

  const isLoadingPlatforms = country && !platforms && !platformsError;

  return (
    <>
      <Field
        as="select"
        id={`source-platform-${index}`}
        name={`sources[${index}].subtype`}
        value={value}
        className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
        disabled={isLoadingPlatforms}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          onChange(e.target.value);
        }}
      >
        <option value="">
          {isLoadingPlatforms
            ? intl.formatMessage(messages.loadingPlatforms)
            : intl.formatMessage(messages.selectPlatform)}
        </option>
        {Array.isArray(platforms) &&
          platforms.map((platform) => (
            <option key={platform.value} value={platform.value}>
              {platform.label}
            </option>
          ))}
      </Field>
      {platformsError && (
        <p className="mt-1 text-xs text-red-400">
          {intl.formatMessage(messages.loadPlatformsError)}
        </p>
      )}
    </>
  );
};

// Tag selection component for Radarr/Sonarr sources in multi-source configs
const ArrTagSelect = ({
  sourceType,
  sourceIndex,
  values,
  setFieldValue,
}: {
  sourceType: 'radarrtag' | 'sonarrtag';
  sourceIndex: number;
  values: MultiSourceCollectionConfig;
  setFieldValue: SetMultiSourceFieldValue;
}) => {
  const intl = useIntl();
  const isRadarr = sourceType === 'radarrtag';
  const isSonarr = sourceType === 'sonarrtag';

  const instanceIdField = isRadarr ? 'radarrTagServerId' : 'sonarrTagServerId';
  const tagIdField = isRadarr ? 'radarrTagId' : 'sonarrTagId';

  // Read instance ID directly from form values
  const currentSource = values.sources?.[sourceIndex];
  const instanceIdRaw = currentSource?.[
    instanceIdField as keyof typeof currentSource
  ] as number | string | undefined;

  // Convert to number, handling both string and number inputs
  let instanceId: number | undefined = undefined;
  if (
    instanceIdRaw !== undefined &&
    instanceIdRaw !== null &&
    instanceIdRaw !== ''
  ) {
    const parsed =
      typeof instanceIdRaw === 'string'
        ? parseInt(instanceIdRaw, 10)
        : instanceIdRaw;
    instanceId = !Number.isNaN(parsed) ? parsed : undefined;
  }

  const isInstanceSelected =
    instanceId !== undefined && !Number.isNaN(instanceId);

  // Reset tag selection when instance changes
  const previousInstanceIdRef = React.useRef<number | undefined>(instanceId);
  React.useEffect(() => {
    if (
      previousInstanceIdRef.current !== instanceId &&
      previousInstanceIdRef.current !== undefined
    ) {
      setFieldValue(`sources[${sourceIndex}].${tagIdField}`, undefined);
    }
    previousInstanceIdRef.current = instanceId;
  }, [instanceId, sourceIndex, tagIdField, setFieldValue]);

  // Fetch instances
  const { data: radarrInstances, error: radarrError } = useSWR<
    RadarrSettings[]
  >(isRadarr ? '/api/v1/settings/radarr' : null, (url) =>
    fetch(url).then((res) => res.json())
  );

  const { data: sonarrInstances, error: sonarrError } = useSWR<
    SonarrSettings[]
  >(isSonarr ? '/api/v1/settings/sonarr' : null, (url) =>
    fetch(url).then((res) => res.json())
  );

  // Fetch tags for the selected instance
  const radarrTagsUrl =
    isRadarr && isInstanceSelected
      ? `/api/v1/settings/radarr/${instanceId}/tags`
      : null;

  const sonarrTagsUrl =
    isSonarr && isInstanceSelected
      ? `/api/v1/settings/sonarr/${instanceId}/tags`
      : null;

  const { data: radarrTags, error: radarrTagsError } = useSWR<ArrTag[]>(
    radarrTagsUrl,
    radarrTagsUrl ? (url) => fetch(url).then((res) => res.json()) : null
  );

  const { data: sonarrTags, error: sonarrTagsError } = useSWR<ArrTag[]>(
    sonarrTagsUrl,
    sonarrTagsUrl ? (url) => fetch(url).then((res) => res.json()) : null
  );

  const isLoadingInstances = isRadarr
    ? !radarrInstances && !radarrError
    : isSonarr
    ? !sonarrInstances && !sonarrError
    : false;

  const isLoadingTags = isRadarr
    ? isInstanceSelected && !radarrTags && !radarrTagsError
    : isSonarr
    ? isInstanceSelected && !sonarrTags && !sonarrTagsError
    : false;

  const instances = isRadarr
    ? radarrInstances
    : isSonarr
    ? sonarrInstances
    : [];
  const tags = isRadarr ? radarrTags : isSonarr ? sonarrTags : [];
  const instanceError = isRadarr ? radarrError : isSonarr ? sonarrError : null;
  const tagsError = isRadarr
    ? radarrTagsError
    : isSonarr
    ? sonarrTagsError
    : null;

  return (
    <div className="space-y-4">
      {/* Instance Selection */}
      <div>
        <label
          htmlFor={`source-instance-${sourceIndex}`}
          className="mb-2 block text-sm text-gray-300"
        >
          {isRadarr
            ? intl.formatMessage(messages.radarrInstance)
            : intl.formatMessage(messages.sonarrInstance)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id={`source-instance-${sourceIndex}`}
          name={`sources[${sourceIndex}].${instanceIdField}`}
          className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          disabled={isLoadingInstances}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const value = e.target.value;
            const numValue = value ? Number(value) : undefined;
            setFieldValue(
              `sources[${sourceIndex}].${instanceIdField}`,
              numValue
            );
          }}
        >
          <option value="">
            {isLoadingInstances
              ? intl.formatMessage(messages.loadingInstances)
              : intl.formatMessage(messages.selectInstance)}
          </option>
          {Array.isArray(instances) &&
            instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name || `${instance.hostname}:${instance.port}`}
                {instance.isDefault ? ' (Default)' : ''}
              </option>
            ))}
        </Field>
        {instanceError && (
          <p className="mt-1 text-xs text-red-400">
            {intl.formatMessage(messages.loadInstancesError)}
          </p>
        )}
      </div>

      {/* Tag selection */}
      <div>
        <label
          htmlFor={`source-tag-${sourceIndex}`}
          className="mb-2 block text-sm text-gray-300"
        >
          {isRadarr
            ? intl.formatMessage(messages.radarrTag)
            : intl.formatMessage(messages.sonarrTag)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id={`source-tag-${sourceIndex}`}
          name={`sources[${sourceIndex}].${tagIdField}`}
          className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          disabled={isLoadingTags || !isInstanceSelected}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const value = e.target.value;
            const numValue = value ? Number(value) : undefined;
            setFieldValue(`sources[${sourceIndex}].${tagIdField}`, numValue);
          }}
        >
          <option value="">
            {!isInstanceSelected
              ? intl.formatMessage(messages.selectInstanceFirst)
              : isLoadingTags
              ? intl.formatMessage(messages.loadingTags)
              : intl.formatMessage(messages.selectTag)}
          </option>
          {Array.isArray(tags) &&
            tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.label}
              </option>
            ))}
        </Field>
        {tagsError && (
          <p className="mt-1 text-xs text-red-400">
            {intl.formatMessage(messages.loadTagsError)}
          </p>
        )}
      </div>
    </div>
  );
};

interface SourceValidation {
  isValidating: boolean;
  isValid: boolean | null;
  title: string | null;
  mediaType: 'movie' | 'tv' | 'both' | 'mixed' | null;
  contentTypes: string[];
  error: string | null;
}

interface MultiSourceConfigSectionProps {
  values: MultiSourceCollectionConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | undefined
  ) => void;
  isVisible?: boolean;
}

const MultiSourceConfigSection = ({
  values,
  setFieldValue,
  isVisible = true,
}: MultiSourceConfigSectionProps) => {
  const intl = useIntl();

  // Fetch available countries for networks (must be before early return)
  const { data: countries } = useSWR<{ value: string; label: string }[]>(
    '/api/v1/collections/networks/countries',
    (url) => fetch(url).then((res) => res.json())
  );

  // Fetch API settings for validation
  const { data: mainSettings } = useSWR<MainSettings>('/api/v1/settings/main');
  const { data: plexSettings } = useSWR<PlexSettings>('/api/v1/settings/plex');
  const { data: traktSettings } = useSWR<TraktSettings>(
    '/api/v1/settings/trakt'
  );
  const { data: mdblistSettings } = useSWR<MDBListSettings>(
    '/api/v1/settings/mdblist'
  );
  const { data: tautulliSettings } = useSWR<TautulliSettings>(
    '/api/v1/settings/tautulli'
  );
  const { data: overseerrSettings } = useSWR<OverseerrSettings>(
    '/api/v1/settings/overseerr'
  );
  const { data: myanimelistSettings } = useSWR<MyAnimeListSettings>(
    '/api/v1/settings/myanimelist'
  );
  const { data: radarrSettings } = useSWR<RadarrSettings[]>(
    '/api/v1/settings/radarr'
  );
  const { data: sonarrSettings } = useSWR<SonarrSettings[]>(
    '/api/v1/settings/sonarr'
  );

  // State for tracking validation status of each source (must be before early return)
  const [sourceValidations, setSourceValidations] = React.useState<
    Record<string, SourceValidation>
  >({});

  const sources = React.useMemo(() => values.sources ?? [], [values.sources]);

  // Ensure *arr tag sources always have the correct subtype
  React.useEffect(() => {
    sources.forEach((source, index) => {
      if (
        source &&
        (source.type === 'radarrtag' || source.type === 'sonarrtag') &&
        source.subtype !== 'tag'
      ) {
        setFieldValue(`sources[${index}].subtype`, 'tag');
      }
    });
  }, [sources, setFieldValue]);

  // Validate a source URL using SSE endpoint
  const validateSourceUrl = React.useCallback(
    async (sourceId: string, url: string, type: string) => {
      if (!url?.trim()) return;

      // Set validating state
      setSourceValidations((prev) => ({
        ...prev,
        [sourceId]: {
          isValidating: true,
          isValid: null,
          title: null,
          mediaType: null,
          contentTypes: [],
          error: null,
        },
      }));

      return new Promise<void>((resolve, reject) => {
        const eventSource = new EventSource(
          `/api/v1/collections/fetch-title?url=${encodeURIComponent(
            url
          )}&type=${type}`
        );

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.status === 'success') {
              // Update validation state with results
              setSourceValidations((prev) => ({
                ...prev,
                [sourceId]: {
                  isValidating: false,
                  isValid: true,
                  title: data.title || null,
                  mediaType: data.mediaType || null,
                  contentTypes: data.contentTypes || [],
                  error: null,
                },
              }));
              eventSource.close();
              resolve();
            } else if (data.status === 'error') {
              // Update validation state with error
              setSourceValidations((prev) => ({
                ...prev,
                [sourceId]: {
                  isValidating: false,
                  isValid: false,
                  title: null,
                  mediaType: null,
                  contentTypes: [],
                  error: data.message || 'Validation failed',
                },
              }));
              eventSource.close();
              reject(new Error(data.message));
            }
            // Ignore progress messages - just wait for success/error
          } catch (parseError) {
            setSourceValidations((prev) => ({
              ...prev,
              [sourceId]: {
                isValidating: false,
                isValid: false,
                title: null,
                mediaType: null,
                contentTypes: [],
                error: 'Failed to parse response',
              },
            }));
            eventSource.close();
            reject(parseError);
          }
        };

        eventSource.onerror = () => {
          setSourceValidations((prev) => ({
            ...prev,
            [sourceId]: {
              isValidating: false,
              isValid: false,
              title: null,
              mediaType: null,
              contentTypes: [],
              error: `Connection error while validating ${type} URL`,
            },
          }));
          eventSource.close();
          reject(new Error('Connection error'));
        };
      });
    },
    []
  );

  // Detect actual mixed content - episodes vs movies/shows across sources
  const detectMixedContent = React.useCallback(() => {
    if (sources.length < 2)
      return { hasMixedContent: false, allContentTypes: [] };

    // Check if any custom URL contains episodes (requires validation)
    const hasEpisodes = sources.some((source) => {
      const validation = sourceValidations[source.id];
      return (
        validation?.isValid && validation.contentTypes.includes('episodes')
      );
    });

    // Check if any source contains movies/shows
    const hasMoviesOrShows = sources.some((source) => {
      const validation = sourceValidations[source.id];

      // If custom URL is validated, check actual content types
      if (source.subtype === 'custom' && validation?.isValid) {
        return (
          validation.contentTypes.includes('movies') ||
          validation.contentTypes.includes('shows')
        );
      }

      // If not custom (preset source), assume it contains movies/shows
      if (source.subtype !== 'custom' && source.subtype !== '') {
        return true;
      }

      return false;
    });

    // Mixed content exists if we have BOTH episodes AND movies/shows
    const hasMixedContent = hasEpisodes && hasMoviesOrShows;

    // Collect all content types for display
    const allContentTypes = new Set<string>();

    // Add content types from validated custom sources
    sources.forEach((source) => {
      const validation = sourceValidations[source.id];
      if (validation?.isValid && validation.contentTypes.length > 0) {
        validation.contentTypes.forEach((type) => allContentTypes.add(type));
      }
    });

    // Add implicit content types for preset sources
    const hasPresetSources = sources.some(
      (source) => source.subtype !== 'custom' && source.subtype !== ''
    );
    if (hasPresetSources) {
      allContentTypes.add('movies');
      allContentTypes.add('shows');
    }

    return {
      hasMixedContent,
      allContentTypes: Array.from(allContentTypes),
    };
  }, [sources, sourceValidations]);

  const mixedContentInfo = detectMixedContent();

  // Auto-correct combine mode when mixed content is detected
  React.useEffect(() => {
    if (mixedContentInfo.hasMixedContent) {
      const currentMode = values.combineMode;
      const disabledModes = ['interleaved', 'list_order', 'randomised'];

      if (disabledModes.includes(currentMode)) {
        setFieldValue('combineMode', 'cycle_lists');
      }
    }
  }, [mixedContentInfo.hasMixedContent, values.combineMode, setFieldValue]);

  const combineModeOptions = React.useMemo(() => {
    // Check if ALL sources are Coming Soon
    const allSourcesComingSoon =
      sources.length > 0 &&
      sources.every((source) => source.type === 'comingsoon');

    // For Coming Soon-only collections, show Release Date (default), Cycle Lists, and Randomised
    if (allSourcesComingSoon) {
      return [
        {
          value: 'interleaved' as MultiSourceCombineMode, // Default mode - backend sorts by release date
          label: 'Release Date',
          description:
            'Sort all items by release date (closest first). Default mode for Coming Soon collections.',
          disabled: false,
        },
        {
          value: 'cycle_lists' as MultiSourceCombineMode,
          label: 'Cycle Lists',
          description:
            'Only one Coming Soon source active at a time, rotates each sync. Each source is sorted by release date.',
          disabled: false,
        },
        {
          value: 'randomised' as MultiSourceCombineMode,
          label: 'Randomised',
          description: 'Shuffle all items randomly on every sync',
          disabled: false,
        },
      ];
    }

    // Normal combine mode options (Coming Soon sources will be sorted by date before combining)
    return [
      {
        value: 'interleaved' as MultiSourceCombineMode,
        label: 'Interleaved',
        description: 'Take 1st item from each source, then 2nd from each, etc.',
        disabled: mixedContentInfo.hasMixedContent,
      },
      {
        value: 'list_order' as MultiSourceCombineMode,
        label: 'List Order',
        description: 'All items from source 1, then all from source 2, etc.',
        disabled: mixedContentInfo.hasMixedContent,
      },
      {
        value: 'randomised' as MultiSourceCombineMode,
        label: 'Randomised',
        description: 'Shuffle all items randomly on every sync',
        disabled: mixedContentInfo.hasMixedContent,
      },
      {
        value: 'cycle_lists' as MultiSourceCombineMode,
        label: 'Cycle Lists',
        description: 'Only one source active at a time, rotates each sync',
        disabled: false, // Always available
      },
    ];
  }, [sources, mixedContentInfo.hasMixedContent]);

  if (!isVisible) return null;

  const addSource = () => {
    const newSource = {
      id: `source-${Date.now()}`,
      type: '' as MultiSourceType,
      subtype: '',
      priority: sources.length,
      networksCountry: '',
      // Initialize *arr tag fields
      radarrTagServerId: undefined,
      radarrTagId: undefined,
      sonarrTagServerId: undefined,
      sonarrTagId: undefined,
    };
    setFieldValue('sources', [...sources, newSource]);
  };

  const removeSource = (index: number) => {
    const updatedSources = sources.filter((_, i) => i !== index);
    setFieldValue('sources', updatedSources);
  };

  const getSubtypeOptions = (type: string): SubtypeOption[] => {
    switch (type) {
      case 'overseerr':
        return [
          {
            value: 'users',
            label: 'Individual Users Requests (excl. server owner)',
          },
          { value: 'server_owner', label: 'Server Owner requests' },
          { value: 'global', label: 'All Requests' },
        ];
      case 'tautulli':
        return [
          {
            value: 'most_popular_plays',
            label: 'Most Popular (by Play Count)',
          },
          {
            value: 'most_popular_duration',
            label: 'Most Popular (by Watch Duration)',
          },
        ];
      case 'trakt':
        return [
          {
            value: 'trending',
            label: 'Trending Now',
            description: 'Movies/shows being watched right now',
          },
          {
            value: 'popular',
            label: 'Popular',
            description: 'Most popular based on ratings and votes',
          },
          {
            value: 'recommendations',
            label: 'Recommendations',
            description:
              'Personalized Trakt recommendations (uses your library media type)',
          },
          {
            value: 'played',
            label: 'Most Played',
            description: 'Most played content (supports time periods)',
          },
          {
            value: 'watched',
            label: 'Most Watched',
            description: 'Most watched by unique users (supports time periods)',
          },
          {
            value: 'collected',
            label: 'Most Collected',
            description:
              'Most collected by unique users (supports time periods)',
          },
          {
            value: 'favorited',
            label: 'Most Favorited',
            description: 'Most favorited content (supports time periods)',
          },
          {
            value: 'boxoffice',
            label: 'Box Office',
            description: 'Top 10 grossing movies last weekend (movies only)',
          },
          {
            value: 'custom',
            label: 'Custom List',
            description: 'Import a custom Trakt list by URL',
          },
          {
            value: 'random',
            label: 'Random Lists',
            description: 'Randomly select from configured Trakt lists',
          },
        ];
      case 'mdblist':
        return [
          {
            value: 'custom',
            label: 'Custom List',
            description: 'Import a custom MDBList by URL',
          },
        ];
      case 'tmdb':
        return [
          { value: 'trending_day', label: 'Trending Today' },
          { value: 'trending_week', label: 'Trending This Week' },
          { value: 'popular', label: 'Popular' },
          { value: 'top_rated', label: 'Top Rated' },
          { value: 'custom', label: 'Custom Collection' },
          {
            value: 'random',
            label: 'Random Lists',
            description: 'Randomly select from configured TMDB lists',
          },
        ];
      case 'imdb':
        return [
          {
            value: 'top_250',
            label: 'Top 250',
            description: 'Highest rated movies/TV shows on IMDb',
          },
          {
            value: 'top_250_english',
            label: 'Top 250 English',
            description:
              'Highest rated English-language movies on IMDb (movies only)',
          },
          {
            value: 'popular',
            label: 'Popular (Meter)',
            description: 'Most viewed by IMDb users based on page views',
          },
          {
            value: 'boxoffice',
            label: 'Box Office',
            description: 'Top grossing movies at the box office (movies only)',
          },
          { value: 'custom', label: 'Custom List' },
          {
            value: 'random',
            label: 'Random Lists',
            description: 'Randomly select from configured IMDb lists',
          },
        ];
      case 'letterboxd':
        return [
          { value: 'custom', label: 'Custom List' },
          {
            value: 'watchlist',
            label: 'Watchlist',
            description: "Import a user's watchlist by URL",
          },
          {
            value: 'random',
            label: 'Random Lists',
            description: 'Randomly select from configured Letterboxd lists',
          },
        ];
      case 'networks':
        return []; // Will be populated dynamically based on selected country
      case 'originals':
        return [
          { value: 'netflix_originals', label: 'Netflix Originals' },
          { value: 'amazon_originals', label: 'Amazon Originals' },
          { value: 'disney_originals', label: 'Disney+ Originals' },
          { value: 'hbomax_originals', label: 'HBO Max Originals' },
          { value: 'paramount_originals', label: 'Paramount+ Originals' },
          { value: 'hulu_originals', label: 'Hulu Originals' },
          { value: 'peacock_originals', label: 'Peacock Originals' },
          { value: 'apple_originals', label: 'Apple TV+ Originals' },
          { value: 'discovery_originals', label: 'Discovery+ Movies' },
        ];
      case 'anilist':
        return [
          {
            value: 'trending',
            label: 'Trending Anime',
            description: 'Trending anime on AniList',
          },
          {
            value: 'popular',
            label: 'Popular Anime',
            description: 'Most popular anime on AniList',
          },
          {
            value: 'top_rated',
            label: 'Top Rated Anime',
            description: 'Highest-rated anime on AniList',
          },
          {
            value: 'custom',
            label: 'Custom List',
            description: 'Import a custom AniList list by URL',
          },
        ];
      case 'myanimelist':
        return [
          {
            value: 'all',
            label: 'Top Anime Series',
            description: 'Highest-rated anime overall',
          },
          {
            value: 'airing',
            label: 'Top Airing Anime',
            description: 'Highest-rated currently airing anime',
          },
          {
            value: 'tv',
            label: 'Top Anime TV Series',
            description: 'Highest-rated TV anime series',
          },
          {
            value: 'movie',
            label: 'Top Anime Movies',
            description: 'Highest-rated anime movies',
          },
          {
            value: 'ova',
            label: 'Top OVA Series',
            description: 'Highest-rated OVA anime',
          },
          {
            value: 'special',
            label: 'Top Anime Specials',
            description: 'Highest-rated anime specials',
          },
        ];
      case 'radarrtag':
        return [];
      case 'sonarrtag':
        return [];
      case 'comingsoon':
        return [
          {
            value: 'monitored',
            label: 'Monitored in Radarr/Sonarr',
            description: 'Items monitored but not yet released',
          },
          {
            value: 'trakt_anticipated',
            label: 'Trakt Anticipated',
            description: 'Most anticipated upcoming releases',
          },
          {
            value: 'tmdb_anticipated',
            label: 'TMDB Coming Soon',
            description:
              'Upcoming releases from TMDB (movies: digital/physical, TV: new & returning shows)',
          },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h4 className="text-md font-medium text-gray-100">
          {intl.formatMessage(messages.sources, { count: sources.length })}
        </h4>

        {sources.length === 0 && (
          <div className="py-6 text-center text-gray-400">
            {intl.formatMessage(messages.noSourcesConfigured)}
          </div>
        )}

        {sources.map((source, index) => (
          <div
            key={source.id}
            className="space-y-4 rounded-lg border border-slate-500 bg-stone-800 p-4"
          >
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-medium text-gray-200">
                {intl.formatMessage(messages.sourceNumber, {
                  number: index + 1,
                })}
              </h5>
              {sources.length > 1 && (
                <Button
                  onClick={() => removeSource(index)}
                  buttonType="danger"
                  buttonSize="sm"
                >
                  {intl.formatMessage(messages.remove)}
                </Button>
              )}
            </div>

            <div>
              <label
                htmlFor={`source-type-${index}`}
                className="mb-2 block text-sm text-gray-300"
              >
                {intl.formatMessage(messages.sourceType)}{' '}
                <span className="text-red-500">*</span>
              </label>
              <Field
                as="select"
                id={`source-type-${index}`}
                name={`sources[${index}].type`}
                className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const newType = e.target.value;
                  setFieldValue(`sources[${index}].type`, newType);
                  if (newType === 'radarrtag' || newType === 'sonarrtag') {
                    setFieldValue(`sources[${index}].subtype`, 'tag');
                    if (newType === 'radarrtag') {
                      setFieldValue(
                        `sources[${index}].sonarrTagServerId`,
                        undefined
                      );
                      setFieldValue(`sources[${index}].sonarrTagId`, undefined);
                    } else {
                      setFieldValue(
                        `sources[${index}].radarrTagServerId`,
                        undefined
                      );
                      setFieldValue(`sources[${index}].radarrTagId`, undefined);
                    }
                  } else {
                    setFieldValue(`sources[${index}].subtype`, ''); // Reset subtype when type changes
                    setFieldValue(
                      `sources[${index}].radarrTagServerId`,
                      undefined
                    );
                    setFieldValue(`sources[${index}].radarrTagId`, undefined);
                    setFieldValue(
                      `sources[${index}].sonarrTagServerId`,
                      undefined
                    );
                    setFieldValue(`sources[${index}].sonarrTagId`, undefined);
                  }
                }}
              >
                <option value="">
                  {intl.formatMessage(messages.selectSource)}
                </option>
                <option value="overseerr">
                  {intl.formatMessage(messages.overseerrRequests)}
                </option>
                <option value="tautulli">
                  {intl.formatMessage(messages.tautulliStatistics)}
                </option>
                <option value="trakt">
                  {intl.formatMessage(messages.traktLists)}
                </option>
                <option value="letterboxd">
                  {intl.formatMessage(messages.letterboxdLists)}
                </option>
                <option value="tmdb">
                  {intl.formatMessage(messages.tmdbLists)}
                </option>
                <option value="imdb">
                  {intl.formatMessage(messages.imdbLists)}
                </option>
                <option value="mdblist">
                  {intl.formatMessage(messages.mdblistLists)}
                </option>
                <option value="networks">
                  {intl.formatMessage(messages.networks)}
                </option>
                <option value="originals">
                  {intl.formatMessage(messages.streamingOriginals)}
                </option>
                <option value="radarrtag">
                  {intl.formatMessage(messages.radarrTags)}
                </option>
                <option value="sonarrtag">
                  {intl.formatMessage(messages.sonarrTags)}
                </option>
                <option value="anilist">
                  {intl.formatMessage(messages.anilist)}
                </option>
                <option value="myanimelist">
                  {intl.formatMessage(messages.myAnimeList)}
                </option>
                <option value="comingsoon">
                  {intl.formatMessage(messages.comingSoon)}
                </option>
              </Field>

              {/* API Key Warning for this source */}
              {values.sources?.[index]?.type &&
                (() => {
                  const sourceType = values.sources[index].type;
                  const sourceSubtype = values.sources[index].subtype;
                  const apiKeyValidation = validateApiKeysForCollectionType(
                    sourceType,
                    {
                      main: mainSettings,
                      plex: plexSettings,
                      trakt: traktSettings,
                      mdblist: mdblistSettings,
                      tautulli: tautulliSettings,
                      overseerr: overseerrSettings,
                      myanimelist: myanimelistSettings,
                      radarr: radarrSettings,
                      sonarr: sonarrSettings,
                    },
                    sourceSubtype
                  );
                  return <ApiKeyWarning validation={apiKeyValidation} />;
                })()}
            </div>

            {values.sources?.[index]?.type &&
              getSubtypeOptions(values.sources[index].type).length > 0 && (
                <div>
                  <label
                    htmlFor={`source-subtype-${index}`}
                    className="mb-2 block text-sm text-gray-300"
                  >
                    {intl.formatMessage(messages.sourceSubtype)}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <Field
                    as="select"
                    id={`source-subtype-${index}`}
                    name={`sources[${index}].subtype`}
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const newSubtype = e.target.value;
                      setFieldValue(`sources[${index}].subtype`, newSubtype);
                    }}
                  >
                    <option value="">
                      {intl.formatMessage(messages.selectSubtype)}
                    </option>
                    {getSubtypeOptions(values.sources[index].type).map(
                      (option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      )
                    )}
                  </Field>

                  {/* Show description if available */}
                  {values.sources?.[index]?.subtype &&
                    (() => {
                      const selectedOption = getSubtypeOptions(
                        values.sources[index].type
                      ).find(
                        (opt) => opt.value === values.sources[index].subtype
                      );
                      return selectedOption?.description ? (
                        <p className="mt-1 text-xs text-gray-400">
                          {selectedOption.description}
                        </p>
                      ) : null;
                    })()}
                </div>
              )}

            {values.sources?.[index]?.subtype === 'custom' && (
              <div>
                <label
                  htmlFor={`source-url-${index}`}
                  className="mb-2 block text-sm text-gray-300"
                >
                  {intl.formatMessage(messages.customUrl)}{' '}
                  <span className="text-red-500">*</span>
                </label>
                <div className="flex space-x-2">
                  <Field
                    type="text"
                    id={`source-url-${index}`}
                    name={`sources[${index}].customUrl`}
                    placeholder={intl.formatMessage(
                      messages.customUrlPlaceholder
                    )}
                    className="flex-1 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setFieldValue(
                        `sources[${index}].customUrl`,
                        e.target.value
                      );
                      // Clear validation when URL changes
                      setSourceValidations((prev) => ({
                        ...prev,
                        [source.id]: {
                          isValidating: false,
                          isValid: null,
                          title: null,
                          mediaType: null,
                          contentTypes: [],
                          error: null,
                        },
                      }));
                    }}
                  />
                  <Button
                    buttonType="ghost"
                    buttonSize="sm"
                    disabled={
                      !source.customUrl?.trim() ||
                      sourceValidations[source.id]?.isValidating ||
                      !source.type
                    }
                    onClick={() =>
                      validateSourceUrl(
                        source.id,
                        source.customUrl || '',
                        source.type
                      )
                    }
                  >
                    {sourceValidations[source.id]?.isValidating
                      ? intl.formatMessage(messages.validatingUrl)
                      : intl.formatMessage(messages.validateUrl)}
                  </Button>
                </div>

                {/* Validation Status Display */}
                {(() => {
                  const validation = sourceValidations[source.id];
                  if (!validation) return null;

                  if (validation.isValid === true) {
                    return (
                      <div className="mt-2 rounded-md border border-green-500/20 bg-green-500/10 p-2">
                        <div className="flex items-center space-x-2">
                          <svg
                            className="h-4 w-4 flex-shrink-0 text-green-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <div className="flex-1">
                            <p className="text-sm text-green-200">
                              <strong>
                                {intl.formatMessage(messages.urlValid)}
                              </strong>
                              {validation.title && `: ${validation.title}`}
                            </p>
                            {validation.contentTypes.length > 0 && (
                              <p className="text-xs text-green-300">
                                {intl.formatMessage(messages.contains, {
                                  types: validation.contentTypes.join(', '),
                                })}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  } else if (validation.isValid === false) {
                    return (
                      <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 p-2">
                        <div className="flex items-center space-x-2">
                          <svg
                            className="h-4 w-4 flex-shrink-0 text-red-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <div className="flex-1">
                            <p className="text-sm text-red-200">
                              <strong>
                                {intl.formatMessage(messages.urlInvalid)}
                              </strong>
                              {validation.error && `: ${validation.error}`}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

            {/* Radarr/Sonarr Tag Selection */}
            {(values.sources?.[index]?.type === 'radarrtag' ||
              values.sources?.[index]?.type === 'sonarrtag') && (
              <ArrTagSelect
                sourceType={
                  values.sources[index].type as 'radarrtag' | 'sonarrtag'
                }
                sourceIndex={index}
                values={values}
                setFieldValue={setFieldValue}
              />
            )}

            {values.sources?.[index]?.type === 'networks' && (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor={`source-country-${index}`}
                    className="mb-2 block text-sm text-gray-300"
                  >
                    {intl.formatMessage(messages.networksCountry)}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <Field
                    as="select"
                    id={`source-country-${index}`}
                    name={`sources[${index}].networksCountry`}
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      const newCountry = e.target.value;
                      setFieldValue(
                        `sources[${index}].networksCountry`,
                        newCountry
                      );
                      // Reset platform selection when country changes
                      if (
                        newCountry !== values.sources?.[index]?.networksCountry
                      ) {
                        setFieldValue(`sources[${index}].subtype`, '');
                      }
                    }}
                    disabled={false}
                  >
                    <option value="">
                      {intl.formatMessage(messages.selectCountry)}
                    </option>

                    {/* Global option - always available */}
                    <option value="global">
                      {intl.formatMessage(messages.global)}
                    </option>

                    {/* Separator */}
                    <option disabled style={{ borderTop: '1px solid #4a5568' }}>
                      ────────────────
                    </option>

                    {/* Loading state or countries */}
                    {Array.isArray(countries) &&
                      countries
                        .filter((country) => country.value !== 'global') // Exclude global since it's shown above
                        .map((country) => (
                          <option key={country.value} value={country.value}>
                            {country.label}
                          </option>
                        ))}
                  </Field>
                </div>

                {values.sources?.[index]?.networksCountry && (
                  <div>
                    <label
                      htmlFor={`source-platform-${index}`}
                      className="mb-2 block text-sm text-gray-300"
                    >
                      {intl.formatMessage(messages.networksPlatform)}{' '}
                      <span className="text-red-500">*</span>
                    </label>
                    <NetworksPlatformSelect
                      country={values.sources?.[index]?.networksCountry || ''}
                      value={values.sources?.[index]?.subtype || ''}
                      onChange={(value) =>
                        setFieldValue(`sources[${index}].subtype`, value)
                      }
                      index={index}
                    />
                  </div>
                )}
              </div>
            )}

            {values.sources?.[index]?.type === 'trakt' &&
              ['played', 'watched', 'collected', 'favorited'].includes(
                values.sources?.[index]?.subtype || ''
              ) && (
                <div>
                  <label
                    htmlFor={`source-timeperiod-${index}`}
                    className="mb-2 block text-sm text-gray-300"
                  >
                    {intl.formatMessage(messages.timePeriod)}{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <Field
                    as="select"
                    id={`source-timeperiod-${index}`}
                    name={`sources[${index}].timePeriod`}
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      setFieldValue(
                        `sources[${index}].timePeriod`,
                        e.target.value
                      );
                    }}
                  >
                    <option value="daily">
                      {intl.formatMessage(messages.daily)}
                    </option>
                    <option value="weekly">
                      {intl.formatMessage(messages.weekly)}
                    </option>
                    <option value="monthly">
                      {intl.formatMessage(messages.monthly)}
                    </option>
                    <option value="all">
                      {intl.formatMessage(messages.allTime)}
                    </option>
                  </Field>
                </div>
              )}

            {values.sources?.[index]?.type === 'tautulli' && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor={`source-days-${index}`}
                    className="mb-2 block text-sm text-gray-300"
                  >
                    {intl.formatMessage(messages.customDays)}
                  </label>
                  <Field
                    type="number"
                    id={`source-days-${index}`}
                    name={`sources[${index}].customDays`}
                    placeholder="30"
                    min="1"
                    max="365"
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setFieldValue(
                        `sources[${index}].customDays`,
                        parseInt(e.target.value) || undefined
                      );
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`source-plays-${index}`}
                    className="mb-2 block text-sm text-gray-300"
                  >
                    {intl.formatMessage(messages.minimumPlays)}
                  </label>
                  <Field
                    type="number"
                    id={`source-plays-${index}`}
                    name={`sources[${index}].minimumPlays`}
                    placeholder="3"
                    min="1"
                    max="100"
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setFieldValue(
                        `sources[${index}].minimumPlays`,
                        parseInt(e.target.value) || undefined
                      );
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="flex justify-end pt-4">
          <Button onClick={addSource} buttonSize="sm">
            {intl.formatMessage(messages.addSource)}
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-3 block text-sm font-medium text-gray-200">
          {intl.formatMessage(messages.combineMode)}
        </div>

        {/* Mixed Content Warning */}
        {mixedContentInfo.hasMixedContent && (
          <div className="mb-4 rounded-md border border-orange-500/20 bg-orange-500/10 p-3">
            <div className="flex">
              <svg
                className="h-5 w-5 flex-shrink-0 text-orange-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="ml-3">
                <p className="text-sm text-orange-200">
                  {intl.formatMessage(messages.mixedContentWarning)}
                </p>
                <p className="mt-1 text-xs text-orange-300">
                  {intl.formatMessage(messages.detectedContentTypes, {
                    types: mixedContentInfo.allContentTypes.join(', '),
                  })}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {combineModeOptions.map((option) => (
            <label
              key={option.value}
              className={`flex items-start space-x-3 ${
                option.disabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer'
              }`}
              htmlFor={`combineMode-${option.value}`}
            >
              <Field
                type="radio"
                name="combineMode"
                value={option.value}
                id={`combineMode-${option.value}`}
                className="form-radio mt-1"
                disabled={option.disabled}
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-100">
                  {option.label}
                  {option.disabled && (
                    <span className="ml-2 text-xs text-orange-500">
                      {intl.formatMessage(messages.disabledMixedContent)}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-400">
                  {option.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MultiSourceConfigSection;
