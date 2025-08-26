import Modal from '@app/components/Common/Modal';
import globalMessages from '@app/i18n/globalMessages';
import type {
  CollectionConfigFormProps,
  CollectionFormConfig,
  CollectionFormConfigForEditing,
  TemplatePreset,
} from '@app/types/collections';
import { Transition } from '@headlessui/react';
import { Field, Formik, type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
// import { useToasts } from 'react-toast-notifications'; // Disabled for future release
import useSWR from 'swr';
import * as Yup from 'yup';

// Form values use CollectionFormConfig with proper initialization
import AutoRequestSection from '@app/components/Collections/FormSections/AutoRequestSection';
import CollectionTypeSection from '@app/components/Collections/FormSections/CollectionTypeSection';
import CustomUrlSection from '@app/components/Collections/FormSections/CustomUrlSection';
import LibrarySelectionSection from '@app/components/Collections/FormSections/LibrarySelectionSection';
// import PosterUploadSection from '@app/components/Collections/FormSections/PosterUploadSection'; // Disabled for future release
import TemplateSection from '@app/components/Collections/FormSections/TemplateSection';
import TimePeriodSection from '@app/components/Collections/FormSections/TimePeriodSection';
import TimeRestrictionsSection from '@app/components/Collections/FormSections/TimeRestrictionsSection';
import VisibilitySection from '@app/components/Collections/FormSections/VisibilitySection';
import { CollectionFormConfigUtils } from '@app/types/collections';

const messages = defineMessages({
  editCollection: 'Edit Collection Configuration',
  addCollection: 'Add New Collection',
  collectionType: 'Collection Type',
  collectionSubtype: 'Collection Sub-Type',
  selectSource: 'Select Source...',
  selectSubtype: 'Select sub-type...',
  visibility: 'Visibility',
  maxItems: 'Max Items',
  // customPoster: 'Custom Poster', // Disabled for future release
  autoRequestSettings: 'Auto-Request Settings',
  timeRestrictions: 'Time Restrictions',
  createCollection: 'Create Collection',
  updateCollection: 'Update Collection',
  cancel: 'Cancel',
  preview: 'Preview:',
  alwaysActive: 'Always Active (no time restrictions)',
});

const CollectionFormConfigForm = ({
  config,
  onSave,
  onCancel,
  onUnlink,
  onLink,
  libraries,
}: CollectionConfigFormProps) => {
  const intl = useIntl();
  // const { addToast } = useToasts(); // Disabled for future release

  // Get current user data which includes Plex Pass status
  const { data: currentUser } = useSWR('/api/v1/auth/me');

  // State for storing fetched titles and detected media types
  // const [posterUploading, setPosterUploading] = useState(false); // Disabled for future release
  const [fetchedTitles, setFetchedTitles] = useState<{
    trakt?: string;
    tmdb?: string;
    imdb?: string;
    letterboxd?: string;
  }>({});

  const [detectedMediaTypes, setDetectedMediaTypes] = useState<{
    trakt?: 'movie' | 'tv' | 'both';
    tmdb?: 'movie' | 'tv' | 'both';
    imdb?: 'movie' | 'tv' | 'both';
    letterboxd?: 'movie' | 'tv' | 'both';
  }>({});

  const [, setFetchingTitle] = useState<{
    trakt?: boolean;
    tmdb?: boolean;
    imdb?: boolean;
    letterboxd?: boolean;
  }>({});

  // State for confirmation - MUST be before any early returns to avoid React Hooks violation
  const [unlinkConfirmState, setUnlinkConfirmState] = useState(false);
  const [linkConfirmState, setLinkConfirmState] = useState(false);

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
  const isLinked = Boolean(config.isLinked);

  // Determine if this config can be linked (for showing link button)
  // Only show link button for existing configs that are unlinked but could be linked
  const canLink =
    config.name &&
    !isLinked &&
    CollectionFormConfigUtils.canLinkCollection(
      config as CollectionFormConfigForEditing
    );

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

  // Title fetching functions
  const fetchTraktTitle = async (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => {
    try {
      setFetchingTitle((prev) => ({ ...prev, trakt: true }));
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'trakt' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, trakt: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({ ...prev, trakt: data.mediaType }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            // If media type is 'both', use template with {mediaType} placeholder for backend processing
            if (data.mediaType === 'both') {
              setFieldValue('template', `${data.title} - {mediaType}s`);
              // Don't set form mediaType - let backend set it per individual library
            } else {
              setFieldValue('template', data.title);
              // For specific media types, we could set it but backend will override anyway
            }
          }, 100); // Small delay to ensure state is updated
        }
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
            // If media type is 'both', use template with {mediaType} placeholder for backend processing
            if (data.mediaType === 'both') {
              setFieldValue('template', `${data.title} - {mediaType}s`);
              // Don't set form mediaType - let backend set it per individual library
            } else {
              setFieldValue('template', data.title);
              // For specific media types, we could set it but backend will override anyway
            }
          }, 100); // Small delay to ensure state is updated
        }
      }
    } catch (error) {
      // Failed to fetch TMDb title - silently continue
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
      const response = await fetch(`/api/v1/collections/fetch-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type: 'imdb' }),
      });
      const data = await response.json();
      if (data.title) {
        setFetchedTitles((prev) => ({ ...prev, imdb: data.title }));
        if (data.mediaType) {
          setDetectedMediaTypes((prev) => ({ ...prev, imdb: data.mediaType }));
        }

        // Auto-select first template option when title is fetched
        if (setFieldValue) {
          setTimeout(() => {
            // If media type is 'both', use template with {mediaType} placeholder for backend processing
            if (data.mediaType === 'both') {
              setFieldValue('template', `${data.title} - {mediaType}s`);
              // Don't set form mediaType - let backend set it per individual library
            } else {
              setFieldValue('template', data.title);
              // For specific media types, we could set it but backend will override anyway
            }
          }, 100); // Small delay to ensure state is updated
        }
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
            // If media type is 'both', use template with {mediaType} placeholder for backend processing
            if (data.mediaType === 'both') {
              setFieldValue('template', `${data.title} - {mediaType}s`);
              // Don't set form mediaType - let backend set it per individual library
            } else {
              setFieldValue('template', data.title);
              // For specific media types, we could set it but backend will override anyway
            }
          }, 100); // Small delay to ensure state is updated
        }
      }
    } catch (error) {
      // Failed to fetch Letterboxd title - silently continue
    } finally {
      setFetchingTitle((prev) => ({ ...prev, letterboxd: false }));
    }
  };

  // Flexible validation schema for collections, hubs, and pre-existing configs
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
    subtype: Yup.string().when(['hubIdentifier', 'collectionType'], {
      is: (hubIdentifier: string, collectionType: string) =>
        !hubIdentifier &&
        collectionType !== 'default_plex_hub' &&
        collectionType !== 'pre_existing', // Only required if not a hub or pre-existing
      then: (schema) => schema.required('Collection sub-type is required'),
      otherwise: (schema) => schema,
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
    // Template validation - only check when it exists
    template: Yup.string().test(
      'not-fetch-title',
      'Please validate the URL first',
      (value) => !value || value !== 'fetch-title'
    ),

    // Custom template validations - simplified
    customMovieTemplate: Yup.string().when('template', {
      is: 'custom',
      then: (schema) => schema.required('Movie template is required'),
      otherwise: (schema) => schema,
    }),

    customTVTemplate: Yup.string().when('template', {
      is: 'custom',
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

    traktCustomListUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) =>
        type === 'trakt' && subtype === 'custom',
      then: (schema) =>
        schema
          .required('Trakt list URL is required')
          .matches(
            /trakt\.tv\/users\/[^/]+\/lists\/[^/?]+/,
            'Please enter a valid Trakt list URL (e.g., https://trakt.tv/users/username/lists/list-name)'
          ),
      otherwise: (schema) => schema,
    }),

    tmdbCustomListUrl: Yup.string().when(['type', 'subtype'], {
      is: (type: string, subtype: string) =>
        type === 'tmdb' && subtype === 'custom',
      then: (schema) =>
        schema
          .required('TMDb collection URL is required')
          .matches(
            /themoviedb\.org\/collection\/\d+/,
            'Please enter a valid TMDb collection URL (e.g., https://www.themoviedb.org/collection/12345)'
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
      otherwise: (schema) => schema,
    }),

    maxItems: Yup.number()
      .min(1, 'Must be at least 1 item')
      .max(1000, 'Cannot exceed 1000 items'),

    maxSeasonsToRequest: Yup.number().when(
      ['searchMissingTV', 'autoApproveTV'],
      {
        is: (searchMissingTV: boolean, autoApproveTV: boolean) =>
          searchMissingTV && autoApproveTV,
        then: (schema) =>
          schema
            .min(1, 'Must be at least 1 season')
            .max(50, 'Cannot exceed 50 seasons'),
        otherwise: (schema) => schema,
      }
    ),

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
  });

  // Template presets will be handled within the Formik form
  // Auto-adjustments will be handled via onChange handlers

  const getTemplatePresets = (
    values?: CollectionFormConfig,
    fetchedTitles?: { trakt?: string; tmdb?: string; imdb?: string },
    detectedMediaTypes?: {
      trakt?: 'movie' | 'tv' | 'both';
      tmdb?: 'movie' | 'tv' | 'both';
      imdb?: 'movie' | 'tv' | 'both';
    }
  ): TemplatePreset[] => {
    if (!values?.subtype) return [{ label: 'Custom', value: 'custom' }];

    // For Trakt time-based collections, combine subtype and timePeriod when both exist
    let effectiveSubtype = values.subtype;
    if (
      values.type === 'trakt' &&
      values.timePeriod &&
      ['played', 'watched', 'collected', 'favorited'].includes(
        values.subtype || ''
      )
    ) {
      effectiveSubtype = `${values.subtype}_${values.timePeriod}`;
    }

    // Helper function to generate preset options for custom URLs
    const getCustomUrlPresets = (
      title: string,
      serviceType: 'trakt' | 'tmdb' | 'imdb'
    ): TemplatePreset[] => {
      if (!title) {
        return [
          {
            label: 'Validate URL',
            value: 'fetch-title',
          },
          { label: 'Custom', value: 'custom' },
        ];
      }

      const detectedType = detectedMediaTypes?.[serviceType];

      if (detectedType === 'both') {
        // For mixed content, offer template with {mediaType}s placeholder
        return [
          {
            label: `${title} - {mediaType}s`,
            value: `${title} - {mediaType}s`,
          },
          {
            label: title, // Original title without suffix
            value: title,
          },
          { label: 'Custom', value: 'custom' },
        ];
      } else {
        // For single media type, just use the original title
        return [
          {
            label: title,
            value: title,
          },
          { label: 'Custom', value: 'custom' },
        ];
      }
    };

    // Overseerr collection presets
    if (values.type === 'overseerr') {
      switch (values.subtype) {
        case 'users':
          return [
            {
              label: "{nickname}'s {domain} {mediaType} requests",
              value: "{nickname}'s {domain} {mediaType} requests",
            },
            {
              label: '{domain} requests by {nickname}',
              value: '{domain} requests by {nickname}',
            },
            {
              label: "{nickname}'s {mediaType} requests",
              value: "{nickname}'s {mediaType} requests",
            },
            {
              label: '{appTitle} requests by {nickname}',
              value: '{appTitle} requests by {nickname}',
            },
            {
              label: 'Requested by {username}',
              value: 'Requested by {username}',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'global':
          return [
            {
              label: '{domain} requests by Everyone - {mediaType}s',
              value: '{domain} requests by Everyone - {mediaType}s',
            },
            {
              label: '{domain} - All {mediaType} Requests',
              value: '{domain} - All {mediaType} Requests',
            },
            {
              label: '{appTitle} requests by Everyone',
              value: '{appTitle} requests by Everyone',
            },
            {
              label: '{appTitle} - All Requests',
              value: '{appTitle} - All Requests',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'server_owner':
          return [
            {
              label: 'My {mediaType} Requests',
              value: 'My {mediaType} Requests',
            },
            {
              label: "{nickname}'s {domain} {mediaType} requests",
              value: "{nickname}'s {domain} {mediaType} requests",
            },
            {
              label: '{domain} requests by {nickname} - {mediaType}s',
              value: '{domain} requests by {nickname} - {mediaType}s',
            },
            {
              label: "{nickname}'s {mediaType} requests",
              value: "{nickname}'s {mediaType} requests",
            },
            {
              label: '{appTitle} {mediaType} requests by {nickname}',
              value: '{appTitle} {mediaType} requests by {nickname}',
            },
            {
              label: 'Requested by {username} - {mediaType}s',
              value: 'Requested by {username} - {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        default:
          return [
            {
              label: 'Overseerr Collection',
              value: 'Overseerr Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // Tautulli collection presets
    if (values.type === 'tautulli') {
      switch (values.subtype) {
        case 'most_popular_plays': {
          const mostPopularPlaysPresets = [
            {
              label:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Top Played {mediaType}s on {servername}',
              value: 'Top Played {mediaType}s on {servername}',
            },
          ];

          // Add "A Year In Review" preset if customDays is 365
          if (
            values.customDays &&
            parseInt(values.customDays.toString(), 10) === 365
          ) {
            mostPopularPlaysPresets.unshift({
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            });
          }

          mostPopularPlaysPresets.push({ label: 'Custom', value: 'custom' });
          return mostPopularPlaysPresets;
        }
        case 'most_popular_duration': {
          const mostPopularDurationPresets = [
            {
              label:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Top Played {mediaType}s on {servername}',
              value: 'Top Played {mediaType}s on {servername}',
            },
          ];

          // Add "A Year In Review" preset if customDays is 365
          if (
            values.customDays &&
            parseInt(values.customDays.toString(), 10) === 365
          ) {
            mostPopularDurationPresets.unshift({
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            });
          }

          mostPopularDurationPresets.push({ label: 'Custom', value: 'custom' });
          return mostPopularDurationPresets;
        }
        case 'most_watched_plays': {
          const mostWatchedPlaysPresets = [
            {
              label:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Frequently Watched {mediaType}s on {servername}',
              value: 'Frequently Watched {mediaType}s on {servername}',
            },
          ];

          // Add "A Year In Review" preset if customDays is 365
          if (
            values.customDays &&
            parseInt(values.customDays.toString(), 10) === 365
          ) {
            mostWatchedPlaysPresets.unshift({
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            });
          }

          mostWatchedPlaysPresets.push({ label: 'Custom', value: 'custom' });
          return mostWatchedPlaysPresets;
        }
        case 'most_watched_duration': {
          const mostWatchedDurationPresets = [
            {
              label:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
              value:
                'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
            },
            {
              label: 'Frequently Watched {mediaType}s on {servername}',
              value: 'Frequently Watched {mediaType}s on {servername}',
            },
          ];

          // Add "A Year In Review" preset if customDays is 365
          if (
            values.customDays &&
            parseInt(values.customDays.toString(), 10) === 365
          ) {
            mostWatchedDurationPresets.unshift({
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            });
          }

          mostWatchedDurationPresets.push({ label: 'Custom', value: 'custom' });
          return mostWatchedDurationPresets;
        }
        default:
          return [
            {
              label: 'Overseerr Collection',
              value: 'Overseerr Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // Trakt collection presets
    if (values.type === 'trakt') {
      switch (effectiveSubtype) {
        case 'trending':
          return [
            {
              label: 'Trending {mediaType}s Today',
              value: 'Trending {mediaType}s Today',
            },
            {
              label: '🔥 Trending {mediaType}s Now',
              value: '🔥 Trending {mediaType}s Now',
            },
            {
              label: "What's Trending Now",
              value: "What's Trending Now",
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'popular':
          return [
            {
              label: 'Popular {mediaType}s from Trakt',
              value: 'Popular {mediaType}s from Trakt',
            },
            {
              label: '⭐ Popular {mediaType}s',
              value: '⭐ Popular {mediaType}s',
            },
            {
              label: 'Most Popular {mediaType}s',
              value: 'Most Popular {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'boxoffice':
          return [
            {
              label: 'Box Office Top 10',
              value: 'Box Office Top 10',
            },
            {
              label: '💰 Box Office Winners',
              value: '💰 Box Office Winners',
            },
            {
              label: 'Top Grossing Movies',
              value: 'Top Grossing Movies',
            },
            { label: 'Custom', value: 'custom' },
          ];
        // Handle all time period variants dynamically with period info
        case 'played_daily':
          return [
            {
              label: 'Most Played {mediaType}s Today',
              value: 'Most Played {mediaType}s Today',
            },
            {
              label: '▶️ Most Played {mediaType}s - Daily',
              value: '▶️ Most Played {mediaType}s - Daily',
            },
            {
              label: 'Top Played {mediaType}s Today',
              value: 'Top Played {mediaType}s Today',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'played_weekly':
          return [
            {
              label: 'Most Played {mediaType}s This Week',
              value: 'Most Played {mediaType}s This Week',
            },
            {
              label: '▶️ Most Played {mediaType}s - Weekly',
              value: '▶️ Most Played {mediaType}s - Weekly',
            },
            {
              label: 'Top Played {mediaType}s This Week',
              value: 'Top Played {mediaType}s This Week',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'played_monthly':
          return [
            {
              label: 'Most Played {mediaType}s This Month',
              value: 'Most Played {mediaType}s This Month',
            },
            {
              label: '▶️ Most Played {mediaType}s - Monthly',
              value: '▶️ Most Played {mediaType}s - Monthly',
            },
            {
              label: 'Top Played {mediaType}s This Month',
              value: 'Top Played {mediaType}s This Month',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'played_all':
          return [
            {
              label: 'Most Played {mediaType}s of All Time',
              value: 'Most Played {mediaType}s of All Time',
            },
            {
              label: '▶️ Most Played {mediaType}s - All Time',
              value: '▶️ Most Played {mediaType}s - All Time',
            },
            {
              label: 'Top Played {mediaType}s Ever',
              value: 'Top Played {mediaType}s Ever',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'watched_daily':
          return [
            {
              label: 'Most Watched {mediaType}s Today',
              value: 'Most Watched {mediaType}s Today',
            },
            {
              label: '📺 Most Watched {mediaType}s - Daily',
              value: '📺 Most Watched {mediaType}s - Daily',
            },
            {
              label: 'Top Watched {mediaType}s Today',
              value: 'Top Watched {mediaType}s Today',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'watched_weekly':
          return [
            {
              label: 'Most Watched {mediaType}s This Week',
              value: 'Most Watched {mediaType}s This Week',
            },
            {
              label: '📺 Most Watched {mediaType}s - Weekly',
              value: '📺 Most Watched {mediaType}s - Weekly',
            },
            {
              label: 'Top Watched {mediaType}s This Week',
              value: 'Top Watched {mediaType}s This Week',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'watched_monthly':
          return [
            {
              label: 'Most Watched {mediaType}s This Month',
              value: 'Most Watched {mediaType}s This Month',
            },
            {
              label: '📺 Most Watched {mediaType}s - Monthly',
              value: '📺 Most Watched {mediaType}s - Monthly',
            },
            {
              label: 'Top Watched {mediaType}s This Month',
              value: 'Top Watched {mediaType}s This Month',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'watched_all':
          return [
            {
              label: 'Most Watched {mediaType}s of All Time',
              value: 'Most Watched {mediaType}s of All Time',
            },
            {
              label: '📺 Most Watched {mediaType}s - All Time',
              value: '📺 Most Watched {mediaType}s - All Time',
            },
            {
              label: 'Top Watched {mediaType}s Ever',
              value: 'Top Watched {mediaType}s Ever',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'collected_daily':
          return [
            {
              label: 'Most Collected {mediaType}s Today',
              value: 'Most Collected {mediaType}s Today',
            },
            {
              label: '📚 Most Collected {mediaType}s - Daily',
              value: '📚 Most Collected {mediaType}s - Daily',
            },
            {
              label: 'Top Collected {mediaType}s Today',
              value: 'Top Collected {mediaType}s Today',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'collected_weekly':
          return [
            {
              label: 'Most Collected {mediaType}s This Week',
              value: 'Most Collected {mediaType}s This Week',
            },
            {
              label: '📚 Most Collected {mediaType}s - Weekly',
              value: '📚 Most Collected {mediaType}s - Weekly',
            },
            {
              label: 'Top Collected {mediaType}s This Week',
              value: 'Top Collected {mediaType}s This Week',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'collected_monthly':
          return [
            {
              label: 'Most Collected {mediaType}s This Month',
              value: 'Most Collected {mediaType}s This Month',
            },
            {
              label: '📚 Most Collected {mediaType}s - Monthly',
              value: '📚 Most Collected {mediaType}s - Monthly',
            },
            {
              label: 'Top Collected {mediaType}s This Month',
              value: 'Top Collected {mediaType}s This Month',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'collected_all':
          return [
            {
              label: 'Most Collected {mediaType}s of All Time',
              value: 'Most Collected {mediaType}s of All Time',
            },
            {
              label: '📚 Most Collected {mediaType}s - All Time',
              value: '📚 Most Collected {mediaType}s - All Time',
            },
            {
              label: 'Top Collected {mediaType}s Ever',
              value: 'Top Collected {mediaType}s Ever',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'favorited_daily':
          return [
            {
              label: 'Most Favorited {mediaType}s Today',
              value: 'Most Favorited {mediaType}s Today',
            },
            {
              label: '⭐ Most Favorited {mediaType}s - Daily',
              value: '⭐ Most Favorited {mediaType}s - Daily',
            },
            {
              label: 'Top Favorited {mediaType}s Today',
              value: 'Top Favorited {mediaType}s Today',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'favorited_weekly':
          return [
            {
              label: 'Most Favorited {mediaType}s This Week',
              value: 'Most Favorited {mediaType}s This Week',
            },
            {
              label: '⭐ Most Favorited {mediaType}s - Weekly',
              value: '⭐ Most Favorited {mediaType}s - Weekly',
            },
            {
              label: 'Top Favorited {mediaType}s This Week',
              value: 'Top Favorited {mediaType}s This Week',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'favorited_monthly':
          return [
            {
              label: 'Most Favorited {mediaType}s This Month',
              value: 'Most Favorited {mediaType}s This Month',
            },
            {
              label: '⭐ Most Favorited {mediaType}s - Monthly',
              value: '⭐ Most Favorited {mediaType}s - Monthly',
            },
            {
              label: 'Top Favorited {mediaType}s This Month',
              value: 'Top Favorited {mediaType}s This Month',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'favorited_all':
          return [
            {
              label: 'Most Favorited {mediaType}s of All Time',
              value: 'Most Favorited {mediaType}s of All Time',
            },
            {
              label: '⭐ Most Favorited {mediaType}s - All Time',
              value: '⭐ Most Favorited {mediaType}s - All Time',
            },
            {
              label: 'Top Favorited {mediaType}s Ever',
              value: 'Top Favorited {mediaType}s Ever',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'custom':
          return getCustomUrlPresets(fetchedTitles?.trakt || '', 'trakt');
        default:
          return [
            {
              label: 'Trakt Collection',
              value: 'Trakt Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // TMDb collection presets
    if (values.type === 'tmdb') {
      switch (values.subtype) {
        case 'trending_day':
          return [
            {
              label: 'Trending {mediaType}s Today',
              value: 'Trending {mediaType}s Today',
            },
            {
              label: 'Daily Trending {mediaType}s',
              value: 'Daily Trending {mediaType}s',
            },
            {
              label: 'Hot {mediaType}s Today',
              value: 'Hot {mediaType}s Today',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'trending_week':
          return [
            {
              label: 'Trending {mediaType}s This Week',
              value: 'Trending {mediaType}s This Week',
            },
            {
              label: 'Weekly Trending {mediaType}s',
              value: 'Weekly Trending {mediaType}s',
            },
            {
              label: 'Trending {mediaType}s Last 7 Days',
              value: 'Trending {mediaType}s Last 7 Days',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'popular':
          return [
            {
              label: 'Popular {mediaType}s',
              value: 'Popular {mediaType}s',
            },
            {
              label: 'Most Popular {mediaType}s',
              value: 'Most Popular {mediaType}s',
            },
            {
              label: 'Popular {mediaType}s Right Now',
              value: 'Popular {mediaType}s Right Now',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'top_rated':
          return [
            {
              label: 'Top Rated {mediaType}s',
              value: 'Top Rated {mediaType}s',
            },
            {
              label: 'Highest Rated {mediaType}s',
              value: 'Highest Rated {mediaType}s',
            },
            {
              label: 'Best {mediaType}s',
              value: 'Best {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'custom':
          return getCustomUrlPresets(fetchedTitles?.tmdb || '', 'tmdb');
        default:
          return [
            {
              label: 'TMDb Collection',
              value: 'TMDb Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // IMDb collection presets
    if (values.type === 'imdb') {
      switch (values.subtype) {
        case 'top_250':
          return [
            {
              label: 'IMDb Top 250 {mediaType}s',
              value: 'IMDb Top 250 {mediaType}s',
            },
            {
              label: 'Best {mediaType}s of All Time',
              value: 'Best {mediaType}s of All Time',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'popular':
          return [
            {
              label: 'Popular {mediaType}s',
              value: 'Popular {mediaType}s',
            },
            {
              label: 'IMDb Popular {mediaType}s',
              value: 'IMDb Popular {mediaType}s',
            },
            {
              label: 'Currently Popular {mediaType}s',
              value: 'Currently Popular {mediaType}s',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'most_popular':
          return [
            {
              label: 'Most Popular {mediaType}s',
              value: 'Most Popular {mediaType}s',
            },
            {
              label: 'IMDb Most Popular {mediaType}s',
              value: 'IMDb Most Popular {mediaType}s',
            },
            {
              label: 'Hottest {mediaType}s Right Now',
              value: 'Hottest {mediaType}s Right Now',
            },
            { label: 'Custom', value: 'custom' },
          ];
        case 'custom':
          return getCustomUrlPresets(fetchedTitles?.imdb || '', 'imdb');
        default:
          return [
            {
              label: 'IMDb Collection',
              value: 'IMDb Collection',
            },
            { label: 'Custom', value: 'custom' },
          ];
      }
    }

    // Fallback for unknown types
    return [
      {
        label: 'Collection',
        value: 'Collection',
      },
      {
        label: 'Overseerr Collection',
        value: 'Overseerr Collection',
      },
      { label: 'Custom', value: 'custom' },
    ];
  };

  // templatePresets will be calculated inside Formik render function

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
          type: (config as CollectionFormConfig).type || undefined,
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
          template: (config as CollectionFormConfig).template || '',
          libraryId: config.libraryId || undefined,
          libraryIds:
            (config as CollectionFormConfigForEditing).libraryIds ||
            (config.libraryId ? [config.libraryId] : []),
          libraryName: config.libraryName || undefined,
          libraryNames:
            (config as CollectionFormConfigForEditing).libraryNames ||
            (config.libraryName ? [config.libraryName] : []),
          maxItems: (config as CollectionFormConfig).maxItems || 50,
          customDays: (config as CollectionFormConfig).customDays || 30,
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
            (config as CollectionFormConfig).maxSeasonsToRequest || 3,
          maxPositionToProcess:
            (config as CollectionFormConfig).maxPositionToProcess || 0,
          visibilityConfig: {
            usersHome: config.visibilityConfig?.usersHome ?? false,
            serverOwnerHome: config.visibilityConfig?.serverOwnerHome ?? true,
            libraryRecommended:
              config.visibilityConfig?.libraryRecommended ?? false,
          },
          customPoster: (config as CollectionFormConfig).customPoster || '',
          timeRestriction: config.timeRestriction || {
            alwaysActive: true,
            removeFromPlexWhenInactive: false,
            inactiveVisibilityConfig: {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: true,
            },
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

          const configToSave: CollectionFormConfig = {
            ...values,
            subtype: finalSubtype,
            libraryId: values.libraryId as string,
            libraryName: values.libraryName as string,
            name: generateCollectionName(values as CollectionFormConfig),
            // Convert string numbers to integers
            customDays: values.customDays
              ? parseInt(values.customDays.toString(), 10)
              : undefined,
            maxItems: values.maxItems
              ? parseInt(values.maxItems.toString(), 10)
              : 50,
            maxSeasonsToRequest: values.maxSeasonsToRequest
              ? parseInt(values.maxSeasonsToRequest.toString(), 10)
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

          return (
            <Modal
              onCancel={onCancel}
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
              secondaryButtonType={isLinked ? 'warning' : 'primary'}
              title={
                config.name
                  ? intl.formatMessage(messages.editCollection)
                  : intl.formatMessage(messages.addCollection)
              }
            >
              {/* Direct type-based form rendering */}
              {(() => {
                const isLinked = config ? Boolean(config.isLinked) : false;

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
                        {isLinked && (
                          <p className="mt-1 text-xs text-orange-300">
                            🔗 Changes will apply to all linked libraries
                          </p>
                        )}
                      </div>
                    )}

                    {/* Basic Information Section */}
                    {/* Collection Type Section - only for regular collections */}
                    {isCollection && (
                      <CollectionTypeSection
                        values={typedValues as CollectionFormConfig}
                        setFieldValue={setFieldValue}
                        errors={errors as FormikErrors<CollectionFormConfig>}
                        touched={touched as FormikTouched<CollectionFormConfig>}
                        isVisible={isCollection}
                        getTemplatePresets={getTemplatePresets}
                      />
                    )}

                    {/* Time Period Section - conditional for Trakt time-based subtypes */}
                    {isCollection &&
                      values.type === 'trakt' &&
                      ['played', 'watched', 'collected', 'favorited'].includes(
                        values.subtype || ''
                      ) && (
                        <TimePeriodSection
                          values={typedValues as CollectionFormConfig}
                          setFieldValue={setFieldValue}
                          errors={errors as FormikErrors<CollectionFormConfig>}
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
                                requesting user can see their requests. Because
                                server owners can&apos;t have restrictions, all
                                collections will be visible to them.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                    {/* Custom URL Section - only show for regular collections */}
                    {isCollection && (
                      <CustomUrlSection
                        values={typedValues as CollectionFormConfig}
                        setFieldValue={setFieldValue}
                        errors={errors as FormikErrors<CollectionFormConfig>}
                        fetchTraktTitle={fetchTraktTitle}
                        fetchTmdbTitle={fetchTmdbTitle}
                        fetchImdbTitle={fetchImdbTitle}
                        fetchLetterboxdTitle={fetchLetterboxdTitle}
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
                            values.subtype &&
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
                                (fetchedTitles.letterboxd || config?.name)))
                        )}
                        filteredLibraries={(() => {
                          // Filter by detected media type for custom lists
                          if (values.subtype === 'custom') {
                            const detectedType =
                              detectedMediaTypes?.[
                                values.type as keyof typeof detectedMediaTypes
                              ];
                            if (detectedType === 'movie') {
                              return libraries.filter(
                                (lib) => lib.type === 'movie'
                              );
                            } else if (detectedType === 'tv') {
                              return libraries.filter(
                                (lib) => lib.type === 'show'
                              );
                            }
                          }

                          // Filter for known movie-only collection types
                          if (
                            values.type === 'trakt' &&
                            values.subtype === 'boxoffice'
                          ) {
                            return libraries.filter(
                              (lib) => lib.type === 'movie'
                            );
                          }
                          if (values.type === 'letterboxd') {
                            return libraries.filter(
                              (lib) => lib.type === 'movie'
                            );
                          }

                          return undefined;
                        })()}
                      />
                    )}

                    {/* Regular Form - show full form for normal collections */}
                    {isCollection &&
                      values.type &&
                      values.subtype &&
                      (values.libraryIds?.length > 0 || values.libraryId) &&
                      (values.type !== 'tautulli' || values.customDays) &&
                      (values.type !== 'trakt' ||
                        values.subtype !== 'custom' ||
                        (values as CollectionFormConfig).traktCustomListUrl) &&
                      (values.type !== 'tmdb' ||
                        values.subtype !== 'custom' ||
                        (values as CollectionFormConfig).tmdbCustomListUrl) &&
                      (values.type !== 'imdb' ||
                        values.subtype !== 'custom' ||
                        (values as CollectionFormConfig).imdbCustomListUrl) && (
                        <>
                          {/* Custom Days (for Tautulli collections) - moved here from above */}
                          {values.type === 'tautulli' && (
                            <div className="form-row">
                              <label
                                htmlFor="customDays"
                                className="text-label"
                              >
                                No. of Days
                                <span className="label-required">*</span>
                              </label>
                              <div className="form-input-area">
                                <div className="form-input-field">
                                  <Field
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    id="customDays"
                                    name="customDays"
                                    className="short"
                                  />
                                </div>
                                {errors.customDays && touched.customDays && (
                                  <div className="error">
                                    {String(errors.customDays)}
                                  </div>
                                )}
                                <div className="label-tip">
                                  Number of days to look back for statistics
                                  (1-365)
                                </div>
                              </div>
                            </div>
                          )}

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
                                  isCollection && values.type && values.subtype
                                )}
                                currentUser={currentUser}
                                libraries={libraries}
                              />
                            </div>
                          </div>

                          {/* Item Order - only for external sources that support ordering */}
                          {values.type === 'trakt' && (
                            <div className="form-row">
                              <label htmlFor="itemOrder" className="text-label">
                                Item Order
                              </label>
                              <div className="form-input-area">
                                <div className="form-input-field">
                                  <Field
                                    as="select"
                                    id="itemOrder"
                                    name="itemOrder"
                                    value={(() => {
                                      if (
                                        (values as CollectionFormConfig)
                                          .randomizeOrder
                                      )
                                        return 'random';
                                      if (
                                        (values as CollectionFormConfig)
                                          .reverseOrder
                                      )
                                        return 'reverse';
                                      return 'default';
                                    })()}
                                    onChange={(
                                      e: React.ChangeEvent<HTMLSelectElement>
                                    ) => {
                                      const selectedValue = e.target.value;
                                      if (selectedValue === 'random') {
                                        setFieldValue('randomizeOrder', true);
                                        setFieldValue('reverseOrder', false);
                                      } else if (selectedValue === 'reverse') {
                                        setFieldValue('randomizeOrder', false);
                                        setFieldValue('reverseOrder', true);
                                      } else {
                                        setFieldValue('randomizeOrder', false);
                                        setFieldValue('reverseOrder', false);
                                      }
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
                                  values.type === 'overseerr' &&
                                  values.subtype === 'users'
                                }
                                restrictToServerOwnerOnly={
                                  values.type === 'overseerr' &&
                                  values.subtype === 'server_owner'
                                }
                              />
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
                                Maximum number of items to include in collection
                                (1-1000)
                              </div>
                            </div>
                          </div>

                          {/* Custom Poster - Disabled for future release
                          <div className="form-row">
                            <label
                              htmlFor="customPoster"
                              className="text-label"
                            >
                              Custom Poster
                            </label>
                            <div className="form-input-area">
                              <PosterUploadSection
                                values={typedValues as CollectionFormConfig}
                                setFieldValue={setFieldValue}
                                posterUploading={posterUploading}
                                setPosterUploading={setPosterUploading}
                                addToast={addToast}
                                fieldId="customPoster"
                                apiEndpoint="/api/v1/collections/poster"
                                isEnhanced={false}
                              />
                            </div>
                          </div>
                          */}

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

                          {/* Auto-Request Settings - only show for external sources */}
                          {typedValues.type &&
                            typedValues.type !== 'overseerr' &&
                            typedValues.type !== 'tautulli' && (
                              <div className="form-row">
                                <label className="text-label">
                                  {intl.formatMessage(
                                    messages.autoRequestSettings
                                  )}
                                </label>
                                <div className="form-input-area">
                                  <AutoRequestSection
                                    values={typedValues as CollectionFormConfig}
                                    errors={errors as Record<string, string>}
                                    touched={touched as Record<string, boolean>}
                                    libraries={libraries}
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
                            tmdbCustomListUrl: 'TMDb Collection URL',
                            imdbCustomListUrl: 'IMDb List URL',
                            letterboxdCustomListUrl: 'Letterboxd List URL',
                            maxSeasonsToRequest: 'Max Seasons to Request',
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

    // Return the template as the name - backend will process it with proper library context
    return values.template || values.name || 'Collection';
  }
};

export default CollectionFormConfigForm;
