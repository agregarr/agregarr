import CollectionConfigForm from '@app/components/Collections/Forms/CollectionConfigForm';
import GlobalSyncStatus from '@app/components/Collections/GlobalSyncStatus';
import LibraryCollectionGroup from '@app/components/Collections/Views/Library/LibraryCollectionGroup';
import Button from '@app/components/Common/Button';
import { useCollectionReordering } from '@app/hooks/collections/useCollectionReordering';
import useFirstTimeSetup from '@app/hooks/useFirstTimeSetup';
import type {
  CollectionFormConfig,
  CollectionSettingsProps,
  Library,
} from '@app/types/collections';
import { CollectionType } from '@app/types/collections';
import { prepareLinkedConfigForEditing } from '@app/utils/collections/collectionUtils';
import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/solid';
import type {
  PlexHubConfig,
  PlexSettings,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import axios from 'axios';
// ID generation is now handled by the backend using sequential numbers
import React, { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

const messages = defineMessages({
  collectionConfigSaved: 'Collection configuration saved successfully!',
  collectionConfigError: 'Failed to save collection configuration.',
  collectionConfigDeleted: 'Collection configuration deleted successfully!',
});

const CollectionSettings = ({
  libraries: librariesProp,
  onUpdateConfigs,
  filterTab,
}: CollectionSettingsProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { mutate: revalidate } = useSWR('/api/v1/settings/plex');
  const { data } = useSWR<PlexSettings>('/api/v1/settings/plex');

  // Load libraries: use prop if provided, otherwise fetch directly from Plex
  const { data: plexLibraries = [], error: librariesError } = useSWR(
    librariesProp ? null : '/api/v1/settings/plex/libraries'
  );

  const libraries = librariesProp || plexLibraries;

  // Load all collection data from separate APIs - each returns its own native type
  const { data: collectionData, mutate: revalidateCollections } = useSWR(
    '/api/v1/collections'
  );
  const { data: hubConfigs, mutate: revalidateDefaultHubs } = useSWR(
    '/api/v1/defaulthubs'
  );
  const { data: preExistingCollectionConfigs, mutate: revalidatePreExisting } =
    useSWR('/api/v1/preexisting');

  const collectionConfigs = useMemo(
    () => collectionData?.collectionConfigs || [],
    [collectionData?.collectionConfigs]
  );

  // Combined revalidation function for all collection-related data
  const revalidateAll = () => {
    revalidateCollections();
    revalidateDefaultHubs();
    revalidatePreExisting();
  };

  // Form state for collections
  const [showConfigForm, setShowConfigForm] = useState(false);
  const [editingConfig, setEditingConfig] =
    useState<CollectionFormConfig | null>(null);

  // Form state for hubs
  const [showHubForm, setShowHubForm] = useState(false);
  const [editingHubConfig, setEditingHubConfig] =
    useState<PlexHubConfig | null>(null);

  // Form state for pre-existing collections
  const [showPreExistingForm, setShowPreExistingForm] = useState(false);
  const [editingPreExistingConfig, setEditingPreExistingConfig] =
    useState<PreExistingCollectionConfig | null>(null);

  // Tab state for Home, Recommended, Library, and Inactive tab ordering
  // Use filterTab if provided (for dedicated pages), otherwise default to 'home' for the main settings page
  const [activeTab, setActiveTab] = useState<
    'home' | 'recommended' | 'library'
  >(filterTab || 'home');
  const [activeLibraryId, setActiveLibraryId] = useState<string>(''); // For sub-tabs

  // Toggle state for hiding/showing inactive collections
  const [hideInactiveCollections, setHideInactiveCollections] = useState(false);

  // State to track when an inactive collection was just added (for pulsating button)
  const [showInactiveHelp, setShowInactiveHelp] = useState(false);

  // Badge click tracking (for easter eggs)
  const [badgeClickCount, setBadgeClickCount] = useState(0);

  // Hub discovery state
  const [discoveringHubs, setDiscoveringHubs] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStarting, setSyncStarting] = useState(false);
  const [refreshSyncStatus, setRefreshSyncStatus] = useState<
    (() => void) | null
  >(null);

  // Local state for immediate UI updates during drag operations - each uses its own native type
  const [localCollectionConfigs, setLocalCollectionConfigs] = useState<
    CollectionFormConfig[]
  >(collectionConfigs || []);
  const [localHubConfigs, setLocalHubConfigs] = useState<PlexHubConfig[]>(
    hubConfigs || []
  );
  const [localPreExistingConfigs, setLocalPreExistingConfigs] = useState<
    PreExistingCollectionConfig[]
  >(preExistingCollectionConfigs || []);

  // Update local state when props change (from SWR)
  React.useEffect(() => {
    setLocalCollectionConfigs(collectionConfigs || []);
  }, [collectionConfigs]);

  React.useEffect(() => {
    setLocalHubConfigs(hubConfigs || []);
  }, [hubConfigs]);

  React.useEffect(() => {
    setLocalPreExistingConfigs(preExistingCollectionConfigs || []);
  }, [preExistingCollectionConfigs]);

  // Get the unified reordering function and legacy handlers
  const { handleReorderItems } = useCollectionReordering({
    context: activeTab, // Use activeTab to determine context
    collectionConfigs: localCollectionConfigs,
    hubConfigs: localHubConfigs,
    preExistingConfigs: localPreExistingConfigs,
  });

  // Update activeTab when filterTab prop changes
  React.useEffect(() => {
    if (filterTab) {
      setActiveTab(filterTab);
      // Set appropriate library for recommended/library tabs
      if (
        (filterTab === 'recommended' || filterTab === 'library') &&
        libraries.length > 0
      ) {
        setActiveLibraryId(libraries[0]?.key || '');
      }
    }
  }, [filterTab, libraries]);

  // Use global first-time setup detection
  const { isFirstTimeSetup } = useFirstTimeSetup();
  const isFirstTimeUser = isFirstTimeSetup;

  // Helper function to save individual configs using individual endpoints
  const saveIndividualConfigs = async (
    configsToUpdate: (
      | CollectionFormConfig
      | PlexHubConfig
      | PreExistingCollectionConfig
    )[]
  ) => {
    // Process each config individually using appropriate endpoints
    // Strip computed fields to avoid OpenAPI validation errors
    for (const config of configsToUpdate) {
      if ('collectionRatingKey' in config) {
        // PreExistingCollectionConfig - exclude computed fields isActive, collectionType
        const preExistingConfig = config as PreExistingCollectionConfig;
        const payload: Omit<
          PreExistingCollectionConfig,
          'isActive' | 'collectionType' | 'missing'
        > = {
          id: preExistingConfig.id,
          collectionRatingKey: preExistingConfig.collectionRatingKey,
          name: preExistingConfig.name,
          libraryId: preExistingConfig.libraryId,
          libraryName: preExistingConfig.libraryName,
          mediaType: preExistingConfig.mediaType,
          sortOrderHome: preExistingConfig.sortOrderHome,
          sortOrderLibrary: preExistingConfig.sortOrderLibrary,
          isLibraryPromoted: preExistingConfig.isLibraryPromoted,
          visibilityConfig: preExistingConfig.visibilityConfig,
          ...(preExistingConfig.isLinked !== undefined && {
            isLinked: preExistingConfig.isLinked,
          }),
          ...(preExistingConfig.linkId !== undefined && {
            linkId: preExistingConfig.linkId,
          }),
          ...(preExistingConfig.isUnlinked !== undefined && {
            isUnlinked: preExistingConfig.isUnlinked,
          }),
          ...(preExistingConfig.timeRestriction && {
            timeRestriction: preExistingConfig.timeRestriction,
          }),
          ...(preExistingConfig.customPoster && {
            customPoster: preExistingConfig.customPoster,
          }),
        };
        await axios.put(`/api/v1/preexisting/${config.id}/settings`, payload);
      } else if ('hubIdentifier' in config) {
        // PlexHubConfig - exclude computed fields isActive, collectionType
        const hubConfig = config as PlexHubConfig;
        const payload: Omit<
          PlexHubConfig,
          'isActive' | 'collectionType' | 'missing'
        > = {
          id: hubConfig.id,
          hubIdentifier: hubConfig.hubIdentifier,
          name: hubConfig.name,
          libraryId: hubConfig.libraryId,
          libraryName: hubConfig.libraryName,
          mediaType: hubConfig.mediaType,
          sortOrderHome: hubConfig.sortOrderHome,
          sortOrderLibrary: hubConfig.sortOrderLibrary,
          isLibraryPromoted: hubConfig.isLibraryPromoted,
          visibilityConfig: hubConfig.visibilityConfig,
          ...(hubConfig.isLinked !== undefined && {
            isLinked: hubConfig.isLinked,
          }),
          ...(hubConfig.linkId !== undefined && { linkId: hubConfig.linkId }),
          ...(hubConfig.isUnlinked !== undefined && {
            isUnlinked: hubConfig.isUnlinked,
          }),
          ...(hubConfig.timeRestriction && {
            timeRestriction: hubConfig.timeRestriction,
          }),
        };
        await axios.put(`/api/v1/defaulthubs/${config.id}/settings`, payload);
      } else {
        // CollectionFormConfig - exclude computed field isActive
        const collectionConfig = config as CollectionFormConfig;
        const payload: Omit<CollectionFormConfig, 'isActive' | 'missing'> = {
          id: collectionConfig.id,
          name: collectionConfig.name,
          ...(collectionConfig.type && { type: collectionConfig.type }),
          ...(collectionConfig.subtype && {
            subtype: collectionConfig.subtype,
          }),
          ...(collectionConfig.configType && {
            configType: collectionConfig.configType,
          }),
          ...(collectionConfig.template && {
            template: collectionConfig.template,
          }),
          ...(collectionConfig.customMovieTemplate && {
            customMovieTemplate: collectionConfig.customMovieTemplate,
          }),
          ...(collectionConfig.customTVTemplate && {
            customTVTemplate: collectionConfig.customTVTemplate,
          }),
          visibilityConfig: collectionConfig.visibilityConfig,
          ...(collectionConfig.maxItems !== undefined && {
            maxItems: collectionConfig.maxItems,
          }),
          ...(collectionConfig.mediaType && {
            mediaType: collectionConfig.mediaType,
          }),
          libraryId: collectionConfig.libraryId,
          libraryName: collectionConfig.libraryName,
          ...(collectionConfig.libraryIds && {
            libraryIds: collectionConfig.libraryIds,
          }),
          ...(collectionConfig.libraryNames && {
            libraryNames: collectionConfig.libraryNames,
          }),
          ...(collectionConfig.sortOrderHome !== undefined && {
            sortOrderHome: collectionConfig.sortOrderHome,
          }),
          ...(collectionConfig.sortOrderLibrary !== undefined && {
            sortOrderLibrary: collectionConfig.sortOrderLibrary,
          }),
          ...(collectionConfig.collectionRatingKey && {
            collectionRatingKey: collectionConfig.collectionRatingKey,
          }),
          ...(collectionConfig.isLinked !== undefined && {
            isLinked: collectionConfig.isLinked,
          }),
          ...(collectionConfig.linkId !== undefined && {
            linkId: collectionConfig.linkId,
          }),
          ...(collectionConfig.customDays !== undefined && {
            customDays: collectionConfig.customDays,
          }),
          ...(collectionConfig.tautulliStatType && {
            tautulliStatType: collectionConfig.tautulliStatType,
          }),
          ...(collectionConfig.downloadMode && {
            downloadMode: collectionConfig.downloadMode,
          }),
          ...(collectionConfig.searchMissingMovies !== undefined && {
            searchMissingMovies: collectionConfig.searchMissingMovies,
          }),
          ...(collectionConfig.searchMissingTV !== undefined && {
            searchMissingTV: collectionConfig.searchMissingTV,
          }),
          ...(collectionConfig.autoApproveMovies !== undefined && {
            autoApproveMovies: collectionConfig.autoApproveMovies,
          }),
          ...(collectionConfig.autoApproveTV !== undefined && {
            autoApproveTV: collectionConfig.autoApproveTV,
          }),
          ...(collectionConfig.maxSeasonsToRequest !== undefined && {
            maxSeasonsToRequest: collectionConfig.maxSeasonsToRequest,
          }),
          ...(collectionConfig.seasonsPerShowLimit !== undefined && {
            seasonsPerShowLimit: collectionConfig.seasonsPerShowLimit,
          }),
          ...(collectionConfig.maxPositionToProcess !== undefined && {
            maxPositionToProcess: collectionConfig.maxPositionToProcess,
          }),
          ...(collectionConfig.traktCustomListUrl && {
            traktCustomListUrl: collectionConfig.traktCustomListUrl,
          }),
          ...(collectionConfig.tmdbCustomListUrl && {
            tmdbCustomListUrl: collectionConfig.tmdbCustomListUrl,
          }),
          ...(collectionConfig.imdbCustomListUrl && {
            imdbCustomListUrl: collectionConfig.imdbCustomListUrl,
          }),
          ...(collectionConfig.letterboxdCustomListUrl && {
            letterboxdCustomListUrl: collectionConfig.letterboxdCustomListUrl,
          }),
          ...(collectionConfig.reverseOrder !== undefined && {
            reverseOrder: collectionConfig.reverseOrder,
          }),
          ...(collectionConfig.randomizeOrder !== undefined && {
            randomizeOrder: collectionConfig.randomizeOrder,
          }),
          ...(collectionConfig.collectionType && {
            collectionType: collectionConfig.collectionType,
          }),
          ...(collectionConfig.isUnlinked !== undefined && {
            isUnlinked: collectionConfig.isUnlinked,
          }),
          ...(collectionConfig.hubIdentifier && {
            hubIdentifier: collectionConfig.hubIdentifier,
          }),
          ...(collectionConfig.customPoster && {
            customPoster: collectionConfig.customPoster,
          }),
          autoPoster: collectionConfig.autoPoster ?? true,
          ...(collectionConfig.timeRestriction && {
            timeRestriction: collectionConfig.timeRestriction,
          }),
        };
        await axios.put(`/api/v1/collections/${config.id}/settings`, payload);
      }
    }
  };

  // Create a set of unified identifiers from existing collection configs to avoid duplicates
  // Uses the unified format: {libraryId}:{ratingKey}
  const existingUnifiedIds = new Set<string>();
  localCollectionConfigs.forEach((config: CollectionFormConfig) => {
    if (config.collectionRatingKey && config.libraryId) {
      const unifiedId = `${config.libraryId}:${config.collectionRatingKey}`;
      existingUnifiedIds.add(unifiedId);
    }
  });

  // Work with separate arrays directly - no filtering needed since APIs are separated
  // All items in localHubConfigs are already default Plex hubs from /api/v1/defaulthubs
  const filteredBuiltInHubs = localHubConfigs;

  const deduplicatedPreExistingConfigs = localPreExistingConfigs.filter(
    (preExistingConfig: PreExistingCollectionConfig) => {
      // Check if we already have this as a regular collection config using rating key
      if (
        preExistingConfig.collectionRatingKey &&
        preExistingConfig.libraryId
      ) {
        const unifiedId = `${preExistingConfig.libraryId}:${preExistingConfig.collectionRatingKey}`;
        return !existingUnifiedIds.has(unifiedId);
      }

      return true;
    }
  );

  const checkForUnlockSequence = () => {
    // Check if there's an Overseerr user collection with 69 items and user has clicked 10 times
    const overseerrUserCollectionWith69Items = collectionConfigs.find(
      (config: CollectionFormConfig) =>
        config.type === 'overseerr' &&
        config.subtype === 'users' &&
        config.maxItems === 69
    );

    if (
      overseerrUserCollectionWith69Items &&
      badgeClickCount >= 10 &&
      !data?.usersHomeUnlocked
    ) {
      // Unlock Users Home collections - preserve all existing settings
      if (data) {
        const writableSettings = Object.fromEntries(
          Object.entries(data).filter(
            ([key]) => !['name', 'machineId', 'libraries'].includes(key)
          )
        );
        fetch('/api/v1/settings/plex', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...writableSettings,
            usersHomeUnlocked: true, // Only change this field
          }),
        })
          .then(() => {
            revalidate();
            addToast('Users Home collections unlocked! 🏠✨', {
              autoDismiss: true,
              appearance: 'success',
            });
            setBadgeClickCount(0);
          })
          .catch(() => {
            addToast('Failed to unlock Users Home collections', {
              autoDismiss: true,
              appearance: 'error',
            });
          });
      }
    }
  };

  // Collection configuration handlers
  const saveCollectionConfigs = async (
    configs: CollectionFormConfig[],
    suppressNotification = false
  ) => {
    try {
      // Use individual PUT calls for each config
      for (const config of configs) {
        // Create submission payload excluding computed fields like isActive (same pattern as saveIndividualConfigs)
        const submissionConfig: Omit<
          CollectionFormConfig,
          'isActive' | 'missing'
        > = {
          id: config.id,
          name: config.name,
          type: config.type,
          subtype: config.subtype,
          template: config.template,
          customMovieTemplate: config.customMovieTemplate,
          customTVTemplate: config.customTVTemplate,
          visibilityConfig: config.visibilityConfig,
          maxItems: config.maxItems,
          mediaType: config.mediaType,
          libraryId: config.libraryId,
          libraryName: config.libraryName,
          sortOrderHome: config.sortOrderHome,
          sortOrderLibrary: config.sortOrderLibrary,
          customDays: config.customDays,
          tautulliStatType: config.tautulliStatType,
          searchMissingMovies: config.searchMissingMovies,
          searchMissingTV: config.searchMissingTV,
          autoApproveMovies: config.autoApproveMovies,
          autoApproveTV: config.autoApproveTV,
          maxSeasonsToRequest: config.maxSeasonsToRequest,
          seasonsPerShowLimit: config.seasonsPerShowLimit,
          traktCustomListUrl: config.traktCustomListUrl,
          tmdbCustomListUrl: config.tmdbCustomListUrl,
          imdbCustomListUrl: config.imdbCustomListUrl,
          letterboxdCustomListUrl: config.letterboxdCustomListUrl,
          reverseOrder: config.reverseOrder,
          randomizeOrder: config.randomizeOrder,
          timeRestriction: config.timeRestriction,
          customPoster: config.customPoster,
          autoPoster: config.autoPoster,
          autoPosterTemplate: config.autoPosterTemplate,
          collectionRatingKey: config.collectionRatingKey,
          ...(config.configType && { configType: config.configType }),
          ...(config.downloadMode && { downloadMode: config.downloadMode }),
          ...(config.isLinked !== undefined && { isLinked: config.isLinked }),
          ...(config.linkId !== undefined && { linkId: config.linkId }),
          ...(config.isUnlinked !== undefined && {
            isUnlinked: config.isUnlinked,
          }),
          ...(config.maxPositionToProcess !== undefined && {
            maxPositionToProcess: config.maxPositionToProcess,
          }),
          ...(config.timePeriod && { timePeriod: config.timePeriod }),
          ...(config.libraryIds && { libraryIds: config.libraryIds }),
          ...(config.libraryNames && { libraryNames: config.libraryNames }),
        };
        await axios.put(
          `/api/v1/collections/${config.id}/settings`,
          submissionConfig
        );
      }

      onUpdateConfigs(configs);
      revalidate();

      if (!suppressNotification) {
        addToast(intl.formatMessage(messages.collectionConfigSaved), {
          autoDismiss: true,
          appearance: 'success',
        });
      }
    } catch (error) {
      addToast(intl.formatMessage(messages.collectionConfigError), {
        autoDismiss: true,
        appearance: 'error',
      });
      throw error;
    }
  };

  const addCollectionConfig = () => {
    const newConfig: CollectionFormConfig = {
      id: '', // Will be assigned on save
      name: '', // Will be generated from template
      type: undefined, // Start with no selection to show "Select Source..."
      subtype: '',
      template: '',
      customMovieTemplate: '', // Initialize empty custom movie template
      customTVTemplate: '', // Initialize empty custom TV template
      visibilityConfig: {
        usersHome: true,
        serverOwnerHome: true,
        libraryRecommended: true,
      }, // Default to Users and Server Owner Home
      isActive: true, // Placeholder for TypeScript - backend will compute actual value
      maxItems: 30,
      libraryId: '', // Start with no selection to show "Select Libraries..."
      libraryName: '',
      sortOrderHome: 1, // Default positioned item (0 is void)
      sortOrderLibrary: 1, // Default promoted section (0 is A-Z)
      customDays: 30, // Default for Tautulli collections
      tautulliStatType: 'plays', // Default stat type
      searchMissingMovies: false,
      searchMissingTV: false,
      autoApproveMovies: false,
      autoApproveTV: false,
      maxSeasonsToRequest: 0, // Default: no limit
      seasonsPerShowLimit: 0, // Default: all seasons
    };
    setEditingConfig(newConfig);
    setShowConfigForm(true);
  };

  const discoverPlexHubs = async () => {
    setDiscoveringHubs(true);
    try {
      // First sync libraries to ensure they're up to date
      const librariesResponse = await axios.get(
        '/api/v1/settings/plex/library',
        {
          params: { sync: true },
        }
      );

      // Then discover hubs and collections
      // Use unified discovery endpoint for cross-type detection and conflict resolution
      const response = await axios.get('/api/v1/discovery/hubs/scan');
      const {
        discoveredHubConfigs,
        discoveredPreExistingConfigs,
        validationResults,
      } = response.data;

      // Apply validation results to mark missing collections
      if (validationResults) {
        // Mark missing collections
        const updatedCollections = localCollectionConfigs.map((config) => ({
          ...config,
          missing:
            validationResults.missingCollections?.includes(config.id) || false,
        }));
        setLocalCollectionConfigs(updatedCollections);

        // Mark missing hubs
        const updatedHubs = localHubConfigs.map((config) => ({
          ...config,
          missing: validationResults.missingHubs?.includes(config.id) || false,
        }));
        setLocalHubConfigs(updatedHubs);

        // Mark missing pre-existing collections
        const updatedPreExisting = localPreExistingConfigs.map((config) => ({
          ...config,
          missing:
            validationResults.missingPreExisting?.includes(config.id) || false,
        }));
        setLocalPreExistingConfigs(updatedPreExisting);

        // Log validation results
        const totalMissing =
          (validationResults.missingCollections?.length || 0) +
          (validationResults.missingHubs?.length || 0) +
          (validationResults.missingPreExisting?.length || 0);
        if (totalMissing > 0) {
          addToast(
            `Validation complete: ${totalMissing} missing collection${
              totalMissing !== 1 ? 's' : ''
            } detected`,
            {
              autoDismiss: true,
              appearance: 'warning',
            }
          );
        }
      }

      // Combine both arrays for processing
      const allDiscoveredConfigs = [
        ...(discoveredHubConfigs || []),
        ...(discoveredPreExistingConfigs || []),
      ];

      if (allDiscoveredConfigs.length === 0) {
        // No new hubs found, but still need to refresh UI for any updates to existing configs
        revalidateAll();

        addToast('No Plex hubs found to import.', {
          autoDismiss: true,
          appearance: 'info',
        });
        return;
      }

      // Get existing hub configurations from separate APIs
      const [existingHubsResponse, existingPreExistingResponse] =
        await Promise.all([
          axios.get('/api/v1/defaulthubs'),
          axios.get('/api/v1/preexisting'),
        ]);
      const existingHubConfigs = existingHubsResponse.data || [];
      const existingPreExistingConfigs = existingPreExistingResponse.data || [];

      // Filter out hubs that are already configured using the proper hub ID format
      const existingHubIds = new Set(
        existingHubConfigs.map((hub: PlexHubConfig) => hub.id)
      );
      const existingPreExistingIds = new Set(
        existingPreExistingConfigs.map(
          (hub: PreExistingCollectionConfig) => hub.id
        )
      );

      const newHubs = (discoveredHubConfigs || []).filter(
        (hub: PlexHubConfig) => !existingHubIds.has(hub.id)
      );

      const newPreExistingCollections = (
        discoveredPreExistingConfigs || []
      ).filter(
        (hub: PreExistingCollectionConfig) =>
          !existingPreExistingIds.has(hub.id)
      );

      if (newHubs.length === 0 && newPreExistingCollections.length === 0) {
        // No new configs to add, but still need to refresh UI for any updates to existing configs
        revalidateAll();

        addToast('All available Plex hubs are already configured.', {
          autoDismiss: true,
          appearance: 'info',
        });
        return;
      }

      // Use discovery APIs for new configurations with proper timing
      const discoveryPromises = [];

      if (newHubs.length > 0) {
        discoveryPromises.push(
          axios.post('/api/v1/defaulthubs/discover', {
            hubConfigs: newHubs,
          })
        );
      }

      if (newPreExistingCollections.length > 0) {
        discoveryPromises.push(
          axios.post('/api/v1/preexisting/discover', {
            preExistingCollectionConfigs: newPreExistingCollections,
          })
        );
      }

      // Wait for all discovery operations to complete with 10 second timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Discovery timeout')), 10000)
      );

      try {
        await Promise.race([Promise.all(discoveryPromises), timeoutPromise]);
      } catch (error) {
        if (error instanceof Error && error.message === 'Discovery timeout') {
          // Discovery timed out, proceed with refresh anyway
        } else {
          throw error; // Re-throw other errors
        }
      }

      // Wait a bit more to ensure backend processing is complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Now revalidate to get the fresh data
      revalidateAll();

      // Calculate summary for comprehensive results
      const libraries = librariesResponse.data || [];

      // Show comprehensive results
      const totalHubs = allDiscoveredConfigs.filter(
        (c: PlexHubConfig) =>
          c.collectionType === CollectionType.DEFAULT_PLEX_HUB
      ).length;
      const totalCollections = allDiscoveredConfigs.filter(
        (c: PlexHubConfig) =>
          c.collectionType !== CollectionType.DEFAULT_PLEX_HUB
      ).length;
      const totalNewConfigs = newHubs.length + newPreExistingCollections.length;

      addToast(
        `Discovery complete! Synced ${libraries.length} libraries and imported ${totalNewConfigs} new configurations (${totalHubs} hubs, ${totalCollections} collections).`,
        {
          autoDismiss: true,
          appearance: 'success',
        }
      );
    } catch (error) {
      addToast(
        'Failed to discover Plex hubs. Please check your Plex connection.',
        {
          autoDismiss: true,
          appearance: 'error',
        }
      );
    } finally {
      setDiscoveringHubs(false);
    }
  };

  const syncCollections = async () => {
    setSyncing(true);
    setSyncStarting(true);
    try {
      await axios.post('/api/v1/collections/sync');

      // Immediately refresh sync status to see backend changes
      if (refreshSyncStatus && typeof refreshSyncStatus === 'function') {
        refreshSyncStatus();
      }

      addToast('Collections sync started successfully!', {
        autoDismiss: true,
        appearance: 'success',
      });
      // Clear starting state after a short delay to allow real status to come through
      setTimeout(() => setSyncStarting(false), 2000);
    } catch (error) {
      addToast('Failed to start collections sync. Please try again.', {
        autoDismiss: true,
        appearance: 'error',
      });
      setSyncStarting(false);
    } finally {
      setSyncing(false);
    }
  };

  const editCollectionConfig = (config: CollectionFormConfig) => {
    // Check if this is a hub config
    if (config.type === 'hub') {
      // Find the actual hub config to check linking status
      const targetHub = localHubConfigs.find(
        (h: PlexHubConfig) => h.id === config.id
      );

      let configToEdit = config;

      // If this hub is linked to others, we need to edit them as a linked set
      if (targetHub?.isLinked && targetHub?.linkId) {
        // Find all hubs in the same link group
        const linkedHubs = localHubConfigs.filter(
          (h: PlexHubConfig) =>
            h.linkId === targetHub.linkId && h.isLinked && h.id !== config.id
        );

        if (linkedHubs.length > 0) {
          // Create a parent config representing all libraries for this linked hub group
          const allLibraryIds = [
            config.libraryId,
            ...linkedHubs.map((h: PlexHubConfig) => h.libraryId),
          ];
          const allLibraryNames = [
            config.libraryName,
            ...linkedHubs.map((h: PlexHubConfig) => h.libraryName),
          ];

          configToEdit = {
            ...config,
            libraryIds: allLibraryIds,
            libraryNames: allLibraryNames,
            // Use the actual linking properties from the hub
            isLinked: true,
            linkId: targetHub.linkId,
          };
        }
      }

      // Mark the config with its type for the form to render appropriately
      const hubConfig = {
        ...configToEdit,
        // Backend properties are already present on config, no need to copy them
      };
      setEditingConfig(hubConfig);
      setShowConfigForm(true);
      return;
    }

    // Check if this is a linked collection - if so, prepare for linked editing
    const configToEdit = prepareLinkedConfigForEditing(
      config,
      localCollectionConfigs
    );

    // Determine if this is a linked/managed collection
    // A collection is linked if:
    // 1. It has libraryId: 'all' (applies to all libraries)
    // 2. It has multiple libraryIds (applies to multiple specific libraries)
    // 3. There are other collections with the same type/subtype (manual linking)

    // Mark the config with appropriate flags for the form to render correctly
    // For linked collections, we want them to show as normal editable collections (not preexisting)
    const editConfig = {
      ...configToEdit,
      isAgregarrManaged: true, // All our collections are managed by Agregarr
    };

    setEditingConfig(editConfig);
    setShowConfigForm(true);
  };

  // Edit handlers for hubs and pre-existing collections
  const editHubConfig = (config: PlexHubConfig) => {
    // Check if this hub is linked to others - if so, prepare for linked editing
    const targetHub = config;
    let configToEdit:
      | CollectionFormConfig
      | PlexHubConfig
      | PreExistingCollectionConfig = config;

    if (targetHub?.isLinked && targetHub?.linkId) {
      // Find all hubs in the same link group
      const linkedHubs = localHubConfigs.filter(
        (h: PlexHubConfig) =>
          h.linkId === targetHub.linkId && h.isLinked && h.id !== config.id
      );

      if (linkedHubs.length > 0) {
        // Create a parent config representing all libraries for this linked hub group
        const allLibraryIds = [
          config.libraryId,
          ...linkedHubs.map((h: PlexHubConfig) => h.libraryId),
        ];
        const allLibraryNames = [
          config.libraryName,
          ...linkedHubs.map((h: PlexHubConfig) => h.libraryName),
        ];

        configToEdit = {
          ...config,
          libraryIds: allLibraryIds,
          libraryNames: allLibraryNames,
          // Use the actual linking properties from the hub
          isLinked: true,
          linkId: targetHub.linkId,
          // Mark as hub type for form detection
          type: 'hub',
        };
      } else {
        configToEdit = {
          ...config,
          type: 'hub',
        };
      }
    } else {
      configToEdit = {
        ...config,
        type: 'hub',
      };
    }

    setEditingConfig(configToEdit);
    setShowConfigForm(true);
  };

  const editPreExistingConfig = (config: PreExistingCollectionConfig) => {
    // Check if this pre-existing collection is linked to others - if so, prepare for linked editing
    let configToEdit:
      | CollectionFormConfig
      | PlexHubConfig
      | PreExistingCollectionConfig = config;

    if (config?.isLinked && config?.linkId) {
      // Find all pre-existing collections in the same link group
      const linkedPreExisting = (localPreExistingConfigs || []).filter(
        (c: PreExistingCollectionConfig) =>
          c.linkId === config.linkId && c.isLinked && c.id !== config.id
      );

      if (linkedPreExisting.length > 0) {
        // Create a parent config representing all libraries for this linked group
        const allLibraryIds = [
          config.libraryId,
          ...linkedPreExisting.map(
            (c: PreExistingCollectionConfig) => c.libraryId
          ),
        ];
        const allLibraryNames = [
          config.libraryName,
          ...linkedPreExisting.map(
            (c: PreExistingCollectionConfig) => c.libraryName
          ),
        ];

        configToEdit = {
          ...config,
          libraryIds: allLibraryIds,
          libraryNames: allLibraryNames,
          // Use the actual linking properties
          isLinked: true,
          linkId: config.linkId,
          // Mark as pre-existing type for form detection
          configType: 'preExisting', // Metadata for form detection
        };
      } else {
        configToEdit = {
          ...config,
          configType: 'preExisting', // Metadata for form detection
        };
      }
    } else {
      configToEdit = {
        ...config,
        configType: 'preExisting', // Metadata for form detection
      };
    }

    // Cast to CollectionFormConfig since we've created form-compatible structure
    setEditingConfig(configToEdit as CollectionFormConfig);
    setShowConfigForm(true);
  };

  const saveHubConfig = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    try {
      // Strip computed fields to avoid OpenAPI validation errors
      const hubConfig = config as PlexHubConfig;
      const payload: Omit<
        PlexHubConfig,
        'isActive' | 'collectionType' | 'missing'
      > = {
        id: hubConfig.id,
        hubIdentifier: hubConfig.hubIdentifier,
        name: hubConfig.name,
        libraryId: hubConfig.libraryId,
        libraryName: hubConfig.libraryName,
        mediaType: hubConfig.mediaType,
        sortOrderHome: hubConfig.sortOrderHome,
        sortOrderLibrary: hubConfig.sortOrderLibrary,
        isLibraryPromoted: hubConfig.isLibraryPromoted,
        visibilityConfig: hubConfig.visibilityConfig,
        ...(hubConfig.isLinked !== undefined && {
          isLinked: hubConfig.isLinked,
        }),
        ...(hubConfig.linkId !== undefined && { linkId: hubConfig.linkId }),
        ...(hubConfig.isUnlinked !== undefined && {
          isUnlinked: hubConfig.isUnlinked,
        }),
        ...(hubConfig.timeRestriction && {
          timeRestriction: hubConfig.timeRestriction,
        }),
      };
      await axios.put(`/api/v1/defaulthubs/${config.id}/settings`, payload);
      await revalidateDefaultHubs();
      addToast('Hub configuration saved successfully!', {
        autoDismiss: true,
        appearance: 'success',
      });
      setShowHubForm(false);
      setEditingHubConfig(null);
    } catch (error) {
      addToast('Failed to save hub configuration.', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const savePreExistingConfig = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    try {
      // Strip computed fields to avoid OpenAPI validation errors
      const preExistingConfig = config as PreExistingCollectionConfig;
      const payload: Omit<
        PreExistingCollectionConfig,
        'isActive' | 'collectionType' | 'missing'
      > = {
        id: preExistingConfig.id,
        collectionRatingKey: preExistingConfig.collectionRatingKey,
        name: preExistingConfig.name,
        libraryId: preExistingConfig.libraryId,
        libraryName: preExistingConfig.libraryName,
        mediaType: preExistingConfig.mediaType,
        sortOrderHome: preExistingConfig.sortOrderHome,
        sortOrderLibrary: preExistingConfig.sortOrderLibrary,
        isLibraryPromoted: preExistingConfig.isLibraryPromoted,
        visibilityConfig: preExistingConfig.visibilityConfig,
        ...(preExistingConfig.isLinked !== undefined && {
          isLinked: preExistingConfig.isLinked,
        }),
        ...(preExistingConfig.linkId !== undefined && {
          linkId: preExistingConfig.linkId,
        }),
        ...(preExistingConfig.isUnlinked !== undefined && {
          isUnlinked: preExistingConfig.isUnlinked,
        }),
        ...(preExistingConfig.timeRestriction && {
          timeRestriction: preExistingConfig.timeRestriction,
        }),
        ...(preExistingConfig.customPoster && {
          customPoster: preExistingConfig.customPoster,
        }),
      };
      await axios.put(`/api/v1/preexisting/${config.id}/settings`, payload);
      await revalidatePreExisting();
      addToast('Pre-existing collection configuration saved successfully!', {
        autoDismiss: true,
        appearance: 'success',
      });
      setShowPreExistingForm(false);
      setEditingPreExistingConfig(null);
    } catch (error) {
      addToast('Failed to save pre-existing collection configuration.', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const closeHubModal = () => {
    setShowHubForm(false);
    setEditingHubConfig(null);
  };

  const closePreExistingModal = () => {
    setShowPreExistingForm(false);
    setEditingPreExistingConfig(null);
  };

  // Unified hide handler that routes to appropriate type-specific handler
  const handleHideConfig = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    const hiddenVisibility = {
      usersHome: false,
      serverOwnerHome: false,
      libraryRecommended: false,
    };

    if ('collectionRatingKey' in config) {
      // This is a PreExistingCollectionConfig - handle linking
      const preExistingConfig = config as PreExistingCollectionConfig;

      // Check if this is linked to others
      const isLinked = Boolean(
        preExistingConfig.isLinked && preExistingConfig.linkId
      );
      const itemsToUpdate =
        isLinked && preExistingConfig.linkId
          ? localPreExistingConfigs.filter(
              (c: PreExistingCollectionConfig) =>
                c.linkId === preExistingConfig.linkId && c.isLinked
            )
          : [preExistingConfig];

      const updatedPreExistingConfigs = localPreExistingConfigs.map(
        (c: PreExistingCollectionConfig) => {
          const shouldUpdate = itemsToUpdate.some((item) => item.id === c.id);
          return shouldUpdate
            ? { ...c, visibilityConfig: hiddenVisibility }
            : c;
        }
      );

      // Update each pre-existing config individually
      const configsToUpdate = itemsToUpdate.map((config) => ({
        ...config,
        visibilityConfig: hiddenVisibility,
      }));
      await saveIndividualConfigs(configsToUpdate);

      setLocalPreExistingConfigs(updatedPreExistingConfigs);
      revalidateAll();
      const itemCount = itemsToUpdate.length;
      addToast(
        `${
          itemCount === 1
            ? 'Pre-existing collection'
            : `${itemCount} linked pre-existing collections`
        } hidden successfully`,
        { autoDismiss: true, appearance: 'success' }
      );
    } else if ('hubIdentifier' in config && !('subtype' in config)) {
      // This is a PlexHubConfig - handle linking
      const hubConfig = config as PlexHubConfig;

      // Check if this is linked to others
      const isLinked = Boolean(hubConfig.isLinked && hubConfig.linkId);
      const itemsToUpdate =
        isLinked && hubConfig.linkId
          ? localHubConfigs.filter(
              (h: PlexHubConfig) => h.linkId === hubConfig.linkId && h.isLinked
            )
          : [hubConfig];

      // Update each config individually
      const updatedConfigs = itemsToUpdate.map((config) => ({
        ...config,
        visibilityConfig: hiddenVisibility,
      }));

      // Use individual API calls for each config
      await saveIndividualConfigs(updatedConfigs);

      // Update local state after successful API calls
      const updatedHubConfigs = localHubConfigs.map((h: PlexHubConfig) => {
        const shouldUpdate = itemsToUpdate.some((item) => item.id === h.id);
        return shouldUpdate ? { ...h, visibilityConfig: hiddenVisibility } : h;
      });
      setLocalHubConfigs(updatedHubConfigs);

      revalidateAll();
      const itemCount = itemsToUpdate.length;
      addToast(
        `${
          itemCount === 1 ? 'Hub' : `${itemCount} linked hubs`
        } hidden successfully`,
        { autoDismiss: true, appearance: 'success' }
      );
    } else {
      // This is a CollectionFormConfig (hub converted to collection form)
      await hideHubConfig(config as CollectionFormConfig);
    }
  };

  const hideHubConfig = async (config: CollectionFormConfig) => {
    if (config.type !== 'hub') {
      return;
    }

    // Check if this hub is linked to other hubs using the proper isLinked/linkId properties
    const targetHub = localHubConfigs.find(
      (h: PlexHubConfig) => h.id === config.id
    );
    const isLinked = Boolean(targetHub?.isLinked && targetHub?.linkId);

    // Update all hubs in the same link group or just this one
    const hubsToUpdate =
      isLinked && targetHub?.linkId
        ? localHubConfigs.filter(
            (h: PlexHubConfig) => h.linkId === targetHub.linkId && h.isLinked
          )
        : localHubConfigs.filter((h: PlexHubConfig) => h.id === config.id);

    const updatedHubConfigs = localHubConfigs.map((h: PlexHubConfig) => {
      const shouldUpdate = hubsToUpdate.some(
        (hub: PlexHubConfig) => hub.id === h.id
      );
      return shouldUpdate
        ? {
            ...h,
            visibilityConfig: {
              usersHome: false,
              serverOwnerHome: false,
              libraryRecommended: false,
            },
          }
        : h;
    });

    try {
      // Update each hub individually using individual API calls
      const configsToUpdate = hubsToUpdate.map((hub) => ({
        ...hub,
        visibilityConfig: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
      }));

      await saveIndividualConfigs(configsToUpdate);

      // Update local state after successful API calls
      setLocalHubConfigs(updatedHubConfigs);
      revalidateAll();

      const message = isLinked
        ? `Linked hub hidden across ${hubsToUpdate.length} libraries successfully`
        : 'Hub hidden successfully';

      addToast(message, {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch (error) {
      // Rollback on error
      setLocalHubConfigs(localHubConfigs);
      const errorMessage = isLinked
        ? 'Failed to hide linked hubs'
        : 'Failed to hide hub';

      addToast(errorMessage, {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const deleteCollectionConfig = async (configId: string) => {
    // Only collections can be deleted - hubs and pre-existing collections cannot be deleted, only hidden
    // Find the collection to delete - it must exist in localCollectionConfigs
    const configToDelete = localCollectionConfigs.find(
      (c: CollectionFormConfig) => c.id === configId
    );
    if (!configToDelete) {
      addToast('Collection not found', {
        autoDismiss: true,
        appearance: 'error',
      });
      return;
    }

    // Determine which configs will be deleted (for UI state updates)
    let configIdsToDelete: string[] = [configId];

    // If this is a linked collection, find all configs in the same group for UI state update
    const linkedConfigs =
      configToDelete.isLinked && configToDelete.linkId
        ? localCollectionConfigs.filter(
            (c: CollectionFormConfig) =>
              c.type === configToDelete.type &&
              c.subtype === configToDelete.subtype &&
              c.linkId === configToDelete.linkId && // Same group ID
              c.isLinked && // Must also be actively linked
              c.id !== configId
          )
        : [];

    if (linkedConfigs.length > 0) {
      // This is a linked collection - all linked configs will be deleted by backend
      configIdsToDelete = [
        configId,
        ...linkedConfigs.map((c: CollectionFormConfig) => c.id),
      ];
    }

    // Filter out all configs that will be deleted (for UI state)
    const updatedConfigs = localCollectionConfigs.filter(
      (c: CollectionFormConfig) => !configIdsToDelete.includes(c.id)
    );
    const isLastCollection = updatedConfigs.length === 0;

    // Update local state immediately
    setLocalCollectionConfigs(updatedConfigs);

    try {
      // Make single DELETE request - backend handles linked collection deletion
      await axios.delete(`/api/v1/collections/${configId}`);

      // If this was the last collection, trigger final sync to clean up Plex
      if (isLastCollection && data) {
        try {
          // First trigger a final sync to clean up all collections and labels
          await axios.post('/api/v1/collections/sync');

          // Then save current Plex settings
          await axios.post('/api/v1/settings/plex', {
            ip: data.ip,
            port: data.port,
            useSsl: data.useSsl,
            webAppUrl: data.webAppUrl,
          });

          addToast('Last collection deleted - final cleanup completed.', {
            autoDismiss: true,
            appearance: 'success',
          });
        } catch (error) {
          // Failed to complete final cleanup after deleting last config
          addToast(
            'Collection deleted but failed to complete final cleanup. Manual cleanup may be required.',
            {
              autoDismiss: true,
              appearance: 'warning',
            }
          );
        }
      } else {
        const successMessage =
          configIdsToDelete.length > 1
            ? `${configIdsToDelete.length} linked collections deleted successfully`
            : intl.formatMessage(messages.collectionConfigDeleted);

        addToast(successMessage, {
          autoDismiss: true,
          appearance: 'success',
        });
      }
    } catch (error) {
      // Error already handled in saveCollectionConfigs
    }
  };

  const saveCollectionConfig = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    // Handle hub configs separately
    if ((config as CollectionFormConfig).configType === 'hub') {
      // Cast to CollectionFormConfig since form converts everything to this format
      const hubConfig = config as CollectionFormConfig;
      try {
        // Check if this is a linked hub (affects multiple libraries)
        const isLinked = Boolean(hubConfig.isLinked);

        if (isLinked && hubConfig.linkId) {
          // This is a linked hub - update all related hubs in the same link group
          const updatedHubConfigs = [...localHubConfigs];

          // Find and update all hubs with the same linkId
          const linkedHubIndices = updatedHubConfigs
            .map((h, index) => ({ hub: h, index }))
            .filter(
              ({ hub }) => hub.linkId === hubConfig.linkId && hub.isLinked
            )
            .map(({ index }) => index);

          linkedHubIndices.forEach((hubIndex) => {
            // Update the existing hub config
            updatedHubConfigs[hubIndex] = {
              ...updatedHubConfigs[hubIndex],
              visibilityConfig: hubConfig.visibilityConfig,
              timeRestriction: hubConfig.timeRestriction,
              // Preserve linking properties
              isLinked: true,
              linkId: hubConfig.linkId,
            };
          });

          // Update local state immediately
          setLocalHubConfigs(updatedHubConfigs);

          // Save updated hub configs individually
          await saveIndividualConfigs(
            updatedHubConfigs.filter((h) =>
              linkedHubIndices.some(
                (index) => updatedHubConfigs[index].id === h.id
              )
            )
          );

          addToast(
            `Linked hub configuration saved successfully across ${linkedHubIndices.length} hubs!`,
            {
              autoDismiss: true,
              appearance: 'success',
            }
          );
        } else {
          // This is a single hub - update just this one
          const existingHubIndex = localHubConfigs.findIndex(
            (h: PlexHubConfig) => h.id === hubConfig.id
          );
          if (existingHubIndex >= 0) {
            const updatedHubConfigs = [...localHubConfigs];
            // Convert back to hub config format with proper type handling
            updatedHubConfigs[existingHubIndex] = {
              ...updatedHubConfigs[existingHubIndex],
              hubIdentifier:
                hubConfig.subtype ||
                updatedHubConfigs[existingHubIndex].hubIdentifier,
              name: hubConfig.name,
              libraryId: hubConfig.libraryId,
              libraryName: hubConfig.libraryName,
              mediaType: hubConfig.mediaType || 'movie',
              sortOrderLibrary: hubConfig.sortOrderLibrary || 0,
              visibilityConfig: hubConfig.visibilityConfig,
              timeRestriction: hubConfig.timeRestriction,
            };

            // Update local state immediately
            setLocalHubConfigs(updatedHubConfigs);

            // Save the single updated hub config
            await saveIndividualConfigs([updatedHubConfigs[existingHubIndex]]);

            addToast('Hub configuration saved successfully!', {
              autoDismiss: true,
              appearance: 'success',
            });
          }
        }

        revalidateAll();
      } catch (error) {
        addToast('Failed to save hub configuration.', {
          autoDismiss: true,
          appearance: 'error',
        });
      }

      setShowConfigForm(false);
      setEditingConfig(null);
      return;
    }

    // Handle regular collection configs (and pre-existing that don't have hub routing)
    // Cast to CollectionFormConfig since we're in the collection handling branch
    try {
      const collectionConfig = config as CollectionFormConfig;
      const existingIndex = localCollectionConfigs.findIndex(
        (c: CollectionFormConfig) => c.id === collectionConfig.id
      );
      let updatedConfigs: CollectionFormConfig[] = [];
      let changedConfigs: CollectionFormConfig[] = [];

      if (existingIndex >= 0) {
        // Update existing config - backend will handle linked collection propagation
        updatedConfigs = [...localCollectionConfigs];
        updatedConfigs[existingIndex] = collectionConfig;

        // Always send API call for only the single config that changed
        // Backend will automatically propagate changes to linked configs
        changedConfigs = [collectionConfig];
      } else {
        // Add new config(s) - Use new simplified backend API
        try {
          // Use the new backend create endpoint that handles multi-library expansion
          const response = await axios.post(
            '/api/v1/collections/create',
            collectionConfig
          );

          if (response.status === 201 && response.data.collectionConfigs) {
            const createdConfigs = response.data.collectionConfigs;

            // Update local state with the created configs
            updatedConfigs = [...localCollectionConfigs, ...createdConfigs];
            setLocalCollectionConfigs(updatedConfigs);

            const configCount = createdConfigs.length;
            const successMessage =
              configCount === 1
                ? 'Collection created successfully!'
                : `${configCount} linked collections created successfully!`;

            addToast(successMessage, {
              autoDismiss: true,
              appearance: 'success',
            });

            // Check for inactive collections
            if (hideInactiveCollections) {
              const hasInactiveNewCollection = createdConfigs.some(
                (newConfig: CollectionFormConfig) => {
                  return (
                    newConfig.timeRestriction &&
                    !newConfig.timeRestriction.alwaysActive
                  );
                }
              );

              if (hasInactiveNewCollection) {
                setShowInactiveHelp(true);
                setTimeout(() => setShowInactiveHelp(false), 10000);
              }
            }

            setShowConfigForm(false);
            setEditingConfig(null);
            revalidateAll();
            return; // Early return - we're done
          }
        } catch (error) {
          addToast('Failed to create collection. Please try again.', {
            autoDismiss: true,
            appearance: 'error',
          });

          return; // Early return on error
        }
      }

      // Only send API calls for collections that actually changed
      if (changedConfigs.length > 0) {
        await saveCollectionConfigs(changedConfigs);
        // Refresh data from backend - this will pick up any linked collection changes
        // that the backend automatically propagated
        revalidateAll();
      } else {
        // Update local React state if no API calls needed
        setLocalCollectionConfigs(updatedConfigs);
      }

      setShowConfigForm(false);
      setEditingConfig(null);
    } catch (error) {
      addToast('Failed to save collection configuration', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const linkCollectionConfig = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    try {
      if ((config as CollectionFormConfig).configType === 'hub') {
        // Handle hub linking - find other hubs with same base identifier that could be linked
        const currentHub = localHubConfigs.find(
          (h: PlexHubConfig) => h.id === config.id
        );
        if (!currentHub) return;

        const eligibleHubs = localHubConfigs.filter(
          (h: PlexHubConfig) =>
            h.linkId === currentHub.linkId && // Same linkId group (established during discovery)
            h.id !== config.id &&
            !h.isLinked && // Only link hubs that aren't already linked
            !h.isUnlinked // Exclude unlinked hubs
        );

        if (eligibleHubs.length === 0) {
          addToast(
            'No other unlinked hubs found in the same group to link to.',
            {
              autoDismiss: true,
              appearance: 'info',
            }
          );
          return;
        }

        // Create a new link group with a unique linkId
        const existingLinkIds = localHubConfigs
          .map((h) => h.linkId)
          .filter((id): id is number => typeof id === 'number');
        const newLinkId =
          existingLinkIds.length > 0 ? Math.max(...existingLinkIds) + 1 : 1;

        const updatedHubConfigs = [...localHubConfigs];
        const hubsToLink = [currentHub, ...eligibleHubs];

        hubsToLink.forEach((hub: PlexHubConfig) => {
          const hubIndex = updatedHubConfigs.findIndex(
            (h: PlexHubConfig) => h.id === hub.id
          );
          if (hubIndex >= 0) {
            // Set isLinked: true and assign linkId
            updatedHubConfigs[hubIndex] = {
              ...updatedHubConfigs[hubIndex],
              isLinked: true,
              linkId: newLinkId,
              isUnlinked: undefined, // Clear any unlinked flag
            };
          }
        });

        setLocalHubConfigs(updatedHubConfigs);

        // Save only the hubs that were linked (updated with new linkId)
        const hubsToSave = updatedHubConfigs.filter((hub) =>
          hubsToLink.some((linkHub) => linkHub.id === hub.id)
        );
        await saveIndividualConfigs(hubsToSave);
        revalidateAll();
        addToast(
          `Successfully linked ${hubsToLink.length} hubs. They will now be configured together.`,
          {
            autoDismiss: true,
            appearance: 'success',
          }
        );
      } else {
        // Handle collection linking - use clicked config as master template
        const collectionConfig = config as CollectionFormConfig;

        // Find eligible collections for relinking: unlinked collections with same linkId
        const eligibleCollections = localCollectionConfigs.filter(
          (c: CollectionFormConfig) =>
            c.type === collectionConfig.type &&
            c.subtype === collectionConfig.subtype &&
            c.linkId === collectionConfig.linkId && // Same group ID
            !c.isLinked && // Must be unlinked to be eligible for relinking
            c.id !== collectionConfig.id // Don't include the master config itself
        );

        if (eligibleCollections.length === 0) {
          addToast(
            'No other unlinked collections found with the same link group to relink.',
            {
              autoDismiss: true,
              appearance: 'info',
            }
          );
          return;
        }

        // Use clicked config as master - apply its settings to all eligible collections
        const masterConfig = collectionConfig;
        const updatedConfigs = [...localCollectionConfigs];
        const collectionsToLink = [masterConfig, ...eligibleCollections];

        collectionsToLink.forEach((targetConfig: CollectionFormConfig) => {
          const configIndex = updatedConfigs.findIndex(
            (c: CollectionFormConfig) => c.id === targetConfig.id
          );
          if (configIndex >= 0) {
            // Override with master config's settings while preserving library-specific properties
            updatedConfigs[configIndex] = {
              ...updatedConfigs[configIndex],
              // Master config shared settings
              template: masterConfig.template,
              customMovieTemplate: masterConfig.customMovieTemplate,
              customTVTemplate: masterConfig.customTVTemplate,
              visibilityConfig: masterConfig.visibilityConfig,
              maxItems: masterConfig.maxItems,
              downloadMode: masterConfig.downloadMode,
              searchMissingMovies: masterConfig.searchMissingMovies,
              searchMissingTV: masterConfig.searchMissingTV,
              autoApproveMovies: masterConfig.autoApproveMovies,
              autoApproveTV: masterConfig.autoApproveTV,
              maxSeasonsToRequest: masterConfig.maxSeasonsToRequest,
              seasonsPerShowLimit: masterConfig.seasonsPerShowLimit,
              maxPositionToProcess: masterConfig.maxPositionToProcess,
              timeRestriction: masterConfig.timeRestriction,
              traktCustomListUrl: masterConfig.traktCustomListUrl,
              tmdbCustomListUrl: masterConfig.tmdbCustomListUrl,
              imdbCustomListUrl: masterConfig.imdbCustomListUrl,
              letterboxdCustomListUrl: masterConfig.letterboxdCustomListUrl,
              reverseOrder: masterConfig.reverseOrder,
              randomizeOrder: masterConfig.randomizeOrder,
              customPoster: masterConfig.customPoster,
              mediaType: masterConfig.mediaType,
              customDays: masterConfig.customDays,
              tautulliStatType: masterConfig.tautulliStatType,
              // Set link status
              isLinked: true,
              isUnlinked: undefined, // Clear any unlinked flag
              // Preserve library-specific properties
              libraryId: updatedConfigs[configIndex].libraryId,
              libraryName: updatedConfigs[configIndex].libraryName,
              collectionRatingKey:
                updatedConfigs[configIndex].collectionRatingKey,
            };
          }
        });

        setLocalCollectionConfigs(updatedConfigs);

        // Only send API calls for the collections that were actually linked/changed
        const changedCollections = collectionsToLink.map((targetConfig) => {
          const configIndex = updatedConfigs.findIndex(
            (c) => c.id === targetConfig.id
          );
          return updatedConfigs[configIndex];
        });

        await saveCollectionConfigs(changedCollections, true);
        revalidateAll();

        addToast(
          `Successfully linked ${collectionsToLink.length} collections using selected config as master. They will now share the same settings.`,
          {
            autoDismiss: true,
            appearance: 'success',
          }
        );
      }
    } catch (error) {
      addToast('Failed to link configuration.', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const unlinkCollectionConfig = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    try {
      if ((config as CollectionFormConfig).configType === 'hub') {
        // Handle hub unlinking
        const currentHub = localHubConfigs.find(
          (h: PlexHubConfig) => h.id === config.id
        );
        if (!currentHub || !currentHub.isLinked || !currentHub.linkId) {
          addToast('This hub is not linked to any other hubs.', {
            autoDismiss: true,
            appearance: 'info',
          });
          return;
        }

        // Find all hubs in the same link group
        const linkedHubs = localHubConfigs.filter(
          (h: PlexHubConfig) => h.linkId === currentHub.linkId && h.isLinked
        );

        if (linkedHubs.length <= 1) {
          addToast('This hub is not linked to any other hubs.', {
            autoDismiss: true,
            appearance: 'info',
          });
          return;
        }

        // Confirmation is now handled by the ConfirmButton in the form

        // Create updated hub configs array
        const updatedHubConfigs = [...localHubConfigs];

        // Unlink all hubs in the group by setting isLinked: false and preserving linkId
        linkedHubs.forEach((hub: PlexHubConfig) => {
          const hubIndex = updatedHubConfigs.findIndex(
            (h: PlexHubConfig) => h.id === hub.id
          );
          if (hubIndex >= 0) {
            // Update the hub to be unlinked (preserve linkId for potential re-linking)
            updatedHubConfigs[hubIndex] = {
              ...hub,
              isLinked: false, // This stops them from being treated as linked
              isUnlinked: true, // Mark as deliberately unlinked
            };
          }
        });

        // Update local hub configs state
        setLocalHubConfigs(updatedHubConfigs);

        // Save only the hubs that were unlinked (updated isLinked/isUnlinked)
        const hubsToSave = updatedHubConfigs.filter((hub) =>
          linkedHubs.some((linkedHub) => linkedHub.id === hub.id)
        );
        await saveIndividualConfigs(hubsToSave);
        revalidateAll();

        addToast(
          `Successfully unlinked ${linkedHubs.length} hubs. Each can now be configured individually.`,
          {
            autoDismiss: true,
            appearance: 'success',
          }
        );
      } else {
        // Handle collection unlinking
        // Cast to CollectionFormConfig since we're in the collection handling branch
        const collectionConfig = config as CollectionFormConfig;
        // Find all linked configs with same type/subtype and group ID
        const linkedConfigs = localCollectionConfigs.filter(
          (c: CollectionFormConfig) =>
            c.type === collectionConfig.type &&
            c.subtype === collectionConfig.subtype &&
            c.isLinked &&
            c.linkId === collectionConfig.linkId
        );

        if (linkedConfigs.length <= 1) {
          addToast('This collection is not linked to any other collections.', {
            autoDismiss: true,
            appearance: 'info',
          });
          return;
        }

        // Unlink collections - preserve linkId but set isLinked to false (so they can be re-linked later)
        const updatedConfigs = localCollectionConfigs.map(
          (c: CollectionFormConfig) => {
            if (
              c.type === collectionConfig.type &&
              c.subtype === collectionConfig.subtype &&
              c.linkId === collectionConfig.linkId &&
              c.isLinked
            ) {
              return { ...c, isLinked: false }; // Preserve linkId, just deactivate linking
            }
            return c;
          }
        );

        setLocalCollectionConfigs(updatedConfigs);

        // Only send API calls for the collections that were actually unlinked/changed
        const changedCollections = updatedConfigs.filter(
          (c) =>
            c.type === collectionConfig.type &&
            c.subtype === collectionConfig.subtype &&
            c.linkId === collectionConfig.linkId &&
            !c.isLinked // These are the ones that were just changed to unlinked
        );

        await saveCollectionConfigs(changedCollections, true);

        addToast(
          `Successfully unlinked ${linkedConfigs.length} collections. Each can now be configured individually.`,
          {
            autoDismiss: true,
            appearance: 'success',
          }
        );
      }
    } catch (error) {
      addToast('Failed to unlink collection/hub.', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  // Helper function to apply tab filtering to different config types
  const filterConfigsByTab = <
    T extends {
      isActive: boolean;
      visibilityConfig: {
        usersHome: boolean;
        serverOwnerHome: boolean;
        libraryRecommended: boolean;
      };
      timeRestriction?: {
        alwaysActive?: boolean;
        removeFromPlexWhenInactive?: boolean;
        inactiveVisibilityConfig?: {
          usersHome?: boolean;
          serverOwnerHome?: boolean;
          libraryRecommended?: boolean;
        };
      };
      collectionType?: CollectionType;
    }
  >(
    configs: T[],
    isHubConfig = false
  ): T[] => {
    return configs.filter((config) => {
      if (activeTab === 'home') {
        // Home tab: Items with home visibility
        if (hideInactiveCollections && !config.isActive) {
          // First check: if collection is removed from Plex when inactive, hide it
          if (config.timeRestriction?.removeFromPlexWhenInactive) return false;

          // Second check: use inactive visibility config for promotion settings
          const inactiveVisibilityConfig = config.timeRestriction
            ?.inactiveVisibilityConfig ?? {
            usersHome: false,
            serverOwnerHome: false,
            libraryRecommended: true,
          };

          return (
            inactiveVisibilityConfig.usersHome ||
            inactiveVisibilityConfig.serverOwnerHome
          );
        }

        // Active collections: use regular visibility config
        return (
          config.visibilityConfig?.usersHome ||
          config.visibilityConfig?.serverOwnerHome
        );
      } else if (activeTab === 'recommended') {
        // Recommended tab: Items with library recommended visibility
        if (hideInactiveCollections && !config.isActive) {
          // First check: if collection is removed from Plex when inactive, hide it
          if (config.timeRestriction?.removeFromPlexWhenInactive) return false;

          // Second check: use inactive visibility config for promotion settings
          const inactiveVisibilityConfig = config.timeRestriction
            ?.inactiveVisibilityConfig ?? {
            usersHome: false,
            serverOwnerHome: false,
            libraryRecommended: true,
          };
          return inactiveVisibilityConfig.libraryRecommended;
        }

        // Active collections: use regular visibility config
        return config.visibilityConfig?.libraryRecommended;
      } else {
        // Library tab: Show all collections that exist in Plex
        if (hideInactiveCollections && !config.isActive) {
          // Only hide if collection is completely removed from Plex
          return !config.timeRestriction?.removeFromPlexWhenInactive;
        }

        // For hub configs in library tab, only show promoted collections (not default algorithmic hubs)
        if (
          isHubConfig &&
          config.collectionType === CollectionType.DEFAULT_PLEX_HUB
        ) {
          return false; // Don't show default Plex hubs in library tab
        }

        // Show all regular collections and promoted hubs in library tab
        return true;
      }
    });
  };

  // Apply filtering to each config type separately using raw data
  const filteredCollectionConfigs = localCollectionConfigs.filter(
    (config: CollectionFormConfig) => {
      // For regular collection configs, exclude user collections from Home tab
      if (
        activeTab === 'home' &&
        config.type === 'overseerr' &&
        config.subtype === 'users'
      ) {
        return false;
      }
      return filterConfigsByTab([config], false).length > 0;
    }
  );

  const filteredHubConfigs = filterConfigsByTab(filteredBuiltInHubs, true);
  const filteredPreExistingConfigs = filterConfigsByTab(
    deduplicatedPreExistingConfigs,
    true
  );

  // Work with native types - no conversion needed!
  // Group each type separately by library
  const collectionsByLibrary = new Map<string, CollectionFormConfig[]>();
  const hubsByLibrary = new Map<string, PlexHubConfig[]>();
  const preExistingByLibrary = new Map<string, PreExistingCollectionConfig[]>();

  // Group collections by library
  filteredCollectionConfigs.forEach((config) => {
    const libraryId = config.libraryId;
    if (!collectionsByLibrary.has(libraryId)) {
      collectionsByLibrary.set(libraryId, []);
    }
    collectionsByLibrary.get(libraryId)?.push(config);
  });

  // Group hubs by library
  filteredHubConfigs.forEach((hub) => {
    const libraryId = hub.libraryId;
    if (!hubsByLibrary.has(libraryId)) {
      hubsByLibrary.set(libraryId, []);
    }
    hubsByLibrary.get(libraryId)?.push(hub);
  });

  // Group pre-existing by library
  filteredPreExistingConfigs.forEach((preExisting) => {
    const libraryId = preExisting.libraryId;
    if (!preExistingByLibrary.has(libraryId)) {
      preExistingByLibrary.set(libraryId, []);
    }
    preExistingByLibrary.get(libraryId)?.push(preExisting);
  });

  // Get all libraries that have any content
  const allLibraryIds = new Set([
    ...Array.from(collectionsByLibrary.keys()),
    ...Array.from(hubsByLibrary.keys()),
    ...Array.from(preExistingByLibrary.keys()),
  ]);

  const allLibraries = libraries;

  // Calculate missing collections count for cleanup button
  const missingCount = useMemo(() => {
    const missingCollections = localCollectionConfigs.filter(
      (c) => c.missing
    ).length;
    const missingHubs = localHubConfigs.filter((h) => h.missing).length;
    const missingPreExisting = localPreExistingConfigs.filter(
      (p) => p.missing
    ).length;
    return missingCollections + missingHubs + missingPreExisting;
  }, [localCollectionConfigs, localHubConfigs, localPreExistingConfigs]);

  // Cleanup missing collections function
  const cleanupMissingCollections = async () => {
    if (missingCount === 0) return;

    const confirmed = window.confirm(
      `Remove ${missingCount} missing collection configuration${
        missingCount !== 1 ? 's' : ''
      }? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      // Call cleanup API endpoint (to be implemented)
      await axios.delete('/api/v1/collections/cleanup-missing');

      // Remove missing items from local state
      setLocalCollectionConfigs((prev) => prev.filter((c) => !c.missing));
      setLocalHubConfigs((prev) => prev.filter((h) => !h.missing));
      setLocalPreExistingConfigs((prev) => prev.filter((p) => !p.missing));

      // Revalidate all data
      revalidateAll();

      addToast(
        `${missingCount} missing collection configuration${
          missingCount !== 1 ? 's' : ''
        } removed successfully`,
        {
          autoDismiss: true,
          appearance: 'success',
        }
      );
    } catch (error) {
      addToast('Failed to cleanup missing collections', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  // Promote/Demote handlers for collections
  const handlePromoteCollection = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    try {
      let response;

      if ('collectionRatingKey' in config) {
        // Pre-existing collection
        response = await axios.patch(
          `/api/v1/preexisting/${config.id}/promote`
        );
      } else if ('hubIdentifier' in config) {
        // Hub config - shouldn't happen since hubs don't appear in Library tab
        return;
      } else {
        // Regular collection
        response = await axios.patch(
          `/api/v1/collections/${config.id}/promote`
        );
      }

      // Update local state
      const updatedConfig = response.data.config;

      if ('collectionRatingKey' in config) {
        // Update pre-existing collection
        setLocalPreExistingConfigs((prev: PreExistingCollectionConfig[]) =>
          prev.map((c: PreExistingCollectionConfig) =>
            c.id === config.id ? updatedConfig : c
          )
        );
      } else {
        // Update regular collection
        setLocalCollectionConfigs((prev: CollectionFormConfig[]) =>
          prev.map((c: CollectionFormConfig) =>
            c.id === config.id ? updatedConfig : c
          )
        );
      }

      // Revalidate all data
      revalidateAll();

      addToast('Collection promoted to top section successfully!', {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch (error) {
      addToast('Failed to promote collection', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const handleDemoteCollection = async (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => {
    try {
      let response;

      if ('collectionRatingKey' in config) {
        // Pre-existing collection
        response = await axios.patch(`/api/v1/preexisting/${config.id}/demote`);
      } else if ('hubIdentifier' in config) {
        // Hub config - shouldn't happen since hubs don't appear in Library tab
        return;
      } else {
        // Regular collection
        response = await axios.patch(`/api/v1/collections/${config.id}/demote`);
      }

      // Update local state
      const updatedConfig = response.data.config;

      if ('collectionRatingKey' in config) {
        // Update pre-existing collection
        setLocalPreExistingConfigs((prev: PreExistingCollectionConfig[]) =>
          prev.map((c: PreExistingCollectionConfig) =>
            c.id === config.id ? updatedConfig : c
          )
        );
      } else {
        // Update regular collection
        setLocalCollectionConfigs((prev: CollectionFormConfig[]) =>
          prev.map((c: CollectionFormConfig) =>
            c.id === config.id ? updatedConfig : c
          )
        );
      }

      // Revalidate all data
      revalidateAll();

      addToast('Collection moved to alphabetical section successfully!', {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch (error) {
      addToast('Failed to demote collection', {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex space-x-3">
          <Button
            buttonType="primary"
            onClick={addCollectionConfig}
            disabled={isFirstTimeUser}
            className={`flex items-center space-x-2 ${
              isFirstTimeUser
                ? 'pointer-events-none cursor-not-allowed opacity-30'
                : ''
            }`}
            title={
              isFirstTimeUser
                ? 'Please discover your Plex setup first'
                : undefined
            }
          >
            <PlusIcon className="h-4 w-4" />
            <span>Add Collection</span>
          </Button>

          {/* First-time setup discovery hint */}
          <div className="relative">
            <Button
              buttonType="default"
              onClick={discoverPlexHubs}
              disabled={discoveringHubs}
              className={`flex items-center space-x-2 ${
                isFirstTimeUser && !discoveringHubs
                  ? 'scale-105 transform border-4 border-orange-700 bg-orange-700 text-base font-bold text-white shadow-sm shadow-orange-600/50 hover:bg-orange-800'
                  : ''
              }`}
              style={
                isFirstTimeUser && !discoveringHubs
                  ? {
                      animation: 'border-pulse 2s infinite',
                    }
                  : undefined
              }
            >
              <MagnifyingGlassIcon className="h-4 w-4" />
              <span>
                {discoveringHubs
                  ? 'Discovering...'
                  : 'Discover Existing Collections & Hubs'}
              </span>
            </Button>
          </div>

          {/* Cleanup missing collections button - only show when there are missing items */}
          {missingCount > 0 && (
            <Button
              buttonType="warning"
              onClick={cleanupMissingCollections}
              className="flex items-center space-x-2"
            >
              <ExclamationTriangleIcon className="h-4 w-4" />
              <span>Clean Up Missing Collections ({missingCount})</span>
            </Button>
          )}
        </div>
        {(localCollectionConfigs.length > 0 || localHubConfigs.length > 0) && (
          <div className="flex items-center space-x-4">
            <GlobalSyncStatus
              isStarting={syncStarting}
              onSyncStart={(refreshFn) => setRefreshSyncStatus(() => refreshFn)}
              onSyncComplete={revalidateAll}
            />
            <Button
              buttonType="primary"
              onClick={syncCollections}
              disabled={syncing || isFirstTimeUser}
              className={`flex items-center space-x-2 ${
                isFirstTimeUser
                  ? 'pointer-events-none cursor-not-allowed opacity-30'
                  : ''
              }`}
            >
              <ArrowPathIcon
                className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`}
              />
              <span>{syncing ? 'Syncing...' : 'Sync Collections'}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Main Tabs for Home, Recommended, Library, and Inactive - only show when not filtering */}
      {!filterTab && (
        <div className="border-b border-gray-700">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => {
                if (!isFirstTimeUser) {
                  setActiveTab('home');
                  setActiveLibraryId('');
                }
              }}
              disabled={isFirstTimeUser}
              className={`border-b-2 py-2 px-1 text-sm font-medium ${
                isFirstTimeUser
                  ? 'cursor-not-allowed border-transparent text-gray-600 opacity-50'
                  : activeTab === 'home'
                  ? 'border-orange-400 text-orange-300'
                  : 'border-transparent text-gray-400 hover:border-gray-300 hover:text-gray-300'
              }`}
            >
              Home
            </button>
            <button
              onClick={() => {
                if (!isFirstTimeUser) {
                  setActiveTab('recommended');
                  setActiveLibraryId(allLibraries[0]?.key || '');
                }
              }}
              disabled={isFirstTimeUser}
              className={`border-b-2 py-2 px-1 text-sm font-medium ${
                isFirstTimeUser
                  ? 'cursor-not-allowed border-transparent text-gray-600 opacity-50'
                  : activeTab === 'recommended'
                  ? 'border-orange-400 text-orange-300'
                  : 'border-transparent text-gray-400 hover:border-gray-300 hover:text-gray-300'
              }`}
            >
              Recommended
            </button>
            <button
              onClick={() => {
                if (!isFirstTimeUser) {
                  setActiveTab('library');
                  setActiveLibraryId(allLibraries[0]?.key || '');
                }
              }}
              disabled={isFirstTimeUser}
              className={`border-b-2 py-2 px-1 text-sm font-medium ${
                isFirstTimeUser
                  ? 'cursor-not-allowed border-transparent text-gray-600 opacity-50'
                  : activeTab === 'library'
                  ? 'border-orange-400 text-orange-300'
                  : 'border-transparent text-gray-400 hover:border-gray-300 hover:text-gray-300'
              }`}
            >
              Library
            </button>
          </nav>

          {/* Ordering Explanation */}
          <div className="bg-stone-800/30 px-4 py-2 text-center text-xs text-gray-500">
            Collections in <strong>Home & Recommended</strong> share the same
            ordering (controls Plex home screen position), while{' '}
            <strong>Library</strong> has independent ordering for library tabs.
          </div>
        </div>
      )}

      {/* Toggle control for hiding/showing inactive collections - only show when collections are present */}
      {(localCollectionConfigs.length > 0 ||
        localHubConfigs.length > 0 ||
        localPreExistingConfigs.length > 0) && (
        <div className="flex items-center justify-between border-b border-gray-700 bg-stone-800/20 px-4 py-2">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-400">
              {hideInactiveCollections ? 'Showing Active only' : 'Showing All'}
            </span>
          </div>
          <button
            onClick={() => {
              setHideInactiveCollections(!hideInactiveCollections);
              // Hide the help when user clicks the button
              if (showInactiveHelp) {
                setShowInactiveHelp(false);
              }
            }}
            className={`relative rounded px-3 py-1 text-xs font-medium transition-colors ${
              hideInactiveCollections
                ? 'bg-orange-600 text-white hover:bg-orange-700'
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
            }`}
          >
            {hideInactiveCollections ? 'Show All' : 'Show Active only'}

            {/* Helper text for inactive collection added */}
            {showInactiveHelp && hideInactiveCollections && (
              <div className="absolute right-full top-1/2 z-50 mr-3 -translate-y-1/2 transform">
                <div className="relative animate-pulse whitespace-nowrap rounded-lg border border-orange-500 bg-orange-900/95 px-3 py-1 text-sm text-orange-100 shadow-sm">
                  <span className="font-semibold">
                    Click here to see inactive Collections
                  </span>
                  {/* Arrow pointing to the button */}
                  <div className="absolute left-full top-1/2 h-0 w-0 -translate-y-1/2 transform border-t-4 border-b-4 border-l-4 border-t-transparent border-b-transparent border-l-orange-500"></div>
                </div>
              </div>
            )}
          </button>
        </div>
      )}

      {/* Library Tabs for Recommended and Library tabs */}
      {(activeTab === 'recommended' || activeTab === 'library') && (
        <div className="border-b border-gray-700">
          <nav className="-mb-px flex space-x-8">
            {allLibraries.map((library: Library) => {
              const libraryCollections =
                collectionsByLibrary.get(library.key) || [];
              const libraryHubs = hubsByLibrary.get(library.key) || [];
              const libraryPreExisting =
                preExistingByLibrary.get(library.key) || [];
              const hasConfigs =
                libraryCollections.length > 0 ||
                libraryHubs.length > 0 ||
                libraryPreExisting.length > 0;

              return (
                <button
                  key={library.key}
                  onClick={() => setActiveLibraryId(library.key)}
                  disabled={!hasConfigs}
                  className={`border-b-2 py-2 px-1 text-sm font-medium ${
                    activeLibraryId === library.key
                      ? 'border-orange-400 text-orange-300'
                      : hasConfigs
                      ? 'border-transparent text-gray-400 hover:border-gray-300 hover:text-gray-300'
                      : 'cursor-not-allowed border-transparent text-gray-600'
                  }`}
                >
                  {library.name}
                  {hasConfigs && (
                    <span className="ml-1 text-sm text-gray-500">
                      (
                      {libraryCollections.length +
                        libraryHubs.length +
                        libraryPreExisting.length}
                      )
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* Content based on active tab */}
      {librariesError ? (
        <div className="py-8 text-center">
          <p className="text-red-400">
            Failed to load Plex libraries. Please check your Plex connection.
          </p>
        </div>
      ) : libraries.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-gray-400">Loading Plex libraries...</p>
        </div>
      ) : allLibraryIds.size === 0 ? (
        <div className="py-8 text-center">
          <p className="text-gray-400">
            No Collections found. Click Discover to get started!
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {activeTab === 'home' ? (
            // Home/Inactive tabs: Show all libraries with relevant configs
            allLibraries.map((library: Library) => {
              const libraryCollections =
                collectionsByLibrary.get(library.key) || [];
              const libraryHubs = hubsByLibrary.get(library.key) || [];
              const libraryPreExisting =
                preExistingByLibrary.get(library.key) || [];

              // Always show library header, even when empty

              return (
                <LibraryCollectionGroup
                  key={library.key}
                  library={library}
                  collections={libraryCollections}
                  hubs={libraryHubs}
                  preExisting={libraryPreExisting}
                  onEditCollection={editCollectionConfig}
                  onEditHub={editHubConfig}
                  onEditPreExisting={editPreExistingConfig}
                  onDelete={deleteCollectionConfig}
                  onHide={handleHideConfig}
                  onPromote={handlePromoteCollection}
                  onDemote={handleDemoteCollection}
                  onReorderItems={handleReorderItems}
                  badgeClickCount={badgeClickCount}
                  setBadgeClickCount={setBadgeClickCount}
                  checkForUnlockSequence={checkForUnlockSequence}
                  activeTab={activeTab}
                />
              );
            })
          ) : // Recommended/Library tabs: Show only the selected library
          activeLibraryId && allLibraryIds.has(activeLibraryId) ? (
            <LibraryCollectionGroup
              key={activeLibraryId}
              library={
                allLibraries.find(
                  (lib: Library) => lib.key === activeLibraryId
                ) || {
                  key: activeLibraryId,
                  name: 'Unknown Library',
                  type: 'movie',
                }
              }
              collections={collectionsByLibrary.get(activeLibraryId) || []}
              hubs={hubsByLibrary.get(activeLibraryId) || []}
              preExisting={preExistingByLibrary.get(activeLibraryId) || []}
              onEditCollection={editCollectionConfig}
              onEditHub={editHubConfig}
              onEditPreExisting={editPreExistingConfig}
              onDelete={deleteCollectionConfig}
              onHide={handleHideConfig}
              onPromote={handlePromoteCollection}
              onDemote={handleDemoteCollection}
              onReorderItems={handleReorderItems}
              badgeClickCount={badgeClickCount}
              setBadgeClickCount={setBadgeClickCount}
              checkForUnlockSequence={checkForUnlockSequence}
              activeTab={activeTab}
            />
          ) : (
            <div className="py-8 text-center">
              <p className="text-gray-400">
                {activeTab === 'recommended'
                  ? 'No recommended collections found for this library.'
                  : 'No collections found for this library.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Bottom Sync Button */}
      {(localCollectionConfigs.length > 0 || localHubConfigs.length > 0) && (
        <div className="mt-8 flex items-center justify-end space-x-4">
          <GlobalSyncStatus
            isStarting={syncStarting}
            onSyncStart={(refreshFn) => setRefreshSyncStatus(() => refreshFn)}
            onSyncComplete={revalidateAll}
          />
          <Button
            buttonType="primary"
            onClick={syncCollections}
            disabled={syncing || isFirstTimeUser}
            className={`flex items-center space-x-2 px-6 py-3 ${
              isFirstTimeUser
                ? 'pointer-events-none cursor-not-allowed opacity-30'
                : ''
            }`}
          >
            <ArrowPathIcon
              className={`h-5 w-5 ${syncing ? 'animate-spin' : ''}`}
            />
            <span>{syncing ? 'Syncing...' : 'Sync Collections'}</span>
          </Button>
        </div>
      )}

      {/* Collection/Hub Configuration Form Modal */}
      {showConfigForm && editingConfig && (
        <CollectionConfigForm
          config={editingConfig}
          libraries={libraries}
          onSave={saveCollectionConfig}
          onCancel={() => {
            setShowConfigForm(false);
            setEditingConfig(null);
          }}
          onUnlink={unlinkCollectionConfig}
          onLink={linkCollectionConfig}
          allCollectionConfigs={localCollectionConfigs}
          allHubConfigs={localHubConfigs}
        />
      )}

      {/* Hub Configuration Form Modal */}
      {showHubForm && editingHubConfig && (
        <CollectionConfigForm
          config={editingHubConfig}
          onSave={saveHubConfig}
          onCancel={closeHubModal}
          libraries={libraries}
        />
      )}

      {/* Pre-existing Collection Configuration Form Modal */}
      {showPreExistingForm && editingPreExistingConfig && (
        <CollectionConfigForm
          config={editingPreExistingConfig}
          onSave={savePreExistingConfig}
          onCancel={closePreExistingModal}
          libraries={libraries}
        />
      )}
    </div>
  );
};

export default CollectionSettings;
