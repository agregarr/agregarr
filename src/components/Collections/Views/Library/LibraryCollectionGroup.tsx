import {
  CustomSyncScheduleBadge,
  getVisibilityIcons,
  ItemCountBadge,
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
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import type {
  CollectionFormConfig,
  FormConfigType,
  Library,
} from '@app/types/collections';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Bars3Icon,
  LockClosedIcon,
  PencilIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import type {
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@server/lib/settings';
import { ArrowsCrossingIcon } from '@sidekickicons/react/24/solid';
import axios from 'axios';
import React, { useEffect, useMemo, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

// Frontend collection promotion utilities
function isLibraryPromoted(
  collection: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
): boolean {
  // Check the isLibraryPromoted flag on each collection type
  return collection.isLibraryPromoted === true;
}

function findPromotedDividerIndex(
  allConfigs: {
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig;
    type: 'collection' | 'hub' | 'preExisting';
    sortOrder: number;
  }[]
): number {
  // Find the first collection that is not promoted (first A-Z collection)
  return allConfigs.findIndex(({ config }) => !isLibraryPromoted(config));
}

// Alphabetical divider component
const AlphabeticalDivider: React.FC = () => (
  <div className="my-4 flex items-center opacity-60">
    <div className="h-px flex-grow bg-gray-300 dark:bg-gray-600"></div>
    <span className="px-3 text-sm font-medium text-gray-500 dark:text-gray-400">
      <FormattedMessage
        id="collections.library.alphabetical_divider"
        defaultMessage="A-Z Collections"
      />
    </span>
    <div className="h-px flex-grow bg-gray-300 dark:bg-gray-600"></div>
  </div>
);

interface LibraryCollectionGroupProps {
  library: Library;
  collections: CollectionFormConfig[];
  hubs: PlexHubConfig[];
  preExisting: PreExistingCollectionConfig[];
  onEditCollection: (config: CollectionFormConfig) => void;
  onEditHub: (config: PlexHubConfig) => void;
  onEditPreExisting: (config: PreExistingCollectionConfig) => void;
  onDelete: (configId: string) => Promise<void>;
  onHide: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  onPromoteCollection?: (config: CollectionFormConfig) => Promise<void>;
  onDemoteCollection?: (config: CollectionFormConfig) => Promise<void>;
  onPromotePreExisting?: (config: PreExistingCollectionConfig) => Promise<void>;
  onDemotePreExisting?: (config: PreExistingCollectionConfig) => Promise<void>;
  onReorderItems: (
    libraryId: string,
    mixedItems: ((
      | CollectionFormConfig
      | PlexHubConfig
      | PreExistingCollectionConfig
    ) & { configType: FormConfigType; position: number })[],
    itemTypeName: string
  ) => Promise<void>;
  badgeClickCount: number;
  setBadgeClickCount: (value: number | ((prev: number) => number)) => void;
  checkForUnlockSequence: () => void;
  activeTab: 'home' | 'recommended' | 'library' | 'inactive' | 'unmanaged';
  onBulkEdit?: () => void;
}

// SortableItem component for individual collection items - now handles multiple config types
interface SortableItemProps {
  config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig;
  configType: 'collection' | 'hub' | 'preExisting';
  onEditCollection?: (config: CollectionFormConfig) => void;
  onEditHub?: (config: PlexHubConfig) => void;
  onEditPreExisting?: (config: PreExistingCollectionConfig) => void;
  onDelete: (configId: string) => Promise<void>;
  onHide: (
    config: CollectionFormConfig | PlexHubConfig | PreExistingCollectionConfig
  ) => void;
  onPromoteCollection?: (config: CollectionFormConfig) => Promise<void>;
  onDemoteCollection?: (config: CollectionFormConfig) => Promise<void>;
  onPromotePreExisting?: (config: PreExistingCollectionConfig) => Promise<void>;
  onDemotePreExisting?: (config: PreExistingCollectionConfig) => Promise<void>;
  setBadgeClickCount: (value: number | ((prev: number) => number)) => void;
  checkForUnlockSequence: () => void;
  activeTab: 'home' | 'recommended' | 'library' | 'inactive' | 'unmanaged';
  onIndividualSync?: (collectionId: string) => Promise<void>;
  isSyncing?: boolean;
}

const SortableItem = ({
  config,
  configType,
  onEditCollection,
  onEditHub,
  onEditPreExisting,
  onDelete,
  onHide,
  onPromoteCollection,
  onDemoteCollection,
  onPromotePreExisting,
  onDemotePreExisting,
  setBadgeClickCount,
  checkForUnlockSequence,
  activeTab,
  onIndividualSync,
  isSyncing,
}: SortableItemProps) => {
  const isHub = configType === 'hub';
  const isPreExisting = configType === 'preExisting';
  const isCollection = configType === 'collection';

  // Check actual linking status for all config types
  const isLinked = Boolean(config.isLinked);
  const isUnlinked = Boolean(config.isUnlinked);

  // Check if this item should be greyed out in Recommended tab
  // Items are greyed out if they're visible in Home tab (ordering controlled there)
  const isGreyedInRecommended =
    activeTab === 'recommended' &&
    (config.visibilityConfig?.usersHome ||
      config.visibilityConfig?.serverOwnerHome);

  // Disable dragging for greyed out items and A-Z collections on Library tab
  const isDraggingDisabled =
    isGreyedInRecommended ||
    (activeTab === 'library' && !isLibraryPromoted(config));

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: (() => {
      if (configType === 'collection') {
        const collectionConfig = config as CollectionFormConfig;
        const libraryId = Array.isArray(collectionConfig.libraryId)
          ? collectionConfig.libraryId[0]
          : collectionConfig.libraryId || 'all';
        return `collection-${config.id}-${libraryId}`;
      } else if (configType === 'hub') {
        return `hub-${config.id}`;
      } else {
        return `preExisting-${config.id}`;
      }
    })(),
    disabled: isDraggingDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
  };
  // Unified styling for both hubs and collections, with greyed out state
  const getContainerClasses = () => {
    // Use same size for both, slightly smaller than original collections (px-3 py-3 instead of p-4)
    const baseClasses =
      'flex items-center justify-between rounded-lg border px-3 py-3 transition-all';

    if (isGreyedInRecommended) {
      // Greyed out state for items controlled in Home tab
      return `${baseClasses} border-gray-700 bg-stone-800/30 opacity-60`;
    }

    // Use consistent hub styling for both hubs and collections
    return `${baseClasses} border-gray-800 bg-stone-900/60 ${
      isDragging ? 'border-orange-500 bg-stone-800/60' : 'hover:bg-stone-900/80'
    }`;
  };

  return (
    <div ref={setNodeRef} style={style} className={getContainerClasses()}>
      <div className="flex flex-1 items-center space-x-3">
        {/* Drag Handle */}
        <div
          {...(isDraggingDisabled ? {} : attributes)}
          {...(isDraggingDisabled ? {} : listeners)}
          className={`flex h-5 w-5 items-center justify-center text-gray-400 ${
            isDraggingDisabled
              ? 'cursor-not-allowed opacity-50'
              : 'cursor-grab hover:text-gray-300 active:cursor-grabbing'
          }`}
        >
          {isDraggingDisabled ? (
            <LockClosedIcon className="h-4 w-4 text-gray-600" />
          ) : config.randomizeHomeOrder ? (
            <ArrowsCrossingIcon
              className="h-5 w-5"
              title="Position will be shuffled with other randomized collections during sync"
            />
          ) : (
            <Bars3Icon className="h-5 w-5" />
          )}
        </div>

        {/* Collection/Hub Info */}
        <div className="flex-1">
          <div className="mb-2 flex items-center">
            <h5 className="text-base font-medium text-white">
              {config.name === 'DYNAMIC_RANDOM_TITLE' ? (
                <em>Title will be updated on Collection Sync</em>
              ) : isCollection &&
                (config as CollectionFormConfig).type === 'tmdb' &&
                (config as CollectionFormConfig).subtype ===
                  'auto_franchise' ? (
                'Auto Franchise Collections'
              ) : isCollection &&
                (config as CollectionFormConfig).type === 'plex' &&
                ((config as CollectionFormConfig).subtype === 'directors' ||
                  (config as CollectionFormConfig).subtype === 'actors') ? (
                (config as CollectionFormConfig).subtype === 'actors' ? (
                  'Auto Actor Collections'
                ) : (
                  'Auto Director Collections'
                )
              ) : config.name === '{director}' || config.name === '{actor}' ? (
                config.name === '{actor}' ? (
                  'Auto Actor Collections'
                ) : (
                  'Auto Director Collections'
                )
              ) : (
                config.name || 'Unnamed Collection'
              )}
            </h5>
            {/* Greyed out indicator for Recommended tab - inline with title */}
            {isGreyedInRecommended && (
              <span className="ml-2 text-xs italic text-gray-500">
                Ordering controlled in Home tab
              </span>
            )}
            {configType === 'collection' &&
              (config as CollectionFormConfig).isExpandedConfig && (
                <Badge badgeType="warning" className="ml-2 !bg-opacity-40">
                  Auto-generated
                </Badge>
              )}
          </div>

          {/* Enhanced Badges - native type implementation */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Collection Type Badge - Removed for Agregarr collections */}
            {isHub && <PlexDefaultBadge />}
            {isPreExisting && <PreExistingBadge />}

            {/* Enhanced Source & Subtype Badge (for regular collections only) */}
            {isCollection && (config as CollectionFormConfig).type && (
              <SourceSubtypeBadge
                type={(config as CollectionFormConfig).type || ''}
                subtype={(config as CollectionFormConfig).subtype}
              />
            )}

            {/* Item Count Badge (only for Agregarr collections) */}
            {isCollection &&
              (() => {
                const collectionConfig = config as CollectionFormConfig;
                const maxItems = collectionConfig.maxItems;
                if (maxItems === undefined) return null;

                return (
                  <ItemCountBadge
                    maxItems={maxItems}
                    onBadgeClick={
                      maxItems === 69
                        ? () => {
                            setBadgeClickCount((prev) => {
                              const newCount = prev + 1;
                              if (newCount >= 10) {
                                checkForUnlockSequence();
                              }
                              return newCount;
                            });
                          }
                        : undefined
                    }
                  />
                );
              })()}

            {/* Missing Items Badge - Shows when grab missing is enabled for collections */}
            {isCollection && (
              <MissingItemsBadge
                searchMissingMovies={
                  (config as CollectionFormConfig).searchMissingMovies
                }
                searchMissingTV={
                  (config as CollectionFormConfig).searchMissingTV
                }
              />
            )}

            {/* Placeholders Badge - Shows when create placeholders is enabled for collections */}
            {isCollection && (
              <PlaceholdersBadge
                createPlaceholdersForMissing={
                  (config as CollectionFormConfig).createPlaceholdersForMissing
                }
              />
            )}

            {/* Time Restrictions Badge */}
            <TimeRestrictionsBadge timeRestriction={config.timeRestriction} />

            {/* Custom Sync Schedule Badge (only for Agregarr collections) */}
            {isCollection && (
              <CustomSyncScheduleBadge
                customSyncSchedule={
                  (config as CollectionFormConfig).customSyncSchedule
                }
              />
            )}

            {/* Unwatched Badge (shows when showUnwatchedOnly is enabled) */}
            {isCollection && (
              <UnwatchedBadge
                showUnwatchedOnly={
                  (config as CollectionFormConfig).showUnwatchedOnly
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Actions - new ordered layout */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Missing indicator - shown when collection no longer exists in Plex */}
        <MissingIndicator missing={config.missing} configType={configType} />

        {/* Visibility icons */}
        {getVisibilityIcons(config.visibilityConfig, config.timeRestriction)}

        {/* Sync Status - Three-state system */}
        <SyncStatus
          needsSync={config.needsSync}
          isActive={config.isActive}
          onIndividualSync={isCollection ? onIndividualSync : undefined}
          collectionId={config.id}
          isSyncing={isSyncing}
        />

        {/* Link icon - fixed space for consistent spacing */}
        <CollectionLinkIcon
          isLinked={isLinked}
          isUnlinked={isUnlinked}
          configType={configType}
        />

        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={() => {
            if (configType === 'collection' && onEditCollection) {
              onEditCollection(config as CollectionFormConfig);
            } else if (configType === 'hub' && onEditHub) {
              onEditHub(config as PlexHubConfig);
            } else if (configType === 'preExisting' && onEditPreExisting) {
              onEditPreExisting(config as PreExistingCollectionConfig);
            }
          }}
          className="text-orange-400 hover:text-orange-300"
        >
          <PencilIcon className={isHub ? 'h-3 w-3' : 'h-4 w-4'} />
        </Button>

        {/* Promote/Demote buttons - only show on Library tab */}
        {activeTab === 'library' &&
          (onPromoteCollection ||
            onDemoteCollection ||
            onPromotePreExisting ||
            onDemotePreExisting) && (
            <>
              {/* Show promote button for A-Z collections */}
              {!isLibraryPromoted(config) && (
                <>
                  {configType === 'collection' && onPromoteCollection && (
                    <Button
                      buttonSize="sm"
                      buttonType="ghost"
                      onClick={() =>
                        onPromoteCollection(config as CollectionFormConfig)
                      }
                      className="text-orange-400 hover:text-orange-300"
                      title="Promote to top section with custom ordering"
                    >
                      <span className="text-xs">↑</span>
                    </Button>
                  )}
                  {configType === 'preExisting' && onPromotePreExisting && (
                    <Button
                      buttonSize="sm"
                      buttonType="ghost"
                      onClick={() =>
                        onPromotePreExisting(
                          config as PreExistingCollectionConfig
                        )
                      }
                      className="text-orange-400 hover:text-orange-300"
                      title="Promote to top section with custom ordering"
                    >
                      <span className="text-xs">↑</span>
                    </Button>
                  )}
                </>
              )}

              {/* Show demote button for promoted collections */}
              {isLibraryPromoted(config) && (
                <>
                  {configType === 'collection' && onDemoteCollection && (
                    <Button
                      buttonSize="sm"
                      buttonType="ghost"
                      onClick={() =>
                        onDemoteCollection(config as CollectionFormConfig)
                      }
                      className="text-yellow-400 hover:text-yellow-300"
                      title="Demote to alphabetical section"
                    >
                      <span className="text-xs">↓</span>
                    </Button>
                  )}
                  {configType === 'preExisting' && onDemotePreExisting && (
                    <Button
                      buttonSize="sm"
                      buttonType="ghost"
                      onClick={() =>
                        onDemotePreExisting(
                          config as PreExistingCollectionConfig
                        )
                      }
                      className="text-yellow-400 hover:text-yellow-300"
                      title="Demote to alphabetical section"
                    >
                      <span className="text-xs">↓</span>
                    </Button>
                  )}
                </>
              )}
            </>
          )}

        {isCollection ? (
          // Full delete for Agregarr collections
          <ConfirmButton
            confirmText="Delete"
            buttonSize="sm"
            className="text-red-500 hover:bg-red-600 hover:text-white"
            onClick={() => onDelete(config.id)}
          >
            <TrashIcon className="h-4 w-4" />
          </ConfirmButton>
        ) : (
          // Hide button for hubs and pre-existing collections
          activeTab !== 'inactive' && (
            <ConfirmButton
              confirmText="Hide"
              buttonSize="sm"
              buttonType="primary"
              onClick={() => onHide(config)}
            >
              <TrashIcon className="h-4 w-4" />
            </ConfirmButton>
          )
        )}
      </div>
    </div>
  );
};

const LibraryCollectionGroup = ({
  library,
  collections,
  hubs,
  preExisting,
  onEditCollection,
  onEditHub,
  onEditPreExisting,
  onDelete,
  onHide,
  onPromoteCollection,
  onDemoteCollection,
  onPromotePreExisting,
  onDemotePreExisting,
  onReorderItems,
  badgeClickCount,
  setBadgeClickCount,
  checkForUnlockSequence,
  activeTab,
  onBulkEdit,
}: LibraryCollectionGroupProps) => {
  // Ensure badgeClickCount is "used" to satisfy linter - this is part of easter egg state management
  void badgeClickCount;

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const { addToast } = useToasts();

  // SWR revalidation hook for refreshing collection data after sync
  const { mutate: revalidateCollections } = useSWR('/api/v1/collections');

  // Monitor collections to detect when individual syncs complete
  useEffect(() => {
    // Check if any collections that were syncing are now no longer needsSync
    syncingIds.forEach((syncingId) => {
      const collection = collections.find((c) => c.id === syncingId);
      if (collection && !collection.needsSync) {
        // Collection sync completed
        setSyncingIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(syncingId);
          return newSet;
        });
      }
    });
  }, [collections, syncingIds]);

  // Handle individual collection sync
  const handleIndividualSync = async (collectionId: string) => {
    // Add to syncing set
    setSyncingIds((prev) => new Set(prev).add(collectionId));

    try {
      await axios.post(`/api/v1/collections/${collectionId}/sync`);

      addToast('Collection sync started successfully', {
        appearance: 'success',
        autoDismiss: true,
      });

      // Start polling for status updates
      const pollInterval = setInterval(() => {
        revalidateCollections();
      }, 3000);

      // Clear polling after 5 minutes max
      setTimeout(() => {
        clearInterval(pollInterval);
        setSyncingIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(collectionId);
          return newSet;
        });
      }, 300000);
    } catch (error) {
      addToast(
        `Failed to start collection sync: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      // Let useEffect handle cleanup when sync actually completes
    }
  };
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Combine all three arrays for unified drag-and-drop
  const allConfigs = useMemo(() => {
    const result: {
      config:
        | CollectionFormConfig
        | PlexHubConfig
        | PreExistingCollectionConfig;
      type: 'collection' | 'hub' | 'preExisting';
      sortOrder: number;
    }[] = [];

    // Add collections
    collections.forEach((config) => {
      const sortOrder =
        activeTab === 'home' || activeTab === 'recommended'
          ? config.sortOrderHome || 1
          : config.sortOrderLibrary || 0;
      result.push({ config, type: 'collection', sortOrder });
    });

    // Add hubs
    hubs.forEach((config) => {
      const sortOrder =
        activeTab === 'home' || activeTab === 'recommended'
          ? config.sortOrderHome || 1
          : config.sortOrderLibrary || 0;
      result.push({ config, type: 'hub', sortOrder });
    });

    // Add pre-existing
    preExisting.forEach((config) => {
      const sortOrder =
        activeTab === 'home' || activeTab === 'recommended'
          ? config.sortOrderHome || 1
          : config.sortOrderLibrary || 0;
      result.push({ config, type: 'preExisting', sortOrder });
    });

    // Sort by the appropriate order with special handling for Library tab
    if (activeTab === 'library') {
      return result.sort((a, b) => {
        const aPromoted = isLibraryPromoted(a.config);
        const bPromoted = isLibraryPromoted(b.config);

        // Both promoted or both A-Z - sort by their respective order
        if (aPromoted === bPromoted) {
          if (aPromoted) {
            // Both promoted - sort by sortOrderLibrary
            return a.sortOrder - b.sortOrder;
          } else {
            // Both A-Z - sort alphabetically by name
            const aName = a.config.name || '';
            const bName = b.config.name || '';
            return aName.localeCompare(bName);
          }
        }

        // One promoted, one A-Z - promoted comes first
        return aPromoted ? -1 : 1;
      });
    }

    // For other tabs, use the normal sort order
    return result.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [collections, hubs, preExisting, activeTab]);

  // Calculate divider position for Library tab
  const dividerIndex = useMemo(() => {
    // Only show divider on Library tab
    if (activeTab !== 'library') return -1;

    // Find where A-Z collections start (first non-promoted collection)
    const alphabeticalStart = findPromotedDividerIndex(allConfigs);

    // Only show divider if we have both promoted and A-Z collections
    return alphabeticalStart > 0 ? alphabeticalStart : -1;
  }, [allConfigs, activeTab]);

  const shouldShowDivider = dividerIndex !== -1;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = allConfigs.findIndex(({ config, type }) => {
        if (type === 'collection') {
          const collectionConfig = config as CollectionFormConfig;
          const libraryId = Array.isArray(collectionConfig.libraryId)
            ? collectionConfig.libraryId[0]
            : collectionConfig.libraryId || 'all';
          return `collection-${config.id}-${libraryId}` === active.id;
        } else if (type === 'hub') {
          return `hub-${config.id}` === active.id;
        } else {
          return `preExisting-${config.id}` === active.id;
        }
      });

      const newIndex = allConfigs.findIndex(({ config, type }) => {
        if (type === 'collection') {
          const collectionConfig = config as CollectionFormConfig;
          const libraryId = Array.isArray(collectionConfig.libraryId)
            ? collectionConfig.libraryId[0]
            : collectionConfig.libraryId || 'all';
          return `collection-${config.id}-${libraryId}` === over?.id;
        } else if (type === 'hub') {
          return `hub-${config.id}` === over?.id;
        } else {
          return `preExisting-${config.id}` === over?.id;
        }
      });

      if (oldIndex !== -1 && newIndex !== -1) {
        // On Library tab, prevent dragging between promoted and A-Z sections
        if (activeTab === 'library' && shouldShowDivider) {
          const draggedConfig = allConfigs[oldIndex].config;
          const targetConfig = allConfigs[newIndex].config;
          const draggedIsPromoted = isLibraryPromoted(draggedConfig);
          const targetIsPromoted = isLibraryPromoted(targetConfig);

          // Prevent dragging between sections
          if (draggedIsPromoted !== targetIsPromoted) {
            return; // Block the drag operation
          }
        }
        const newAllConfigs = arrayMove(allConfigs, oldIndex, newIndex) as {
          config:
            | CollectionFormConfig
            | PlexHubConfig
            | PreExistingCollectionConfig;
          type: 'collection' | 'hub' | 'preExisting';
          sortOrder: number;
        }[];

        // TRUE unified approach: send entire mixed list with positions
        const mixedItems = newAllConfigs.map(({ config, type }, index) => ({
          ...config,
          configType:
            type === 'collection'
              ? ('collection' as FormConfigType)
              : type === 'hub'
              ? ('hub' as FormConfigType)
              : ('preExisting' as FormConfigType),
          position: index,
        }));

        // Single API call for entire mixed list
        await onReorderItems(library.key, mixedItems, 'Mixed collections');
      }
    }
  };

  // Always show library header, even when empty

  return (
    <div className="mb-6">
      {/* Library Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h4 className="text-lg font-medium text-white">{library.name}</h4>
          <Badge badgeType="default">
            {allConfigs.length} item{allConfigs.length !== 1 ? 's' : ''}
          </Badge>
        </div>
        <div className="flex items-center space-x-4">
          {onBulkEdit && (
            <button
              type="button"
              onClick={onBulkEdit}
              className="flex items-center space-x-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-300"
              title="Bulk Edit Collections"
            >
              <PencilSquareIcon className="h-3.5 w-3.5" />
              <span>Bulk Edit</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-sm text-gray-400 hover:text-gray-300"
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {/* Collections List */}
      {!isCollapsed && allConfigs.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={allConfigs.map(({ config, type }) => {
              if (type === 'collection') {
                const collectionConfig = config as CollectionFormConfig;
                const libraryId = Array.isArray(collectionConfig.libraryId)
                  ? collectionConfig.libraryId[0]
                  : collectionConfig.libraryId || 'all';
                return `collection-${config.id}-${libraryId}`;
              } else if (type === 'hub') {
                return `hub-${config.id}`;
              } else {
                return `preExisting-${config.id}`;
              }
            })}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {allConfigs.map(({ config, type }, index) => {
                const keyId =
                  type === 'collection'
                    ? `collection-${config.id}-${
                        Array.isArray(
                          (config as CollectionFormConfig).libraryId
                        )
                          ? (config as CollectionFormConfig).libraryId[0]
                          : (config as CollectionFormConfig).libraryId || 'all'
                      }`
                    : type === 'hub'
                    ? `hub-${config.id}`
                    : `preExisting-${config.id}`;

                // Check if we should show the divider before this item
                const showDivider = shouldShowDivider && index === dividerIndex;

                return (
                  <React.Fragment key={keyId}>
                    {showDivider && <AlphabeticalDivider />}
                    <SortableItem
                      config={config}
                      configType={type}
                      onEditCollection={onEditCollection}
                      onEditHub={onEditHub}
                      onEditPreExisting={onEditPreExisting}
                      onDelete={onDelete}
                      onHide={onHide}
                      onPromoteCollection={onPromoteCollection}
                      onDemoteCollection={onDemoteCollection}
                      onPromotePreExisting={onPromotePreExisting}
                      onDemotePreExisting={onDemotePreExisting}
                      setBadgeClickCount={setBadgeClickCount}
                      checkForUnlockSequence={checkForUnlockSequence}
                      activeTab={activeTab}
                      onIndividualSync={handleIndividualSync}
                      isSyncing={syncingIds.has(config.id)}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};

export default LibraryCollectionGroup;
