import type {
  CollectionFormConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@app/types/collections';
import type { AddToast } from 'react-toast-notifications';
import { saveIndividualConfigs } from './apiHandlers';

interface LinkingHandlersParams {
  localCollectionConfigs: CollectionFormConfig[];
  localHubConfigs: PlexHubConfig[];
  setLocalCollectionConfigs: (configs: CollectionFormConfig[]) => void;
  setLocalHubConfigs: (configs: PlexHubConfig[]) => void;
  revalidateAll: () => void;
  addToast: AddToast;
  saveCollectionConfigs: (
    configs: CollectionFormConfig[],
    suppressNotification?: boolean
  ) => Promise<void>;
}

export const linkCollectionConfig = async (
  config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig,
  params: LinkingHandlersParams
) => {
  const {
    localCollectionConfigs,
    localHubConfigs,
    setLocalCollectionConfigs,
    setLocalHubConfigs,
    revalidateAll,
    addToast,
    saveCollectionConfigs,
  } = params;

  try {
    if ((config as CollectionFormConfig).configType === 'hub') {
      // Handle hub linking - find other hubs with same base identifier that could be linked
      const currentHub = localHubConfigs.find(
        (h: PlexHubConfig) => h.id === config.id
      );
      if (!currentHub) return;

      // Hubs must have a valid linkId to be linkable (prevent undefined === undefined matching ALL hubs)
      if (currentHub.linkId === undefined) {
        addToast(
          'This hub does not have a link group ID. Please run hub discovery to enable linking.',
          {
            autoDismiss: true,
            appearance: 'warning',
          }
        );
        return;
      }

      const eligibleHubs = localHubConfigs.filter(
        (h: PlexHubConfig) =>
          h.linkId !== undefined && // Must have a valid linkId (prevent undefined === undefined)
          h.linkId === currentHub.linkId && // Same linkId group (established during discovery)
          h.id !== config.id &&
          !h.isLinked // Only link hubs that aren't already linked
        // Note: We don't exclude isUnlinked hubs - those can be relinked!
      );

      if (eligibleHubs.length === 0) {
        addToast('No other unlinked hubs found in the same group to link to.', {
          autoDismiss: true,
          appearance: 'info',
        });
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
            isUnlinked: false, // Clear any unlinked flag (use false instead of undefined so it survives JSON.stringify)
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
            directDownloadRadarrServerId:
              masterConfig.directDownloadRadarrServerId,
            directDownloadRadarrProfileId:
              masterConfig.directDownloadRadarrProfileId,
            directDownloadRadarrRootFolder:
              masterConfig.directDownloadRadarrRootFolder,
            directDownloadRadarrTags: masterConfig.directDownloadRadarrTags,
            directDownloadRadarrMonitor:
              masterConfig.directDownloadRadarrMonitor,
            directDownloadRadarrSearchOnAdd:
              masterConfig.directDownloadRadarrSearchOnAdd,
            directDownloadSonarrServerId:
              masterConfig.directDownloadSonarrServerId,
            directDownloadSonarrProfileId:
              masterConfig.directDownloadSonarrProfileId,
            directDownloadSonarrRootFolder:
              masterConfig.directDownloadSonarrRootFolder,
            directDownloadSonarrTags: masterConfig.directDownloadSonarrTags,
            directDownloadSonarrMonitor:
              masterConfig.directDownloadSonarrMonitor,
            directDownloadSonarrSearchOnAdd:
              masterConfig.directDownloadSonarrSearchOnAdd,
            overseerrRadarrServerId: masterConfig.overseerrRadarrServerId,
            overseerrRadarrProfileId: masterConfig.overseerrRadarrProfileId,
            overseerrRadarrRootFolder: masterConfig.overseerrRadarrRootFolder,
            overseerrRadarrTags: masterConfig.overseerrRadarrTags,
            overseerrSonarrServerId: masterConfig.overseerrSonarrServerId,
            overseerrSonarrProfileId: masterConfig.overseerrSonarrProfileId,
            overseerrSonarrRootFolder: masterConfig.overseerrSonarrRootFolder,
            overseerrSonarrTags: masterConfig.overseerrSonarrTags,
            searchMissingMovies: masterConfig.searchMissingMovies,
            searchMissingTV: masterConfig.searchMissingTV,
            autoApproveMovies: masterConfig.autoApproveMovies,
            autoApproveTV: masterConfig.autoApproveTV,
            maxSeasonsToRequest: masterConfig.maxSeasonsToRequest,
            seasonsPerShowLimit: masterConfig.seasonsPerShowLimit,
            seasonGrabOrder: masterConfig.seasonGrabOrder,
            maxPositionToProcess: masterConfig.maxPositionToProcess,
            minimumYear: masterConfig.minimumYear,
            minimumImdbRating: masterConfig.minimumImdbRating,
            minimumRottenTomatoesRating:
              masterConfig.minimumRottenTomatoesRating,
            excludedGenres: masterConfig.excludedGenres,
            excludedCountries: masterConfig.excludedCountries,
            excludedLanguages: masterConfig.excludedLanguages,
            filterSettings: masterConfig.filterSettings,
            excludeFromCollections: masterConfig.excludeFromCollections,
            timeRestriction: masterConfig.timeRestriction,
            traktCustomListUrl: masterConfig.traktCustomListUrl,
            tmdbCustomCollectionUrl: masterConfig.tmdbCustomCollectionUrl,
            imdbCustomListUrl: masterConfig.imdbCustomListUrl,
            letterboxdCustomListUrl: masterConfig.letterboxdCustomListUrl,
            sortOrder: masterConfig.sortOrder,
            customPoster: masterConfig.customPoster,
            useTmdbFranchisePoster: masterConfig.useTmdbFranchisePoster,
            hideIndividualItems: masterConfig.hideIndividualItems,
            applyOverlaysDuringSync: masterConfig.applyOverlaysDuringSync,
            showUnwatchedOnly: masterConfig.showUnwatchedOnly,
            smartCollectionSort: masterConfig.smartCollectionSort,
            randomizeHomeOrder: masterConfig.randomizeHomeOrder,
            customWallpaper: masterConfig.customWallpaper,
            customSummary: masterConfig.customSummary,
            customTheme: masterConfig.customTheme,
            enableCustomWallpaper: masterConfig.enableCustomWallpaper,
            enableCustomSummary: masterConfig.enableCustomSummary,
            enableCustomTheme: masterConfig.enableCustomTheme,
            mediaType: masterConfig.mediaType,
            customDays: masterConfig.customDays,
            createPlaceholdersForMissing:
              masterConfig.createPlaceholdersForMissing,
            placeholderDaysAhead: masterConfig.placeholderDaysAhead,
            placeholderReleasedDays: masterConfig.placeholderReleasedDays,
            tautulliStatType: masterConfig.tautulliStatType,
            isMultiSource: masterConfig.isMultiSource,
            sources: masterConfig.sources,
            combineMode: masterConfig.combineMode,
            // Set link status
            isLinked: true,
            isUnlinked: false, // Clear any unlinked flag (use false instead of undefined so it survives JSON.stringify)
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

export const unlinkCollectionConfig = async (
  config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig,
  params: LinkingHandlersParams
) => {
  const {
    localCollectionConfigs,
    localHubConfigs,
    setLocalCollectionConfigs,
    setLocalHubConfigs,
    revalidateAll,
    addToast,
    saveCollectionConfigs,
  } = params;

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
