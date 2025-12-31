import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import globalMessages from '@app/i18n/globalMessages';
import type {
  CollectionConfigFormProps,
  CollectionFormConfig,
  CollectionFormConfigForEditing,
  CollectionSourceConfig,
  MultiSourceCollectionConfig,
  MultiSourceCombineMode,
  MultiSourceType,
  PlexHubConfig,
} from '@app/types/collections';
import { SMART_COLLECTION_SORT_OPTIONS } from '@app/types/collections';
import { Transition } from '@headlessui/react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid';
import { Field, Formik, type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';

// Form values use CollectionFormConfig with proper initialization
import { getTemplatePresets } from '@app/components/Collections/Forms/titlePresets';
import ArrTagConfigSection from '@app/components/Collections/FormSections/ArrTagConfigSection';
import AutoRequestSection from '@app/components/Collections/FormSections/AutoRequestSection';
import CollectionExclusionSection from '@app/components/Collections/FormSections/CollectionExclusionSection';
import CollectionTypeSection from '@app/components/Collections/FormSections/CollectionTypeSection';
import CustomUrlSection from '@app/components/Collections/FormSections/CustomUrlSection';
import LibrarySelectionSection from '@app/components/Collections/FormSections/LibrarySelectionSection';
import MultiSourceConfigSection from '@app/components/Collections/FormSections/MultiSourceConfigSection';
import NetworksConfigSection from '@app/components/Collections/FormSections/NetworksConfigSection';
import OriginalsConfigSection from '@app/components/Collections/FormSections/OriginalsConfigSection';
import PosterUploadSection from '@app/components/Collections/FormSections/PosterUploadSection';
import TemplateSection from '@app/components/Collections/FormSections/TemplateSection';
import ThemeUploadSection from '@app/components/Collections/FormSections/ThemeUploadSection';
import TimePeriodSection from '@app/components/Collections/FormSections/TimePeriodSection';
import TimeRestrictionsSection from '@app/components/Collections/FormSections/TimeRestrictionsSection';
import VisibilitySection from '@app/components/Collections/FormSections/VisibilitySection';
import WallpaperUploadSection from '@app/components/Collections/FormSections/WallpaperUploadSection';
import PreviewCollectionModal from '@app/components/Collections/PreviewCollectionModal';

const messages = defineMessages({
  editCollection: 'Edit Collection Configuration',
  addCollection: 'Add New Collection',
  collectionType: 'Collection Type',
  collectionSubtype: 'Collection Sub-Type',
  selectSource: 'Select Source...',
  selectSubtype: 'Select sub-type...',
  visibility: 'Visibility',
  maxItems: 'Max Items',
  minimumPlays: 'Minimum Play Count',
  customPoster: 'Posters',
  wallpapersAndTheme: 'Wallpapers and Theme',
  enableCustomWallpaper: 'Custom Wallpaper',
  enableCustomSummary: 'Custom Summary',
  enableCustomTheme: 'Custom Theme Music',
  customSummaryPlaceholder: 'Enter a custom description for this collection...',
  customSummaryHelp:
    'Custom description text for the collection. Will be synced to Plex.',
  overlayConfigWarningTitle: 'No Overlay Templates Configured',
  overlayConfigWarningMessage:
    'You have enabled placeholder creation and overlay application, but no overlay templates are configured for {libraryNames}. Placeholders will be created without status overlays showing monitored status, release dates, etc.',
  configureOverlays: 'Configure Overlays',
  placeholderRootFoldersRequired: 'Placeholder Root Folders Required',
  placeholderRootFoldersMessage:
    'You have enabled placeholder creation, but no placeholder root folders are configured. Please configure at least one folder to enable this feature.',
  configureDownloads: 'Configure Downloads',
  autoRequestSettings: 'Auto-Request Settings',
  timeRestrictions: 'Time Restrictions',
  createCollection: 'Create Collection',
  updateCollection: 'Update Collection',
  showUnwatchedOnly: 'Show Unwatched Items Only',
  showUnwatchedOnlyDescription: 'Create Smart Collection',
  smartCollectionSort: 'Smart Collection Sort Order',
  cancel: 'Cancel',
  preview: 'Preview:',
  previewCollection: 'Preview Collection',
  alwaysActive: 'Always Active',
});

const CollectionFormConfigForm = ({
  config,
  onSave,
  onCancel,
  onUnlink,
  onLink,
  libraries,
  allCollectionConfigs,
  allHubConfigs,
}: CollectionConfigFormProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  // Get current user data which includes Plex Pass status
  const { data: currentUser } = useSWR('/api/v1/auth/me');

  // Fetch overlay library configs to check if overlays are configured
  const { data: overlayConfigsResponse } = useSWR<{
    configs: {
      id: number;
      libraryId: string;
      libraryName: string;
      mediaType: 'movie' | 'show';
      enabledOverlays: {
        templateId: number;
        enabled: boolean;
        layerOrder: number;
      }[];
    }[];
  }>('/api/v1/overlay-library-configs');
  const overlayConfigs = overlayConfigsResponse?.configs || [];

  // Fetch settings to check if placeholder root folders are configured
  const { data: settingsData } = useSWR<{
    placeholderMovieRootFolder?: string;
    placeholderTVRootFolder?: string;
  }>('/api/v1/settings/main');

  // State for storing fetched titles and detected media types
  const [fetchedTitles, setFetchedTitles] = useState<{
    trakt?: string;
    tmdb?: string;
    imdb?: string;
    letterboxd?: string;
    mdblist?: string;
    anilist?: string;
  }>({});

  const [detectedMediaTypes, setDetectedMediaTypes] = useState<{
    trakt?: 'movie' | 'tv' | 'both';
    tmdb?: 'movie' | 'tv' | 'both';
    imdb?: 'movie' | 'tv' | 'both';
    letterboxd?: 'movie' | 'tv' | 'both';
    mdblist?: 'movie' | 'tv' | 'both';
    anilist?: 'movie' | 'tv' | 'both';
  }>({});

  const [detectingMediaTypes, setDetectingMediaTypes] = useState<{
    trakt?: boolean;
    tmdb?: boolean;
    imdb?: boolean;
    letterboxd?: boolean;
    mdblist?: boolean;
  }>({});

  const [, setFetchingTitle] = useState<{
    trakt?: boolean;
    tmdb?: boolean;
    imdb?: boolean;
    letterboxd?: boolean;
    mdblist?: boolean;
    anilist?: boolean;
  }>({});

  // State for confirmation - MUST be before any early returns to avoid React Hooks violation
  const [unlinkConfirmState, setUnlinkConfirmState] = useState(false);
  const [linkConfirmState, setLinkConfirmState] = useState(false);

  // State for preview modal
  const [showPreview, setShowPreview] = useState(false);

  // Generate tooltip showing which other items will be affected - MUST be before early returns
  const linkingTooltip = useMemo(() => {
    if (!config) return undefined;

    const isHub =
      config.collectionType === 'default_plex_hub' ||
      (config as CollectionFormConfig).configType === 'hub';
    const isPreExisting =
      config.collectionType === 'pre_existing' ||
      (config as CollectionFormConfig).configType === 'preExisting';
    const isCollection = !isHub && !isPreExisting;
    const isLinked = Boolean(config.isLinked && !config.isUnlinked);

    if (isLinked) {
      // Unlink button - show what will be unlinked
      if (isHub && allHubConfigs) {
        const hubConfig = config as PlexHubConfig;
        const linkedHubs = allHubConfigs.filter(
          (h: PlexHubConfig) =>
            h.linkId === config.linkId && h.isLinked && h.id !== config.id
        );
        if (linkedHubs.length > 0) {
          const currentHubText = `${hubConfig.name} (${hubConfig.libraryName})`;
          const otherHubsText = linkedHubs
            .map((h) => `${h.name} (${h.libraryName})`)
            .join('\n');
          return `Will unlink ${
            linkedHubs.length + 1
          } hubs:\n${currentHubText}\n${otherHubsText}`;
        }
      } else if (isCollection && allCollectionConfigs) {
        const collectionConfig = config as CollectionFormConfig;
        const linkedCollections = allCollectionConfigs.filter(
          (c: CollectionFormConfig) =>
            c.type === collectionConfig.type &&
            c.subtype === collectionConfig.subtype &&
            c.linkId === collectionConfig.linkId &&
            c.isLinked &&
            c.id !== collectionConfig.id
        );
        if (linkedCollections.length > 0) {
          const currentLibName =
            libraries?.find((lib) => lib.key === collectionConfig.libraryId)
              ?.name || 'Unknown';
          const currentText = `${config.name} (${currentLibName})`;
          const otherTexts = linkedCollections
            .map((c) => {
              const libName =
                libraries?.find((lib) => lib.key === c.libraryId)?.name ||
                'Unknown';
              return `${c.name} (${libName})`;
            })
            .join('\n');
          return `Will unlink ${
            linkedCollections.length + 1
          } collections:\n${currentText}\n${otherTexts}`;
        }
      }
    } else if (config.linkId) {
      // Check if can link
      if (isHub && allHubConfigs) {
        const hubConfig = config as PlexHubConfig;
        const eligibleHubs = allHubConfigs.filter(
          (h: PlexHubConfig) =>
            h.linkId !== undefined &&
            h.linkId === config.linkId &&
            h.id !== config.id &&
            !h.isLinked
        );
        if (eligibleHubs.length > 0) {
          const currentHubText = `${hubConfig.name} (${hubConfig.libraryName})`;
          const otherHubsText = eligibleHubs
            .map((h) => `${h.name} (${h.libraryName})`)
            .join('\n');
          return `Will link ${
            eligibleHubs.length + 1
          } hubs:\n${currentHubText}\n${otherHubsText}`;
        }
      } else if (isCollection && allCollectionConfigs) {
        const collectionConfig = config as CollectionFormConfig;
        const eligibleCollections = allCollectionConfigs.filter(
          (c: CollectionFormConfig) =>
            c.type === collectionConfig.type &&
            c.subtype === collectionConfig.subtype &&
            c.linkId !== undefined &&
            c.linkId === collectionConfig.linkId &&
            !c.isLinked &&
            c.id !== collectionConfig.id
        );
        if (eligibleCollections.length > 0) {
          const currentLibName =
            libraries?.find((lib) => lib.key === collectionConfig.libraryId)
              ?.name || 'Unknown';
          const currentText = `${config.name} (${currentLibName})`;
          const otherTexts = eligibleCollections
            .map((c) => {
              const libName =
                libraries?.find((lib) => lib.key === c.libraryId)?.name ||
                'Unknown';
              return `${c.name} (${libName})`;
            })
            .join('\n');
          return `Will link ${
            eligibleCollections.length + 1
          } collections:\n${currentText}\n${otherTexts}`;
        }
      }
    }
    return undefined;
  }, [config, allHubConfigs, allCollectionConfigs, libraries]);

  // Validation schema for collections, hubs, and pre-existing configs
  const CollectionFormConfigSchema = Yup.object().shape({
    // Only validate type/subtype for full collections, not hubs/pre-existing
    type: Yup.string().when(['hubIdentifier', 'collectionType'], {
      is: (hubIdentifier: string, collectionType: string) =>
        !hubIdentifier &&
        collectionType !== 'default_plex_hub' &&
        collectionType !== 'pre_existing', // Only required if not a hub or pre-existing
      then: (schema) => schema.required('Collection type is required'),
      otherwise: (schema) => schema,
    }),
    subtype: Yup.string().when(['hubIdentifier', 'collectionType', 'type'], {
      is: (hubIdentifier: string, collectionType: string, type?: string) =>
        !hubIdentifier &&
        collectionType !== 'default_plex_hub' &&
        collectionType !== 'pre_existing' &&
        !!type &&
        type !== 'multi-source' &&
        type !== 'radarrtag' &&
        type !== 'sonarrtag' &&
        type !== 'filtered_hub', // Only required if not a hub, pre-existing, multi-source, tag-based, or recently_added
      then: (schema) => schema.required('Collection sub-type is required'),
      otherwise: (schema) => schema.notRequired(),
    }),
    personMinimumItems: Yup.number()
      .transform((value, originalValue) => {
        if (
          originalValue === null ||
          originalValue === undefined ||
          originalValue === ''
        ) {
          return undefined;
        }
        return Number.isNaN(value) ? undefined : value;
      })
      .when(['type', 'subtype'], {
        is: (type?: string, subtype?: string) =>
          type === 'plex' && (subtype === 'actors' || subtype === 'directors'),
        then: (schema) =>
          schema
            .required('Minimum items is required')
            .min(2, 'Minimum items must be at least 2'),
        otherwise: (schema) => schema.notRequired(),
      }),
    useSeparator: Yup.boolean(),
    separatorTitle: Yup.string()
      .transform((value) => value?.trim())
      .when(['type', 'subtype', 'useSeparator'], {
        is: (type?: string, subtype?: string, useSeparator?: boolean) =>
          useSeparator === true &&
          type === 'plex' &&
          (subtype === 'actors' || subtype === 'directors'),
        then: (schema) =>
          schema
            .required('Separator title is required')
            .min(2, 'Separator title must be at least 2 characters'),
        otherwise: (schema) => schema.notRequired(),
      }),

    // Handle both libraryIds (collections) and libraryId (hubs/pre-existing)
    libraryIds: Yup.array()
      .of(Yup.string())
      .when('libraryId', {
        is: (libraryId: string) => !libraryId, // Only required if no single libraryId
        then: (schema) =>
          schema
            .min(1, 'Please select at least one library')
            .required('Please select at least one library'),
        otherwise: (schema) => schema,
      }),
    libraryId: Yup.string(), // Allow single libraryId for hubs/pre-existing
    radarrInstanceId: Yup.number()
      .transform((value, originalValue) =>
        originalValue === null || originalValue === ''
          ? undefined
          : Number.isNaN(value)
          ? undefined
          : value
      )
      .nullable()
      .when('type', {
        is: 'radarrtag',
        then: (schema) =>
          schema
            .typeError('Radarr instance is required')
            .required('Radarr instance is required'),
        otherwise: (schema) => schema,
      }),
    radarrTagId: Yup.number()
      .transform((value, originalValue) =>
        originalValue === null || originalValue === ''
          ? undefined
          : Number.isNaN(value)
          ? undefined
          : value
      )
      .nullable()
      .when('type', {
        is: 'radarrtag',
        then: (schema) =>
          schema
            .typeError('Radarr tag is required')
            .required('Radarr tag is required'),
        otherwise: (schema) => schema,
      }),
    sonarrInstanceId: Yup.number()
      .transform((value, originalValue) =>
        originalValue === null || originalValue === ''
          ? undefined
          : Number.isNaN(value)
          ? undefined
          : value
      )
      .nullable()
      .when('type', {
        is: 'sonarrtag',
        then: (schema) =>
          schema
            .typeError('Sonarr instance is required')
            .required('Sonarr instance is required'),
        otherwise: (schema) => schema,
      }),
    sonarrTagId: Yup.number()
      .transform((value, originalValue) =>
        originalValue === null || originalValue === ''
          ? undefined
          : Number.isNaN(value)
          ? undefined
          : value
      )
      .nullable()
      .when('type', {
        is: 'sonarrtag',
        then: (schema) =>
          schema
            .typeError('Sonarr tag is required')
            .required('Sonarr tag is required'),
        otherwise: (schema) => schema,
      }),
    // Template validation - only check when it exists
    template: Yup.string().test(
      'not-fetch-title',
      'Please validate the URL first',
      (value) => !value || value !== 'fetch-title'
    ),

    // Custom template validations - conditional based on selected libraries
    customMovieTemplate: Yup.string().when(['template', 'libraryIds'], {
      is: (template: string, libraryIds: string[]) => {
        if (template !== 'custom') return false;
        // Check if any selected library is a movie library
        return libraryIds?.some((libraryId: string) => {
          const library = libraries?.find((lib) => lib.key === libraryId);
          return library?.type === 'movie';
        });
      },
      then: (schema) => schema.required('Movie template is required'),
      otherwise: (schema) => schema,
    }),

    customTVTemplate: Yup.string().when(['template', 'libraryIds'], {
      is: (template: string, libraryIds: string[]) => {
        if (template !== 'custom') return false;
        // Check if any selected library is a TV library
        return libraryIds?.some((libraryId: string) => {
          const library = libraries?.find((lib) => lib.key === libraryId);
          return library?.type === 'show';
        });
      },
      then: (schema) => schema.required('TV template is required'),
      otherwise: (schema) => schema,
    }),

    customDays: Yup.number().when('type', {
      is: 'tautulli',
      then: (schema) =>
        schema
          .required('Number of days is required')
          .min(1, 'Must be at least 1 day')
          .max(365, 'Cannot exceed 365 days'),
      otherwise: (schema) => schema,
    }),

    comingSoonDays: Yup.number().when('type', {
      is: 'comingsoon',
      then: (schema) =>
        schema
          .min(1, 'Must be at least 1 day')
          .max(730, 'Cannot exceed 730 days'),
      otherwise: (schema) => schema,
    }),

    comingSoonReleasedDays: Yup.number().when('type', {
      is: 'comingsoon',
      then: (schema) =>
        schema
          .min(1, 'Must be at least 1 day')
          .max(30, 'Cannot exceed 30 days'),
      otherwise: (schema) => schema,
    }),

    traktCustomListUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) =>
        type === 'trakt' && subtype === 'custom',
      then: (schema) =>
        schema
          .required('Trakt list URL is required')
          .matches(
            /trakt\.tv\/(users\/[^/]+\/lists\/[^/?]+|lists\/official\/[^/?]+)/,
            'Please enter a valid Trakt list URL (e.g., https://trakt.tv/users/username/lists/list-name or https://trakt.tv/lists/official/collection-name)'
          ),
      otherwise: (schema) => schema,
    }),

    tmdbCustomCollectionUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) =>
        type === 'tmdb' && subtype === 'custom',
      then: (schema) =>
        schema
          .required('TMDB collection/list/network/company URL is required')
          .matches(
            /themoviedb\.org\/(collection\/\d+|list\/\d+|network\/\d+|company\/\d+(?:-[^/]+)?\/(?:movie|tv))/,
            'Please enter a valid TMDB URL (collection, list, network, or company page)'
          ),
      otherwise: (schema) => schema,
    }),

    imdbCustomListUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) =>
        type === 'imdb' && subtype === 'custom',
      then: (schema) =>
        schema
          .required('IMDb list URL is required')
          .matches(
            /imdb\.com\/list\/ls\d+/,
            'Please enter a valid IMDb list URL (e.g., https://www.imdb.com/list/ls123456789/)'
          ),
      otherwise: (schema) => schema,
    }),

    letterboxdCustomListUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) =>
        type === 'letterboxd' && subtype === 'custom',
      then: (schema) =>
        schema
          .required('Letterboxd list URL is required')
          .matches(
            /letterboxd\.com\/[^/]+\/list\/[^/?]+/,
            'Please enter a valid Letterboxd list URL (e.g., https://letterboxd.com/username/list/list-name/)'
          ),
      otherwise: (schema) =>
        schema.when(['type', 'subtype'], {
          is: (type: string, subtype: string) =>
            type === 'letterboxd' && subtype === 'watchlist',
          then: (schema) =>
            schema
              .required('Letterboxd watchlist URL is required')
              .matches(
                /letterboxd\.com\/[^/]+\/watchlist\/?/,
                'Please enter a valid Letterboxd watchlist URL (e.g., https://letterboxd.com/username/watchlist/)'
              ),
          otherwise: (schema) => schema,
        }),
    }),

    anilistCustomListUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) =>
        type === 'anilist' && subtype === 'custom',
      then: (schema) =>
        schema
          .required('AniList list URL is required')
          .matches(
            /anilist\.co\/(?:user\/[^/]+\/(?:animelist|list)\/[^/?]+|(?:animelist|list)\/[^/?]+|search\/anime(?:\/[^/?]+)?|anime\/?\d+)/,
            'Please enter a valid AniList URL (e.g., user lists, search pages, or anime pages)'
          ),
      otherwise: (schema) => schema,
    }),

    maxItems: Yup.number()
      .min(1, 'Must be at least 1 item')
      .max(9999, 'Cannot exceed 9999 items'),

    minimumPlays: Yup.number()
      .min(1, 'Must be at least 1 play')
      .max(100, 'Cannot exceed 100 plays')
      .when('type', {
        is: 'tautulli',
        then: (schema) => schema.required('Minimum plays is required'),
        otherwise: (schema) => schema.notRequired(),
      }),

    maxSeasonsToRequest: Yup.number().when('searchMissingTV', {
      is: (searchMissingTV: boolean) => searchMissingTV,
      then: (schema) =>
        schema
          .min(0, 'Must be 0 or greater (0 = no limit)')
          .max(50, 'Cannot exceed 50 seasons'),
      otherwise: (schema) => schema,
    }),

    seasonsPerShowLimit: Yup.number().when('searchMissingTV', {
      is: (searchMissingTV: boolean) => searchMissingTV,
      then: (schema) =>
        schema
          .min(0, 'Must be 0 or greater (0 = all seasons)')
          .max(50, 'Cannot exceed 50 seasons'),
      otherwise: (schema) => schema,
    }),

    // Visibility configuration - no validation required, any combination is valid
    visibilityConfig: Yup.object().shape({
      usersHome: Yup.boolean(),
      serverOwnerHome: Yup.boolean(),
      libraryRecommended: Yup.boolean(),
    }),

    // Time restriction validation
    timeRestriction: Yup.object().shape({
      alwaysActive: Yup.boolean(),
      removeFromPlexWhenInactive: Yup.boolean(),
      inactiveVisibilityConfig: Yup.object().shape({
        usersHome: Yup.boolean(),
        serverOwnerHome: Yup.boolean(),
        libraryRecommended: Yup.boolean(),
      }),
    }),

    // Custom sync schedule validation
    customSyncSchedule: Yup.object().shape({
      enabled: Yup.boolean(),
      scheduleType: Yup.string().oneOf(['preset', 'custom']),
      intervalHours: Yup.number().min(0.1),
      preset: Yup.string(),
      customCron: Yup.string(),
      startNow: Yup.boolean(),
      startDate: Yup.string().matches(
        /^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])$/,
        'Invalid date format (DD-MM)'
      ),
      startTime: Yup.string().matches(
        /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
        'Invalid time format (HH:MM)'
      ),
      firstSyncAt: Yup.string(),
    }),

    // Direct download field validation
    downloadMode: Yup.string().oneOf(['overseerr', 'direct']),
    excludedGenres: Yup.array().of(Yup.number().positive().integer()),
    excludedCountries: Yup.array().of(Yup.string()),
    directDownloadRadarrServerId: Yup.number().integer().min(0),
    directDownloadRadarrProfileId: Yup.number().positive().integer(),
    directDownloadRadarrRootFolder: Yup.string(),
    directDownloadRadarrTags: Yup.array().of(Yup.number().integer()),
    directDownloadRadarrMonitor: Yup.boolean(),
    directDownloadRadarrSearchOnAdd: Yup.boolean(),
    directDownloadSonarrServerId: Yup.number().integer().min(0),
    directDownloadSonarrProfileId: Yup.number().positive().integer(),
    directDownloadSonarrRootFolder: Yup.string(),
    directDownloadSonarrTags: Yup.array().of(Yup.number().integer()),
    directDownloadSonarrMonitor: Yup.boolean(),
    directDownloadSonarrSearchOnAdd: Yup.boolean(),
    overseerrRadarrServerId: Yup.number().integer().min(0),
    overseerrRadarrProfileId: Yup.number().positive().integer(),
    overseerrRadarrRootFolder: Yup.string(),
    overseerrRadarrTags: Yup.array().of(Yup.number().integer()),
    overseerrSonarrServerId: Yup.number().integer().min(0),
    overseerrSonarrProfileId: Yup.number().positive().integer(),
    overseerrSonarrRootFolder: Yup.string(),
    overseerrSonarrTags: Yup.array().of(Yup.number().integer()),

    // Multi-source field validation
    isMultiSource: Yup.boolean(),
    // Smart collection validation
    showUnwatchedOnly: Yup.boolean(),
    smartCollectionSort: Yup.object()
      .shape({
        value: Yup.string(),
        label: Yup.string(),
      })
      .nullable(),
    sources: Yup.array().of(
      Yup.object().shape({
        id: Yup.string().required('Source ID is required'),
        type: Yup.string().required('Source type is required'),
        subtype: Yup.string(),
        customUrl: Yup.string(),
        timePeriod: Yup.string().oneOf(['daily', 'weekly', 'monthly', 'all']),
        priority: Yup.number().required('Source priority is required'),
        isExpanded: Yup.boolean(),
        customDays: Yup.number().min(1).max(365),
        minimumPlays: Yup.number().min(1).max(100),
        networksCountry: Yup.string(),
      })
    ),
    combineMode: Yup.string().oneOf([
      'interleaved',
      'list_order',
      'randomised',
      'cycle_lists',
    ]),
  });

  // Safety check for undefined config
  if (!config) {
    return null;
  }

  // Determine config type for form adaptation using collectionType or configType
  const isHub =
    config.collectionType === 'default_plex_hub' ||
    (config as CollectionFormConfig).configType === 'hub';
  const isPreExisting =
    config.collectionType === 'pre_existing' ||
    (config as CollectionFormConfig).configType === 'preExisting';
  const isCollection = !isHub && !isPreExisting; // Regular Agregarr collections

  // Use unified linking approach - check if actively linked
  // If isUnlinked is true, treat as NOT linked (available for re-linking)
  const isLinked = Boolean(config.isLinked && !config.isUnlinked);

  // Determine if this config can be linked (for showing link button)
  // Only show link button for existing configs that are unlinked but could be linked
  const canLink = (() => {
    if (!config.name || isLinked || isPreExisting) return false;

    if (isHub) {
      // For hubs: check if there are other unlinked hubs with same linkId
      // Include hubs with isUnlinked flag - those can be relinked!
      if (!allHubConfigs) return false;
      // Must have valid linkId to be linkable (prevent undefined === undefined)
      if (config.linkId === undefined) return false;
      const eligibleHubs = allHubConfigs.filter(
        (h: PlexHubConfig) =>
          h.linkId !== undefined && // Must have valid linkId
          h.linkId === config.linkId &&
          h.id !== config.id &&
          !h.isLinked
        // Note: We don't exclude isUnlinked hubs - they can be relinked
      );
      return eligibleHubs.length > 0;
    } else if (isCollection) {
      // For collections: check if there are other unlinked collections with same type/subtype/linkId
      if (!allCollectionConfigs) return false;
      const collectionConfig = config as CollectionFormConfig;
      // Must have valid linkId to be linkable (prevent undefined === undefined)
      if (collectionConfig.linkId === undefined) return false;
      const eligibleCollections = allCollectionConfigs.filter(
        (c: CollectionFormConfig) =>
          c.type === collectionConfig.type &&
          c.subtype === collectionConfig.subtype &&
          c.linkId !== undefined && // Must have valid linkId
          c.linkId === collectionConfig.linkId &&
          !c.isLinked &&
          c.id !== collectionConfig.id
      );
      return eligibleCollections.length > 0;
    }

    return false;
  })();

  // Button handlers for link/unlink
  const handleUnlinkClick = () => {
    if (!unlinkConfirmState) {
      // First click - show confirmation state
      setUnlinkConfirmState(true);
    } else {
      // Second click - actually unlink
      if (onUnlink) {
        onUnlink(config);
        onCancel(); // Close the form after unlinking
      }
    }
  };

  const handleLinkClick = () => {
    if (!linkConfirmState) {
      // First click - show confirmation state
      setLinkConfirmState(true);
    } else {
      // Second click - actually link
      if (onLink) {
        onLink(config);
        onCancel(); // Close the form after linking
      }
    }
  };

  // Comprehensive media type detection function
  const detectMediaType = async (
    url: string,
    type: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd'
  ) => {
    try {
      setDetectingMediaTypes((prev) => ({ ...prev, [type]: true }));
      const response = await fetch(`/api/v1/collections/detect-media-type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type }),
      });
      const data = await response.json();
      if (data.mediaType) {
        setDetectedMediaTypes((prev) => ({ ...prev, [type]: data.mediaType }));
      }
    } catch (error) {
      // Silently fail - media type detection is optional
    } finally {
      setDetectingMediaTypes((prev) => ({ ...prev, [type]: false }));
    }
  };

  // Title fetching functions
  const fetchTraktTitle = async (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => {
    try {
      setFetchingTitle((prev) => ({ ...prev, trakt: true }));

      // Step 1: Quick title fetch and validation (first 10 items)
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'trakt' }),
      });
      const data = await response.json();

      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, trakt: data.title }));

        // Set initial media type from first 10 items if available
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({ ...prev, trakt: data.mediaType }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            setFieldValue('template', data.title);
          }, 100); // Small delay to ensure state is updated
        }

        // Step 2: Start comprehensive media type detection in background
        setDetectingMediaTypes((prev) => ({ ...prev, trakt: true }));
        detectMediaType(url, 'trakt');
      }
    } catch (error) {
      // Failed to fetch Trakt title - silently continue
    } finally {
      setFetchingTitle((prev) => ({ ...prev, trakt: false }));
    }
  };

  const fetchTmdbTitle = async (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => {
    try {
      setFetchingTitle((prev) => ({ ...prev, tmdb: true }));
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'tmdb' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, tmdb: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({ ...prev, tmdb: data.mediaType }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            setFieldValue('template', data.title);
          }, 100); // Small delay to ensure state is updated
        }
      }
    } catch (error) {
      // Failed to fetch TMDB title - silently continue
    } finally {
      setFetchingTitle((prev) => ({ ...prev, tmdb: false }));
    }
  };

  const fetchImdbTitle = async (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => {
    try {
      setFetchingTitle((prev) => ({ ...prev, imdb: true }));

      // Step 1: Quick title fetch and validation
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'imdb' }),
      });
      const data = await response.json();

      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, imdb: data.title }));

        // Set initial media type if available
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({ ...prev, imdb: data.mediaType }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            setFieldValue('template', data.title);
          }, 100);
        }

        // Step 2: Start comprehensive media type detection in background
        detectMediaType(url, 'imdb');
      }
    } catch (error) {
      // Failed to fetch IMDb title - silently continue
    } finally {
      setFetchingTitle((prev) => ({ ...prev, imdb: false }));
    }
  };

  const fetchLetterboxdTitle = async (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => {
    try {
      setFetchingTitle((prev) => ({ ...prev, letterboxd: true }));
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'letterboxd' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, letterboxd: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({
            ...prev,
            letterboxd: data.mediaType,
          }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            setFieldValue('template', data.title);
          }, 100); // Small delay to ensure state is updated
        }
      }
    } catch (error) {
      // Failed to fetch Letterboxd title - silently continue
    } finally {
      setFetchingTitle((prev) => ({ ...prev, letterboxd: false }));
    }
  };

  const fetchMdblistTitle = async (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => {
    try {
      setFetchingTitle((prev) => ({ ...prev, mdblist: true }));
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'mdblist' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, mdblist: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({
            ...prev,
            mdblist: data.mediaType,
          }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            setFieldValue('template', data.title);
          }, 100); // Small delay to ensure state is updated
        }
      }
    } catch (error) {
      // Failed to fetch MDBList title - silently continue
    } finally {
      setFetchingTitle((prev) => ({ ...prev, mdblist: false }));
    }
  };

  const fetchAnilistTitle = async (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => {
    try {
      setFetchingTitle((prev) => ({ ...prev, anilist: true }));
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'anilist' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, anilist: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({
            ...prev,
            anilist: data.mediaType,
          }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            setFieldValue('template', data.title);
          }, 100); // Small delay to ensure state is updated
        }
      }
    } catch (error) {
      // Failed to fetch AniList title - silently continue
    } finally {
      setFetchingTitle((prev) => ({ ...prev, anilist: false }));
    }
  };

  // getVisibilityOptions will be defined inside the Formik render function

  // Validation is now handled by Yup schema

  // handleSave is now handled by Formik onSubmit

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity ease-in-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Formik
        initialValues={{
          ...config,
          // Set clean defaults for new collections
          // Cast to CollectionFormConfig since we're creating CollectionFormConfig-compatible values
          type: (config as CollectionFormConfig).isMultiSource
            ? 'multi-source'
            : (config as CollectionFormConfig).type || undefined,
          // Parse compound subtypes (e.g., "played_daily" -> subtype: "played", timePeriod: "daily")
          ...(() => {
            const originalSubtype =
              (config as CollectionFormConfig).subtype || '';
            if (
              (config as CollectionFormConfig).type === 'trakt' &&
              ['played_', 'watched_', 'collected_', 'favorited_'].some(
                (prefix) => originalSubtype.startsWith(prefix)
              )
            ) {
              const parts = originalSubtype.split('_');
              if (parts.length === 2) {
                return {
                  subtype: parts[0],
                  timePeriod: parts[1] as
                    | 'daily'
                    | 'weekly'
                    | 'monthly'
                    | 'all',
                };
              }
            }
            return {
              subtype: originalSubtype,
              timePeriod: undefined,
            };
          })(),
          template:
            (config as CollectionFormConfig).template ||
            (() => {
              if (
                (config as CollectionFormConfig).type === 'plex' &&
                ((config as CollectionFormConfig).subtype === 'directors' ||
                  (config as CollectionFormConfig).subtype === 'actors')
              ) {
                return (config as CollectionFormConfig).subtype === 'actors'
                  ? '{actor}'
                  : '{director}';
              }
              return '';
            })(),
          libraryId: config.libraryId || undefined,
          libraryIds:
            (config as CollectionFormConfigForEditing).libraryIds ||
            (config.libraryId ? [config.libraryId] : []),
          libraryName: config.libraryName || undefined,
          libraryNames:
            (config as CollectionFormConfigForEditing).libraryNames ||
            (config.libraryName ? [config.libraryName] : []),
          maxItems: (config as CollectionFormConfig).maxItems || 50,
          minimumPlays: (config as CollectionFormConfig).minimumPlays || 3,
          customDays: (config as CollectionFormConfig).customDays || 30,
          // Placeholder settings - map old Coming Soon fields for backward compatibility
          createPlaceholdersForMissing:
            (config as CollectionFormConfig).createPlaceholdersForMissing ??
            (config as CollectionFormConfig).type === 'comingsoon', // Force true for Coming Soon
          personMinimumItems:
            (config as CollectionFormConfig).personMinimumItems ??
            ((config as CollectionFormConfig).type === 'plex' &&
            ((config as CollectionFormConfig).subtype === 'actors' ||
              (config as CollectionFormConfig).subtype === 'directors')
              ? 5
              : undefined),
          useSeparator: (config as CollectionFormConfig).useSeparator ?? false,
          separatorTitle:
            (config as CollectionFormConfig).separatorTitle ||
            ((config as CollectionFormConfig).type === 'plex' &&
            ((config as CollectionFormConfig).subtype === 'actors' ||
              (config as CollectionFormConfig).subtype === 'directors')
              ? (config as CollectionFormConfig).subtype === 'actors'
                ? 'Actor Collections'
                : 'Director Collections'
              : ''),
          placeholderReleasedDays:
            (config as CollectionFormConfig).placeholderReleasedDays ||
            (config as CollectionFormConfig).comingSoonReleasedDays ||
            14,
          placeholderDaysAhead:
            (config as CollectionFormConfig).placeholderDaysAhead ||
            (config as CollectionFormConfig).comingSoonDays ||
            90,
          applyOverlaysDuringSync:
            (config as CollectionFormConfig).applyOverlaysDuringSync ??
            (config as CollectionFormConfig).type === 'comingsoon', // Default true for Coming Soon
          // Download mode settings
          enableGrabMissingItems:
            ((config as CollectionFormConfig).searchMissingMovies ||
              (config as CollectionFormConfig).searchMissingTV) ??
            false,
          downloadMode:
            (config as CollectionFormConfig).downloadMode || undefined, // No default - user must choose
          searchMissingMovies:
            (config as CollectionFormConfig).searchMissingMovies ?? false,
          searchMissingTV:
            (config as CollectionFormConfig).searchMissingTV ?? false,
          autoApproveMovies:
            (config as CollectionFormConfig).autoApproveMovies ?? false,
          autoApproveTV:
            (config as CollectionFormConfig).autoApproveTV ?? false,
          maxSeasonsToRequest:
            (config as CollectionFormConfig).maxSeasonsToRequest ?? 0,
          seasonsPerShowLimit:
            (config as CollectionFormConfig).seasonsPerShowLimit ?? 0,
          maxPositionToProcess:
            (config as CollectionFormConfig).maxPositionToProcess ?? 0,
          minimumYear: (config as CollectionFormConfig).minimumYear || 0,
          minimumImdbRating:
            (config as CollectionFormConfig).minimumImdbRating || 0,
          minimumRottenTomatoesRating:
            (config as CollectionFormConfig).minimumRottenTomatoesRating || 0,
          excludedGenres: (config as CollectionFormConfig).excludedGenres || [],
          excludedCountries:
            (config as CollectionFormConfig).excludedCountries || [],
          excludedLanguages:
            (config as CollectionFormConfig).excludedLanguages || [],
          filterSettings: (config as CollectionFormConfig).filterSettings,
          excludeFromCollections:
            (config as CollectionFormConfig).excludeFromCollections || [],
          // Radarr/Sonarr tag configuration
          radarrInstanceId:
            (config as CollectionFormConfig).radarrInstanceId ?? undefined,
          sonarrInstanceId:
            (config as CollectionFormConfig).sonarrInstanceId ?? undefined,
          radarrTagId:
            (config as CollectionFormConfig).radarrTagId ?? undefined,
          sonarrTagId:
            (config as CollectionFormConfig).sonarrTagId ?? undefined,
          // Direct download server selection
          directDownloadRadarrServerId:
            (config as CollectionFormConfig).directDownloadRadarrServerId ??
            undefined,
          directDownloadRadarrProfileId:
            (config as CollectionFormConfig).directDownloadRadarrProfileId ??
            undefined,
          directDownloadRadarrRootFolder:
            (config as CollectionFormConfig).directDownloadRadarrRootFolder ??
            undefined,
          directDownloadRadarrTags:
            (config as CollectionFormConfig).directDownloadRadarrTags ?? [],
          directDownloadRadarrMonitor: (config as CollectionFormConfig)
            .directDownloadRadarrMonitor,
          directDownloadRadarrSearchOnAdd: (config as CollectionFormConfig)
            .directDownloadRadarrSearchOnAdd,
          directDownloadSonarrServerId:
            (config as CollectionFormConfig).directDownloadSonarrServerId ??
            undefined,
          directDownloadSonarrProfileId:
            (config as CollectionFormConfig).directDownloadSonarrProfileId ??
            undefined,
          directDownloadSonarrRootFolder:
            (config as CollectionFormConfig).directDownloadSonarrRootFolder ??
            undefined,
          directDownloadSonarrTags:
            (config as CollectionFormConfig).directDownloadSonarrTags ?? [],
          directDownloadSonarrMonitor: (config as CollectionFormConfig)
            .directDownloadSonarrMonitor,
          directDownloadSonarrSearchOnAdd: (config as CollectionFormConfig)
            .directDownloadSonarrSearchOnAdd,
          overseerrRadarrServerId:
            (config as CollectionFormConfig).overseerrRadarrServerId ??
            undefined,
          overseerrRadarrProfileId:
            (config as CollectionFormConfig).overseerrRadarrProfileId ??
            undefined,
          overseerrRadarrRootFolder:
            (config as CollectionFormConfig).overseerrRadarrRootFolder ??
            undefined,
          overseerrRadarrTags:
            (config as CollectionFormConfig).overseerrRadarrTags ?? [],
          overseerrSonarrServerId:
            (config as CollectionFormConfig).overseerrSonarrServerId ??
            undefined,
          overseerrSonarrProfileId:
            (config as CollectionFormConfig).overseerrSonarrProfileId ??
            undefined,
          overseerrSonarrRootFolder:
            (config as CollectionFormConfig).overseerrSonarrRootFolder ??
            undefined,
          overseerrSonarrTags:
            (config as CollectionFormConfig).overseerrSonarrTags ?? [],
          visibilityConfig: {
            usersHome: config.visibilityConfig?.usersHome ?? false,
            serverOwnerHome: config.visibilityConfig?.serverOwnerHome ?? false,
            libraryRecommended:
              config.visibilityConfig?.libraryRecommended ?? false,
          },
          randomizeHomeOrder:
            (config as CollectionFormConfig).randomizeHomeOrder ?? false,
          customPoster: (config as CollectionFormConfig).customPoster || '',
          customWallpaper:
            (config as CollectionFormConfig).customWallpaper || '',
          customSummary: (config as CollectionFormConfig).customSummary || '',
          customTheme: (config as CollectionFormConfig).customTheme || '',
          // Enable flags for custom features (default to false)
          enableCustomWallpaper:
            (config as CollectionFormConfig).enableCustomWallpaper ?? false,
          enableCustomSummary:
            (config as CollectionFormConfig).enableCustomSummary ?? false,
          enableCustomTheme:
            (config as CollectionFormConfig).enableCustomTheme ?? false,
          // Default autoPoster to false for pre-existing collections (they have their own posters),
          // true for Agregarr-created collections
          autoPoster:
            (config as CollectionFormConfig).autoPoster ??
            (isPreExisting ? false : true),
          autoPosterTemplate:
            (config as CollectionFormConfig).autoPosterTemplate ?? null,
          useTmdbFranchisePoster:
            (config as CollectionFormConfig).useTmdbFranchisePoster ?? false,
          hideIndividualItems:
            (config as CollectionFormConfig).hideIndividualItems ?? false,
          showUnwatchedOnly:
            (config as CollectionFormConfig).showUnwatchedOnly ?? false,
          smartCollectionSort:
            (config as CollectionFormConfig).smartCollectionSort ??
            SMART_COLLECTION_SORT_OPTIONS[5], // Default to release date (newest first)
          timeRestriction: config.timeRestriction || {
            alwaysActive: true,
            removeFromPlexWhenInactive: false,
            inactiveVisibilityConfig: {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: true,
            },
          },
          // Multi-source configuration - initialize properly based on existing config
          isMultiSource:
            (config as CollectionFormConfig).isMultiSource ?? false,
          sources: (() => {
            const existingConfig = config as CollectionFormConfig;

            // If this is already a multi-source config, use existing sources
            if (
              existingConfig.isMultiSource &&
              existingConfig.sources &&
              existingConfig.sources.length > 0
            ) {
              return [...existingConfig.sources] as CollectionSourceConfig[];
            }

            // For single-source configs, create single source from existing config
            if (existingConfig.type) {
              return [
                {
                  id: '0',
                  type: existingConfig.type,
                  subtype: existingConfig.subtype,
                  timePeriod: existingConfig.timePeriod,
                  customUrl:
                    existingConfig.traktCustomListUrl ||
                    existingConfig.tmdbCustomCollectionUrl ||
                    existingConfig.imdbCustomListUrl ||
                    existingConfig.letterboxdCustomListUrl,
                  customDays: existingConfig.customDays,
                  minimumPlays: existingConfig.minimumPlays,
                  networksCountry: existingConfig.networksCountry,
                  priority: 0,
                  isExpanded: true,
                },
              ] as CollectionSourceConfig[];
            }
            return [] as CollectionSourceConfig[];
          })(),
          combineMode:
            (config as CollectionFormConfig).combineMode ??
            ('list_order' as MultiSourceCombineMode),
          customSyncSchedule: (config as CollectionFormConfig)
            .customSyncSchedule ?? {
            enabled: false,
            scheduleType: 'preset' as const,
            intervalHours: 24,
            preset: '1d',
            startNow: true,
            startDate: '01-01',
            startTime: '09:00',
          },
        }}
        validationSchema={CollectionFormConfigSchema}
        enableReinitialize={false}
        validateOnChange={true}
        validateOnBlur={true}
        onSubmit={async (values, { setFieldError }) => {
          // Final validation before submission
          // Only validate template for regular collections, not hubs or pre-existing
          if (isCollection && !values.template) {
            setFieldError('template', 'Collection title template is required');
            return;
          }
          if (isCollection && values.template === 'fetch-title') {
            setFieldError('template', 'Please validate the URL first');
            return;
          }

          // Validate required fields before saving - only for regular collections
          if (
            isCollection &&
            !values.libraryId &&
            (!values.libraryIds || values.libraryIds.length === 0)
          ) {
            setFieldError('libraryIds', 'Library selection is required');
            return;
          }

          // Create the config to save - let the calling component handle type conversion
          // Combine subtype and timePeriod for Trakt time-based collections
          let finalSubtype = values.subtype;
          if (
            values.type === 'trakt' &&
            values.timePeriod &&
            ['played', 'watched', 'collected', 'favorited'].includes(
              values.subtype || ''
            )
          ) {
            finalSubtype = `${values.subtype}_${values.timePeriod}`;
          }

          const isValueSet = (value: unknown): boolean =>
            value !== undefined && value !== null && value !== '';

          const optionalNumber = (value: unknown): number | undefined => {
            if (!isValueSet(value)) {
              return undefined;
            }
            const parsed = Number(value);
            return Number.isNaN(parsed) ? undefined : parsed;
          };

          const optionalString = (value: unknown): string | undefined => {
            if (!isValueSet(value)) {
              return undefined;
            }
            const str = String(value).trim();
            return str.length > 0 ? str : undefined;
          };

          const directRadarrServerId = values.enableGrabMissingItems
            ? optionalNumber(values.directDownloadRadarrServerId)
            : undefined;
          const directRadarrProfileId = values.enableGrabMissingItems
            ? optionalNumber(values.directDownloadRadarrProfileId)
            : undefined;
          const directRadarrRootFolder = values.enableGrabMissingItems
            ? optionalString(values.directDownloadRadarrRootFolder)
            : undefined;
          const directRadarrTags = values.enableGrabMissingItems
            ? values.directDownloadRadarrTags
            : undefined;
          const directRadarrMonitor = values.enableGrabMissingItems
            ? values.directDownloadRadarrMonitor
            : undefined;
          const directRadarrSearchOnAdd = values.enableGrabMissingItems
            ? values.directDownloadRadarrSearchOnAdd
            : undefined;

          const directSonarrServerId = values.enableGrabMissingItems
            ? optionalNumber(values.directDownloadSonarrServerId)
            : undefined;
          const directSonarrProfileId = values.enableGrabMissingItems
            ? optionalNumber(values.directDownloadSonarrProfileId)
            : undefined;
          const directSonarrRootFolder = values.enableGrabMissingItems
            ? optionalString(values.directDownloadSonarrRootFolder)
            : undefined;
          const directSonarrTags = values.enableGrabMissingItems
            ? values.directDownloadSonarrTags
            : undefined;
          const directSonarrMonitor = values.enableGrabMissingItems
            ? values.directDownloadSonarrMonitor
            : undefined;
          const directSonarrSearchOnAdd = values.enableGrabMissingItems
            ? values.directDownloadSonarrSearchOnAdd
            : undefined;

          const overseerrRadarrServerId = values.enableGrabMissingItems
            ? optionalNumber(values.overseerrRadarrServerId)
            : undefined;
          const overseerrRadarrProfileId = values.enableGrabMissingItems
            ? optionalNumber(values.overseerrRadarrProfileId)
            : undefined;
          const overseerrRadarrRootFolder = values.enableGrabMissingItems
            ? optionalString(values.overseerrRadarrRootFolder)
            : undefined;
          const overseerrRadarrTags = values.enableGrabMissingItems
            ? values.overseerrRadarrTags
            : undefined;

          const overseerrSonarrServerId = values.enableGrabMissingItems
            ? optionalNumber(values.overseerrSonarrServerId)
            : undefined;
          const overseerrSonarrProfileId = values.enableGrabMissingItems
            ? optionalNumber(values.overseerrSonarrProfileId)
            : undefined;
          const overseerrSonarrRootFolder = values.enableGrabMissingItems
            ? optionalString(values.overseerrSonarrRootFolder)
            : undefined;
          const overseerrSonarrTags = values.enableGrabMissingItems
            ? values.overseerrSonarrTags
            : undefined;
          const isPersonCollection =
            values.type === 'plex' &&
            (values.subtype === 'directors' || values.subtype === 'actors');
          const defaultSeparatorTitle =
            values.subtype === 'actors'
              ? 'Actor Collections'
              : 'Director Collections';
          const separatorTitle =
            isPersonCollection && values.useSeparator
              ? optionalString(values.separatorTitle) || defaultSeparatorTitle
              : undefined;

          // Validate required template variables for multi-collection patterns
          if (isPersonCollection) {
            const requiredVar =
              values.subtype === 'actors' ? '{actor}' : '{director}';

            // Check the actual template being used
            const actualTemplate =
              values.template === 'custom'
                ? ('customTVTemplate' in values
                    ? values.customTVTemplate
                    : undefined) ||
                  ('customMovieTemplate' in values
                    ? values.customMovieTemplate
                    : undefined)
                : values.template;

            if (!actualTemplate?.includes(requiredVar)) {
              const fieldToError =
                values.template === 'custom'
                  ? 'customMovieTemplate' // Use movie template field for error (both should have same validation)
                  : 'template';
              setFieldError(
                fieldToError,
                `Template must include ${requiredVar} for ${
                  values.subtype === 'actors' ? 'actor' : 'director'
                } collections`
              );
              return; // Prevent save
            }
          } else if (
            values.type === 'tmdb' &&
            values.subtype === 'auto_franchise'
          ) {
            // Check the actual template being used (customMovieTemplate if template is 'custom')
            const actualTemplate =
              values.template === 'custom'
                ? 'customMovieTemplate' in values
                  ? values.customMovieTemplate
                  : undefined
                : values.template;

            if (!actualTemplate?.includes('{franchiseName}')) {
              const fieldToError =
                values.template === 'custom'
                  ? 'customMovieTemplate'
                  : 'template';
              setFieldError(
                fieldToError,
                'Template must include {franchiseName} for auto franchise collections'
              );
              return; // Prevent save
            }
          }

          const configToSave: CollectionFormConfig = {
            ...values,
            // For multi-source collections, ensure type is set correctly
            type: values.isMultiSource ? 'multi-source' : values.type,
            subtype: finalSubtype,
            libraryId: values.libraryId as string,
            libraryName: values.libraryName as string,
            // Force deterministic names for multi-collection patterns (for UI consistency)
            name: isPersonCollection
              ? values.subtype === 'actors'
                ? 'Auto Actor Collections'
                : 'Auto Director Collections'
              : values.type === 'tmdb' && values.subtype === 'auto_franchise'
              ? 'Auto Franchise Collections'
              : generateCollectionName(values as CollectionFormConfig),
            // Template is user-customizable, but validated below
            template: values.template,
            useSeparator: isPersonCollection
              ? Boolean(values.useSeparator)
              : undefined,
            separatorTitle,
            customMovieTemplate:
              values.template === 'custom'
                ? (values as CollectionFormConfig).customMovieTemplate
                : undefined,
            customTVTemplate:
              values.template === 'custom'
                ? (values as CollectionFormConfig).customTVTemplate
                : undefined,
            // Convert string numbers to integers
            customDays: values.customDays
              ? parseInt(values.customDays.toString(), 10)
              : undefined,
            // Placeholder settings (unified for all collection types including Coming Soon)
            createPlaceholdersForMissing:
              values.type === 'comingsoon'
                ? true
                : values.createPlaceholdersForMissing ?? false,
            placeholderReleasedDays: values.createPlaceholdersForMissing
              ? values.placeholderReleasedDays
                ? parseInt(values.placeholderReleasedDays.toString(), 10)
                : 14
              : undefined,
            placeholderDaysAhead: values.createPlaceholdersForMissing
              ? values.placeholderDaysAhead
                ? parseInt(values.placeholderDaysAhead.toString(), 10)
                : 90
              : undefined,
            applyOverlaysDuringSync:
              values.type === 'comingsoon'
                ? true
                : values.applyOverlaysDuringSync,
            minimumPlays: values.minimumPlays
              ? parseInt(values.minimumPlays.toString(), 10)
              : 3,
            maxItems: values.maxItems
              ? parseInt(values.maxItems.toString(), 10)
              : 50,
            maxSeasonsToRequest: values.maxSeasonsToRequest
              ? parseInt(values.maxSeasonsToRequest.toString(), 10)
              : undefined,
            seasonsPerShowLimit: values.seasonsPerShowLimit
              ? parseInt(values.seasonsPerShowLimit.toString(), 10)
              : undefined,
            // Handle download settings based on enableGrabMissingItems
            downloadMode: values.enableGrabMissingItems
              ? values.downloadMode
              : undefined,
            // Use user's explicit choices for media type processing
            searchMissingMovies: values.enableGrabMissingItems
              ? values.searchMissingMovies
              : false,
            searchMissingTV: values.enableGrabMissingItems
              ? values.searchMissingTV
              : false,
            autoApproveMovies: values.enableGrabMissingItems
              ? values.autoApproveMovies
              : false,
            autoApproveTV: values.enableGrabMissingItems
              ? values.autoApproveTV
              : false,
            maxPositionToProcess: values.enableGrabMissingItems
              ? values.maxPositionToProcess
              : undefined,
            minimumYear: values.enableGrabMissingItems
              ? values.minimumYear
                ? parseInt(values.minimumYear.toString(), 10)
                : 0
              : undefined,
            minimumImdbRating: values.enableGrabMissingItems
              ? values.minimumImdbRating
                ? parseFloat(values.minimumImdbRating.toString())
                : 0
              : undefined,
            minimumRottenTomatoesRating: values.enableGrabMissingItems
              ? values.minimumRottenTomatoesRating
                ? parseFloat(values.minimumRottenTomatoesRating.toString())
                : 0
              : undefined,
            // Unified person minimum items mapped to person collections
            personMinimumItems: isPersonCollection
              ? optionalNumber(values.personMinimumItems) ??
                (config as CollectionFormConfig).personMinimumItems ??
                5
              : undefined,
            excludedGenres:
              values.enableGrabMissingItems && values.excludedGenres
                ? values.excludedGenres
                : undefined,
            excludedCountries:
              values.enableGrabMissingItems && values.excludedCountries
                ? values.excludedCountries
                : undefined,
            excludedLanguages:
              values.enableGrabMissingItems && values.excludedLanguages
                ? values.excludedLanguages
                : undefined,
            filterSettings:
              values.enableGrabMissingItems && values.filterSettings
                ? values.filterSettings
                : undefined,
            // Direct download server selection
            directDownloadRadarrServerId: directRadarrServerId,
            directDownloadRadarrProfileId: directRadarrProfileId,
            directDownloadRadarrRootFolder: directRadarrRootFolder,
            directDownloadRadarrTags: directRadarrTags,
            directDownloadRadarrMonitor: directRadarrMonitor,
            directDownloadRadarrSearchOnAdd: directRadarrSearchOnAdd,
            directDownloadSonarrServerId: directSonarrServerId,
            directDownloadSonarrProfileId: directSonarrProfileId,
            directDownloadSonarrRootFolder: directSonarrRootFolder,
            directDownloadSonarrTags: directSonarrTags,
            directDownloadSonarrMonitor: directSonarrMonitor,
            directDownloadSonarrSearchOnAdd: directSonarrSearchOnAdd,
            // Overseerr request configuration
            overseerrRadarrServerId: overseerrRadarrServerId,
            overseerrRadarrProfileId: overseerrRadarrProfileId,
            overseerrRadarrRootFolder: overseerrRadarrRootFolder,
            overseerrRadarrTags: overseerrRadarrTags,
            overseerrSonarrServerId: overseerrSonarrServerId,
            overseerrSonarrProfileId: overseerrSonarrProfileId,
            overseerrSonarrRootFolder: overseerrSonarrRootFolder,
            overseerrSonarrTags: overseerrSonarrTags,
            // Radarr/Sonarr tag configuration (explicitly preserve these fields)
            radarrInstanceId: values.radarrInstanceId,
            radarrTagId: values.radarrTagId,
            sonarrInstanceId: values.sonarrInstanceId,
            sonarrTagId: values.sonarrTagId,
            autoPoster: values.autoPoster,
            autoPosterTemplate: values.autoPosterTemplate,
            useTmdbFranchisePoster: values.useTmdbFranchisePoster,
            hideIndividualItems: values.hideIndividualItems,
            showUnwatchedOnly: values.showUnwatchedOnly,
            smartCollectionSort: values.smartCollectionSort,
            randomizeHomeOrder: values.randomizeHomeOrder,
            // Wallpaper, summary, and theme settings
            customWallpaper: values.customWallpaper,
            customSummary: values.customSummary,
            customTheme: values.customTheme,
            enableCustomWallpaper: values.enableCustomWallpaper,
            enableCustomSummary: values.enableCustomSummary,
            enableCustomTheme: values.enableCustomTheme,
            // Ensure customSyncSchedule is explicitly included
            customSyncSchedule: values.customSyncSchedule,
            // People collections should not carry exclusion rules
            excludeFromCollections: isPersonCollection
              ? undefined
              : values.excludeFromCollections,
            // Remove UI-only fields from the final config
            enableGrabMissingItems: undefined,
          };

          onSave(configToSave);
        }}
      >
        {({
          values,
          handleSubmit,
          handleChange,
          setFieldValue,
          isSubmitting,
          isValid,
          errors,
          touched,
        }) => {
          const typedValues = values;
          const { radarrTagId, sonarrTagId } = values as CollectionFormConfig;
          const hasSelectedRadarrTag = radarrTagId != null;
          const hasSelectedSonarrTag = sonarrTagId != null;

          return (
            <>
              <Modal
                onCancel={onCancel}
                backgroundClickable={false}
                okButtonType="primary"
                okText={
                  isSubmitting
                    ? intl.formatMessage(globalMessages.saving)
                    : config.name
                    ? intl.formatMessage(messages.updateCollection)
                    : intl.formatMessage(messages.createCollection)
                }
                okDisabled={!isValid || isSubmitting}
                onOk={() => handleSubmit()}
                // Add unlink button if linked, or link button if can be linked
                onSecondary={
                  isLinked && onUnlink
                    ? handleUnlinkClick
                    : canLink && onLink
                    ? handleLinkClick
                    : undefined
                }
                secondaryText={
                  isLinked
                    ? unlinkConfirmState
                      ? 'Confirm Unlink'
                      : 'Unlink'
                    : canLink
                    ? linkConfirmState
                      ? 'Confirm Link'
                      : 'Link'
                    : undefined
                }
                secondaryTooltip={linkingTooltip}
                secondaryButtonType={isLinked ? 'warning' : 'primary'}
                // Add preview button for collections (not hubs or pre-existing)
                // Disable for multi-collection patterns (overseerr users, tmdb franchise, plex auto-directors/actors)
                onTertiary={
                  isCollection &&
                  values.type &&
                  values.libraryIds &&
                  values.libraryIds.length > 0 &&
                  !(
                    values.type === 'overseerr' && values.subtype === 'users'
                  ) &&
                  !(
                    values.type === 'tmdb' &&
                    values.subtype === 'auto_franchise'
                  ) &&
                  !(
                    values.type === 'plex' &&
                    (values.subtype === 'directors' ||
                      values.subtype === 'actors')
                  )
                    ? () => setShowPreview(true)
                    : undefined
                }
                tertiaryText={
                  isCollection &&
                  values.type &&
                  values.libraryIds &&
                  values.libraryIds.length > 0 &&
                  !(
                    values.type === 'overseerr' && values.subtype === 'users'
                  ) &&
                  !(
                    values.type === 'tmdb' &&
                    values.subtype === 'auto_franchise'
                  ) &&
                  !(
                    values.type === 'plex' &&
                    (values.subtype === 'directors' ||
                      values.subtype === 'actors')
                  )
                    ? intl.formatMessage(messages.previewCollection)
                    : undefined
                }
                tertiaryButtonType="default"
                title={
                  config.name
                    ? intl.formatMessage(messages.editCollection)
                    : intl.formatMessage(messages.addCollection)
                }
                footerMessage={
                  isLinked
                    ? '🔗 Changes will apply to all linked libraries'
                    : undefined
                }
              >
                {/* Direct type-based form rendering */}
                {(() => {
                  return (
                    <div className="space-y-4">
                      {/* Info Header - show for hubs and pre-existing collections */}
                      {(isHub || isPreExisting) && (
                        <div className="rounded-md border border-gray-500/20 bg-transparent p-4">
                          <div className="flex">
                            <svg
                              className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-gray-400"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                clipRule="evenodd"
                              />
                            </svg>
                            <div>
                              <h4 className="mb-1 text-sm font-medium text-gray-300">
                                {isPreExisting
                                  ? 'Pre-existing Collection'
                                  : 'Default Plex Hub'}
                              </h4>
                              <p className="text-sm text-gray-400">
                                {isPreExisting
                                  ? 'This is an existing collection detected in Plex. Limited configuration options are available to preserve existing content.'
                                  : 'This is a built-in Plex hub. Limited configuration options are available - the content is managed by Plex.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Collection/Hub Title - show for hubs and pre-existing */}
                      {(isHub || isPreExisting) && (
                        <div className="mb-6">
                          <h2 className="text-lg font-medium text-white">
                            {values.name || 'Collection Settings'}
                          </h2>
                        </div>
                      )}

                      {/* Collection Type Section - appears above multi-source config */}
                      {isCollection && (
                        <CollectionTypeSection
                          values={typedValues as CollectionFormConfig}
                          setFieldValue={setFieldValue}
                          errors={errors as FormikErrors<CollectionFormConfig>}
                          touched={
                            touched as FormikTouched<CollectionFormConfig>
                          }
                          isVisible={true}
                          getTemplatePresets={getTemplatePresets}
                        />
                      )}

                      {/* Networks Config Section - country and platform selection */}
                      {isCollection && values.type === 'networks' && (
                        <NetworksConfigSection
                          values={typedValues as CollectionFormConfig}
                          setFieldValue={setFieldValue}
                          errors={errors as FormikErrors<CollectionFormConfig>}
                          touched={
                            touched as FormikTouched<CollectionFormConfig>
                          }
                          isVisible={true}
                          getTemplatePresets={getTemplatePresets}
                        />
                      )}

                      {/* Originals Config Section - streaming provider selection */}
                      {isCollection && values.type === 'originals' && (
                        <OriginalsConfigSection
                          values={typedValues as CollectionFormConfig}
                          setFieldValue={setFieldValue}
                          errors={errors as FormikErrors<CollectionFormConfig>}
                          touched={
                            touched as FormikTouched<CollectionFormConfig>
                          }
                          isVisible={true}
                          getTemplatePresets={getTemplatePresets}
                        />
                      )}

                      {/* Arr Tag Config Section - Radarr/Sonarr tag instance and tag selection */}
                      {isCollection &&
                        (values.type === 'radarrtag' ||
                          values.type === 'sonarrtag') && (
                          <ArrTagConfigSection
                            values={typedValues as CollectionFormConfig}
                            setFieldValue={setFieldValue}
                            errors={
                              errors as FormikErrors<CollectionFormConfig>
                            }
                            touched={
                              touched as FormikTouched<CollectionFormConfig>
                            }
                            isVisible={true}
                            getTemplatePresets={getTemplatePresets}
                          />
                        )}

                      {/* Time Period Section - conditional for Trakt time-based subtypes */}
                      {isCollection &&
                        values.type === 'trakt' &&
                        [
                          'played',
                          'watched',
                          'collected',
                          'favorited',
                        ].includes(values.subtype || '') && (
                          <TimePeriodSection
                            values={typedValues as CollectionFormConfig}
                            setFieldValue={setFieldValue}
                            errors={
                              errors as FormikErrors<CollectionFormConfig>
                            }
                            touched={
                              touched as FormikTouched<CollectionFormConfig>
                            }
                            baseSubtype={
                              values.subtype as
                                | 'played'
                                | 'watched'
                                | 'collected'
                                | 'favorited'
                            }
                            isVisible={true}
                            getTemplatePresets={getTemplatePresets}
                          />
                        )}

                      {/* Multi-Source Configuration - New approach for type='multi-source' */}
                      {isCollection &&
                        (values as CollectionFormConfig & { type?: string })
                          .type === 'multi-source' && (
                          <MultiSourceConfigSection
                            values={
                              {
                                ...values,
                                type: 'multi-source',
                                sources:
                                  values.sources?.map((source) => ({
                                    id: source.id,
                                    type: source.type as MultiSourceType,
                                    subtype: source.subtype || '',
                                    customUrl: source.customUrl,
                                    timePeriod: source.timePeriod as
                                      | 'daily'
                                      | 'weekly'
                                      | 'monthly'
                                      | 'all'
                                      | undefined,
                                    customDays: source.customDays,
                                    minimumPlays: source.minimumPlays,
                                    priority: source.priority,
                                    networksCountry: source.networksCountry,
                                    // Radarr/Sonarr tag fields
                                    radarrTagServerId: source.radarrTagServerId,
                                    radarrTagId: source.radarrTagId,
                                    sonarrTagServerId: source.sonarrTagServerId,
                                    sonarrTagId: source.sonarrTagId,
                                  })) || [],
                                combineMode: values.combineMode || 'list_order',
                              } as MultiSourceCollectionConfig
                            }
                            setFieldValue={setFieldValue}
                          />
                        )}

                      {/* Simple explanation for Overseerr Users Collections */}
                      {isCollection &&
                        values.type === 'overseerr' &&
                        values.subtype === 'users' && (
                          <div className="rounded-md border border-gray-500/20 bg-transparent p-4">
                            <div className="flex">
                              <svg
                                className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-gray-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <div>
                                <p className="text-sm text-gray-400">
                                  Creates a collection for each Overseerr user
                                  based off their Overseerr requests, and uses
                                  labels and restrictions to ensure only the
                                  requesting user can see their requests.
                                  Because server owners can&apos;t have
                                  restrictions, all collections will be visible
                                  to them.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                      {/* Simple explanation for TMDB Auto Franchise Collections */}
                      {isCollection &&
                        values.type === 'tmdb' &&
                        values.subtype === 'auto_franchise' && (
                          <div className="rounded-md border border-gray-500/20 bg-transparent p-4">
                            <div className="flex">
                              <svg
                                className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-gray-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <div>
                                <p className="text-sm text-gray-400">
                                  Automatically discovers and creates a
                                  collection for each movie franchise in your
                                  library (e.g., Die Hard 1, 2, 3 → &quot;Die
                                  Hard Collection&quot;). Only franchises with
                                  2+ movies in your library will be created.
                                </p>
                                <p className="mt-2 text-sm text-orange-400">
                                  <strong>Note:</strong> Your title template
                                  must include{' '}
                                  <code className="rounded bg-gray-700 px-1">
                                    {'{franchiseName}'}
                                  </code>{' '}
                                  (e.g., &quot;{'{franchiseName}'}&quot; or
                                  &quot;Movies from the {'{franchiseName}'}
                                  &quot;).
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      {/* Simple explanation for Plex Library Auto Person Collections */}
                      {isCollection &&
                        values.type === 'plex' &&
                        (values.subtype === 'directors' ||
                          values.subtype === 'actors') && (
                          <div className="rounded-md border border-gray-500/20 bg-transparent p-4">
                            <div className="flex">
                              <svg
                                className="mt-0.5 mr-3 h-5 w-5 flex-shrink-0 text-gray-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                  clipRule="evenodd"
                                />
                              </svg>
                              <div>
                                <p className="text-sm text-gray-400">
                                  Automatically finds top{' '}
                                  {values.subtype === 'actors'
                                    ? 'actors'
                                    : 'directors'}{' '}
                                  in this Plex library and creates a smart
                                  collection for each (up to your limits). These
                                  collections stay synced via Plex smart filters
                                  and exclude trailer placeholders. Managed here
                                  as a single &quot;Auto{' '}
                                  {values.subtype === 'actors'
                                    ? 'Actor'
                                    : 'Director'}{' '}
                                  Collections&quot; config.
                                </p>
                                <p className="mt-2 text-sm text-orange-400">
                                  <strong>Note:</strong> Your title template
                                  must include{' '}
                                  <code className="rounded bg-gray-700 px-1">
                                    {values.subtype === 'actors'
                                      ? '{actor}'
                                      : '{director}'}
                                  </code>{' '}
                                  (e.g., &quot;
                                  {values.subtype === 'actors'
                                    ? '{actor}'
                                    : '{director}'}
                                  &quot; or &quot;Movies by{' '}
                                  {values.subtype === 'actors'
                                    ? '{actor}'
                                    : '{director}'}
                                  &quot;).
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                      {/* Custom URL Section - show after type/subtype selection, before library selection */}
                      {isCollection && (
                        <CustomUrlSection
                          values={typedValues as CollectionFormConfig}
                          setFieldValue={setFieldValue}
                          errors={errors as FormikErrors<CollectionFormConfig>}
                          fetchTraktTitle={fetchTraktTitle}
                          fetchTmdbTitle={fetchTmdbTitle}
                          fetchImdbTitle={fetchImdbTitle}
                          fetchLetterboxdTitle={fetchLetterboxdTitle}
                          fetchMdblistTitle={fetchMdblistTitle}
                          fetchAnilistTitle={fetchAnilistTitle}
                        />
                      )}

                      {/* Library Selection - only show for regular collections */}
                      {isCollection && (
                        <LibrarySelectionSection
                          values={typedValues as CollectionFormConfig}
                          libraries={libraries}
                          setFieldValue={setFieldValue}
                          errors={errors as FormikErrors<CollectionFormConfig>}
                          isEnhancedForm={false}
                          isVisible={Boolean(
                            isCollection &&
                              values.type &&
                              (values.type === 'multi-source'
                                ? values.sources && values.sources.length >= 2
                                : values.type === 'radarrtag'
                                ? hasSelectedRadarrTag
                                : values.type === 'sonarrtag'
                                ? hasSelectedSonarrTag
                                : values.type === 'filtered_hub'
                                ? true // recently_added doesn't require a subtype
                                : values.subtype) && // Radarr/Sonarr tag collections require a tag instead of subtype
                              // For Trakt time-period subtypes, also require timePeriod to be selected
                              (values.type !== 'trakt' ||
                                ![
                                  'played',
                                  'watched',
                                  'collected',
                                  'favorited',
                                ].includes(values.subtype) ||
                                values.timePeriod) &&
                              // For custom types, show after title is fetched OR when editing existing config with a name
                              (values.subtype !== 'custom' ||
                                (values.type === 'trakt' &&
                                  values.subtype === 'custom' &&
                                  (fetchedTitles.trakt || config?.name)) ||
                                (values.type === 'tmdb' &&
                                  values.subtype === 'custom' &&
                                  (fetchedTitles.tmdb || config?.name)) ||
                                (values.type === 'imdb' &&
                                  values.subtype === 'custom' &&
                                  (fetchedTitles.imdb || config?.name)) ||
                                (values.type === 'letterboxd' &&
                                  values.subtype === 'custom' &&
                                  (fetchedTitles.letterboxd || config?.name)) ||
                                (values.type === 'mdblist' &&
                                  values.subtype === 'custom' &&
                                  (fetchedTitles.mdblist || config?.name)) ||
                                (values.type === 'anilist' &&
                                  values.subtype === 'custom' &&
                                  (fetchedTitles.anilist || config?.name)))
                          )}
                          detectedMediaType={(() => {
                            // Return detected media type for custom lists
                            if (values.subtype === 'custom') {
                              return detectedMediaTypes?.[
                                values.type as keyof typeof detectedMediaTypes
                              ];
                            }

                            // Return media type for known single-type collection types
                            if (
                              values.type === 'trakt' &&
                              values.subtype === 'boxoffice'
                            ) {
                              return 'movie';
                            }
                            if (values.type === 'letterboxd') {
                              return 'movie';
                            }
                            if (values.type === 'radarrtag') {
                              return 'movie';
                            }
                            if (values.type === 'sonarrtag') {
                              return 'tv';
                            }

                            return undefined;
                          })()}
                          isDetectingMediaType={(() => {
                            // Return detecting state for custom lists
                            if (values.subtype === 'custom') {
                              return detectingMediaTypes?.[
                                values.type as keyof typeof detectingMediaTypes
                              ];
                            }
                            return false;
                          })()}
                        />
                      )}

                      {/* Regular Form - show full form for normal collections */}
                      {isCollection &&
                        values.type &&
                        (values.type === 'multi-source'
                          ? values.sources && values.sources.length >= 2
                          : values.type === 'radarrtag'
                          ? hasSelectedRadarrTag
                          : values.type === 'sonarrtag'
                          ? hasSelectedSonarrTag
                          : values.type === 'filtered_hub'
                          ? true // recently_added doesn't require a subtype
                          : values.subtype) &&
                        (values.libraryIds?.length > 0 || values.libraryId) &&
                        (values.type !== 'tautulli' || values.customDays) &&
                        (values.type !== 'trakt' ||
                          values.subtype !== 'custom' ||
                          (values as CollectionFormConfig)
                            .traktCustomListUrl) &&
                        (values.type !== 'tmdb' ||
                          values.subtype !== 'custom' ||
                          (values as CollectionFormConfig)
                            .tmdbCustomCollectionUrl) &&
                        (values.type !== 'imdb' ||
                          values.subtype !== 'custom' ||
                          (values as CollectionFormConfig)
                            .imdbCustomListUrl) && (
                          <>
                            {/* Collection Title Template */}
                            <div className="form-row">
                              <label
                                htmlFor="collectionTemplate"
                                className="text-label"
                              >
                                Collection Title Template
                                <span className="label-required">*</span>
                              </label>
                              <div className="form-input-area">
                                <TemplateSection
                                  values={typedValues as CollectionFormConfig}
                                  setFieldValue={setFieldValue}
                                  handleChange={handleChange}
                                  errors={
                                    errors as FormikErrors<CollectionFormConfig>
                                  }
                                  touched={
                                    touched as FormikTouched<CollectionFormConfig>
                                  }
                                  fetchedTitles={fetchedTitles}
                                  detectedMediaTypes={detectedMediaTypes}
                                  getTemplatePresets={getTemplatePresets}
                                  isVisible={Boolean(
                                    isCollection &&
                                      values.type &&
                                      (values.type === 'multi-source' ||
                                        values.type === 'filtered_hub' ||
                                        (values.type === 'radarrtag'
                                          ? hasSelectedRadarrTag
                                          : values.type === 'sonarrtag'
                                          ? hasSelectedSonarrTag
                                          : values.subtype))
                                  )}
                                  currentUser={currentUser}
                                  libraries={libraries}
                                />
                              </div>
                            </div>

                            {/* Item Order - available for all collection types except multi-source and recently_added */}
                            {values.type !== 'multi-source' &&
                              values.type !== 'filtered_hub' && (
                                <div className="form-row">
                                  <label
                                    htmlFor="sortOrder"
                                    className="text-label"
                                  >
                                    Item Order
                                  </label>
                                  <div className="form-input-area">
                                    <div className="form-input-field">
                                      <Field
                                        as="select"
                                        id="sortOrder"
                                        name="sortOrder"
                                        value={
                                          (values as CollectionFormConfig)
                                            .sortOrder || 'default'
                                        }
                                        onChange={(
                                          e: React.ChangeEvent<HTMLSelectElement>
                                        ) => {
                                          setFieldValue(
                                            'sortOrder',
                                            e.target.value
                                          );
                                        }}
                                      >
                                        <option value="default">
                                          Default order (as provided by source)
                                        </option>
                                        <option value="reverse">
                                          Reverse order
                                        </option>
                                        <option value="random">
                                          Random order (shuffled each sync)
                                        </option>
                                        <option value="imdb_rating_desc">
                                          IMDb Rating (Highest to Lowest)
                                        </option>
                                        <option value="imdb_rating_asc">
                                          IMDb Rating (Lowest to Highest)
                                        </option>
                                      </Field>
                                    </div>
                                  </div>
                                </div>
                              )}

                            {/* Collection Visibility */}
                            <div className="form-row">
                              <div className="text-label">Visibility</div>
                              <div className="form-input-area">
                                <VisibilitySection
                                  values={typedValues as CollectionFormConfig}
                                  setFieldValue={setFieldValue}
                                  isEnhancedForm={false}
                                  isDefaultPlexHub={isHub}
                                  restrictToLibraryOnly={
                                    (values.type === 'overseerr' &&
                                      values.subtype === 'users') ||
                                    (values.type === 'tmdb' &&
                                      values.subtype === 'auto_franchise') ||
                                    (values.type === 'plex' &&
                                      (values.subtype === 'directors' ||
                                        values.subtype === 'actors'))
                                  }
                                  restrictToServerOwnerOnly={
                                    values.type === 'overseerr' &&
                                    values.subtype === 'server_owner'
                                  }
                                />
                              </div>
                            </div>

                            {/* Randomize Home Order */}
                            <div className="form-input-area">
                              <div className="flex items-center">
                                <Field
                                  type="checkbox"
                                  id="randomizeHomeOrder"
                                  name="randomizeHomeOrder"
                                  className="form-checkbox"
                                />
                                <label
                                  htmlFor="randomizeHomeOrder"
                                  className="ml-2 text-sm text-gray-300"
                                >
                                  Shuffle position on Home/Recommended screens
                                </label>
                              </div>
                              <div className="label-tip mt-2">
                                When enabled, this collection&apos;s position
                                will be randomly shuffled with other collections
                                that have this option enabled during each sync.
                                Custom scheduling for shuffling can be set on
                                the Jobs page.
                              </div>
                            </div>

                            {/* Max Items */}
                            <div className="form-row">
                              <label
                                htmlFor="collectionMaxItems"
                                className="text-label"
                              >
                                Max Items
                              </label>
                              <div className="form-input-area">
                                <div className="form-input-field">
                                  <Field
                                    type="text"
                                    inputMode="numeric"
                                    id="collectionMaxItems"
                                    name="maxItems"
                                    className="short"
                                  />
                                </div>
                                {errors.maxItems && touched.maxItems && (
                                  <div className="error">
                                    {String(errors.maxItems)}
                                  </div>
                                )}
                                <div className="label-tip">
                                  Limit the Collection to this many items
                                  {values.type === 'filtered_hub' &&
                                    ' (applies to smart collection)'}
                                </div>
                              </div>
                            </div>

                            {/* Smart Collection - Show Unwatched Only */}
                            {/* Hide for: recently_added (already smart), and tmdb auto_franchise (multi-collection) */}
                            {values.type !== 'filtered_hub' &&
                              !(
                                (values.type === 'tmdb' &&
                                  values.subtype === 'auto_franchise') ||
                                (values.type === 'plex' &&
                                  (values.subtype === 'directors' ||
                                    values.subtype === 'actors'))
                              ) && (
                                <div className="form-row">
                                  <label className="text-label">
                                    {intl.formatMessage(
                                      messages.showUnwatchedOnly
                                    )}
                                  </label>
                                  <div className="form-input-area">
                                    <div className="flex items-center">
                                      <Field
                                        type="checkbox"
                                        id="showUnwatchedOnly"
                                        name="showUnwatchedOnly"
                                        className="form-checkbox"
                                      />
                                      <label
                                        htmlFor="showUnwatchedOnly"
                                        className="ml-2 text-sm text-gray-300"
                                      >
                                        {intl.formatMessage(
                                          messages.showUnwatchedOnlyDescription
                                        )}
                                      </label>
                                    </div>
                                    <div className="mt-2 text-xs text-gray-400">
                                      When enabled, creates a smart collection
                                      with the unwatched filter to show only
                                      unwatched items for the user viewing the
                                      collection. The original collection will
                                      be pushed to the bottom in the Collections
                                      Tab.
                                    </div>
                                    {/* Smart Collection Sort Order - only show when showUnwatchedOnly is enabled */}
                                    {values.showUnwatchedOnly && (
                                      <div className="form-row">
                                        <label
                                          htmlFor="smartCollectionSort"
                                          className="text-label"
                                        >
                                          {intl.formatMessage(
                                            messages.smartCollectionSort
                                          )}
                                        </label>
                                        <div className="form-input-area">
                                          <div className="form-input-field">
                                            <Field
                                              as="select"
                                              id="smartCollectionSort"
                                              name="smartCollectionSort"
                                              value={
                                                values.smartCollectionSort
                                                  ?.value ||
                                                SMART_COLLECTION_SORT_OPTIONS[5]
                                                  .value // Default to release date (newest first)
                                              }
                                              onChange={(
                                                e: React.ChangeEvent<HTMLSelectElement>
                                              ) => {
                                                const selectedOption =
                                                  SMART_COLLECTION_SORT_OPTIONS.find(
                                                    (option) =>
                                                      option.value ===
                                                      e.target.value
                                                  );
                                                if (selectedOption) {
                                                  setFieldValue(
                                                    'smartCollectionSort',
                                                    selectedOption
                                                  );
                                                }
                                              }}
                                            >
                                              {SMART_COLLECTION_SORT_OPTIONS.map(
                                                (option) => (
                                                  <option
                                                    key={option.value}
                                                    value={option.value}
                                                  >
                                                    {option.label}
                                                  </option>
                                                )
                                              )}
                                            </Field>
                                          </div>
                                          <div className="mt-2 text-xs text-gray-400">
                                            Choose how items in the smart
                                            collection should be sorted. Due to
                                            Plex limiations, the original list
                                            order cannot be preserved when using
                                            smart collections.
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                            {/* Custom Poster Section */}
                            {isCollection &&
                              (values.libraryIds?.length > 0 ||
                                values.libraryId) && (
                                <div className="form-row">
                                  <label
                                    htmlFor="customPoster"
                                    className="text-label"
                                  >
                                    {intl.formatMessage(messages.customPoster)}
                                  </label>
                                  <div className="form-input-area">
                                    <PosterUploadSection
                                      values={
                                        typedValues as CollectionFormConfig
                                      }
                                      setFieldValue={setFieldValue}
                                      addToast={addToast}
                                      fieldId="customPoster"
                                      libraries={libraries}
                                      selectedLibraryIds={
                                        values.libraryIds || []
                                      }
                                      isAgregarrCollection={isCollection}
                                    />
                                  </div>
                                </div>
                              )}

                            {/* Wallpapers and Theme - only for collections and pre-existing, not hubs */}
                            {!isHub && (
                              <div className="form-row">
                                <label className="text-label">
                                  {intl.formatMessage(
                                    messages.wallpapersAndTheme
                                  )}
                                </label>
                                <div className="form-input-area">
                                  {/* Enable Wallpaper Checkbox */}
                                  <div className="mb-4">
                                    <div className="flex items-center">
                                      <Field
                                        type="checkbox"
                                        id="enableCustomWallpaper"
                                        name="enableCustomWallpaper"
                                        className="form-checkbox"
                                      />
                                      <label
                                        htmlFor="enableCustomWallpaper"
                                        className="ml-2 text-sm text-gray-300"
                                      >
                                        {intl.formatMessage(
                                          messages.enableCustomWallpaper
                                        )}
                                      </label>
                                    </div>
                                    {values.enableCustomWallpaper &&
                                      (values.libraryIds?.length > 0 ||
                                        values.libraryId) && (
                                        <div className="mt-3">
                                          <WallpaperUploadSection
                                            values={
                                              typedValues as CollectionFormConfig
                                            }
                                            setFieldValue={setFieldValue}
                                            addToast={addToast}
                                            fieldId="customWallpaper"
                                            libraries={libraries}
                                            selectedLibraryIds={
                                              values.libraryIds || []
                                            }
                                          />
                                        </div>
                                      )}
                                  </div>

                                  {/* Enable Summary Checkbox */}
                                  <div className="mb-4">
                                    <div className="flex items-center">
                                      <Field
                                        type="checkbox"
                                        id="enableCustomSummary"
                                        name="enableCustomSummary"
                                        className="form-checkbox"
                                      />
                                      <label
                                        htmlFor="enableCustomSummary"
                                        className="ml-2 text-sm text-gray-300"
                                      >
                                        {intl.formatMessage(
                                          messages.enableCustomSummary
                                        )}
                                      </label>
                                    </div>
                                    {values.enableCustomSummary && (
                                      <div className="mt-3">
                                        <Field
                                          as="textarea"
                                          id="customSummary"
                                          name="customSummary"
                                          rows={4}
                                          className="w-full resize-none rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white placeholder-stone-400 focus:border-orange-500 focus:outline-none"
                                          placeholder={intl.formatMessage(
                                            messages.customSummaryPlaceholder
                                          )}
                                        />
                                        <div className="label-tip mt-1">
                                          {intl.formatMessage(
                                            messages.customSummaryHelp
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Enable Theme Checkbox */}
                                  <div className="mb-4">
                                    <div className="flex items-center">
                                      <Field
                                        type="checkbox"
                                        id="enableCustomTheme"
                                        name="enableCustomTheme"
                                        className="form-checkbox"
                                      />
                                      <label
                                        htmlFor="enableCustomTheme"
                                        className="ml-2 text-sm text-gray-300"
                                      >
                                        {intl.formatMessage(
                                          messages.enableCustomTheme
                                        )}
                                      </label>
                                    </div>
                                    {values.enableCustomTheme &&
                                      (values.libraryIds?.length > 0 ||
                                        values.libraryId) && (
                                        <div className="mt-3">
                                          <ThemeUploadSection
                                            values={
                                              typedValues as CollectionFormConfig
                                            }
                                            setFieldValue={setFieldValue}
                                            addToast={addToast}
                                            fieldId="customTheme"
                                            libraries={libraries}
                                            selectedLibraryIds={
                                              values.libraryIds || []
                                            }
                                          />
                                        </div>
                                      )}
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="form-row">
                              <label
                                htmlFor="timeRestrictions"
                                className="text-label"
                              >
                                {intl.formatMessage(messages.timeRestrictions)}
                              </label>
                              <div className="form-input-area">
                                <TimeRestrictionsSection
                                  values={typedValues as CollectionFormConfig}
                                  setFieldValue={setFieldValue}
                                  isEnhancedForm={false}
                                  isDefaultPlexHub={isHub}
                                  isPreExisting={isPreExisting}
                                />
                              </div>
                            </div>

                            {/* Collection Mutual Exclusion - only for Agregarr-created collections */}
                            {isCollection && (
                              <CollectionExclusionSection
                                values={typedValues as CollectionFormConfig}
                                setFieldValue={setFieldValue}
                                allCollectionConfigs={
                                  allCollectionConfigs || []
                                }
                              />
                            )}

                            {/* Placeholder Creation - show for external sources that can have missing items */}
                            {/* Hide for: overseerr, tautulli, recently_added, tmdb auto_franchise, plex directors/actors */}
                            {typedValues.type &&
                              typedValues.type !== 'overseerr' &&
                              typedValues.type !== 'tautulli' &&
                              typedValues.type !== 'filtered_hub' &&
                              !(
                                typedValues.type === 'tmdb' &&
                                typedValues.subtype === 'auto_franchise'
                              ) &&
                              !(
                                typedValues.type === 'plex' &&
                                (typedValues.subtype === 'directors' ||
                                  typedValues.subtype === 'actors')
                              ) && (
                                <div className="form-row">
                                  <label
                                    htmlFor="createPlaceholdersForMissing"
                                    className="text-label"
                                  >
                                    Placeholder Creation
                                  </label>
                                  <div className="form-input-area">
                                    <div className="flex items-center">
                                      <Field
                                        type="checkbox"
                                        id="createPlaceholdersForMissing"
                                        name="createPlaceholdersForMissing"
                                        className={`form-checkbox ${
                                          typedValues.type === 'comingsoon'
                                            ? 'cursor-not-allowed opacity-50'
                                            : ''
                                        }`}
                                        checked={
                                          typedValues.type === 'comingsoon'
                                            ? true
                                            : typedValues.createPlaceholdersForMissing
                                        }
                                        disabled={
                                          typedValues.type === 'comingsoon'
                                        }
                                      />
                                      <span
                                        className={`ml-2 text-sm ${
                                          typedValues.type === 'comingsoon'
                                            ? 'text-gray-500'
                                            : 'text-gray-300'
                                        }`}
                                      >
                                        Create placeholders for missing items
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-400">
                                      Creates placeholder files in Plex for
                                      items not yet available, with countdown
                                      overlays showing release dates.
                                    </p>

                                    {/* Warning when placeholder creation enabled but no root folders configured */}
                                    {typedValues.createPlaceholdersForMissing &&
                                      !settingsData?.placeholderMovieRootFolder &&
                                      !settingsData?.placeholderTVRootFolder && (
                                        <div className="mt-3 rounded-md bg-yellow-900 bg-opacity-30 p-3 ring-1 ring-yellow-600">
                                          <div className="flex">
                                            <div className="flex-shrink-0">
                                              <svg
                                                className="h-4 w-4 text-yellow-400"
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 20 20"
                                                fill="currentColor"
                                                aria-hidden="true"
                                              >
                                                <path
                                                  fillRule="evenodd"
                                                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                                                  clipRule="evenodd"
                                                />
                                              </svg>
                                            </div>
                                            <div className="ml-2 flex-1">
                                              <p className="text-xs font-medium text-yellow-300">
                                                {intl.formatMessage(
                                                  messages.placeholderRootFoldersRequired
                                                )}
                                              </p>
                                              <p className="mt-1 text-xs text-yellow-200">
                                                {intl.formatMessage(
                                                  messages.placeholderRootFoldersMessage
                                                )}
                                              </p>
                                              <div className="mt-2">
                                                <a
                                                  href="/settings/downloads"
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="inline-flex items-center gap-1.5 rounded-md bg-yellow-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-stone-900"
                                                >
                                                  {intl.formatMessage(
                                                    messages.configureDownloads
                                                  )}
                                                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                                                </a>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                    {/* Info alert about Filtered Plex Hubs */}
                                    {typedValues.createPlaceholdersForMissing && (
                                      <div className="mt-3">
                                        <Alert type="info">
                                          <p className="font-medium">
                                            Use Filtered Plex Hubs to keep
                                            placeholders out of Recently Added
                                            etc
                                          </p>
                                          <p className="mt-1.5">
                                            Create{' '}
                                            <span className="font-semibold">
                                              Filtered Plex Hub
                                            </span>{' '}
                                            collection type to replace default
                                            Plex hubs (Recently Added, Recently
                                            Released, Recently Released
                                            Episodes) with filtered versions
                                            that automatically exclude
                                            placeholder items. You can also
                                            Enable Collection Exclusion on other
                                            collections to exclude placeholders
                                            from them.
                                          </p>
                                        </Alert>
                                      </div>
                                    )}

                                    {/* Placeholder options - show when enabled */}
                                    {typedValues.createPlaceholdersForMissing && (
                                      <div className="mt-4 flex gap-4 rounded-lg bg-stone-800 p-4">
                                        <div className="flex-1">
                                          <label
                                            htmlFor="placeholderDaysAhead"
                                            className="block text-sm font-medium text-gray-300"
                                          >
                                            Days Ahead
                                          </label>
                                          <Field
                                            type="number"
                                            id="placeholderDaysAhead"
                                            name="placeholderDaysAhead"
                                            min="1"
                                            max="730"
                                            placeholder="360"
                                            className="mt-1 w-24 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white"
                                          />
                                          <p className="mt-1 text-xs text-gray-400">
                                            Create placeholders for items
                                            releasing within this many days
                                          </p>
                                        </div>
                                        <div className="flex-1">
                                          <label
                                            htmlFor="placeholderReleasedDays"
                                            className="block text-sm font-medium text-gray-300"
                                          >
                                            Orphaned Item Window
                                          </label>
                                          <Field
                                            type="number"
                                            id="placeholderReleasedDays"
                                            name="placeholderReleasedDays"
                                            min="0"
                                            max="30"
                                            placeholder="7"
                                            className="mt-1 w-24 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white"
                                          />
                                          <p className="mt-1 text-xs text-gray-400">
                                            Days to keep placeholders after they
                                            fall off the source list (from
                                            release date if released, otherwise
                                            from creation date)
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                            {/* Warning when placeholders + overlays enabled but no overlay configs exist */}
                            {typedValues.createPlaceholdersForMissing &&
                              (typedValues.applyOverlaysDuringSync ||
                                typedValues.type === 'comingsoon') &&
                              (() => {
                                // Find libraries without overlay configurations
                                const selectedLibraryIds =
                                  typedValues.libraryIds || [];
                                const librariesWithoutOverlays =
                                  selectedLibraryIds.filter((libId) => {
                                    const config = overlayConfigs.find(
                                      (c) => c.libraryId === libId
                                    );
                                    return (
                                      !config ||
                                      config.enabledOverlays.filter(
                                        (o) => o.enabled
                                      ).length === 0
                                    );
                                  });

                                if (librariesWithoutOverlays.length === 0) {
                                  return null;
                                }

                                const libraryNames = librariesWithoutOverlays
                                  .map((libId) => {
                                    const lib = libraries?.find(
                                      (l) => l.key === libId
                                    );
                                    return lib?.name || 'Unknown';
                                  })
                                  .join(', ');

                                return (
                                  <div className="form-row">
                                    <div className="form-input-area">
                                      <div className="rounded-md bg-orange-900 bg-opacity-30 p-4 ring-1 ring-orange-500">
                                        <div className="flex">
                                          <div className="flex-shrink-0">
                                            <svg
                                              className="h-5 w-5 text-orange-400"
                                              xmlns="http://www.w3.org/2000/svg"
                                              viewBox="0 0 20 20"
                                              fill="currentColor"
                                              aria-hidden="true"
                                            >
                                              <path
                                                fillRule="evenodd"
                                                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                                                clipRule="evenodd"
                                              />
                                            </svg>
                                          </div>
                                          <div className="ml-3 flex-1">
                                            <h3 className="text-sm font-medium text-orange-300">
                                              {intl.formatMessage(
                                                messages.overlayConfigWarningTitle
                                              )}
                                            </h3>
                                            <div className="mt-2 text-sm text-orange-200">
                                              <p>
                                                {intl.formatMessage(
                                                  messages.overlayConfigWarningMessage,
                                                  {
                                                    libraryNames,
                                                  }
                                                )}
                                              </p>
                                            </div>
                                            <div className="mt-3">
                                              <a
                                                href="/posters"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-stone-900"
                                              >
                                                {intl.formatMessage(
                                                  messages.configureOverlays
                                                )}
                                                <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                                              </a>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                            {/* Auto-Request Settings - only show for external sources */}
                            {/* Hide for: overseerr, tautulli, recently_added, tmdb auto_franchise, plex directors/actors */}
                            {typedValues.type &&
                              typedValues.type !== 'overseerr' &&
                              typedValues.type !== 'tautulli' &&
                              typedValues.type !== 'filtered_hub' &&
                              !(
                                typedValues.type === 'tmdb' &&
                                typedValues.subtype === 'auto_franchise'
                              ) &&
                              !(
                                typedValues.type === 'plex' &&
                                (typedValues.subtype === 'directors' ||
                                  typedValues.subtype === 'actors')
                              ) && (
                                <div className="form-row">
                                  <label className="text-label">
                                    {intl.formatMessage(
                                      messages.autoRequestSettings
                                    )}
                                  </label>
                                  <div className="form-input-area">
                                    <AutoRequestSection
                                      values={
                                        typedValues as CollectionFormConfig
                                      }
                                      errors={errors as Record<string, string>}
                                      touched={
                                        touched as Record<string, boolean>
                                      }
                                      libraries={libraries}
                                      setFieldValue={setFieldValue}
                                    />
                                  </div>
                                </div>
                              )}
                          </>
                        )}

                      {/* Simple Form - show basic options for hubs and pre-existing collections */}
                      {(isHub || isPreExisting) && (
                        <>
                          {/* Visibility Section */}
                          <div className="form-row">
                            <div className="text-label">Visibility</div>
                            <div className="form-input-area">
                              <VisibilitySection
                                values={typedValues as CollectionFormConfig}
                                setFieldValue={setFieldValue}
                                isEnhancedForm={false}
                                isDefaultPlexHub={isHub}
                                restrictToLibraryOnly={false}
                                restrictToServerOwnerOnly={false}
                              />
                            </div>
                          </div>

                          {/* Randomize Home Order */}
                          <div className="form-row">
                            <label
                              htmlFor="randomizeHomeOrder"
                              className="text-label"
                            >
                              Randomize Home Order
                            </label>
                            <div className="form-input-area">
                              <div className="flex items-center">
                                <Field
                                  type="checkbox"
                                  id="randomizeHomeOrder"
                                  name="randomizeHomeOrder"
                                  className="form-checkbox"
                                />
                                <label
                                  htmlFor="randomizeHomeOrder"
                                  className="ml-2 text-sm text-gray-300"
                                >
                                  Shuffle position on Home/Recommended screens
                                </label>
                              </div>
                              <div className="label-tip mt-2">
                                When enabled, this{' '}
                                {isHub ? 'hub' : 'collection'}
                                &apos;s position will be randomly shuffled with
                                other collections that have this option enabled
                                during each sync. Custom scheduling for
                                shuffling can be set on the Jobs page.
                              </div>
                            </div>
                          </div>

                          {/* Time Restrictions */}
                          <div className="form-row">
                            <label
                              htmlFor="timeRestrictions"
                              className="text-label"
                            >
                              {intl.formatMessage(messages.timeRestrictions)}
                            </label>
                            <div className="form-input-area">
                              <TimeRestrictionsSection
                                values={typedValues as CollectionFormConfig}
                                setFieldValue={setFieldValue}
                                isEnhancedForm={false}
                                isDefaultPlexHub={isHub}
                                isPreExisting={isPreExisting}
                              />
                            </div>
                          </div>
                          {/* Custom Poster Section - Only for pre-existing collections, NOT for default Plex hubs */}
                          {isPreExisting && (
                            <div className="form-row">
                              <label
                                htmlFor="customPoster"
                                className="text-label"
                              >
                                {intl.formatMessage(messages.customPoster)}
                              </label>
                              <div className="form-input-area">
                                <PosterUploadSection
                                  values={typedValues as CollectionFormConfig}
                                  setFieldValue={setFieldValue}
                                  addToast={addToast}
                                  fieldId="customPoster"
                                  libraries={libraries}
                                  selectedLibraryIds={
                                    // For linked configs, get all library IDs from the linked group
                                    // For single configs, just use the current libraryId
                                    values.isLinked && allCollectionConfigs
                                      ? allCollectionConfigs
                                          .filter(
                                            (c) => c.linkId === values.linkId
                                          )
                                          .map((c) => c.libraryId)
                                      : values.libraryId
                                      ? [values.libraryId]
                                      : []
                                  }
                                  isAgregarrCollection={true}
                                />
                              </div>
                            </div>
                          )}

                          {/* Wallpapers and Theme - Only for pre-existing collections, NOT for default Plex hubs */}
                          {isPreExisting && (
                            <div className="form-row">
                              <label className="text-label">
                                {intl.formatMessage(
                                  messages.wallpapersAndTheme
                                )}
                              </label>
                              <div className="form-input-area">
                                {/* Enable Wallpaper Checkbox */}
                                <div>
                                  <div className="mb-4 flex items-center">
                                    <Field
                                      type="checkbox"
                                      id="enableCustomWallpaper"
                                      name="enableCustomWallpaper"
                                      className="form-checkbox"
                                    />
                                    <label
                                      htmlFor="enableCustomWallpaper"
                                      className="ml-2 text-sm text-gray-300"
                                    >
                                      {intl.formatMessage(
                                        messages.enableCustomWallpaper
                                      )}
                                    </label>
                                  </div>
                                  {values.enableCustomWallpaper &&
                                    values.libraryId && (
                                      <div className="mb-4">
                                        <WallpaperUploadSection
                                          values={
                                            typedValues as CollectionFormConfig
                                          }
                                          setFieldValue={setFieldValue}
                                          addToast={addToast}
                                          fieldId="customWallpaper"
                                          libraries={libraries}
                                          selectedLibraryIds={
                                            values.libraryId
                                              ? [values.libraryId]
                                              : []
                                          }
                                        />
                                      </div>
                                    )}
                                </div>

                                {/* Enable Theme Checkbox */}
                                <div>
                                  <div className="mb-4 flex items-center">
                                    <Field
                                      type="checkbox"
                                      id="enableCustomTheme"
                                      name="enableCustomTheme"
                                      className="form-checkbox"
                                    />
                                    <label
                                      htmlFor="enableCustomTheme"
                                      className="ml-2 text-sm text-gray-300"
                                    >
                                      {intl.formatMessage(
                                        messages.enableCustomTheme
                                      )}
                                    </label>
                                  </div>
                                  {values.enableCustomTheme &&
                                    values.libraryId && (
                                      <div className="mb-4">
                                        <ThemeUploadSection
                                          values={
                                            typedValues as CollectionFormConfig
                                          }
                                          setFieldValue={setFieldValue}
                                          addToast={addToast}
                                          fieldId="customTheme"
                                          libraries={libraries}
                                          selectedLibraryIds={
                                            values.libraryId
                                              ? [values.libraryId]
                                              : []
                                          }
                                        />
                                      </div>
                                    )}
                                </div>

                                {/* Enable Summary Checkbox */}
                                <div>
                                  <div className="mb-4 flex items-center">
                                    <Field
                                      type="checkbox"
                                      id="enableCustomSummary"
                                      name="enableCustomSummary"
                                      className="form-checkbox"
                                    />
                                    <label
                                      htmlFor="enableCustomSummary"
                                      className="ml-2 text-sm text-gray-300"
                                    >
                                      {intl.formatMessage(
                                        messages.enableCustomSummary
                                      )}
                                    </label>
                                  </div>
                                  {values.enableCustomSummary && (
                                    <div>
                                      <Field
                                        as="textarea"
                                        id="customSummary"
                                        name="customSummary"
                                        rows={4}
                                        className="w-full resize-none rounded-md border border-stone-600 bg-stone-800 px-3 py-2 text-sm text-white placeholder-stone-400 focus:border-orange-500 focus:outline-none"
                                        placeholder={intl.formatMessage(
                                          messages.customSummaryPlaceholder
                                        )}
                                      />
                                      <div className="label-tip mt-1">
                                        {intl.formatMessage(
                                          messages.customSummaryHelp
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {/* Submit error display - detailed error messages */}
                      {!isValid && Object.keys(errors).length > 0 && (
                        <div className="mt-3 space-y-1">
                          <div className="text-xs font-medium text-red-400">
                            Please fix the following errors:
                          </div>
                          {Object.entries(errors).map(([field, error]) => {
                            // Skip nested object errors - they should be handled by their specific components
                            if (typeof error === 'object') return null;

                            // Convert field names to user-friendly labels
                            const fieldLabels: Record<string, string> = {
                              type: 'Collection Type',
                              subtype: 'Collection Sub-Type',
                              template: 'Collection Title Template',
                              libraryIds: 'Library Selection',
                              libraryId: 'Library Selection',
                              maxItems: 'Max Items',
                              customDays: 'Number of Days',
                              customMovieTemplate: 'Custom Movie Template',
                              customTVTemplate: 'Custom TV Template',
                              traktCustomListUrl: 'Trakt List URL',
                              tmdbCustomCollectionUrl:
                                'TMDB Collection/List/Network/Company URL',
                              imdbCustomListUrl: 'IMDb List URL',
                              anilistCustomListUrl: 'AniList List URL',
                              letterboxdCustomListUrl: 'Letterboxd List URL',
                              maxSeasonsToRequest: 'Max Seasons to Request',
                              seasonsPerShowLimit: 'Seasons Per Show Limit',
                              timePeriod: 'Time Period',
                            };

                            const fieldLabel = fieldLabels[field] || field;

                            return (
                              <div key={field} className="text-xs text-red-300">
                                • {fieldLabel}: {String(error)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </Modal>
              {showPreview &&
                isCollection &&
                values.type &&
                values.libraryIds &&
                values.libraryIds.length > 0 &&
                (() => {
                  const valuesRecord = values as Record<string, unknown>;
                  // Map library IDs to library objects
                  const selectedLibraries = values.libraryIds
                    .map((libId) => libraries.find((lib) => lib.key === libId))
                    .filter(
                      (lib): lib is NonNullable<typeof lib> => lib !== undefined
                    )
                    .map((lib) => ({
                      id: lib.key,
                      name: lib.name,
                      type: lib.type,
                    }));

                  return (
                    <PreviewCollectionModal
                      onCancel={() => setShowPreview(false)}
                      previewConfig={{
                        type: values.type,
                        subtype: values.subtype,
                        collectionName:
                          (values.name &&
                          typeof values.name === 'string' &&
                          values.name.trim().length > 0
                            ? values.name
                            : generateCollectionName(
                                values as CollectionFormConfig
                              )) || undefined,
                        libraryIds: values.libraryIds,
                        libraries: selectedLibraries,
                        customUrl:
                          values.type === 'trakt'
                            ? (valuesRecord.traktCustomListUrl as
                                | string
                                | undefined)
                            : values.type === 'tmdb'
                            ? (valuesRecord.tmdbCustomCollectionUrl as
                                | string
                                | undefined)
                            : values.type === 'imdb'
                            ? (valuesRecord.imdbCustomListUrl as
                                | string
                                | undefined)
                            : values.type === 'letterboxd'
                            ? (valuesRecord.letterboxdCustomListUrl as
                                | string
                                | undefined)
                            : values.type === 'mdblist'
                            ? (valuesRecord.mdblistCustomListUrl as
                                | string
                                | undefined)
                            : values.type === 'anilist'
                            ? (valuesRecord.anilistCustomListUrl as
                                | string
                                | undefined)
                            : undefined,
                        maxItems: values.maxItems,
                        timePeriod: values.timePeriod,
                        minimumPlays: values.minimumPlays,
                        customDays: values.customDays,
                        network: valuesRecord.network as string | undefined,
                        country: valuesRecord.networksCountry as
                          | string
                          | undefined,
                        provider: valuesRecord.provider as string | undefined,
                        // Radarr/Sonarr tag specific fields
                        radarrTagId: values.radarrTagId,
                        sonarrTagId: values.sonarrTagId,
                        radarrInstanceId: values.radarrInstanceId,
                        sonarrInstanceId: values.sonarrInstanceId,
                        // Multi-source specific fields
                        isMultiSource: values.isMultiSource,
                        sources: values.sources as
                          | {
                              id: string;
                              type: string;
                              subtype?: string;
                              customUrl?: string;
                              timePeriod?: string;
                              priority: number;
                              customDays?: number;
                              minimumPlays?: number;
                              networksCountry?: string;
                            }[]
                          | undefined,
                        combineMode: values.combineMode,
                      }}
                    />
                  );
                })()}
            </>
          );
        }}
      </Formik>
    </Transition>
  );

  function generateCollectionName(values: CollectionFormConfig): string {
    if (
      values.type === 'overseerr' &&
      (values.subtype === 'users' || values.subtype === 'server_owner')
    ) {
      return values.name || 'User Collection';
    }

    if (
      values.type === 'plex' &&
      (values.subtype === 'directors' || values.subtype === 'actors')
    ) {
      return (
        values.name ||
        (values.subtype === 'actors'
          ? 'Auto Actor Collections'
          : 'Auto Director Collections')
      );
    }

    // Handle custom templates - show appropriate preview
    if (values.template === 'custom') {
      const hasMovie = values.customMovieTemplate?.trim();
      const hasTV = values.customTVTemplate?.trim();

      if (hasMovie && hasTV) {
        return '[Different names per library type]';
      } else if (hasMovie) {
        return values.customMovieTemplate || '';
      } else if (hasTV) {
        return values.customTVTemplate || '';
      }
      return 'Custom Template';
    }

    // Return the template as the name - backend will process it with proper library context
    return values.template || values.name || 'Collection';
  }
};

export default CollectionFormConfigForm;
