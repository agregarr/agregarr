import type {
  CollectionFormConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@app/types/collections';
import axios from 'axios';

// Helper function to save individual configs using individual endpoints
export const saveIndividualConfigs = async (
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
        isLinked: preExistingConfig.isLinked,
        linkId: preExistingConfig.linkId,
        isUnlinked: preExistingConfig.isUnlinked,
        ...(preExistingConfig.titleSort && {
          titleSort: preExistingConfig.titleSort,
        }),
        ...(preExistingConfig.randomizeHomeOrder !== undefined && {
          randomizeHomeOrder: preExistingConfig.randomizeHomeOrder,
        }),
        ...(preExistingConfig.everLibraryPromoted !== undefined && {
          everLibraryPromoted: preExistingConfig.everLibraryPromoted,
        }),
        ...(preExistingConfig.isPromotedToHub !== undefined && {
          isPromotedToHub: preExistingConfig.isPromotedToHub,
        }),
        ...(preExistingConfig.timeRestriction && {
          timeRestriction: preExistingConfig.timeRestriction,
        }),
        ...(preExistingConfig.customPoster && {
          customPoster: preExistingConfig.customPoster,
        }),
        ...(preExistingConfig.autoPoster !== undefined && {
          autoPoster: preExistingConfig.autoPoster,
        }),
        ...(preExistingConfig.autoPosterTemplate !== undefined && {
          autoPosterTemplate: preExistingConfig.autoPosterTemplate,
        }),
        ...(preExistingConfig.customWallpaper && {
          customWallpaper: preExistingConfig.customWallpaper,
        }),
        ...(preExistingConfig.customSummary && {
          customSummary: preExistingConfig.customSummary,
        }),
        ...(preExistingConfig.customTheme && {
          customTheme: preExistingConfig.customTheme,
        }),
        ...(preExistingConfig.enableCustomWallpaper !== undefined && {
          enableCustomWallpaper: preExistingConfig.enableCustomWallpaper,
        }),
        ...(preExistingConfig.enableCustomSummary !== undefined && {
          enableCustomSummary: preExistingConfig.enableCustomSummary,
        }),
        ...(preExistingConfig.enableCustomTheme !== undefined && {
          enableCustomTheme: preExistingConfig.enableCustomTheme,
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
        isLinked: hubConfig.isLinked,
        linkId: hubConfig.linkId,
        isUnlinked: hubConfig.isUnlinked,
        ...(hubConfig.randomizeHomeOrder !== undefined && {
          randomizeHomeOrder: hubConfig.randomizeHomeOrder,
        }),
        ...(hubConfig.everLibraryPromoted !== undefined && {
          everLibraryPromoted: hubConfig.everLibraryPromoted,
        }),
        ...(hubConfig.isPromotedToHub !== undefined && {
          isPromotedToHub: hubConfig.isPromotedToHub,
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
        isLinked: collectionConfig.isLinked,
        linkId: collectionConfig.linkId,
        ...(collectionConfig.customDays !== undefined && {
          customDays: collectionConfig.customDays,
        }),
        ...(collectionConfig.createPlaceholdersForMissing !== undefined && {
          createPlaceholdersForMissing:
            collectionConfig.createPlaceholdersForMissing,
        }),
        ...(collectionConfig.placeholderDaysAhead !== undefined && {
          placeholderDaysAhead: collectionConfig.placeholderDaysAhead,
        }),
        ...(collectionConfig.placeholderReleasedDays !== undefined && {
          placeholderReleasedDays: collectionConfig.placeholderReleasedDays,
        }),
        ...(collectionConfig.includeAllReleasedItems !== undefined && {
          includeAllReleasedItems: collectionConfig.includeAllReleasedItems,
        }),
        ...(collectionConfig.tautulliStatType && {
          tautulliStatType: collectionConfig.tautulliStatType,
        }),
        ...(collectionConfig.minimumPlays !== undefined && {
          minimumPlays: collectionConfig.minimumPlays,
        }),
        ...(collectionConfig.downloadMode && {
          downloadMode: collectionConfig.downloadMode,
        }),
        ...(collectionConfig.directDownloadRadarrServerId !== undefined && {
          directDownloadRadarrServerId:
            collectionConfig.directDownloadRadarrServerId,
        }),
        ...(collectionConfig.directDownloadRadarrProfileId !== undefined && {
          directDownloadRadarrProfileId:
            collectionConfig.directDownloadRadarrProfileId,
        }),
        ...(collectionConfig.directDownloadRadarrRootFolder !== undefined && {
          directDownloadRadarrRootFolder:
            collectionConfig.directDownloadRadarrRootFolder,
        }),
        ...(collectionConfig.directDownloadSonarrServerId !== undefined && {
          directDownloadSonarrServerId:
            collectionConfig.directDownloadSonarrServerId,
        }),
        ...(collectionConfig.directDownloadSonarrProfileId !== undefined && {
          directDownloadSonarrProfileId:
            collectionConfig.directDownloadSonarrProfileId,
        }),
        ...(collectionConfig.directDownloadSonarrRootFolder !== undefined && {
          directDownloadSonarrRootFolder:
            collectionConfig.directDownloadSonarrRootFolder,
        }),
        ...(collectionConfig.directDownloadRadarrTags !== undefined && {
          directDownloadRadarrTags: collectionConfig.directDownloadRadarrTags,
        }),
        ...(collectionConfig.directDownloadRadarrMonitor !== undefined && {
          directDownloadRadarrMonitor:
            collectionConfig.directDownloadRadarrMonitor,
        }),
        ...(collectionConfig.directDownloadRadarrSearchOnAdd !== undefined && {
          directDownloadRadarrSearchOnAdd:
            collectionConfig.directDownloadRadarrSearchOnAdd,
        }),
        ...(collectionConfig.directDownloadSonarrTags !== undefined && {
          directDownloadSonarrTags: collectionConfig.directDownloadSonarrTags,
        }),
        ...(collectionConfig.directDownloadSonarrMonitor !== undefined && {
          directDownloadSonarrMonitor:
            collectionConfig.directDownloadSonarrMonitor,
        }),
        ...(collectionConfig.directDownloadSonarrMonitorType !== undefined && {
          directDownloadSonarrMonitorType:
            collectionConfig.directDownloadSonarrMonitorType,
        }),
        ...(collectionConfig.directDownloadSonarrSearchOnAdd !== undefined && {
          directDownloadSonarrSearchOnAdd:
            collectionConfig.directDownloadSonarrSearchOnAdd,
        }),
        ...(collectionConfig.overseerrRadarrServerId !== undefined && {
          overseerrRadarrServerId: collectionConfig.overseerrRadarrServerId,
        }),
        ...(collectionConfig.overseerrRadarrProfileId !== undefined && {
          overseerrRadarrProfileId: collectionConfig.overseerrRadarrProfileId,
        }),
        ...(collectionConfig.overseerrRadarrRootFolder !== undefined && {
          overseerrRadarrRootFolder: collectionConfig.overseerrRadarrRootFolder,
        }),
        ...(collectionConfig.overseerrSonarrServerId !== undefined && {
          overseerrSonarrServerId: collectionConfig.overseerrSonarrServerId,
        }),
        ...(collectionConfig.overseerrSonarrProfileId !== undefined && {
          overseerrSonarrProfileId: collectionConfig.overseerrSonarrProfileId,
        }),
        ...(collectionConfig.overseerrSonarrRootFolder !== undefined && {
          overseerrSonarrRootFolder: collectionConfig.overseerrSonarrRootFolder,
        }),
        ...(collectionConfig.overseerrRadarrTags !== undefined && {
          overseerrRadarrTags: collectionConfig.overseerrRadarrTags,
        }),
        ...(collectionConfig.overseerrSonarrTags !== undefined && {
          overseerrSonarrTags: collectionConfig.overseerrSonarrTags,
        }),
        ...(collectionConfig.comingSoonRadarrServerId !== undefined && {
          comingSoonRadarrServerId: collectionConfig.comingSoonRadarrServerId,
        }),
        ...(collectionConfig.comingSoonSonarrServerId !== undefined && {
          comingSoonSonarrServerId: collectionConfig.comingSoonSonarrServerId,
        }),
        ...(collectionConfig.comingSoonFilterByTags !== undefined && {
          comingSoonFilterByTags: collectionConfig.comingSoonFilterByTags,
        }),
        ...(collectionConfig.comingSoonTagMode !== undefined && {
          comingSoonTagMode: collectionConfig.comingSoonTagMode,
        }),
        ...(collectionConfig.comingSoonRadarrTagIds !== undefined && {
          comingSoonRadarrTagIds: collectionConfig.comingSoonRadarrTagIds,
        }),
        ...(collectionConfig.comingSoonSonarrTagIds !== undefined && {
          comingSoonSonarrTagIds: collectionConfig.comingSoonSonarrTagIds,
        }),
        ...(collectionConfig.isMultiSource !== undefined && {
          isMultiSource: collectionConfig.isMultiSource,
        }),
        ...(collectionConfig.sources !== undefined && {
          sources: collectionConfig.sources,
        }),
        ...(collectionConfig.combineMode !== undefined && {
          combineMode: collectionConfig.combineMode,
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
        ...(collectionConfig.seasonGrabOrder && {
          seasonGrabOrder: collectionConfig.seasonGrabOrder,
        }),
        ...(collectionConfig.maxPositionToProcess !== undefined && {
          maxPositionToProcess: collectionConfig.maxPositionToProcess,
        }),
        ...(collectionConfig.minimumYear !== undefined && {
          minimumYear: collectionConfig.minimumYear,
        }),
        ...(collectionConfig.minimumImdbRating !== undefined && {
          minimumImdbRating: collectionConfig.minimumImdbRating,
        }),
        ...(collectionConfig.minimumRottenTomatoesRating !== undefined && {
          minimumRottenTomatoesRating:
            collectionConfig.minimumRottenTomatoesRating,
        }),
        ...(collectionConfig.minimumRottenTomatoesAudienceRating !==
          undefined && {
          minimumRottenTomatoesAudienceRating:
            collectionConfig.minimumRottenTomatoesAudienceRating,
        }),
        ...(collectionConfig.filterSettings !== undefined && {
          filterSettings: collectionConfig.filterSettings,
        }),
        ...(collectionConfig.excludeFromCollections !== undefined && {
          excludeFromCollections: collectionConfig.excludeFromCollections,
        }),
        ...(collectionConfig.traktCustomListUrl && {
          traktCustomListUrl: collectionConfig.traktCustomListUrl,
        }),
        ...(collectionConfig.tmdbCustomCollectionUrl && {
          tmdbCustomCollectionUrl: collectionConfig.tmdbCustomCollectionUrl,
        }),
        ...(collectionConfig.imdbCustomListUrl && {
          imdbCustomListUrl: collectionConfig.imdbCustomListUrl,
        }),
        ...(collectionConfig.letterboxdCustomListUrl && {
          letterboxdCustomListUrl: collectionConfig.letterboxdCustomListUrl,
        }),
        ...(collectionConfig.sortOrder && {
          sortOrder: collectionConfig.sortOrder,
        }),
        ...(collectionConfig.collectionType && {
          collectionType: collectionConfig.collectionType,
        }),
        isUnlinked: collectionConfig.isUnlinked,
        ...(collectionConfig.hubIdentifier && {
          hubIdentifier: collectionConfig.hubIdentifier,
        }),
        ...(collectionConfig.customPoster && {
          customPoster: collectionConfig.customPoster,
        }),
        autoPoster: collectionConfig.autoPoster ?? true,
        ...(collectionConfig.autoPosterTemplate !== undefined && {
          autoPosterTemplate: collectionConfig.autoPosterTemplate,
        }),
        ...(collectionConfig.useTmdbFranchisePoster !== undefined && {
          useTmdbFranchisePoster: collectionConfig.useTmdbFranchisePoster,
        }),
        ...(collectionConfig.hideIndividualItems !== undefined && {
          hideIndividualItems: collectionConfig.hideIndividualItems,
        }),
        ...(collectionConfig.applyOverlaysDuringSync !== undefined && {
          applyOverlaysDuringSync: collectionConfig.applyOverlaysDuringSync,
        }),
        ...(collectionConfig.showUnwatchedOnly !== undefined && {
          showUnwatchedOnly: collectionConfig.showUnwatchedOnly,
        }),
        ...(collectionConfig.smartCollectionSort !== undefined && {
          smartCollectionSort: collectionConfig.smartCollectionSort,
        }),
        ...(collectionConfig.randomizeHomeOrder !== undefined && {
          randomizeHomeOrder: collectionConfig.randomizeHomeOrder,
        }),
        ...(collectionConfig.customWallpaper && {
          customWallpaper: collectionConfig.customWallpaper,
        }),
        ...(collectionConfig.customSummary && {
          customSummary: collectionConfig.customSummary,
        }),
        ...(collectionConfig.customTheme && {
          customTheme: collectionConfig.customTheme,
        }),
        ...(collectionConfig.enableCustomWallpaper !== undefined && {
          enableCustomWallpaper: collectionConfig.enableCustomWallpaper,
        }),
        ...(collectionConfig.enableCustomSummary !== undefined && {
          enableCustomSummary: collectionConfig.enableCustomSummary,
        }),
        ...(collectionConfig.enableCustomTheme !== undefined && {
          enableCustomTheme: collectionConfig.enableCustomTheme,
        }),
        ...(collectionConfig.customSyncSchedule && {
          customSyncSchedule: collectionConfig.customSyncSchedule,
        }),
        ...(collectionConfig.timeRestriction && {
          timeRestriction: collectionConfig.timeRestriction,
        }),
      };
      await axios.put(`/api/v1/collections/${config.id}/settings`, payload);
    }
  }
};
