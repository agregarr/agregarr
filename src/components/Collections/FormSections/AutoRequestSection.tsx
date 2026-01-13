import type {
  OverseerrSettings,
  RadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import axios from 'axios';
import { Field } from 'formik';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import Select from 'react-select';
import useSWR from 'swr';
import FilterWithMode from './FilterWithMode';

interface OptionType {
  value: number;
  label: string;
}

const messages = defineMessages({
  grabMissingItems: 'Grab Missing Items',
  grabMissingItemsHelp:
    'Automatically grab missing items via Radarr/Sonarr or Overseerr that are in the source but not available in Plex',

  // Universal options
  processMovies: 'Grab Missing Movies',
  processTv: 'Grab Missing TV Shows',
  positionLimit: 'Skip item if position in list is greater than',
  positionLimitHelp: '0 = no limit',
  tvSeasonLimit: 'Skip TV shows with more than this many seasons',
  tvSeasonLimitHelp: '0 = no limit',
  seasonsPerShow: 'Seasons per TV show to download/request',
  seasonsPerShowHelp:
    'Limit each TV show to only certain number of seasons, grabbed in certain order (0 = all seasons)',
  seasonGrabOrder: 'Season grab order',
  seasonGrabOrderHelp:
    'Choose which order to grab seasons: First, Latest (including unreleased), or Most Recently aired',
  seasonGrabOrderFirst: 'First seasons',
  seasonGrabOrderLatest: 'Latest seasons (including unreleased)',
  seasonGrabOrderAiring: 'Most recently aired seasons',
  minimumYear: 'Minimum release year',
  minimumYearHelp:
    'Only grab movies/TV shows released on or after this year (0 = no limit)',
  minimumImdbRating: 'Minimum IMDb rating',
  minimumImdbRatingHelp:
    'Only grab movies/TV shows with an IMDb rating >= this value (0 = no limit). Items without ratings will be allowed.',
  minimumRottenTomatoesRating: 'Minimum Rotten Tomatoes rating',
  minimumRottenTomatoesRatingHelp:
    'Only grab movies/TV shows with a Rotten Tomatoes critics score >= this value (0 = no limit). Items without ratings will be allowed.',
  minimumRottenTomatoesAudienceRating:
    'Minimum Rotten Tomatoes audience rating',
  minimumRottenTomatoesAudienceRatingHelp:
    'Only grab movies/TV shows with a Rotten Tomatoes audience score >= this value (0 = no limit). Items without ratings will be allowed.',

  // Download method
  downloadMethod: 'Download Method',
  downloadMethodHelp:
    'Choose how missing items from this collection should be handled',
  overseerrMode: 'Request via Overseerr',
  overseerrModeHelp:
    'Create requests in Overseerr (can require approval or be auto-approved)',
  directMode: 'Download via Radarr/Sonarr',
  directModeHelp: 'Send directly to your *arr services for immediate download',

  // Overseerr-specific options
  overseerrOptions: 'Overseerr Request Options',
  autoApproveMissingMovies: 'Auto-approve movie requests',
  autoApproveMissingTV: 'Auto-approve TV show requests',
  autoApproveHelp:
    'Automatically approve requests instead of requiring manual approval',
  overseerrServerOptions: 'Overseerr Server Configuration',
  selectOverseerrRadarrServer: 'Radarr Server (Movies)',
  selectOverseerrRadarrProfile: 'Radarr Quality Profile (Movies)',
  selectOverseerrRadarrRootFolder: 'Radarr Root Folder (Movies)',
  selectOverseerrSonarrServer: 'Sonarr Server (TV Shows)',
  selectOverseerrSonarrProfile: 'Sonarr Quality Profile (TV Shows)',
  selectOverseerrSonarrRootFolder: 'Sonarr Root Folder (TV Shows)',

  // Direct download server selection
  directDownloadOptions: 'Direct Download Configuration',
  selectRadarrServer: 'Radarr Server (Movies)',
  selectRadarrProfile: 'Radarr Quality Profile (Movies)',
  selectRadarrRootFolder: 'Radarr Root Folder (Movies)',
  selectRadarrTags: 'Radarr Tags (Movies)',
  radarrMonitor: 'Monitor Movies',
  radarrMonitorHelp: 'Monitor movies when added to Radarr',
  radarrSearchOnAdd: 'Search on Add (Movies)',
  radarrSearchOnAddHelp: 'Immediately search for movies when added to Radarr',
  selectSonarrServer: 'Sonarr Server (TV Shows)',
  selectSonarrProfile: 'Sonarr Quality Profile (TV Shows)',
  selectSonarrRootFolder: 'Sonarr Root Folder (TV Shows)',
  selectSonarrTags: 'Sonarr Tags (TV Shows)',
  sonarrMonitor: 'Monitor TV Shows',
  sonarrMonitorHelp: 'Monitor TV shows when added to Sonarr',
  sonarrSearchOnAdd: 'Search on Add (TV Shows)',
  sonarrSearchOnAddHelp: 'Immediately search for TV shows when added to Sonarr',
  selectServer: 'Select server...',
  selectProfile: 'Select quality profile...',
  selectRootFolder: 'Select root folder...',
  selectTags: 'Select tags...',
  selectServerFirst: 'Select a server first',
  noTagOptions: 'No tags.',
  selectOverseerrRadarrTags: 'Radarr Tags (Movies)',
  selectOverseerrSonarrTags: 'Sonarr Tags (TV Shows)',
  contentProcessing: 'Content Processing',
  enableProcessingForApproval:
    'Enable movie or TV processing above to configure auto-approval options.',
  enableProcessingForOverseerr:
    'Enable movie or TV processing above to configure server options.',
  enableProcessingForDirect:
    'Enable movie or TV processing above to configure server and profile options.',
});

interface AutoRequestSectionProps {
  values: {
    libraryIds?: string[];
    libraryId?: string | string[];
    mediaType?: string;
    downloadMode?: 'overseerr' | 'direct';
    searchMissingMovies?: boolean;
    searchMissingTV?: boolean;
    filterSettings?: {
      genres?: {
        mode: 'exclude' | 'include';
        values: number[];
      };
      countries?: {
        mode: 'exclude' | 'include';
        values: string[];
      };
      languages?: {
        mode: 'exclude' | 'include';
        values: string[];
      };
    };
    directDownloadRadarrServerId?: number;
    directDownloadRadarrProfileId?: number;
    directDownloadRadarrRootFolder?: string;
    directDownloadRadarrTags?: number[];
    directDownloadRadarrMonitor?: boolean;
    directDownloadRadarrSearchOnAdd?: boolean;
    directDownloadSonarrServerId?: number;
    directDownloadSonarrProfileId?: number;
    directDownloadSonarrRootFolder?: string;
    directDownloadSonarrTags?: number[];
    directDownloadSonarrMonitor?: boolean;
    directDownloadSonarrSearchOnAdd?: boolean;
    overseerrRadarrServerId?: number;
    overseerrRadarrProfileId?: number;
    overseerrRadarrRootFolder?: string;
    overseerrRadarrTags?: number[];
    overseerrSonarrServerId?: number;
    overseerrSonarrProfileId?: number;
    overseerrSonarrRootFolder?: string;
    overseerrSonarrTags?: number[];
    [key: string]: unknown;
  };
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  libraries: { key: string; name: string; type: string }[];
  isVisible?: boolean;
  setFieldValue?: (field: string, value: unknown) => void;
}

const AutoRequestSection = ({
  values,
  errors,
  touched,
  libraries = [],
  isVisible = true,
  setFieldValue,
}: AutoRequestSectionProps) => {
  const intl = useIntl();

  // Fetch Radarr and Sonarr servers
  const { data: radarrServers, isLoading: radarrLoading } = useSWR<
    RadarrSettings[]
  >('/api/v1/settings/radarr');
  const { data: sonarrServers, isLoading: sonarrLoading } = useSWR<
    SonarrSettings[]
  >('/api/v1/settings/sonarr');

  // Fetch Overseerr settings
  const { data: overseerrSettings } = useSWR<OverseerrSettings>(
    '/api/v1/settings/overseerr'
  );

  // State for Overseerr server options
  const [overseerrServerOptions, setOverseerrServerOptions] = useState<{
    servers: {
      radarr: {
        id: number;
        name: string;
        hostname: string;
        port: number;
        is4k: boolean;
        isDefault: boolean;
      }[];
      sonarr: {
        id: number;
        name: string;
        hostname: string;
        port: number;
        is4k: boolean;
        isDefault: boolean;
      }[];
    };
    radarrServerOptions: Record<
      number,
      {
        profiles: { id: number; name: string }[];
        rootFolders: { id: number; path: string }[];
        tags: { id: number; label: string }[];
      }
    >;
    sonarrServerOptions: Record<
      number,
      {
        profiles: { id: number; name: string }[];
        rootFolders: { id: number; path: string }[];
        tags: { id: number; label: string }[];
      }
    >;
  }>({
    servers: { radarr: [], sonarr: [] },
    radarrServerOptions: {},
    sonarrServerOptions: {},
  });
  const [overseerrLoading, setOverseerrLoading] = useState(false);

  // Fetch Overseerr server options when Overseerr is configured
  useEffect(() => {
    const fetchOverseerrServers = async () => {
      if (!overseerrSettings?.hostname || !overseerrSettings?.apiKey) {
        return;
      }

      setOverseerrLoading(true);
      try {
        const response = await axios.post('/api/v1/overseerr/test', {
          hostname: overseerrSettings.hostname,
          port: overseerrSettings.port || 5055,
          apiKey: overseerrSettings.apiKey,
          useSsl: overseerrSettings.useSsl,
          urlBase: overseerrSettings.urlBase,
        });

        setOverseerrServerOptions({
          servers: response.data.servers || { radarr: [], sonarr: [] },
          radarrServerOptions: response.data.radarrServerOptions || {},
          sonarrServerOptions: response.data.sonarrServerOptions || {},
        });
      } catch (error) {
        // Silently fail - Overseerr options are optional
        setOverseerrServerOptions({
          servers: { radarr: [], sonarr: [] },
          radarrServerOptions: {},
          sonarrServerOptions: {},
        });
      } finally {
        setOverseerrLoading(false);
      }
    };

    fetchOverseerrServers();
  }, [overseerrSettings]);

  // Auto-select single Overseerr Radarr server if only one exists
  useEffect(() => {
    if (
      !overseerrLoading &&
      overseerrServerOptions.servers.radarr.length === 1 &&
      values.overseerrRadarrServerId === undefined
    ) {
      setFieldValue?.(
        'overseerrRadarrServerId',
        overseerrServerOptions.servers.radarr[0].id
      );
    }
  }, [
    overseerrLoading,
    overseerrServerOptions.servers.radarr,
    values.overseerrRadarrServerId,
    setFieldValue,
  ]);

  // Auto-select single Overseerr Sonarr server if only one exists
  useEffect(() => {
    if (
      !overseerrLoading &&
      overseerrServerOptions.servers.sonarr.length === 1 &&
      values.overseerrSonarrServerId === undefined
    ) {
      setFieldValue?.(
        'overseerrSonarrServerId',
        overseerrServerOptions.servers.sonarr[0].id
      );
    }
  }, [
    overseerrLoading,
    overseerrServerOptions.servers.sonarr,
    values.overseerrSonarrServerId,
    setFieldValue,
  ]);

  // Get the effective server IDs (only when server data has loaded)
  const effectiveRadarrServerId =
    values.directDownloadRadarrServerId !== undefined
      ? values.directDownloadRadarrServerId
      : !radarrLoading && radarrServers?.length === 1
      ? radarrServers[0].id
      : !radarrLoading && radarrServers?.find((s) => s.isDefault)?.id;
  const effectiveSonarrServerId =
    values.directDownloadSonarrServerId !== undefined
      ? values.directDownloadSonarrServerId
      : !sonarrLoading && sonarrServers?.length === 1
      ? sonarrServers[0].id
      : !sonarrLoading && sonarrServers?.find((s) => s.isDefault)?.id;

  // Fetch profiles for selected servers or default/single server
  const { data: radarrProfiles } = useSWR<{ id: number; name: string }[]>(
    effectiveRadarrServerId !== undefined
      ? `/api/v1/settings/radarr/${effectiveRadarrServerId}/profiles`
      : null
  );
  const { data: sonarrProfiles } = useSWR<{ id: number; name: string }[]>(
    effectiveSonarrServerId !== undefined
      ? `/api/v1/settings/sonarr/${effectiveSonarrServerId}/profiles`
      : null
  );

  // Fetch root folders for selected servers or default/single server
  const { data: radarrRootFolders } = useSWR<{ id: number; path: string }[]>(
    effectiveRadarrServerId !== undefined
      ? `/api/v1/settings/radarr/${effectiveRadarrServerId}/rootfolders`
      : null
  );
  const { data: sonarrRootFolders } = useSWR<{ id: number; path: string }[]>(
    effectiveSonarrServerId !== undefined
      ? `/api/v1/settings/sonarr/${effectiveSonarrServerId}/rootfolders`
      : null
  );

  // Fetch tags for selected servers or default/single server
  const { data: radarrTags } = useSWR<{ id: number; label: string }[]>(
    effectiveRadarrServerId !== undefined
      ? `/api/v1/settings/radarr/${effectiveRadarrServerId}/tags`
      : null
  );

  const { data: sonarrTags } = useSWR<{ id: number; label: string }[]>(
    effectiveSonarrServerId !== undefined
      ? `/api/v1/settings/sonarr/${effectiveSonarrServerId}/tags`
      : null
  );

  if (!isVisible) return null;

  // Only show for external sources (not Overseerr or Tautulli)
  if (
    !values.type ||
    values.type === 'overseerr' ||
    values.type === 'tautulli'
  ) {
    return null;
  }

  // Helper function to check if we should show movie settings
  const shouldShowMovieSettings = () => {
    const selectedLibraryIds =
      values.libraryIds ||
      (values.libraryId
        ? Array.isArray(values.libraryId)
          ? values.libraryId
          : [values.libraryId]
        : []);
    const hasAllLibraries =
      selectedLibraryIds.includes('all') || values.libraryId === 'all';
    const hasMovieLibrary = selectedLibraryIds.some(
      (id: string) =>
        id !== 'all' &&
        libraries.find((lib) => lib.key === id)?.type === 'movie'
    );
    return hasAllLibraries || hasMovieLibrary || values.mediaType === 'movie';
  };

  // Helper function to check if we should show TV settings
  const shouldShowTvSettings = () => {
    const selectedLibraryIds =
      values.libraryIds ||
      (values.libraryId
        ? Array.isArray(values.libraryId)
          ? values.libraryId
          : [values.libraryId]
        : []);
    const hasAllLibraries =
      selectedLibraryIds.includes('all') || values.libraryId === 'all';
    const hasTvLibrary = selectedLibraryIds.some(
      (id: string) =>
        id !== 'all' && libraries.find((lib) => lib.key === id)?.type === 'show'
    );
    return hasAllLibraries || hasTvLibrary || values.mediaType === 'tv';
  };

  return (
    <>
      {/* Step 1: Main Grab Missing Items Toggle */}
      <div className="mb-6">
        <label
          className="inline-flex cursor-pointer items-center"
          htmlFor="enableGrabMissingItems"
        >
          <Field
            type="checkbox"
            name="enableGrabMissingItems"
            className="form-checkbox"
            id="enableGrabMissingItems"
          />
          <span className="ml-2 text-sm text-gray-300">
            {intl.formatMessage(messages.grabMissingItems)}
          </span>
        </label>
        <div className="label-tip mt-2">
          {intl.formatMessage(messages.grabMissingItemsHelp)}
        </div>
      </div>

      {/* Step 2: Universal Options (show immediately when grab missing is enabled) */}
      {values.enableGrabMissingItems && (
        <>
          {/* Media Type Processing Options */}
          <div className="mb-6">
            <div className="mb-3 text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.contentProcessing)}
            </div>
            <div className="space-y-3">
              {/* Movies - only show if library supports movies */}
              {shouldShowMovieSettings() && (
                <label
                  className="inline-flex cursor-pointer items-center"
                  htmlFor="searchMissingMovies"
                >
                  <Field
                    type="checkbox"
                    name="searchMissingMovies"
                    className="form-checkbox"
                    id="searchMissingMovies"
                  />
                  <span className="ml-2 text-white">
                    {intl.formatMessage(messages.processMovies)}
                  </span>
                </label>
              )}
            </div>
            <div className="space-y-3">
              {/* TV Shows - only show if library supports TV */}
              {shouldShowTvSettings() && (
                <label
                  className="inline-flex cursor-pointer items-center"
                  htmlFor="searchMissingTV"
                >
                  <Field
                    type="checkbox"
                    name="searchMissingTV"
                    className="form-checkbox"
                    id="searchMissingTV"
                  />
                  <span className="ml-2 text-white">
                    {intl.formatMessage(messages.processTv)}
                  </span>
                </label>
              )}
            </div>
          </div>

          {/* Position Limit */}
          <div className="mb-6">
            <div className="mb-2 text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.positionLimit)}
            </div>
            <div className="form-input-field">
              <Field
                type="text"
                inputMode="numeric"
                id="maxPositionToProcess"
                name="maxPositionToProcess"
                placeholder="0"
                className="short"
              />
            </div>
            {errors.maxPositionToProcess && touched.maxPositionToProcess && (
              <div className="error">{errors.maxPositionToProcess}</div>
            )}
            <div className="label-tip mt-2">
              {intl.formatMessage(messages.positionLimitHelp)}
            </div>
          </div>

          {/* Minimum Year */}
          <div className="mb-6">
            <div className="mb-2 text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.minimumYear)}
            </div>
            <div className="form-input-field">
              <Field
                type="text"
                inputMode="numeric"
                id="minimumYear"
                name="minimumYear"
                placeholder="0"
                className="short"
              />
            </div>
            {errors.minimumYear && touched.minimumYear && (
              <div className="error">{errors.minimumYear}</div>
            )}
            <div className="label-tip mt-2">
              {intl.formatMessage(messages.minimumYearHelp)}
            </div>
          </div>

          {/* Minimum IMDb Rating */}
          <div className="mb-6">
            <div className="mb-2 text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.minimumImdbRating)}
            </div>
            <div className="form-input-field">
              <Field
                type="text"
                inputMode="decimal"
                id="minimumImdbRating"
                name="minimumImdbRating"
                placeholder="0"
                className="short"
              />
            </div>
            {errors.minimumImdbRating && touched.minimumImdbRating && (
              <div className="error">{errors.minimumImdbRating}</div>
            )}
            <div className="label-tip mt-2">
              {intl.formatMessage(messages.minimumImdbRatingHelp)}
            </div>
          </div>

          {/* Minimum Rotten Tomatoes Rating */}
          <div className="mb-6">
            <div className="mb-2 text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.minimumRottenTomatoesRating)}
            </div>
            <div className="form-input-field">
              <Field
                type="text"
                inputMode="decimal"
                id="minimumRottenTomatoesRating"
                name="minimumRottenTomatoesRating"
                placeholder="0"
                className="short"
              />
            </div>
            {errors.minimumRottenTomatoesRating &&
              touched.minimumRottenTomatoesRating && (
                <div className="error">
                  {errors.minimumRottenTomatoesRating}
                </div>
              )}
            <div className="label-tip mt-2">
              {intl.formatMessage(messages.minimumRottenTomatoesRatingHelp)}
            </div>
          </div>

          {/* Minimum Rotten Tomatoes Audience Rating */}
          <div className="mb-6">
            <div className="mb-2 text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.minimumRottenTomatoesAudienceRating)}
            </div>
            <div className="form-input-field">
              <Field
                type="text"
                inputMode="decimal"
                id="minimumRottenTomatoesAudienceRating"
                name="minimumRottenTomatoesAudienceRating"
                placeholder="0"
                className="short"
              />
            </div>
            {errors.minimumRottenTomatoesAudienceRating &&
              touched.minimumRottenTomatoesAudienceRating && (
                <div className="error">
                  {errors.minimumRottenTomatoesAudienceRating}
                </div>
              )}
            <div className="label-tip mt-2">
              {intl.formatMessage(
                messages.minimumRottenTomatoesAudienceRatingHelp
              )}
            </div>
          </div>

          {/* Genre Filter with Include/Exclude Mode */}
          <FilterWithMode
            filterType="genres"
            mode={values.filterSettings?.genres?.mode || 'exclude'}
            selectedValues={values.filterSettings?.genres?.values || []}
            onModeChange={(mode) => {
              const currentValues = values.filterSettings?.genres?.values || [];
              setFieldValue?.('filterSettings', {
                ...(values.filterSettings || {}),
                genres: { mode, values: currentValues },
              });
            }}
            onValuesChange={(selectedValues) => {
              const currentMode =
                values.filterSettings?.genres?.mode || 'exclude';
              setFieldValue?.('filterSettings', {
                ...(values.filterSettings || {}),
                genres: {
                  mode: currentMode,
                  values: selectedValues as number[],
                },
              });
            }}
          />

          {/* Country Filter with Include/Exclude Mode */}
          <FilterWithMode
            filterType="countries"
            mode={values.filterSettings?.countries?.mode || 'exclude'}
            selectedValues={values.filterSettings?.countries?.values || []}
            onModeChange={(mode) => {
              const currentValues =
                values.filterSettings?.countries?.values || [];
              setFieldValue?.('filterSettings', {
                ...(values.filterSettings || {}),
                countries: { mode, values: currentValues },
              });
            }}
            onValuesChange={(selectedValues) => {
              const currentMode =
                values.filterSettings?.countries?.mode || 'exclude';
              setFieldValue?.('filterSettings', {
                ...(values.filterSettings || {}),
                countries: {
                  mode: currentMode,
                  values: selectedValues as string[],
                },
              });
            }}
          />

          {/* Language Filter with Include/Exclude Mode */}
          <FilterWithMode
            filterType="languages"
            mode={values.filterSettings?.languages?.mode || 'exclude'}
            selectedValues={values.filterSettings?.languages?.values || []}
            onModeChange={(mode) => {
              const currentValues =
                values.filterSettings?.languages?.values || [];
              setFieldValue?.('filterSettings', {
                ...(values.filterSettings || {}),
                languages: { mode, values: currentValues },
              });
            }}
            onValuesChange={(selectedValues) => {
              const currentMode =
                values.filterSettings?.languages?.mode || 'exclude';
              setFieldValue?.('filterSettings', {
                ...(values.filterSettings || {}),
                languages: {
                  mode: currentMode,
                  values: selectedValues as string[],
                },
              });
            }}
          />

          {/* TV Season Limit - only show when TV processing is enabled */}
          {values.searchMissingTV && (
            <div className="mb-6">
              <div className="mb-2 text-sm font-medium text-gray-200">
                {intl.formatMessage(messages.tvSeasonLimit)}
              </div>
              <div className="form-input-field">
                <Field
                  type="text"
                  inputMode="numeric"
                  id="maxSeasonsToRequest"
                  name="maxSeasonsToRequest"
                  placeholder="0"
                  className="short"
                />
              </div>
              {errors.maxSeasonsToRequest && touched.maxSeasonsToRequest && (
                <div className="error">{errors.maxSeasonsToRequest}</div>
              )}
              <div className="label-tip mt-2">
                {intl.formatMessage(messages.tvSeasonLimitHelp)}
              </div>
            </div>
          )}

          {/* Seasons Per Show Limit - only show when TV processing is enabled */}
          {values.searchMissingTV && (
            <div className="mb-6">
              <div className="mb-2 text-sm font-medium text-gray-200">
                {intl.formatMessage(messages.seasonsPerShow)}
              </div>
              <div className="form-input-field">
                <Field
                  type="text"
                  inputMode="numeric"
                  id="seasonsPerShowLimit"
                  name="seasonsPerShowLimit"
                  placeholder="0"
                  className="short"
                />
              </div>
              {errors.seasonsPerShowLimit && touched.seasonsPerShowLimit && (
                <div className="error">{errors.seasonsPerShowLimit}</div>
              )}
              <div className="label-tip mt-2">
                {intl.formatMessage(messages.seasonsPerShowHelp)}
              </div>
            </div>
          )}

          {/* Season Grab Order - only show when TV processing is enabled and seasonsPerShowLimit > 0 */}
          {values.searchMissingTV &&
            values.seasonsPerShowLimit &&
            Number(values.seasonsPerShowLimit) > 0 && (
              <div className="mb-6">
                <div className="mb-2 text-sm font-medium text-gray-200">
                  {intl.formatMessage(messages.seasonGrabOrder)}
                </div>
                <div className="form-input-field">
                  <Field as="select" name="seasonGrabOrder" className="short">
                    <option value="first">
                      {intl.formatMessage(messages.seasonGrabOrderFirst)}
                    </option>
                    <option value="latest">
                      {intl.formatMessage(messages.seasonGrabOrderLatest)}
                    </option>
                    <option value="airing">
                      {intl.formatMessage(messages.seasonGrabOrderAiring)}
                    </option>
                  </Field>
                </div>
                <div className="label-tip mt-2">
                  {intl.formatMessage(messages.seasonGrabOrderHelp)}
                </div>
              </div>
            )}

          {/* Step 3: Download Method Selection */}
          <div className="mb-6">
            <div className="mb-3 text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.downloadMethod)}
            </div>
            <div className="space-y-3">
              {/* Direct Mode */}
              <label
                className="flex cursor-pointer items-start"
                htmlFor="downloadMode-direct"
              >
                <Field
                  type="radio"
                  name="downloadMode"
                  value="direct"
                  className="form-radio mt-1"
                  id="downloadMode-direct"
                />
                <div className="ml-3">
                  <div className="font-medium text-white">
                    {intl.formatMessage(messages.directMode)}
                  </div>
                  <div className="text-sm text-gray-400">
                    {intl.formatMessage(messages.directModeHelp)}
                  </div>
                </div>
              </label>

              {/* Overseerr Mode */}
              <label
                className="flex cursor-pointer items-start"
                htmlFor="downloadMode-overseerr"
              >
                <Field
                  type="radio"
                  name="downloadMode"
                  value="overseerr"
                  className="form-radio mt-1"
                  id="downloadMode-overseerr"
                />
                <div className="ml-3">
                  <div className="font-medium text-white">
                    {intl.formatMessage(messages.overseerrMode)}
                  </div>
                  <div className="text-sm text-gray-400">
                    {intl.formatMessage(messages.overseerrModeHelp)}
                  </div>
                </div>
              </label>
            </div>
            <div className="label-tip mt-2">
              {intl.formatMessage(messages.downloadMethodHelp)}
            </div>
          </div>

          {/* Step 4: Overseerr-Specific Options (only show when Overseerr mode is selected) */}
          {values.downloadMode === 'overseerr' && (
            <div className="mb-6">
              <div className="mb-3 text-sm font-medium text-gray-200">
                {intl.formatMessage(messages.overseerrOptions)}
              </div>
              <div className="space-y-3">
                <>
                  {/* Auto-approve movies - only show if movie processing is enabled */}
                  {values.searchMissingMovies && (
                    <div>
                      <label
                        className="inline-flex cursor-pointer items-center"
                        htmlFor="autoApproveMovies"
                      >
                        <Field
                          type="checkbox"
                          name="autoApproveMovies"
                          className="form-checkbox"
                          id="autoApproveMovies"
                        />
                        <span className="ml-2 text-white">
                          {intl.formatMessage(
                            messages.autoApproveMissingMovies
                          )}
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Auto-approve TV - only show if TV processing is enabled */}
                  {values.searchMissingTV && (
                    <div>
                      <label
                        className="inline-flex cursor-pointer items-center"
                        htmlFor="autoApproveTV"
                      >
                        <Field
                          type="checkbox"
                          name="autoApproveTV"
                          className="form-checkbox"
                          id="autoApproveTV"
                        />
                        <span className="ml-2 text-white">
                          {intl.formatMessage(messages.autoApproveMissingTV)}
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Ensure at least one child exists to avoid empty div */}
                  {!values.searchMissingMovies && !values.searchMissingTV && (
                    <div className="text-sm text-gray-400">
                      {intl.formatMessage(messages.enableProcessingForApproval)}
                    </div>
                  )}
                </>
              </div>
              <div className="label-tip mt-2">
                {intl.formatMessage(messages.autoApproveHelp)}
              </div>

              {/* Overseerr Server Configuration */}
              <div className="mb-6">
                <div className="mb-3 text-sm font-medium text-gray-200">
                  {intl.formatMessage(messages.overseerrServerOptions)}
                </div>
                <div className="space-y-4">
                  {/* Radarr Server Configuration - only show if movie processing is enabled */}
                  {values.searchMissingMovies && shouldShowMovieSettings() && (
                    <div className="rounded-md border border-gray-700 p-4">
                      {/* Radarr Server Selection - only show if 2+ servers */}
                      {overseerrServerOptions.servers.radarr.length > 1 && (
                        <div>
                          <div className="mb-2 text-sm font-medium text-gray-300">
                            {intl.formatMessage(
                              messages.selectOverseerrRadarrServer
                            )}
                          </div>
                          <div className="form-input-field">
                            <Field
                              as="select"
                              name="overseerrRadarrServerId"
                              disabled={overseerrLoading}
                              onChange={(
                                e: React.ChangeEvent<HTMLSelectElement>
                              ) => {
                                const serverId = e.target.value
                                  ? Number(e.target.value)
                                  : undefined;
                                setFieldValue?.(
                                  'overseerrRadarrServerId',
                                  serverId
                                );
                                // Clear profile and root folder when server changes
                                setFieldValue?.(
                                  'overseerrRadarrProfileId',
                                  undefined
                                );
                                setFieldValue?.(
                                  'overseerrRadarrRootFolder',
                                  undefined
                                );
                              }}
                            >
                              <option value="">
                                {overseerrLoading
                                  ? 'Loading...'
                                  : intl.formatMessage(messages.selectServer)}
                              </option>
                              {overseerrServerOptions.servers.radarr.map(
                                (server) => (
                                  <option key={server.id} value={server.id}>
                                    {server.name}
                                    {server.isDefault && ' (Default)'}
                                  </option>
                                )
                              )}
                            </Field>
                          </div>
                        </div>
                      )}

                      {/* Radarr Profile Selection */}
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(
                            messages.selectOverseerrRadarrProfile
                          )}
                        </div>
                        <div className="form-input-field">
                          <Field
                            as="select"
                            name="overseerrRadarrProfileId"
                            disabled={
                              overseerrLoading ||
                              values.overseerrRadarrServerId === undefined ||
                              values.overseerrRadarrServerId === null ||
                              !overseerrServerOptions.radarrServerOptions[
                                Number(values.overseerrRadarrServerId)
                              ]
                            }
                          >
                            <option value="">
                              {overseerrLoading
                                ? 'Loading...'
                                : values.overseerrRadarrServerId ===
                                    undefined ||
                                  values.overseerrRadarrServerId === null
                                ? intl.formatMessage(messages.selectServerFirst)
                                : intl.formatMessage(messages.selectProfile)}
                            </option>
                            {overseerrServerOptions.radarrServerOptions[
                              Number(values.overseerrRadarrServerId)
                            ]?.profiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name}
                              </option>
                            ))}
                          </Field>
                        </div>
                      </div>

                      {/* Radarr Root Folder Selection */}
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(
                            messages.selectOverseerrRadarrRootFolder
                          )}
                        </div>
                        <div className="form-input-field">
                          <Field
                            as="select"
                            name="overseerrRadarrRootFolder"
                            disabled={
                              overseerrLoading ||
                              values.overseerrRadarrServerId === undefined ||
                              values.overseerrRadarrServerId === null ||
                              !overseerrServerOptions.radarrServerOptions[
                                Number(values.overseerrRadarrServerId)
                              ]
                            }
                          >
                            <option value="">
                              {overseerrLoading
                                ? 'Loading...'
                                : values.overseerrRadarrServerId ===
                                    undefined ||
                                  values.overseerrRadarrServerId === null
                                ? intl.formatMessage(messages.selectServerFirst)
                                : intl.formatMessage(messages.selectRootFolder)}
                            </option>
                            {overseerrServerOptions.radarrServerOptions[
                              Number(values.overseerrRadarrServerId)
                            ]?.rootFolders.map((folder) => (
                              <option key={folder.id} value={folder.path}>
                                {folder.path}
                              </option>
                            ))}
                          </Field>
                        </div>
                      </div>

                      {/* Radarr Tags Selection */}
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(
                            messages.selectOverseerrRadarrTags
                          )}
                        </div>
                        <div className="form-input-field">
                          <Select<OptionType, true>
                            options={
                              overseerrServerOptions.radarrServerOptions[
                                Number(values.overseerrRadarrServerId)
                              ]?.tags.map((tag) => ({
                                label: tag.label,
                                value: tag.id,
                              })) || []
                            }
                            isMulti
                            isDisabled={
                              overseerrLoading ||
                              values.overseerrRadarrServerId === undefined ||
                              values.overseerrRadarrServerId === null ||
                              !overseerrServerOptions.radarrServerOptions[
                                Number(values.overseerrRadarrServerId)
                              ]
                            }
                            placeholder={
                              overseerrLoading
                                ? 'Loading...'
                                : values.overseerrRadarrServerId ===
                                    undefined ||
                                  values.overseerrRadarrServerId === null
                                ? intl.formatMessage(messages.selectServerFirst)
                                : intl.formatMessage(messages.selectTags)
                            }
                            noOptionsMessage={() =>
                              intl.formatMessage(messages.noTagOptions)
                            }
                            className="react-select-container"
                            classNamePrefix="react-select"
                            value={
                              overseerrServerOptions.radarrServerOptions[
                                Number(values.overseerrRadarrServerId)
                              ]?.tags
                                .filter((tag) =>
                                  values.overseerrRadarrTags?.includes(tag.id)
                                )
                                .map((tag) => ({
                                  label: tag.label,
                                  value: tag.id,
                                })) || []
                            }
                            onChange={(value) => {
                              setFieldValue?.(
                                'overseerrRadarrTags',
                                value?.map((v) => v.value) || []
                              );
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sonarr Server Configuration - only show if TV processing is enabled */}
                  {values.searchMissingTV && shouldShowTvSettings() && (
                    <div className="rounded-md border border-gray-700 p-4">
                      {/* Sonarr Server Selection - only show if 2+ servers */}
                      {overseerrServerOptions.servers.sonarr.length > 1 && (
                        <div>
                          <div className="mb-2 text-sm font-medium text-gray-300">
                            {intl.formatMessage(
                              messages.selectOverseerrSonarrServer
                            )}
                          </div>
                          <div className="form-input-field">
                            <Field
                              as="select"
                              name="overseerrSonarrServerId"
                              disabled={overseerrLoading}
                              onChange={(
                                e: React.ChangeEvent<HTMLSelectElement>
                              ) => {
                                const serverId = e.target.value
                                  ? Number(e.target.value)
                                  : undefined;
                                setFieldValue?.(
                                  'overseerrSonarrServerId',
                                  serverId
                                );
                                // Clear profile and root folder when server changes
                                setFieldValue?.(
                                  'overseerrSonarrProfileId',
                                  undefined
                                );
                                setFieldValue?.(
                                  'overseerrSonarrRootFolder',
                                  undefined
                                );
                              }}
                            >
                              <option value="">
                                {overseerrLoading
                                  ? 'Loading...'
                                  : intl.formatMessage(messages.selectServer)}
                              </option>
                              {overseerrServerOptions.servers.sonarr.map(
                                (server) => (
                                  <option key={server.id} value={server.id}>
                                    {server.name}
                                    {server.isDefault && ' (Default)'}
                                  </option>
                                )
                              )}
                            </Field>
                          </div>
                        </div>
                      )}

                      {/* Sonarr Profile Selection */}
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(
                            messages.selectOverseerrSonarrProfile
                          )}
                        </div>
                        <div className="form-input-field">
                          <Field
                            as="select"
                            name="overseerrSonarrProfileId"
                            disabled={
                              overseerrLoading ||
                              values.overseerrSonarrServerId === undefined ||
                              values.overseerrSonarrServerId === null ||
                              !overseerrServerOptions.sonarrServerOptions[
                                Number(values.overseerrSonarrServerId)
                              ]
                            }
                          >
                            <option value="">
                              {overseerrLoading
                                ? 'Loading...'
                                : values.overseerrSonarrServerId ===
                                    undefined ||
                                  values.overseerrSonarrServerId === null
                                ? intl.formatMessage(messages.selectServerFirst)
                                : intl.formatMessage(messages.selectProfile)}
                            </option>
                            {overseerrServerOptions.sonarrServerOptions[
                              Number(values.overseerrSonarrServerId)
                            ]?.profiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name}
                              </option>
                            ))}
                          </Field>
                        </div>
                      </div>

                      {/* Sonarr Root Folder Selection */}
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(
                            messages.selectOverseerrSonarrRootFolder
                          )}
                        </div>
                        <div className="form-input-field">
                          <Field
                            as="select"
                            name="overseerrSonarrRootFolder"
                            disabled={
                              overseerrLoading ||
                              values.overseerrSonarrServerId === undefined ||
                              values.overseerrSonarrServerId === null ||
                              !overseerrServerOptions.sonarrServerOptions[
                                Number(values.overseerrSonarrServerId)
                              ]
                            }
                          >
                            <option value="">
                              {overseerrLoading
                                ? 'Loading...'
                                : values.overseerrSonarrServerId ===
                                    undefined ||
                                  values.overseerrSonarrServerId === null
                                ? intl.formatMessage(messages.selectServerFirst)
                                : intl.formatMessage(messages.selectRootFolder)}
                            </option>
                            {overseerrServerOptions.sonarrServerOptions[
                              Number(values.overseerrSonarrServerId)
                            ]?.rootFolders.map((folder) => (
                              <option key={folder.id} value={folder.path}>
                                {folder.path}
                              </option>
                            ))}
                          </Field>
                        </div>
                      </div>

                      {/* Sonarr Tags Selection */}
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(
                            messages.selectOverseerrSonarrTags
                          )}
                        </div>
                        <div className="form-input-field">
                          <Select<OptionType, true>
                            options={
                              overseerrServerOptions.sonarrServerOptions[
                                Number(values.overseerrSonarrServerId)
                              ]?.tags.map((tag) => ({
                                label: tag.label,
                                value: tag.id,
                              })) || []
                            }
                            isMulti
                            isDisabled={
                              overseerrLoading ||
                              values.overseerrSonarrServerId === undefined ||
                              values.overseerrSonarrServerId === null ||
                              !overseerrServerOptions.sonarrServerOptions[
                                Number(values.overseerrSonarrServerId)
                              ]
                            }
                            placeholder={
                              overseerrLoading
                                ? 'Loading...'
                                : values.overseerrSonarrServerId ===
                                    undefined ||
                                  values.overseerrSonarrServerId === null
                                ? intl.formatMessage(messages.selectServerFirst)
                                : intl.formatMessage(messages.selectTags)
                            }
                            noOptionsMessage={() =>
                              intl.formatMessage(messages.noTagOptions)
                            }
                            className="react-select-container"
                            classNamePrefix="react-select"
                            value={
                              overseerrServerOptions.sonarrServerOptions[
                                Number(values.overseerrSonarrServerId)
                              ]?.tags
                                .filter((tag) =>
                                  values.overseerrSonarrTags?.includes(tag.id)
                                )
                                .map((tag) => ({
                                  label: tag.label,
                                  value: tag.id,
                                })) || []
                            }
                            onChange={(value) => {
                              setFieldValue?.(
                                'overseerrSonarrTags',
                                value?.map((v) => v.value) || []
                              );
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Show message if no processing options are enabled */}
                  {!values.searchMissingMovies && !values.searchMissingTV && (
                    <div className="text-sm text-gray-400">
                      {intl.formatMessage(
                        messages.enableProcessingForOverseerr
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Direct Download Configuration (only show when direct mode is selected) */}
          {values.downloadMode === 'direct' && (
            <div className="mb-6">
              <div className="mb-3 text-sm font-medium text-gray-200">
                {intl.formatMessage(messages.directDownloadOptions)}
              </div>
              <div className="space-y-4">
                {/* Radarr Server and Profile Selection - only show if movie processing is enabled */}
                {values.searchMissingMovies && shouldShowMovieSettings() && (
                  <div className="rounded-md border border-gray-700 p-4">
                    {/* Radarr Server Selection - only show if 2+ servers */}
                    {radarrServers && radarrServers.length > 1 && (
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(messages.selectRadarrServer)}
                        </div>
                        <div className="form-input-field">
                          <Field
                            as="select"
                            name="directDownloadRadarrServerId"
                            onChange={(
                              e: React.ChangeEvent<HTMLSelectElement>
                            ) => {
                              const serverId = e.target.value
                                ? Number(e.target.value)
                                : undefined;
                              setFieldValue?.(
                                'directDownloadRadarrServerId',
                                serverId
                              );
                              // Clear profile selection when server changes
                              setFieldValue?.(
                                'directDownloadRadarrProfileId',
                                undefined
                              );
                            }}
                          >
                            <option value="">
                              {intl.formatMessage(messages.selectServer)}
                            </option>
                            {radarrServers.map((server) => (
                              <option key={server.id} value={server.id}>
                                {server.name ||
                                  `${server.hostname}:${server.port}`}
                                {server.isDefault && ' (Default)'}
                              </option>
                            ))}
                          </Field>
                        </div>
                      </div>
                    )}

                    {/* Radarr Profile Selection - always show */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-300">
                        {intl.formatMessage(messages.selectRadarrProfile)}
                      </div>
                      <div className="form-input-field">
                        <Field
                          as="select"
                          name="directDownloadRadarrProfileId"
                          disabled={radarrLoading || !radarrProfiles}
                        >
                          <option value="">
                            {radarrLoading
                              ? 'Loading...'
                              : effectiveRadarrServerId !== undefined
                              ? intl.formatMessage(messages.selectProfile)
                              : intl.formatMessage(messages.selectServerFirst)}
                          </option>
                          {radarrProfiles?.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </Field>
                      </div>
                    </div>

                    {/* Radarr Root Folder Selection - always show */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-300">
                        {intl.formatMessage(messages.selectRadarrRootFolder)}
                      </div>
                      <div className="form-input-field">
                        <Field
                          as="select"
                          name="directDownloadRadarrRootFolder"
                          disabled={radarrLoading || !radarrRootFolders}
                        >
                          <option value="">
                            {radarrLoading
                              ? 'Loading...'
                              : effectiveRadarrServerId !== undefined
                              ? intl.formatMessage(messages.selectRootFolder)
                              : intl.formatMessage(messages.selectServerFirst)}
                          </option>
                          {radarrRootFolders?.map((folder) => (
                            <option key={folder.id} value={folder.path}>
                              {folder.path}
                            </option>
                          ))}
                        </Field>
                      </div>
                    </div>

                    {/* Radarr Tags Selection */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-300">
                        {intl.formatMessage(messages.selectRadarrTags)}
                      </div>
                      <div className="form-input-field">
                        <Select<OptionType, true>
                          options={
                            radarrTags?.map((tag) => ({
                              label: tag.label,
                              value: tag.id,
                            })) || []
                          }
                          isMulti
                          isDisabled={radarrLoading || !radarrTags}
                          placeholder={
                            radarrLoading
                              ? 'Loading...'
                              : effectiveRadarrServerId !== undefined
                              ? intl.formatMessage(messages.selectTags)
                              : intl.formatMessage(messages.selectServerFirst)
                          }
                          noOptionsMessage={() =>
                            intl.formatMessage(messages.noTagOptions)
                          }
                          className="react-select-container"
                          classNamePrefix="react-select"
                          value={
                            radarrTags
                              ?.filter((tag) =>
                                values.directDownloadRadarrTags?.includes(
                                  tag.id
                                )
                              )
                              .map((tag) => ({
                                label: tag.label,
                                value: tag.id,
                              })) || []
                          }
                          onChange={(value) => {
                            setFieldValue?.(
                              'directDownloadRadarrTags',
                              value?.map((v) => v.value) || []
                            );
                          }}
                        />
                      </div>
                    </div>

                    {/* Radarr Monitor checkbox */}
                    <div className="flex items-center">
                      <Field
                        type="checkbox"
                        id="directDownloadRadarrMonitor"
                        name="directDownloadRadarrMonitor"
                        className="rounded"
                      />
                      <label
                        htmlFor="directDownloadRadarrMonitor"
                        className="ml-2 text-sm font-medium text-gray-300"
                      >
                        {intl.formatMessage(messages.radarrMonitor)}
                        <span className="label-tip">
                          {intl.formatMessage(messages.radarrMonitorHelp)}
                        </span>
                      </label>
                    </div>

                    {/* Radarr Search on Add checkbox */}
                    <div className="flex items-center">
                      <Field
                        type="checkbox"
                        id="directDownloadRadarrSearchOnAdd"
                        name="directDownloadRadarrSearchOnAdd"
                        className="rounded"
                      />
                      <label
                        htmlFor="directDownloadRadarrSearchOnAdd"
                        className="ml-2 text-sm font-medium text-gray-300"
                      >
                        {intl.formatMessage(messages.radarrSearchOnAdd)}
                        <span className="label-tip">
                          {intl.formatMessage(messages.radarrSearchOnAddHelp)}
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Sonarr Server and Profile Selection - only show if TV processing is enabled */}
                {values.searchMissingTV && shouldShowTvSettings() && (
                  <div className="rounded-md border border-gray-700 p-4">
                    {/* Sonarr Server Selection - only show if 2+ servers */}
                    {sonarrServers && sonarrServers.length > 1 && (
                      <div>
                        <div className="mb-2 text-sm font-medium text-gray-300">
                          {intl.formatMessage(messages.selectSonarrServer)}
                        </div>
                        <div className="form-input-field">
                          <Field
                            as="select"
                            name="directDownloadSonarrServerId"
                            onChange={(
                              e: React.ChangeEvent<HTMLSelectElement>
                            ) => {
                              const serverId = e.target.value
                                ? Number(e.target.value)
                                : undefined;
                              setFieldValue?.(
                                'directDownloadSonarrServerId',
                                serverId
                              );
                              // Clear profile selection when server changes
                              setFieldValue?.(
                                'directDownloadSonarrProfileId',
                                undefined
                              );
                            }}
                          >
                            <option value="">
                              {intl.formatMessage(messages.selectServer)}
                            </option>
                            {sonarrServers.map((server) => (
                              <option key={server.id} value={server.id}>
                                {server.name ||
                                  `${server.hostname}:${server.port}`}
                                {server.isDefault && ' (Default)'}
                              </option>
                            ))}
                          </Field>
                        </div>
                      </div>
                    )}

                    {/* Sonarr Profile Selection - always show */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-300">
                        {intl.formatMessage(messages.selectSonarrProfile)}
                      </div>
                      <div className="form-input-field">
                        <Field
                          as="select"
                          name="directDownloadSonarrProfileId"
                          disabled={sonarrLoading || !sonarrProfiles}
                        >
                          <option value="">
                            {sonarrLoading
                              ? 'Loading...'
                              : effectiveSonarrServerId !== undefined
                              ? intl.formatMessage(messages.selectProfile)
                              : intl.formatMessage(messages.selectServerFirst)}
                          </option>
                          {sonarrProfiles?.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </Field>
                      </div>
                    </div>

                    {/* Sonarr Root Folder Selection - always show */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-300">
                        {intl.formatMessage(messages.selectSonarrRootFolder)}
                      </div>
                      <div className="form-input-field">
                        <Field
                          as="select"
                          name="directDownloadSonarrRootFolder"
                          disabled={sonarrLoading || !sonarrRootFolders}
                        >
                          <option value="">
                            {sonarrLoading
                              ? 'Loading...'
                              : effectiveSonarrServerId !== undefined
                              ? intl.formatMessage(messages.selectRootFolder)
                              : intl.formatMessage(messages.selectServerFirst)}
                          </option>
                          {sonarrRootFolders?.map((folder) => (
                            <option key={folder.id} value={folder.path}>
                              {folder.path}
                            </option>
                          ))}
                        </Field>
                      </div>
                    </div>

                    {/* Sonarr Tags Selection */}
                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-300">
                        {intl.formatMessage(messages.selectSonarrTags)}
                      </div>
                      <div className="form-input-field">
                        <Select<OptionType, true>
                          options={
                            sonarrTags?.map((tag) => ({
                              label: tag.label,
                              value: tag.id,
                            })) || []
                          }
                          isMulti
                          isDisabled={sonarrLoading || !sonarrTags}
                          placeholder={
                            sonarrLoading
                              ? 'Loading...'
                              : effectiveSonarrServerId !== undefined
                              ? intl.formatMessage(messages.selectTags)
                              : intl.formatMessage(messages.selectServerFirst)
                          }
                          noOptionsMessage={() =>
                            intl.formatMessage(messages.noTagOptions)
                          }
                          className="react-select-container"
                          classNamePrefix="react-select"
                          value={
                            sonarrTags
                              ?.filter((tag) =>
                                values.directDownloadSonarrTags?.includes(
                                  tag.id
                                )
                              )
                              .map((tag) => ({
                                label: tag.label,
                                value: tag.id,
                              })) || []
                          }
                          onChange={(value) => {
                            setFieldValue?.(
                              'directDownloadSonarrTags',
                              value?.map((v) => v.value) || []
                            );
                          }}
                        />
                      </div>
                    </div>

                    {/* Sonarr Monitor checkbox */}
                    <div className="flex items-center">
                      <Field
                        type="checkbox"
                        id="directDownloadSonarrMonitor"
                        name="directDownloadSonarrMonitor"
                        className="rounded"
                      />
                      <label
                        htmlFor="directDownloadSonarrMonitor"
                        className="ml-2 text-sm font-medium text-gray-300"
                      >
                        {intl.formatMessage(messages.sonarrMonitor)}
                        <span className="label-tip">
                          {intl.formatMessage(messages.sonarrMonitorHelp)}
                        </span>
                      </label>
                    </div>

                    {/* Sonarr Search on Add checkbox */}
                    <div className="flex items-center">
                      <Field
                        type="checkbox"
                        id="directDownloadSonarrSearchOnAdd"
                        name="directDownloadSonarrSearchOnAdd"
                        className="rounded"
                      />
                      <label
                        htmlFor="directDownloadSonarrSearchOnAdd"
                        className="ml-2 text-sm font-medium text-gray-300"
                      >
                        {intl.formatMessage(messages.sonarrSearchOnAdd)}
                        <span className="label-tip">
                          {intl.formatMessage(messages.sonarrSearchOnAddHelp)}
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Show message if no processing options are enabled */}
                {!values.searchMissingMovies && !values.searchMissingTV && (
                  <div className="text-sm text-gray-400">
                    {intl.formatMessage(messages.enableProcessingForDirect)}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};

export default AutoRequestSection;
