import Button from '@app/components/Common/Button';
import type {
  MultiSourceCollectionConfig,
  MultiSourceCombineMode,
  MultiSourceType,
} from '@app/types/collections';
import { validateApiKeysForCollectionType } from '@app/utils/apiKeyValidation';
import type {
  MDBListSettings,
  MyAnimeListSettings,
  OverseerrSettings,
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
  loadingCountries: 'Loading countries...',
  loadingPlatforms: 'Loading platforms...',
  customUrl: 'Custom URL',
  customUrlPlaceholder: 'Enter custom list URL',
  timePeriod: 'Time Period',
  customDays: 'Number of Days',
  minimumPlays: 'Minimum Play Count',
  combineMode: 'Combine Mode',
  addSource: 'Add Source',
  removeSource: 'Remove',
  validateUrl: 'Validate URL',
  validatingUrl: 'Validating...',
  urlValid: 'Valid',
  urlInvalid: 'Invalid',
  mixedContentWarning:
    'Warning: Conflicting episodes/TV show lists detected across sources. Only "Cycle Lists" mode is available to prevent collection type conflicts.',
});

interface SubtypeOption {
  value: string;
  label: string;
  description?: string;
}

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
          Failed to load platforms. Please try again.
        </p>
      )}
    </>
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

  // State for tracking validation status of each source (must be before early return)
  const [sourceValidations, setSourceValidations] = React.useState<
    Record<string, SourceValidation>
  >({});

  const sources = React.useMemo(() => values.sources || [], [values.sources]);

  // Validate a source URL using the existing /fetch-title endpoint
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

      try {
        const response = await fetch('/api/v1/collections/fetch-title', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, type }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || `Failed to validate ${type} URL`
          );
        }

        const data = await response.json();

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
      } catch (error) {
        // Update validation state with error
        setSourceValidations((prev) => ({
          ...prev,
          [sourceId]: {
            isValidating: false,
            isValid: false,
            title: null,
            mediaType: null,
            contentTypes: [],
            error: error instanceof Error ? error.message : 'Validation failed',
          },
        }));
      }
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

  if (!isVisible) return null;

  const addSource = () => {
    const newSource = {
      id: `source-${Date.now()}`,
      type: '' as MultiSourceType,
      subtype: '',
      priority: sources.length,
      networksCountry: '',
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
      default:
        return [];
    }
  };

  const getCombineModeOptions = (): {
    value: MultiSourceCombineMode;
    label: string;
    description: string;
    disabled?: boolean;
  }[] => [
    {
      value: 'interleaved',
      label: 'Interleaved',
      description: 'Take 1st item from each source, then 2nd from each, etc.',
      disabled: mixedContentInfo.hasMixedContent,
    },
    {
      value: 'list_order',
      label: 'List Order',
      description: 'All items from source 1, then all from source 2, etc.',
      disabled: mixedContentInfo.hasMixedContent,
    },
    {
      value: 'randomised',
      label: 'Randomised',
      description: 'Shuffle all items randomly on every sync',
      disabled: mixedContentInfo.hasMixedContent,
    },
    {
      value: 'cycle_lists',
      label: 'Cycle Lists',
      description: 'Only one source active at a time, rotates each sync',
      disabled: false, // Always available
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h4 className="text-md font-medium text-gray-100">
          Sources ({sources.length})
        </h4>

        {sources.length === 0 && (
          <div className="py-6 text-center text-gray-400">
            No sources configured. Click Add Source to get started.
          </div>
        )}

        {sources.map((source, index) => (
          <div
            key={source.id}
            className="space-y-4 rounded-lg border border-slate-500 bg-stone-800 p-4"
          >
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-medium text-gray-200">
                Source {index + 1}
              </h5>
              {sources.length > 1 && (
                <Button
                  onClick={() => removeSource(index)}
                  buttonType="danger"
                  buttonSize="sm"
                >
                  Remove
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
                  setFieldValue(`sources[${index}].subtype`, ''); // Reset subtype when type changes
                }}
              >
                <option value="">
                  {intl.formatMessage(messages.selectSource)}
                </option>
                <option value="overseerr">Overseerr Requests</option>
                <option value="tautulli">Tautulli Statistics</option>
                <option value="trakt">Trakt Lists</option>
                <option value="letterboxd">Letterboxd Lists</option>
                <option value="tmdb">TMDB Lists</option>
                <option value="imdb">IMDb Lists</option>
                <option value="mdblist">MDBList Lists</option>
                <option value="networks">Networks</option>
                <option value="originals">Streaming Originals</option>
                <option value="anilist">AniList</option>
                <option value="myanimelist">MyAnimeList</option>
              </Field>

              {/* API Key Warning for this source */}
              {values.sources?.[index]?.type &&
                (() => {
                  const sourceType = values.sources[index].type;
                  const apiKeyValidation = validateApiKeysForCollectionType(
                    sourceType,
                    {
                      trakt: traktSettings,
                      mdblist: mdblistSettings,
                      tautulli: tautulliSettings,
                      overseerr: overseerrSettings,
                      myanimelist: myanimelistSettings,
                    }
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
                                Contains: {validation.contentTypes.join(', ')}
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
                    <option value="global">Global</option>

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
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="all">All Time</option>
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
            Add Source
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
                  Detected content types:{' '}
                  {mixedContentInfo.allContentTypes.join(', ')}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {getCombineModeOptions().map((option) => (
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
                      (Disabled - mixed content detected)
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
