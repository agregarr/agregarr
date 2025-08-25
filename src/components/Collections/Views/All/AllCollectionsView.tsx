import HomeStarIcon from '@app/assets/icons/homeWithStar.svg';
import LibraryBookmarkIcon from '@app/assets/icons/libraryRecommended.svg';
import ThreeHomesIcon from '@app/assets/icons/threeHomes.svg';
import CollectionConfigForm from '@app/components/Collections/Forms/CollectionConfigForm';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useCollectionEdit } from '@app/hooks/collections/useCollectionEdit';
import type { CollectionFormConfig, Library } from '@app/types/collections';
import {
  ArrowPathIcon,
  CheckIcon,
  FunnelIcon,
  LinkIcon,
  LinkSlashIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type {
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import axios from 'axios';
import type React from 'react';
import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  allCollectionsTitle: 'All Collections',
  allCollectionsDescription:
    'Complete list of all Agregarr Collections, Default Plex Hubs, and Pre-existing Collections.',
  loading: 'Loading collections...',
  noCollections: 'No collections found.',
  agregarrCollections: 'Agregarr Collections',
  plexHubs: 'Plex Hubs',
  preExistingCollections: 'Pre-existing Collections',
  totalCollections: '{count} total collections',
  allTypes: 'All Types',
  allLibraries: 'All Libraries',
  nameAZ: 'Name (A-Z)',
  nameZA: 'Name (Z-A)',
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

  // Sorting state
  const [sortType, setSortType] = useState<string>('name-asc');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterLibrary, setFilterLibrary] = useState<string>('all');

  // Fetch data from separate APIs for consistency with CollectionSettings
  const { data: collectionData, error: collectionError } = useSWR(
    '/api/v1/collections'
  );
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
          Error Loading Collections
        </h3>
        <p className="mt-2 text-gray-500">
          Failed to load collection data. Please try refreshing the page.
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

  // Helper component for horizontal split icons
  const HorizontalSplitIcon = ({
    Icon,
    activeState,
    inactiveState,
    title,
  }: {
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    activeState: boolean;
    inactiveState: boolean;
    title: string;
  }) => (
    <div className="relative isolate h-5 w-5" title={title}>
      {/* Background icon (inactive state) */}
      <Icon
        className={`absolute inset-0 h-5 w-5 ${
          inactiveState ? 'text-gray-400' : 'text-gray-600 opacity-30'
        }`}
      />
      {/* Top half mask for active state */}
      <div className="absolute inset-0 isolate overflow-hidden">
        <div
          className="absolute inset-0 bg-stone-900"
          style={{
            clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)',
          }}
        />
        <Icon
          className={`absolute inset-0 h-5 w-5 ${
            activeState ? 'text-gray-400' : 'text-gray-600 opacity-30'
          }`}
          style={{
            clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)',
          }}
        />
      </div>
    </div>
  );

  const getVisibilityIcons = (
    visibilityConfig?: {
      usersHome?: boolean;
      serverOwnerHome?: boolean;
      libraryRecommended?: boolean;
    },
    timeRestriction?: {
      alwaysActive: boolean;
      inactiveVisibilityConfig?: {
        usersHome: boolean;
        serverOwnerHome: boolean;
        libraryRecommended: boolean;
      };
    }
  ) => {
    const hasTimeRestriction = timeRestriction && !timeRestriction.alwaysActive;

    // Default to false if no visibilityConfig
    const activeVisibility = visibilityConfig || {
      usersHome: false,
      serverOwnerHome: false,
      libraryRecommended: false,
    };
    const inactiveVisibility = timeRestriction?.inactiveVisibilityConfig || {
      usersHome: false,
      serverOwnerHome: false,
      libraryRecommended: false,
    };

    return (
      <div className="flex w-20 items-center space-x-1">
        {/* Server Owner Home icon - fixed position */}
        <div
          className="flex h-5 w-5 items-center justify-center"
          title={
            hasTimeRestriction
              ? `Server Owner Home - Active: ${
                  activeVisibility.serverOwnerHome ? 'On' : 'Off'
                }, Inactive: ${
                  inactiveVisibility.serverOwnerHome ? 'On' : 'Off'
                }`
              : `Server Owner Home - ${
                  activeVisibility.serverOwnerHome ? 'On' : 'Off'
                }`
          }
        >
          {hasTimeRestriction ? (
            <HorizontalSplitIcon
              Icon={HomeStarIcon}
              activeState={Boolean(activeVisibility.serverOwnerHome)}
              inactiveState={Boolean(inactiveVisibility.serverOwnerHome)}
              title=""
            />
          ) : (
            <HomeStarIcon
              className={`h-5 w-5 flex-shrink-0 ${
                activeVisibility.serverOwnerHome
                  ? 'text-gray-400'
                  : 'text-gray-600 opacity-30'
              }`}
            />
          )}
        </div>

        {/* Users Home icon - fixed position */}
        <div
          className="flex h-5 w-5 items-center justify-center"
          title={
            hasTimeRestriction
              ? `Users Home - Active: ${
                  activeVisibility.usersHome ? 'On' : 'Off'
                }, Inactive: ${inactiveVisibility.usersHome ? 'On' : 'Off'}`
              : `Users Home - ${activeVisibility.usersHome ? 'On' : 'Off'}`
          }
        >
          {hasTimeRestriction ? (
            <HorizontalSplitIcon
              Icon={ThreeHomesIcon}
              activeState={Boolean(activeVisibility.usersHome)}
              inactiveState={Boolean(inactiveVisibility.usersHome)}
              title=""
            />
          ) : (
            <ThreeHomesIcon
              className={`h-5 w-5 ${
                activeVisibility.usersHome
                  ? 'text-gray-400'
                  : 'text-gray-600 opacity-30'
              }`}
            />
          )}
        </div>

        {/* Library Recommended icon - fixed position */}
        <div
          className="flex h-5 w-5 items-center justify-center"
          title={
            hasTimeRestriction
              ? `Library Recommended - Active: ${
                  activeVisibility.libraryRecommended ? 'On' : 'Off'
                }, Inactive: ${
                  inactiveVisibility.libraryRecommended ? 'On' : 'Off'
                }`
              : `Library Recommended - ${
                  activeVisibility.libraryRecommended ? 'On' : 'Off'
                }`
          }
        >
          {hasTimeRestriction ? (
            <HorizontalSplitIcon
              Icon={LibraryBookmarkIcon}
              activeState={Boolean(activeVisibility.libraryRecommended)}
              inactiveState={Boolean(inactiveVisibility.libraryRecommended)}
              title=""
            />
          ) : (
            <LibraryBookmarkIcon
              className={`h-5 w-5 ${
                activeVisibility.libraryRecommended
                  ? 'text-gray-400'
                  : 'text-gray-600 opacity-30'
              }`}
            />
          )}
        </div>
      </div>
    );
  };

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
        ...(preExistingConfig.timeRestriction && {
          timeRestriction: preExistingConfig.timeRestriction,
        }),
        ...(preExistingConfig.customPoster && {
          customPoster: preExistingConfig.customPoster,
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
          <p className="text-sm text-gray-400">
            {intl.formatMessage(messages.totalCollections, {
              count: filteredAndSortedCollections.length,
            })}
            {allCollections.length !== filteredAndSortedCollections.length && (
              <span className="text-gray-500"> of {allCollections.length}</span>
            )}
          </p>

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
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="type">Type</option>
              <option value="library">Library</option>
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

            if (isCollection && collection.originalConfig) {
              const config = collection.originalConfig as CollectionFormConfig;
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
                        {collection.name || 'Unnamed Collection'}
                      </h5>
                    </div>

                    {/* Enhanced Badges - native type specific badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Library Badge */}
                      <Badge
                        badgeType="default"
                        className="!border !border-gray-500 !bg-transparent text-xs !text-gray-300"
                      >
                        {collection.libraryName}
                      </Badge>

                      {/* Collection Type Badge - Removed for Agregarr collections */}
                      {isHub && (
                        <Badge
                          badgeType="default"
                          className="!bg-gray-600/20 text-xs !text-gray-300"
                        >
                          Plex Default
                        </Badge>
                      )}
                      {isPreExisting && (
                        <Badge
                          badgeType="default"
                          className="!border !border-orange-500 !bg-gray-600/20 text-xs !text-gray-300"
                        >
                          Pre-Existing
                        </Badge>
                      )}

                      {/* Enhanced Source & Subtype Badge (for regular collections only) */}
                      {isCollection &&
                        collection.originalConfig &&
                        (() => {
                          const config =
                            collection.originalConfig as CollectionFormConfig;
                          if (!config.type) return null;

                          const getSubtypeLabel = (
                            type: string,
                            subtype?: string
                          ): string => {
                            if (!subtype) return '';

                            switch (type) {
                              case 'trakt':
                                switch (subtype) {
                                  case 'trending':
                                    return 'Trending';
                                  case 'popular':
                                    return 'Popular';
                                  case 'played':
                                    return 'Most Played';
                                  case 'watched':
                                    return 'Most Watched';
                                  case 'collected':
                                    return 'Most Collected';
                                  case 'favorited':
                                    return 'Most Favorited';
                                  case 'boxoffice':
                                    return 'Box Office';
                                  case 'custom':
                                    return 'Custom List';
                                  case 'watched_daily':
                                    return 'Watched Daily';
                                  case 'watched_weekly':
                                    return 'Watched Weekly';
                                  case 'watched_monthly':
                                    return 'Watched Monthly';
                                  case 'watched_all':
                                    return 'Most Watched All Time';
                                  case 'played_daily':
                                    return 'Played Daily';
                                  case 'played_weekly':
                                    return 'Played Weekly';
                                  case 'played_monthly':
                                    return 'Played Monthly';
                                  case 'played_all':
                                    return 'Most Played All Time';
                                  case 'collected_daily':
                                    return 'Collected Daily';
                                  case 'collected_weekly':
                                    return 'Collected Weekly';
                                  case 'collected_monthly':
                                    return 'Collected Monthly';
                                  case 'collected_all':
                                    return 'Most Collected All Time';
                                  default:
                                    return subtype
                                      .replace(/_/g, ' ')
                                      .replace(/\b\w/g, (l) => l.toUpperCase());
                                }
                              case 'tmdb':
                                switch (subtype) {
                                  case 'trending_day':
                                    return 'Trending Today';
                                  case 'trending_week':
                                    return 'Trending This Week';
                                  case 'popular':
                                    return 'Popular';
                                  case 'top_rated':
                                    return 'Top Rated';
                                  case 'custom':
                                    return 'Custom Collection';
                                  default:
                                    return subtype;
                                }
                              case 'imdb':
                                switch (subtype) {
                                  case 'top_250':
                                    return 'Top 250';
                                  case 'popular':
                                    return 'Popular';
                                  case 'most_popular':
                                    return 'Most Popular';
                                  case 'custom':
                                    return 'Custom List';
                                  default:
                                    return subtype;
                                }
                              case 'overseerr':
                                switch (subtype) {
                                  case 'users':
                                    return 'Individual Users';
                                  case 'server_owner':
                                    return 'Server Owner';
                                  case 'global':
                                    return 'All Requests';
                                  default:
                                    return subtype;
                                }
                              case 'tautulli':
                                switch (subtype) {
                                  case 'most_popular_plays':
                                    return 'Most Popular (Plays)';
                                  case 'most_popular_duration':
                                    return 'Most Popular (Duration)';
                                  default:
                                    return subtype;
                                }
                              case 'letterboxd':
                                switch (subtype) {
                                  case 'custom':
                                    return 'Custom List';
                                  default:
                                    return subtype;
                                }
                              default:
                                return subtype;
                            }
                          };

                          const typeLabel =
                            config.type === 'trakt'
                              ? 'Trakt'
                              : config.type === 'tmdb'
                              ? 'TMDb'
                              : config.type === 'imdb'
                              ? 'IMDb'
                              : config.type === 'letterboxd'
                              ? 'Letterboxd'
                              : config.type === 'tautulli'
                              ? 'Tautulli'
                              : config.type === 'overseerr'
                              ? 'Overseerr'
                              : config.type || '';

                          const subtypeLabel = getSubtypeLabel(
                            config.type || '',
                            config.subtype
                          );
                          const displayText = subtypeLabel
                            ? `${typeLabel} - ${subtypeLabel}`
                            : typeLabel;

                          return (
                            <Badge
                              badgeType="primary"
                              className="!bg-opacity-60 text-xs"
                            >
                              {displayText}
                            </Badge>
                          );
                        })()}

                      {/* Missing Items Badge - Shows when grab missing is enabled for collections */}
                      {isCollection &&
                        collection.originalConfig &&
                        (() => {
                          const config =
                            collection.originalConfig as CollectionFormConfig;
                          const hasGrabMissing =
                            config.searchMissingMovies ||
                            config.searchMissingTV;
                          return hasGrabMissing ? (
                            <Badge
                              badgeType="default"
                              className="!bg-opacity-30"
                            >
                              Grab Missing Items
                            </Badge>
                          ) : null;
                        })()}

                      {/* Time Restrictions Badge */}
                      {timeRestriction && !timeRestriction.alwaysActive && (
                        <Badge badgeType="default" className="!bg-opacity-30">
                          Time Restrictions Set
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions - new ordered layout */}
                <div className="flex items-center space-x-2">
                  {/* Visibility icons */}
                  {getVisibilityIcons(visibilityConfig, timeRestriction)}

                  {/* Sync Status - Three-state system */}
                  <div className="flex w-12 justify-center">
                    {collection.needsSync ? (
                      <ArrowPathIcon
                        className="h-4 w-4 text-red-400"
                        title="Needs Sync - Collection has been modified and needs to be synced to Plex"
                      />
                    ) : collection.isActive ? (
                      <CheckIcon
                        className="h-4 w-4 text-gray-400"
                        title="Synced and Active - Collection is up to date and currently active"
                      />
                    ) : (
                      <XMarkIcon
                        className="h-4 w-4 text-gray-400"
                        title="Inactive - Collection is disabled by time restrictions"
                      />
                    )}
                  </div>

                  {/* Link icon - fixed space for consistent spacing */}
                  <div className="flex w-6 justify-center">
                    {isUnlinked ? (
                      // Show unlink icon for deliberately unlinked collections
                      <LinkSlashIcon
                        className="h-4 w-4 text-gray-400"
                        title={
                          isHub
                            ? 'Unlinked Hub - was deliberately unlinked from group'
                            : 'Unlinked Collection - was deliberately unlinked from group'
                        }
                      />
                    ) : isLinked ? (
                      // Show active link icon for linked collections
                      <LinkIcon
                        className="h-4 w-4 text-gray-400"
                        title={
                          isHub
                            ? 'Linked Hub - applies to all compatible libraries'
                            : 'Linked Collection - applies to all compatible libraries'
                        }
                      />
                    ) : (
                      // Show shaded link icon for unlinked collections (false state)
                      <LinkIcon
                        className="h-4 w-4 text-gray-600 opacity-30"
                        title={
                          isHub
                            ? 'Hub not linked to other libraries'
                            : 'Collection not linked to other libraries'
                        }
                      />
                    )}
                  </div>

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
        />
      )}

      {/* Hub Configuration Modal */}
      {showHubForm && editingHubConfig && (
        <CollectionConfigForm
          config={editingHubConfig}
          onSave={saveHubConfig}
          onCancel={closeHubModal}
          libraries={libraries}
        />
      )}

      {/* Pre-existing Configuration Modal */}
      {showPreExistingForm && editingPreExistingConfig && (
        <CollectionConfigForm
          config={editingPreExistingConfig}
          onSave={savePreExistingConfig}
          onCancel={closePreExistingModal}
          libraries={libraries}
        />
      )}
    </>
  );
};

export default AllCollectionsView;
