import BulkEditModal from '@app/components/Collections/BulkEditModal';
import CollectionConfigForm from '@app/components/Collections/Forms/CollectionConfigForm';
import {
  CustomSyncScheduleBadge,
  getVisibilityIcons,
  LibraryBadge,
  LinkIcon as CollectionLinkIcon,
  MissingIndicator,
  MissingItemsBadge,
  PlaceholdersBadge,
  PlexDefaultBadge,
  PreExistingBadge,
  SourceSubtypeBadge,
  SyncStatus,
  TimeRestrictionsBadge,
  UnwatchedBadge,
} from '@app/components/Collections/Shared/CollectionBadges';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useCollectionEdit } from '@app/hooks/collections/useCollectionEdit';
import type { CollectionFormConfig, Library } from '@app/types/collections';
import {
  linkCollectionConfig,
  unlinkCollectionConfig,
} from '@app/utils/collections/linkingHandlers';
import {
  FunnelIcon,
  PencilIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type {
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import axios from 'axios';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

const messages = defineMessages({
  allCollectionsTitle: 'All Collections',
  allCollectionsDescription:
    'Complete list of all Agregarr Collections, Default Plex Hubs, and Pre-existing Collections.',
  noCollections: 'No collections found.',
  agregarrCollections: 'Agregarr Collections',
  plexHubs: 'Plex Hubs',
  preExistingCollections: 'Pre-existing Collections',
  totalCollections: '{count} total collections',
  allTypes: 'All Types',
  allLibraries: 'All Libraries',
  nameAZ: 'Name (A-Z)',
  nameZA: 'Name (Z-A)',
  bulkEdit: 'Bulk Edit',
  errorLoadingCollections: 'Error Loading Collections',
  errorLoadingDescription:
    'Failed to load collection data. Please try refreshing the page.',
  ofTotal: 'of {total}',
  sortType: 'Type',
  sortLibrary: 'Library',
  titleWillUpdate: 'Title will be updated on Collection Sync',
});

// Interfaces for clean collection data display - no conversion needed
interface DisplayCollection {
  id: string;
  name: string;
  type: 'collection' | 'hub' | 'preExisting';
  libraryName?: string;
  mediaType?: string;
  isActive?: boolean;
  needsSync?: boolean;
  originalConfig:
    | CollectionFormConfig
    | PlexHubConfig
    | PreExistingCollectionConfig;
  configType: 'collection' | 'hub' | 'preExisting';
}

const AllCollectionsView: React.FC = () => {
  const intl = useIntl();
  const { addToast } = useToasts();

  // Use the shared collection edit hook for collections only
  const {
    showConfigForm: showCollectionForm,
    editingConfig: editingCollectionConfig,
    openEditModal: openCollectionModal,
    closeEditModal: closeCollectionModal,
    saveCollectionConfig,
    deleteCollectionConfig,
  } = useCollectionEdit();

  // Separate form state for hubs and pre-existing collections
  const [showHubForm, setShowHubForm] = useState(false);
  const [editingHubConfig, setEditingHubConfig] =
    useState<PlexHubConfig | null>(null);
  const [showPreExistingForm, setShowPreExistingForm] = useState(false);
  const [editingPreExistingConfig, setEditingPreExistingConfig] =
    useState<PreExistingCollectionConfig | null>(null);

  // Bulk edit modal state
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);

  // Sorting state
  const [sortType, setSortType] = useState<string>('name-asc');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterLibrary, setFilterLibrary] = useState<string>('all');

  // Fetch data from separate APIs for consistency with CollectionSettings
  const {
    data: collectionData,
    error: collectionError,
    mutate: revalidateCollections,
  } = useSWR('/api/v1/collections');
  const { data: libraries = [], error: librariesError } = useSWR(
    '/api/v1/settings/plex/libraries'
  );
  const {
    data: hubConfigs,
    error: hubError,
    mutate: revalidateDefaultHubs,
  } = useSWR('/api/v1/defaulthubs');
  const {
    data: preExistingConfigs,
    error: preExistingError,
    mutate: revalidatePreExisting,
  } = useSWR('/api/v1/preexisting');

  // Local state for linking operations
  const [localCollectionConfigs, setLocalCollectionConfigs] = useState<
    CollectionFormConfig[]
  >([]);
  const [localHubConfigs, setLocalHubConfigs] = useState<PlexHubConfig[]>([]);

  // Update local state when data changes
  useEffect(() => {
    if (collectionData?.collectionConfigs) {
      setLocalCollectionConfigs(collectionData.collectionConfigs);
    }
    if (hubConfigs) {
      setLocalHubConfigs(hubConfigs);
    }
  }, [collectionData, hubConfigs]);

  // Revalidate all data sources
  const revalidateAll = () => {
    revalidateCollections();
    revalidateDefaultHubs();
    revalidatePreExisting();
  };

  // Wrapper for saveCollectionConfig to match linking handler signature
  const saveCollectionConfigs = async (configs: CollectionFormConfig[]) => {
    // Save each config individually
    for (const config of configs) {
      await saveCollectionConfig(config);
    }
  };

  const isLoading =
    !collectionData || !libraries || !hubConfigs || !preExistingConfigs;
  const hasError =
    collectionError || librariesError || hubError || preExistingError;

  // Work with native types directly - no conversion needed
  const allCollections = useMemo((): DisplayCollection[] => {
    if (!collectionData || !libraries || !hubConfigs || !preExistingConfigs)
      return [];

    const collections: DisplayCollection[] = [];

    // 1. Agregarr Collections (native CollectionFormConfig)
    const collectionConfigs: CollectionFormConfig[] =
      collectionData.collectionConfigs || [];
    collectionConfigs.forEach((config: CollectionFormConfig) => {
      if (config.libraryId) {
        const library = libraries.find(
          (lib: Library) => lib.key === config.libraryId
        );
        collections.push({
          id: `collection-${config.id}`,
          name: config.name,
          type: 'collection',
          configType: 'collection',
          libraryName: config.libraryName || library?.name || 'Unknown Library',
          mediaType: config.mediaType || 'mixed',
          isActive: config.isActive,
          needsSync: config.needsSync,
          originalConfig: config,
        });
      }
    });

    // 2. Hub Configs (native PlexHubConfig) - no deduplication needed, APIs are separated
    hubConfigs.forEach((hubConfig: PlexHubConfig) => {
      const library = libraries.find(
        (lib: Library) => lib.key === hubConfig.libraryId
      );

      collections.push({
        id: `hub-${hubConfig.id}`,
        name: hubConfig.name || hubConfig.hubIdentifier,
        type: 'hub',
        configType: 'hub',
        libraryName:
          hubConfig.libraryName || library?.name || 'Unknown Library',
        mediaType: hubConfig.mediaType || library?.type || 'mixed',
        isActive: hubConfig.isActive,
        needsSync: hubConfig.needsSync,
        originalConfig: hubConfig,
      });
    });

    // 3. Pre-existing Collections (native PreExistingCollectionConfig)
    const preExistingConfigsArray = preExistingConfigs || [];
    preExistingConfigsArray.forEach(
      (preExistingConfig: PreExistingCollectionConfig) => {
        const library = libraries.find(
          (lib: Library) => lib.key === preExistingConfig.libraryId
        );

        collections.push({
          id: `preExisting-${preExistingConfig.id}`,
          name: preExistingConfig.name,
          type: 'preExisting',
          configType: 'preExisting',
          libraryName:
            preExistingConfig.libraryName || library?.name || 'Unknown Library',
          mediaType: preExistingConfig.mediaType || 'mixed',
          isActive: preExistingConfig.isActive,
          needsSync: preExistingConfig.needsSync,
          originalConfig: preExistingConfig,
        });
      }
    );

    return collections;
  }, [collectionData, libraries, hubConfigs, preExistingConfigs]);

  // Get unique libraries for filter dropdown
  const uniqueLibraries = useMemo(() => {
    const librarySet = new Set(
      allCollections.map((c) => c.libraryName).filter(Boolean)
    );
    return Array.from(librarySet).sort();
  }, [allCollections]);

  // Apply filtering and sorting
  const filteredAndSortedCollections = useMemo(() => {
    let filtered = [...allCollections];

    // Apply filters - update filter values to match new types
    if (filterType !== 'all') {
      filtered = filtered.filter((c) => {
        if (filterType === 'agregarr') return c.type === 'collection';
        if (filterType === 'hub') return c.type === 'hub';
        if (filterType === 'preexisting') return c.type === 'preExisting';
        return c.type === filterType;
      });
    }

    if (filterLibrary !== 'all') {
      filtered = filtered.filter((c) => c.libraryName === filterLibrary);
    }

    // Apply sorting
    switch (sortType) {
      case 'name-asc':
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return filtered.sort((a, b) => b.name.localeCompare(a.name));
      case 'type':
        return filtered.sort((a, b) => {
          if (a.type !== b.type) return a.type.localeCompare(b.type);
          return a.name.localeCompare(b.name);
        });
      case 'library':
        return filtered.sort((a, b) => {
          const libA = a.libraryName || '';
          const libB = b.libraryName || '';
          if (libA !== libB) return libA.localeCompare(libB);
          return a.name.localeCompare(b.name);
        });
      default:
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [allCollections, filterType, filterLibrary, sortType]);

  if (hasError) {
    return (
      <div className="text-center">
        <h3 className="text-lg font-medium text-red-400">
          {intl.formatMessage(messages.errorLoadingCollections)}
        </h3>
        <p className="mt-2 text-gray-500">
          {intl.formatMessage(messages.errorLoadingDescription)}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.allCollectionsTitle)} />
        <div className="mb-8">
          <h3 className="heading text-white">
            {intl.formatMessage(messages.allCollectionsTitle)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.allCollectionsDescription)}
          </p>
        </div>
        <LoadingSpinner />
      </>
    );
  }

  const handleDelete = async (collection: DisplayCollection) => {
    if (collection.type === 'collection' && collection.originalConfig) {
      const config = collection.originalConfig as CollectionFormConfig;
      if (config.id) {
        await deleteCollectionConfig(config.id);
      }
    } else if (collection.type === 'hub' && collection.originalConfig) {
      // Hide hub by setting all visibility to false
      const config = collection.originalConfig as PlexHubConfig;
      const updatedConfig = {
        ...config,
        visibilityConfig: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
      };
      try {
        await axios.put(
          `/api/v1/defaulthubs/${updatedConfig.id}/settings`,
          updatedConfig
        );
        revalidateDefaultHubs();
      } catch (error) {
        console.error('Failed to hide hub:', error); // eslint-disable-line no-console
      }
    } else if (collection.type === 'preExisting' && collection.originalConfig) {
      // Hide pre-existing collection by setting all visibility to false
      const config = collection.originalConfig as PreExistingCollectionConfig;
      const updatedConfig = {
        ...config,
        visibilityConfig: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
      };
      try {
        await axios.put(
          `/api/v1/preexisting/${updatedConfig.id}/settings`,
          updatedConfig
        );
        revalidatePreExisting();
      } catch (error) {
        console.error('Failed to hide pre-existing collection:', error); // eslint-disable-line no-console
      }
    }
  };

  // Direct edit handlers for each type - no conversion needed
  const handleEdit = (collection: DisplayCollection) => {
    if (collection.configType === 'collection') {
      openCollectionModal(collection.originalConfig as CollectionFormConfig);
    } else if (collection.configType === 'hub') {
      setEditingHubConfig(collection.originalConfig as PlexHubConfig);
      setShowHubForm(true);
    } else if (collection.configType === 'preExisting') {
      setEditingPreExistingConfig(
        collection.originalConfig as PreExistingCollectionConfig
      );
      setShowPreExistingForm(true);
    }
  };

  // Save handlers for each type
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
      // Revalidate data
      revalidateDefaultHubs();
    } catch (error) {
      console.error('Failed to save hub config:', error); // eslint-disable-line no-console
    }
    setShowHubForm(false);
    setEditingHubConfig(null);
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
      // Revalidate data
      revalidatePreExisting();
    } catch (error) {
      console.error('Failed to save pre-existing config:', error); // eslint-disable-line no-console
    }
    setShowPreExistingForm(false);
    setEditingPreExistingConfig(null);
  };

  const closeHubModal = () => {
    setShowHubForm(false);
    setEditingHubConfig(null);
  };

  const closePreExistingModal = () => {
    setShowPreExistingForm(false);
    setEditingPreExistingConfig(null);
  };

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.allCollectionsTitle)} />
      <div className="mb-8">
        <h3 className="heading text-white">
          {intl.formatMessage(messages.allCollectionsTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.allCollectionsDescription)}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              buttonType="primary"
              buttonSize="sm"
              onClick={() => setShowBulkEditModal(true)}
            >
              <PencilSquareIcon className="mr-1 h-4 w-4" />
              {intl.formatMessage(messages.bulkEdit)}
            </Button>
            <p className="text-sm text-gray-400">
              {intl.formatMessage(messages.totalCollections, {
                count: filteredAndSortedCollections.length,
              })}
              {allCollections.length !==
                filteredAndSortedCollections.length && (
                <span className="text-gray-500">
                  {' '}
                  {intl.formatMessage(messages.ofTotal, {
                    total: allCollections.length,
                  })}
                </span>
              )}
            </p>
          </div>

          {/* Sorting and Filtering Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <FunnelIcon className="h-4 w-4 text-gray-400" />

            {/* Collection Type Filter */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-md border border-gray-600 bg-stone-700 px-3 py-1 text-sm text-white focus:border-orange-400 focus:ring-2 focus:ring-orange-400"
            >
              <option value="all">
                {intl.formatMessage(messages.allTypes)}
              </option>
              <option value="agregarr">
                {intl.formatMessage(messages.agregarrCollections)}
              </option>
              <option value="hub">
                {intl.formatMessage(messages.plexHubs)}
              </option>
              <option value="preexisting">
                {intl.formatMessage(messages.preExistingCollections)}
              </option>
            </select>

            {/* Library Filter */}
            <select
              value={filterLibrary}
              onChange={(e) => setFilterLibrary(e.target.value)}
              className="rounded-md border border-gray-600 bg-stone-700 px-3 py-1 text-sm text-white focus:border-orange-400 focus:ring-2 focus:ring-orange-400"
            >
              <option value="all">
                {intl.formatMessage(messages.allLibraries)}
              </option>
              {uniqueLibraries.map((library) => (
                <option key={library} value={library}>
                  {library}
                </option>
              ))}
            </select>

            {/* Sort Options */}
            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value)}
              className="rounded-md border border-gray-600 bg-stone-700 px-3 py-1 text-sm text-white focus:border-orange-400 focus:ring-2 focus:ring-orange-400"
            >
              <option value="name-asc">
                {intl.formatMessage(messages.nameAZ)}
              </option>
              <option value="name-desc">
                {intl.formatMessage(messages.nameZA)}
              </option>
              <option value="type">
                {intl.formatMessage(messages.sortType)}
              </option>
              <option value="library">
                {intl.formatMessage(messages.sortLibrary)}
              </option>
            </select>
          </div>
        </div>
      </div>

      {filteredAndSortedCollections.length === 0 ? (
        <div className="py-12 text-center">
          <h3 className="text-lg font-medium text-gray-400">
            {intl.formatMessage(messages.noCollections)}
          </h3>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAndSortedCollections.map((collection) => {
            const isHub = collection.type === 'hub';
            const isCollection = collection.type === 'collection';
            const isPreExisting = collection.type === 'preExisting';

            // Handle different config types - work with native types directly
            let visibilityConfig:
              | {
                  usersHome?: boolean;
                  serverOwnerHome?: boolean;
                  libraryRecommended?: boolean;
                }
              | undefined = undefined;
            let timeRestriction:
              | {
                  alwaysActive: boolean;
                  inactiveVisibilityConfig?: {
                    usersHome: boolean;
                    serverOwnerHome: boolean;
                    libraryRecommended: boolean;
                  };
                }
              | undefined = undefined;
            let isLinked = false;
            let isUnlinked = false;

            let originalCollectionConfig: CollectionFormConfig | undefined;

            if (isCollection && collection.originalConfig) {
              const config = collection.originalConfig as CollectionFormConfig;
              originalCollectionConfig = config;
              visibilityConfig = config.visibilityConfig;
              timeRestriction = config.timeRestriction;
              isLinked = Boolean(config.isLinked);
              isUnlinked = Boolean(config.isUnlinked);
            } else if ((isHub || isPreExisting) && collection.originalConfig) {
              const config = collection.originalConfig as
                | PlexHubConfig
                | PreExistingCollectionConfig;
              visibilityConfig = config.visibilityConfig;
              timeRestriction = config.timeRestriction;
              isLinked = Boolean(config.isLinked); // Check actual linking status from backend
              isUnlinked = Boolean(config.isUnlinked);
            }

            return (
              <div
                key={collection.id}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-stone-900/60 px-3 py-2 transition-all hover:bg-stone-900/80"
              >
                <div className="flex flex-1 items-center space-x-3">
                  <div className="flex-1">
                    <div className="mb-2">
                      <h5 className="text-base font-medium text-white">
                        {collection.name === 'DYNAMIC_RANDOM_TITLE' ? (
                          <em>
                            {intl.formatMessage(messages.titleWillUpdate)}
                          </em>
                        ) : isCollection &&
                          originalCollectionConfig?.type === 'plex' &&
                          (originalCollectionConfig?.subtype === 'directors' ||
                            originalCollectionConfig?.subtype === 'actors') ? (
                          originalCollectionConfig?.subtype === 'actors' ? (
                            'Auto Actor Collections'
                          ) : (
                            'Auto Director Collections'
                          )
                        ) : isCollection &&
                          originalCollectionConfig?.type === 'tmdb' &&
                          originalCollectionConfig?.subtype ===
                            'auto_franchise' ? (
                          'Auto Franchise Collections'
                        ) : (
                          collection.name || 'Unnamed Collection'
                        )}
                      </h5>
                    </div>

                    {/* Enhanced Badges - native type specific badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Library Badge */}
                      <LibraryBadge
                        libraryName={collection.libraryName || ''}
                      />

                      {/* Collection Type Badge - Removed for Agregarr collections */}
                      {isHub && <PlexDefaultBadge />}
                      {isPreExisting && <PreExistingBadge withBorder={true} />}

                      {/* Enhanced Source & Subtype Badge (for regular collections only) */}
                      {isCollection &&
                        collection.originalConfig &&
                        (collection.originalConfig as CollectionFormConfig)
                          .type && (
                          <SourceSubtypeBadge
                            type={
                              (
                                collection.originalConfig as CollectionFormConfig
                              ).type || ''
                            }
                            subtype={
                              (
                                collection.originalConfig as CollectionFormConfig
                              ).subtype
                            }
                          />
                        )}

                      {/* Missing Items Badge - Shows when grab missing is enabled for collections */}
                      {isCollection && collection.originalConfig && (
                        <MissingItemsBadge
                          searchMissingMovies={
                            (collection.originalConfig as CollectionFormConfig)
                              .searchMissingMovies
                          }
                          searchMissingTV={
                            (collection.originalConfig as CollectionFormConfig)
                              .searchMissingTV
                          }
                        />
                      )}

                      {/* Placeholders Badge - Shows when create placeholders is enabled for collections */}
                      {isCollection && collection.originalConfig && (
                        <PlaceholdersBadge
                          createPlaceholdersForMissing={
                            (collection.originalConfig as CollectionFormConfig)
                              .createPlaceholdersForMissing
                          }
                        />
                      )}

                      {/* Time Restrictions Badge */}
                      <TimeRestrictionsBadge
                        timeRestriction={timeRestriction}
                      />

                      {/* Custom Sync Schedule Badge (only for Agregarr collections) */}
                      {isCollection && (
                        <CustomSyncScheduleBadge
                          customSyncSchedule={
                            (collection.originalConfig as CollectionFormConfig)
                              .customSyncSchedule
                          }
                        />
                      )}

                      {/* Unwatched Badge (shows when showUnwatchedOnly is enabled) */}
                      {isCollection && (
                        <UnwatchedBadge
                          showUnwatchedOnly={
                            (collection.originalConfig as CollectionFormConfig)
                              .showUnwatchedOnly
                          }
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions - new ordered layout */}
                <div className="flex items-center space-x-2">
                  {/* Missing indicator - shown when collection no longer exists in Plex */}
                  <MissingIndicator
                    missing={collection.originalConfig.missing}
                    configType={collection.configType}
                  />

                  {/* Visibility icons */}
                  {getVisibilityIcons(visibilityConfig, timeRestriction)}

                  {/* Sync Status - Three-state system */}
                  <SyncStatus
                    needsSync={collection.needsSync}
                    isActive={collection.isActive}
                  />

                  {/* Link icon - fixed space for consistent spacing */}
                  <CollectionLinkIcon
                    isLinked={isLinked}
                    isUnlinked={isUnlinked}
                    configType={collection.configType}
                  />

                  <Button
                    buttonType="ghost"
                    buttonSize="sm"
                    onClick={() => handleEdit(collection)}
                    className="text-orange-400 hover:text-orange-300"
                  >
                    <PencilIcon className={isHub ? 'h-3 w-3' : 'h-4 w-4'} />
                  </Button>

                  {isCollection ? (
                    // Full delete for Agregarr collections
                    <ConfirmButton
                      confirmText="Delete"
                      buttonSize="sm"
                      className="text-red-500 hover:bg-red-600 hover:text-white"
                      onClick={() => handleDelete(collection)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </ConfirmButton>
                  ) : (
                    // Hide button for hubs and pre-existing collections
                    <ConfirmButton
                      confirmText="Hide"
                      buttonSize="sm"
                      buttonType="primary"
                      onClick={() => handleDelete(collection)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </ConfirmButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Collection Configuration Modal */}
      {showCollectionForm && editingCollectionConfig && (
        <CollectionConfigForm
          config={editingCollectionConfig}
          onSave={saveCollectionConfig}
          onCancel={closeCollectionModal}
          libraries={libraries}
          onUnlink={(config) =>
            unlinkCollectionConfig(config, {
              localCollectionConfigs:
                collectionData?.collectionConfigs || localCollectionConfigs,
              localHubConfigs: hubConfigs || localHubConfigs,
              setLocalCollectionConfigs,
              setLocalHubConfigs,
              revalidateAll,
              addToast,
              saveCollectionConfigs,
            })
          }
          onLink={(config) =>
            linkCollectionConfig(config, {
              localCollectionConfigs:
                collectionData?.collectionConfigs || localCollectionConfigs,
              localHubConfigs: hubConfigs || localHubConfigs,
              setLocalCollectionConfigs,
              setLocalHubConfigs,
              revalidateAll,
              addToast,
              saveCollectionConfigs,
            })
          }
          allCollectionConfigs={collectionData?.collectionConfigs || []}
          allHubConfigs={hubConfigs || []}
        />
      )}

      {/* Hub Configuration Modal */}
      {showHubForm && editingHubConfig && (
        <CollectionConfigForm
          config={editingHubConfig}
          onSave={saveHubConfig}
          onCancel={closeHubModal}
          libraries={libraries}
          onUnlink={(config) =>
            unlinkCollectionConfig(config, {
              localCollectionConfigs:
                collectionData?.collectionConfigs || localCollectionConfigs,
              localHubConfigs: hubConfigs || localHubConfigs,
              setLocalCollectionConfigs,
              setLocalHubConfigs,
              revalidateAll,
              addToast,
              saveCollectionConfigs,
            })
          }
          onLink={(config) =>
            linkCollectionConfig(config, {
              localCollectionConfigs:
                collectionData?.collectionConfigs || localCollectionConfigs,
              localHubConfigs: hubConfigs || localHubConfigs,
              setLocalCollectionConfigs,
              setLocalHubConfigs,
              revalidateAll,
              addToast,
              saveCollectionConfigs,
            })
          }
          allCollectionConfigs={collectionData?.collectionConfigs || []}
          allHubConfigs={hubConfigs || []}
        />
      )}

      {/* Pre-existing Configuration Modal */}
      {showPreExistingForm && editingPreExistingConfig && (
        <CollectionConfigForm
          config={editingPreExistingConfig}
          onSave={savePreExistingConfig}
          onCancel={closePreExistingModal}
          libraries={libraries}
          onUnlink={(config) =>
            unlinkCollectionConfig(config, {
              localCollectionConfigs:
                collectionData?.collectionConfigs || localCollectionConfigs,
              localHubConfigs: hubConfigs || localHubConfigs,
              setLocalCollectionConfigs,
              setLocalHubConfigs,
              revalidateAll,
              addToast,
              saveCollectionConfigs,
            })
          }
          onLink={(config) =>
            linkCollectionConfig(config, {
              localCollectionConfigs:
                collectionData?.collectionConfigs || localCollectionConfigs,
              localHubConfigs: hubConfigs || localHubConfigs,
              setLocalCollectionConfigs,
              setLocalHubConfigs,
              revalidateAll,
              addToast,
              saveCollectionConfigs,
            })
          }
          allCollectionConfigs={collectionData?.collectionConfigs || []}
          allHubConfigs={hubConfigs || []}
        />
      )}

      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <BulkEditModal
          collections={collectionData?.collectionConfigs || []}
          hubs={hubConfigs || []}
          preExisting={preExistingConfigs || []}
          onClose={() => setShowBulkEditModal(false)}
          onSave={revalidateAll}
        />
      )}
    </>
  );
};

export default AllCollectionsView;
