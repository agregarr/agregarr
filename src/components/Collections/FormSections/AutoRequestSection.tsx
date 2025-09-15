import { Field } from 'formik';
import { defineMessages, useIntl } from 'react-intl';

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
    'Limit each TV show to only the first X seasons (0 = all seasons)',

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
});

interface AutoRequestSectionProps {
  values: {
    libraryIds?: string[];
    libraryId?: string | string[];
    mediaType?: string;
    [key: string]: unknown;
  };
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  libraries: { key: string; name: string; type: string }[];
  isVisible?: boolean;
}

const AutoRequestSection = ({
  values,
  errors,
  touched,
  libraries = [],
  isVisible = true,
}: AutoRequestSectionProps) => {
  const intl = useIntl();

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
              Content Processing
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
                      Enable movie or TV processing above to configure
                      auto-approval options.
                    </div>
                  )}
                </>
              </div>
              <div className="label-tip mt-2">
                {intl.formatMessage(messages.autoApproveHelp)}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
};

export default AutoRequestSection;
