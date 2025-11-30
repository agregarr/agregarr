import type { CollectionFormConfig } from '@app/types/collections';
import { validateApiKeysForCollectionType } from '@app/utils/apiKeyValidation';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import type {
  MainSettings,
  MDBListSettings,
  MyAnimeListSettings,
  OverseerrSettings,
  RadarrSettings,
  SonarrSettings,
  TautulliSettings,
  TraktSettings,
} from '@server/lib/settings';
import { Field, type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

import Alert from '@app/components/Common/Alert';
import ApiKeyWarning from './ApiKeyWarning';

interface TemplatePreset {
  value: string;
  label: string;
  description?: string;
}

const messages = defineMessages({
  collectionType: 'Collection Type',
  collectionSubtype: 'Collection Sub-Type',
  selectSource: 'Select Source...',
  selectSubtype: 'Select sub-type...',
});

interface SubtypeOption {
  value: string;
  label: string;
  description?: string;
}

interface CollectionTypeSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | undefined
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  touched: FormikTouched<CollectionFormConfig>;
  isVisible?: boolean;
  getTemplatePresets?: (values?: CollectionFormConfig) => TemplatePreset[];
}

const CollectionTypeSection = ({
  values,
  setFieldValue,
  isVisible = true,
  getTemplatePresets,
}: CollectionTypeSectionProps) => {
  const intl = useIntl();

  // Fetch API settings for validation
  const { data: mainSettings } = useSWR<MainSettings>('/api/v1/settings/main');
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

  if (!isVisible) return null;

  // Validate API keys for the current collection type
  const apiKeyValidation = validateApiKeysForCollectionType(
    values.type || '',
    {
      main: mainSettings,
      trakt: traktSettings,
      mdblist: mdblistSettings,
      tautulli: tautulliSettings,
      overseerr: overseerrSettings,
      myanimelist: myanimelistSettings,
      radarr: radarrSettings,
      sonarr: sonarrSettings,
    },
    values.subtype,
    values.createPlaceholdersForMissing
  );

  const collectionTypes = [
    { value: 'overseerr', label: 'Overseerr Requests' },
    { value: 'tautulli', label: 'Tautulli Statistics' },
    { value: 'trakt', label: 'Trakt Lists' },
    { value: 'letterboxd', label: 'Letterboxd Lists' },
    { value: 'tmdb', label: 'TMDB Lists' },
    { value: 'imdb', label: 'IMDb Lists' },
    { value: 'mdblist', label: 'MDBList Lists' },
    { value: 'networks', label: 'Networks Top 10' },
    { value: 'originals', label: 'Networks Originals' },
    { value: 'anilist', label: 'AniList' },
    { value: 'myanimelist', label: 'MyAnimeList' },
    { value: 'radarrtag', label: 'Radarr Tag' },
    { value: 'sonarrtag', label: 'Sonarr Tag' },
    { value: 'comingsoon', label: 'Coming Soon' },
    { value: 'recently_added', label: 'Recently Added (filtered)' },
    { value: 'multi-source', label: 'Multiple Sources' },
  ];

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
          {
            value: 'auto_franchise',
            label: 'Auto Franchise Collections',
            description:
              'Automatically create collections for all movie franchises in your library',
          },
          { value: 'custom', label: 'Custom Collection/List' },
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
        return []; // Will be populated dynamically with provider options
      case 'multi-source':
        return []; // Multi-source collections don't use subtypes - they configure sources directly
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
      case 'anilist': // Add AniList subtypes
        return [
          {
            value: 'trending',
            label: 'Trending Anime',
            description: 'Trending anime on AniList.',
          },
          {
            value: 'popular',
            label: 'Popular Anime',
            description: 'Most popular anime on AniList.',
          },
          {
            value: 'top_rated',
            label: 'Top Rated Anime',
            description: 'Highest-rated anime on AniList.',
          },
          {
            value: 'custom',
            label: 'Custom List',
            description: 'Import a custom AniList list by URL.',
          },
        ];
      case 'myanimelist':
        return [
          {
            value: 'all',
            label: 'Top Anime Series',
            description: 'Highest-rated anime overall.',
          },
          {
            value: 'airing',
            label: 'Top Airing Anime',
            description: 'Highest-rated currently airing anime.',
          },
          {
            value: 'tv',
            label: 'Top Anime TV Series',
            description: 'Highest-rated TV anime series.',
          },
          {
            value: 'movie',
            label: 'Top Anime Movies',
            description: 'Highest-rated anime movies.',
          },
          {
            value: 'ova',
            label: 'Top OVA Series',
            description: 'Highest-rated OVA anime.',
          },
          {
            value: 'special',
            label: 'Top Anime Specials',
            description: 'Highest-rated anime specials.',
          },
          {
            value: 'bypopularity',
            label: 'Most Popular Anime',
            description: 'Most popular anime by member count.',
          },
          {
            value: 'favorite',
            label: 'Most Favorited Anime',
            description: 'Most favorited anime by users.',
          },
        ];
      case 'radarrtag':
      case 'sonarrtag':
        return []; // These use custom tag selectors instead of subtypes
      case 'recently_added':
        return []; // No subtypes - standalone type that creates filtered smart collection
      default:
        return [];
    }
  };

  const subtypeOptions = getSubtypeOptions(String(values.type || ''));

  return (
    <div className="space-y-4">
      {/* Collection Type */}
      <div>
        <label htmlFor="type" className="mb-2 block text-sm text-gray-300">
          {intl.formatMessage(messages.collectionType)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id="type"
          name="type"
          className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const newType = e.target.value;
            const oldType = values.type;

            setFieldValue('type', newType);

            // Only reset subtype if type actually changed (not just re-rendering)
            if (newType !== oldType) {
              setFieldValue('subtype', ''); // Reset subtype when type changes

              // Handle multi-source type selection
              if (newType === 'multi-source') {
                setFieldValue('isMultiSource', true);
              } else if (oldType === 'multi-source') {
                setFieldValue('isMultiSource', false);
              }
            }

            // Auto-set media type based on collection type
            if (newType === 'letterboxd') {
              setFieldValue('mediaType', 'movie');
            }
          }}
        >
          <option value="">{intl.formatMessage(messages.selectSource)}</option>
          {collectionTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </Field>

        {/* API Key Warning - Show after type selection */}
        {values.type && <ApiKeyWarning validation={apiKeyValidation} />}
      </div>

      {/* Collection Sub-Type */}
      {values.type && subtypeOptions.length > 0 && (
        <div>
          <label htmlFor="subtype" className="mb-2 block text-sm text-gray-300">
            {intl.formatMessage(messages.collectionSubtype)}{' '}
            <span className="text-red-500">*</span>
          </label>
          <Field
            as="select"
            id="subtype"
            name="subtype"
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const newSubtype = e.target.value;
              setFieldValue('subtype', newSubtype);

              // Auto-set media type for movie-only collection types
              if (values.type === 'trakt' && newSubtype === 'boxoffice') {
                setFieldValue('mediaType', 'movie');
              }
              if (values.type === 'imdb' && newSubtype === 'boxoffice') {
                setFieldValue('mediaType', 'movie');
              }

              // Auto-select the first template preset when subtype changes
              // For Trakt subtypes that require timePeriod, wait for timePeriod to be selected
              const traktSubtypesRequiringTimePeriod = [
                'played',
                'watched',
                'collected',
                'favorited',
              ];
              const needsTimePeriod =
                values.type === 'trakt' &&
                traktSubtypesRequiringTimePeriod.includes(newSubtype);

              if (newSubtype && getTemplatePresets && !needsTimePeriod) {
                const templatePresets = getTemplatePresets({
                  ...values,
                  subtype: newSubtype,
                } as CollectionFormConfig);
                if (
                  templatePresets.length > 0 &&
                  templatePresets[0].value !== 'custom' &&
                  !values.template // Only auto-select if no template is currently selected
                ) {
                  // Auto-select the first non-custom template
                  setFieldValue('template', templatePresets[0].value);
                }
              }
            }}
          >
            <option value="">
              {intl.formatMessage(messages.selectSubtype)}
            </option>
            {subtypeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Field>

          {/* Show description if available */}
          {values.subtype &&
            (() => {
              const selectedOption = subtypeOptions.find(
                (opt) => opt.value === values.subtype
              );
              return selectedOption?.description ? (
                <p className="mt-1 text-xs text-gray-400">
                  {selectedOption.description}
                </p>
              ) : null;
            })()}
        </div>
      )}

      {/* Coming Soon Volume Info - appears when type='comingsoon' is selected */}
      {values.type === 'comingsoon' && (
        <Alert
          title={
            <>
              Coming Soon requires media volume mounts for placeholder creation
              -{' '}
              <a
                href="https://agregarr.org/docs/coming-soon-volumes"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-400"
              >
                See setup guide
                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            </>
          }
          type="info"
        />
      )}

      {/* Tautulli Configuration - appears when type='tautulli' and subtype is selected */}
      {values.type === 'tautulli' && values.subtype && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="customDays"
              className="mb-2 block text-sm text-gray-300"
            >
              Number of Days <span className="text-red-500">*</span>
            </label>
            <Field
              type="number"
              id="customDays"
              name="customDays"
              placeholder="30"
              min="1"
              max="365"
              className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label
              htmlFor="minimumPlays"
              className="mb-2 block text-sm text-gray-300"
            >
              Minimum Play Count <span className="text-red-500">*</span>
            </label>
            <Field
              type="number"
              id="minimumPlays"
              name="minimumPlays"
              placeholder="3"
              min="1"
              max="100"
              className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionTypeSection;
