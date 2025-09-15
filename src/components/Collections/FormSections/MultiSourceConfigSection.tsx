import Button from '@app/components/Common/Button';
import type {
  MultiSourceCollectionConfig,
  MultiSourceCombineMode,
  MultiSourceType,
} from '@app/types/collections';
import { Field } from 'formik';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

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

  if (!isVisible) return null;
  const sources = values.sources || [];

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
            description: 'Randomly select from configured TMDb lists',
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
      default:
        return [];
    }
  };

  const getCombineModeOptions = (): {
    value: MultiSourceCombineMode;
    label: string;
    description: string;
  }[] => [
    {
      value: 'interleaved',
      label: 'Interleaved',
      description: 'Take 1st item from each source, then 2nd from each, etc.',
    },
    {
      value: 'list_order',
      label: 'List Order',
      description: 'All items from source 1, then all from source 2, etc.',
    },
    {
      value: 'randomised',
      label: 'Randomised',
      description: 'Shuffle all items randomly on every sync',
    },
    {
      value: 'cycle_lists',
      label: 'Cycle Lists',
      description: 'Only one source active at a time, rotates each sync',
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
                <option value="tmdb">TMDb Lists</option>
                <option value="imdb">IMDb Lists</option>
                <option value="networks">Networks</option>
              </Field>
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
                <Field
                  type="text"
                  id={`source-url-${index}`}
                  name={`sources[${index}].customUrl`}
                  placeholder={intl.formatMessage(
                    messages.customUrlPlaceholder
                  )}
                  className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setFieldValue(
                      `sources[${index}].customUrl`,
                      e.target.value
                    );
                  }}
                />
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
        <div className="space-y-3">
          {getCombineModeOptions().map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start space-x-3"
              htmlFor={`combineMode-${option.value}`}
            >
              <Field
                type="radio"
                name="combineMode"
                value={option.value}
                id={`combineMode-${option.value}`}
                className="form-radio mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-100">
                  {option.label}
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
