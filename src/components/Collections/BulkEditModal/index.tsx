import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import type {
  CollectionFormConfig,
  PlexHubConfig,
  PreExistingCollectionConfig,
} from '@app/types/collections';
import { CollectionType } from '@app/types/collections';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FunnelIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import type React from 'react';
import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  bulkEditTitle: 'Bulk Edit Collections',
  bulkEditDescription:
    'Select collections and edit multiple fields at once. Changes apply only to selected collections.',
  selectAll: 'Select All',
  deselectAll: 'Deselect All',
  selectedCount: '{count} selected',
  save: 'Save Changes',
  close: 'Close',
  saving: 'Saving...',
  successToast: 'Successfully updated {count} collection(s)',
  errorToast: 'Failed to update {name}: {error}',
  allTypes: 'All Types',
  allLibraries: 'All Libraries',
  agregarrCollections: 'Agregarr Collections',
  plexHubs: 'Plex Hubs',
  preExistingCollections: 'Pre-existing Collections',
  collectionName: 'Collection Name',
  type: 'Type',
  library: 'Library',
  usersHome: 'Users Home',
  serverOwnerHome: 'Server Owner Home',
  libraryRecommended: 'Library Recommended',
  maxItems: 'Max Items',
  randomizeHomeOrder: 'Randomize Home Order',
  reverseOrder: 'Reverse Order',
  randomizeOrder: 'Randomize Order',
  downloadMode: 'Download Mode',
  searchMissingMovies: 'Search Missing Movies',
  searchMissingTV: 'Search Missing TV',
  autoApproveMovies: 'Auto Approve Movies',
  autoApproveTV: 'Auto Approve TV',
  maxSeasonsToRequest: 'Max Seasons to Request',
  seasonsPerShowLimit: 'Seasons Per Show Limit',
  seasonGrabOrder: 'Season Grab Order',
  maxPositionToProcess: 'Max Position to Process',
  minimumYear: 'Minimum Year',
  minimumImdbRating: 'Minimum IMDb Rating',
  minimumRottenTomatoesRating: 'Minimum RT Rating',
  showUnwatchedOnly: 'Unwatched Only',
  createPlaceholders: 'Create Placeholders',
  editValues: 'Edit Selected',
  noCollections: 'No collections available',
  overseerrMode: 'Overseerr',
  directMode: 'Direct',
});

interface BulkEditModalProps {
  collections: CollectionFormConfig[];
  hubs: PlexHubConfig[];
  preExisting: PreExistingCollectionConfig[];
  onClose: () => void;
  onSave: () => void; // Callback to revalidate data
}

type UnifiedCollection = {
  id: string;
  name: string;
  type: 'collection' | 'hub' | 'preExisting';
  collectionType?: CollectionType;
  libraryName: string;
  libraryId: string;
  // Visibility
  visibilityConfig: {
    usersHome: boolean;
    serverOwnerHome: boolean;
    libraryRecommended: boolean;
  };
  // Common fields
  maxItems?: number;
  randomizeHomeOrder?: boolean;
  // Collection-specific fields
  reverseOrder?: boolean;
  randomizeOrder?: boolean;
  downloadMode?: 'overseerr' | 'direct';
  searchMissingMovies?: boolean;
  searchMissingTV?: boolean;
  autoApproveMovies?: boolean;
  autoApproveTV?: boolean;
  maxSeasonsToRequest?: number;
  seasonsPerShowLimit?: number;
  seasonGrabOrder?: 'first' | 'latest' | 'airing';
  maxPositionToProcess?: number;
  minimumYear?: number;
  minimumImdbRating?: number;
  minimumRottenTomatoesRating?: number;
  showUnwatchedOnly?: boolean;
  createPlaceholdersForMissing?: boolean;
  // Original config for saving
  originalConfig:
    | CollectionFormConfig
    | PlexHubConfig
    | PreExistingCollectionConfig;
};

const BulkEditModal: React.FC<BulkEditModalProps> = ({
  collections,
  hubs,
  preExisting,
  onClose,
  onSave,
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter and sort state - default to Agregarr collections
  const [filterType, setFilterType] = useState<string>('agregarr');
  const [filterLibrary, setFilterLibrary] = useState<string>('all');
  const [sortColumn, setSortColumn] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Edit values state
  const [editValues, setEditValues] = useState<{
    visibilityConfig?: {
      usersHome?: boolean;
      serverOwnerHome?: boolean;
      libraryRecommended?: boolean;
    };
    maxItems?: number | '';
    randomizeHomeOrder?: boolean;
    reverseOrder?: boolean;
    randomizeOrder?: boolean;
    downloadMode?: 'overseerr' | 'direct' | '';
    searchMissingMovies?: boolean;
    searchMissingTV?: boolean;
    autoApproveMovies?: boolean;
    autoApproveTV?: boolean;
    maxSeasonsToRequest?: number | '';
    seasonsPerShowLimit?: number | '';
    seasonGrabOrder?: 'first' | 'latest' | 'airing' | '';
    maxPositionToProcess?: number | '';
    minimumYear?: number | '';
    minimumImdbRating?: number | '';
    minimumRottenTomatoesRating?: number | '';
    showUnwatchedOnly?: boolean;
    createPlaceholdersForMissing?: boolean;
  }>({});

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Transform all collections into unified format
  const unifiedCollections = useMemo((): UnifiedCollection[] => {
    const unified: UnifiedCollection[] = [];

    // Agregarr Collections
    collections.forEach((config) => {
      unified.push({
        id: `collection-${config.id}`,
        name: config.name,
        type: 'collection',
        collectionType: CollectionType.AGREGARR_CREATED,
        libraryName: config.libraryName,
        libraryId: config.libraryId,
        visibilityConfig: config.visibilityConfig,
        maxItems: config.maxItems,
        randomizeHomeOrder: config.randomizeHomeOrder,
        reverseOrder: config.reverseOrder,
        randomizeOrder: config.randomizeOrder,
        downloadMode: config.downloadMode,
        searchMissingMovies: config.searchMissingMovies,
        searchMissingTV: config.searchMissingTV,
        autoApproveMovies: config.autoApproveMovies,
        autoApproveTV: config.autoApproveTV,
        maxSeasonsToRequest: config.maxSeasonsToRequest,
        seasonsPerShowLimit: config.seasonsPerShowLimit,
        seasonGrabOrder: config.seasonGrabOrder,
        maxPositionToProcess: config.maxPositionToProcess,
        minimumYear: config.minimumYear,
        minimumImdbRating: config.minimumImdbRating,
        minimumRottenTomatoesRating: config.minimumRottenTomatoesRating,
        showUnwatchedOnly: config.showUnwatchedOnly,
        createPlaceholdersForMissing: config.createPlaceholdersForMissing,
        originalConfig: config,
      });
    });

    // Plex Hubs
    hubs.forEach((hub) => {
      unified.push({
        id: `hub-${hub.id}`,
        name: hub.name,
        type: 'hub',
        collectionType: CollectionType.DEFAULT_PLEX_HUB,
        libraryName: hub.libraryName,
        libraryId: hub.libraryId,
        visibilityConfig: hub.visibilityConfig,
        randomizeHomeOrder: hub.randomizeHomeOrder,
        originalConfig: hub,
      });
    });

    // Pre-existing Collections
    preExisting.forEach((pre) => {
      unified.push({
        id: `preExisting-${pre.id}`,
        name: pre.name,
        type: 'preExisting',
        collectionType: CollectionType.PRE_EXISTING,
        libraryName: pre.libraryName,
        libraryId: pre.libraryId,
        visibilityConfig: pre.visibilityConfig,
        randomizeHomeOrder: pre.randomizeHomeOrder,
        originalConfig: pre,
      });
    });

    return unified;
  }, [collections, hubs, preExisting]);

  // Get unique libraries for filter
  const uniqueLibraries = useMemo(() => {
    const librarySet = new Set(unifiedCollections.map((c) => c.libraryName));
    return Array.from(librarySet).sort();
  }, [unifiedCollections]);

  // Apply filters and sorting
  const filteredAndSortedCollections = useMemo(() => {
    let filtered = [...unifiedCollections];

    // Apply type filter
    if (filterType !== 'all') {
      filtered = filtered.filter((c) => {
        if (filterType === 'agregarr') return c.type === 'collection';
        if (filterType === 'hub') return c.type === 'hub';
        if (filterType === 'preexisting') return c.type === 'preExisting';
        return true;
      });
    }

    // Apply library filter
    if (filterLibrary !== 'all') {
      filtered = filtered.filter((c) => c.libraryName === filterLibrary);
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'library':
          comparison = a.libraryName.localeCompare(b.libraryName);
          break;
        case 'usersHome':
          comparison =
            (a.visibilityConfig.usersHome ? 1 : 0) -
            (b.visibilityConfig.usersHome ? 1 : 0);
          break;
        case 'serverOwnerHome':
          comparison =
            (a.visibilityConfig.serverOwnerHome ? 1 : 0) -
            (b.visibilityConfig.serverOwnerHome ? 1 : 0);
          break;
        case 'libraryRecommended':
          comparison =
            (a.visibilityConfig.libraryRecommended ? 1 : 0) -
            (b.visibilityConfig.libraryRecommended ? 1 : 0);
          break;
        case 'maxItems':
          comparison = (a.maxItems || 0) - (b.maxItems || 0);
          break;
        case 'randomizeHomeOrder':
          comparison =
            (a.randomizeHomeOrder ? 1 : 0) - (b.randomizeHomeOrder ? 1 : 0);
          break;
        case 'reverseOrder':
          comparison = (a.reverseOrder ? 1 : 0) - (b.reverseOrder ? 1 : 0);
          break;
        case 'randomizeOrder':
          comparison = (a.randomizeOrder ? 1 : 0) - (b.randomizeOrder ? 1 : 0);
          break;
        case 'downloadMode':
          comparison = (a.downloadMode || '').localeCompare(
            b.downloadMode || ''
          );
          break;
        case 'searchMissingMovies':
          comparison =
            (a.searchMissingMovies ? 1 : 0) - (b.searchMissingMovies ? 1 : 0);
          break;
        case 'searchMissingTV':
          comparison =
            (a.searchMissingTV ? 1 : 0) - (b.searchMissingTV ? 1 : 0);
          break;
        case 'autoApproveMovies':
          comparison =
            (a.autoApproveMovies ? 1 : 0) - (b.autoApproveMovies ? 1 : 0);
          break;
        case 'autoApproveTV':
          comparison = (a.autoApproveTV ? 1 : 0) - (b.autoApproveTV ? 1 : 0);
          break;
        case 'maxSeasonsToRequest':
          comparison =
            (a.maxSeasonsToRequest || 0) - (b.maxSeasonsToRequest || 0);
          break;
        case 'seasonsPerShowLimit':
          comparison =
            (a.seasonsPerShowLimit || 0) - (b.seasonsPerShowLimit || 0);
          break;
        case 'seasonGrabOrder':
          comparison = (a.seasonGrabOrder || '').localeCompare(
            b.seasonGrabOrder || ''
          );
          break;
        case 'maxPositionToProcess':
          comparison =
            (a.maxPositionToProcess || 0) - (b.maxPositionToProcess || 0);
          break;
        case 'minimumYear':
          comparison = (a.minimumYear || 0) - (b.minimumYear || 0);
          break;
        case 'minimumImdbRating':
          comparison = (a.minimumImdbRating || 0) - (b.minimumImdbRating || 0);
          break;
        case 'minimumRottenTomatoesRating':
          comparison =
            (a.minimumRottenTomatoesRating || 0) -
            (b.minimumRottenTomatoesRating || 0);
          break;
        case 'showUnwatchedOnly':
          comparison =
            (a.showUnwatchedOnly ? 1 : 0) - (b.showUnwatchedOnly ? 1 : 0);
          break;
        case 'createPlaceholdersForMissing':
          comparison =
            (a.createPlaceholdersForMissing ? 1 : 0) -
            (b.createPlaceholdersForMissing ? 1 : 0);
          break;
        default:
          comparison = 0;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [
    unifiedCollections,
    filterType,
    filterLibrary,
    sortColumn,
    sortDirection,
  ]);

  // Select/Deselect all
  const handleSelectAll = () => {
    const allIds = new Set(filteredAndSortedCollections.map((c) => c.id));
    setSelectedIds(allIds);
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  // Toggle individual selection
  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // Handle column header click for sorting
  const handleColumnSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Render sort indicator for column header
  const renderSortIndicator = (column: string) => {
    if (sortColumn !== column) {
      return null;
    }
    return sortDirection === 'asc' ? (
      <ChevronUpIcon className="ml-1 inline h-3 w-3" />
    ) : (
      <ChevronDownIcon className="ml-1 inline h-3 w-3" />
    );
  };

  // Check if field is applicable for collection type
  const isFieldApplicable = (
    field: string,
    type: 'collection' | 'hub' | 'preExisting'
  ): boolean => {
    // Common fields available to all types
    const commonFields = [
      'usersHome',
      'serverOwnerHome',
      'libraryRecommended',
      'randomizeHomeOrder',
    ];

    if (commonFields.includes(field)) {
      return true;
    }

    // Collection-specific fields
    const collectionOnlyFields = [
      'maxItems',
      'reverseOrder',
      'randomizeOrder',
      'downloadMode',
      'searchMissingMovies',
      'searchMissingTV',
      'autoApproveMovies',
      'autoApproveTV',
      'maxSeasonsToRequest',
      'seasonsPerShowLimit',
      'seasonGrabOrder',
      'maxPositionToProcess',
      'minimumYear',
      'minimumImdbRating',
      'minimumRottenTomatoesRating',
      'showUnwatchedOnly',
      'createPlaceholdersForMissing',
    ];

    if (collectionOnlyFields.includes(field)) {
      return type === 'collection';
    }

    return false;
  };

  // Save changes
  const handleSave = async () => {
    if (selectedIds.size === 0) {
      addToast('No collections selected', {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setIsSaving(true);

    let successCount = 0;

    // Get selected collections
    const selectedCollections = unifiedCollections.filter((c) =>
      selectedIds.has(c.id)
    );

    // Update each selected collection
    for (const collection of selectedCollections) {
      try {
        // Build updated config by merging edit values with original
        // Create a mutable copy to avoid readonly errors
        const baseConfig = { ...collection.originalConfig };

        // Build the updated configuration object
        const updatedFields: Record<string, unknown> = {};

        // Apply visibility changes if set
        if (editValues.visibilityConfig) {
          updatedFields.visibilityConfig = {
            ...baseConfig.visibilityConfig,
            ...(editValues.visibilityConfig.usersHome !== undefined && {
              usersHome: editValues.visibilityConfig.usersHome,
            }),
            ...(editValues.visibilityConfig.serverOwnerHome !== undefined && {
              serverOwnerHome: editValues.visibilityConfig.serverOwnerHome,
            }),
            ...(editValues.visibilityConfig.libraryRecommended !==
              undefined && {
              libraryRecommended:
                editValues.visibilityConfig.libraryRecommended,
            }),
          };
        }

        // Apply other field changes if applicable
        if (
          editValues.maxItems !== undefined &&
          isFieldApplicable('maxItems', collection.type)
        ) {
          updatedFields.maxItems =
            editValues.maxItems === '' ? undefined : editValues.maxItems;
        }

        if (
          editValues.randomizeHomeOrder !== undefined &&
          isFieldApplicable('randomizeHomeOrder', collection.type)
        ) {
          updatedFields.randomizeHomeOrder = editValues.randomizeHomeOrder;
        }

        if (
          editValues.reverseOrder !== undefined &&
          isFieldApplicable('reverseOrder', collection.type)
        ) {
          updatedFields.reverseOrder = editValues.reverseOrder;
        }

        if (
          editValues.randomizeOrder !== undefined &&
          isFieldApplicable('randomizeOrder', collection.type)
        ) {
          updatedFields.randomizeOrder = editValues.randomizeOrder;
        }

        if (
          editValues.downloadMode !== undefined &&
          editValues.downloadMode !== '' &&
          isFieldApplicable('downloadMode', collection.type)
        ) {
          updatedFields.downloadMode = editValues.downloadMode;
        }

        if (
          editValues.searchMissingMovies !== undefined &&
          isFieldApplicable('searchMissingMovies', collection.type)
        ) {
          updatedFields.searchMissingMovies = editValues.searchMissingMovies;
        }

        if (
          editValues.searchMissingTV !== undefined &&
          isFieldApplicable('searchMissingTV', collection.type)
        ) {
          updatedFields.searchMissingTV = editValues.searchMissingTV;
        }

        if (
          editValues.autoApproveMovies !== undefined &&
          isFieldApplicable('autoApproveMovies', collection.type)
        ) {
          updatedFields.autoApproveMovies = editValues.autoApproveMovies;
        }

        if (
          editValues.autoApproveTV !== undefined &&
          isFieldApplicable('autoApproveTV', collection.type)
        ) {
          updatedFields.autoApproveTV = editValues.autoApproveTV;
        }

        if (
          editValues.maxSeasonsToRequest !== undefined &&
          isFieldApplicable('maxSeasonsToRequest', collection.type)
        ) {
          updatedFields.maxSeasonsToRequest =
            editValues.maxSeasonsToRequest === ''
              ? undefined
              : editValues.maxSeasonsToRequest;
        }

        if (
          editValues.seasonsPerShowLimit !== undefined &&
          isFieldApplicable('seasonsPerShowLimit', collection.type)
        ) {
          updatedFields.seasonsPerShowLimit =
            editValues.seasonsPerShowLimit === ''
              ? undefined
              : editValues.seasonsPerShowLimit;
        }

        if (
          editValues.seasonGrabOrder !== undefined &&
          isFieldApplicable('seasonGrabOrder', collection.type)
        ) {
          updatedFields.seasonGrabOrder =
            editValues.seasonGrabOrder === ''
              ? undefined
              : editValues.seasonGrabOrder;
        }

        if (
          editValues.maxPositionToProcess !== undefined &&
          isFieldApplicable('maxPositionToProcess', collection.type)
        ) {
          updatedFields.maxPositionToProcess =
            editValues.maxPositionToProcess === ''
              ? undefined
              : editValues.maxPositionToProcess;
        }

        if (
          editValues.minimumYear !== undefined &&
          isFieldApplicable('minimumYear', collection.type)
        ) {
          updatedFields.minimumYear =
            editValues.minimumYear === '' ? undefined : editValues.minimumYear;
        }

        if (
          editValues.minimumImdbRating !== undefined &&
          isFieldApplicable('minimumImdbRating', collection.type)
        ) {
          updatedFields.minimumImdbRating =
            editValues.minimumImdbRating === ''
              ? undefined
              : editValues.minimumImdbRating;
        }

        if (
          editValues.minimumRottenTomatoesRating !== undefined &&
          isFieldApplicable('minimumRottenTomatoesRating', collection.type)
        ) {
          updatedFields.minimumRottenTomatoesRating =
            editValues.minimumRottenTomatoesRating === ''
              ? undefined
              : editValues.minimumRottenTomatoesRating;
        }

        if (
          editValues.showUnwatchedOnly !== undefined &&
          isFieldApplicable('showUnwatchedOnly', collection.type)
        ) {
          updatedFields.showUnwatchedOnly = editValues.showUnwatchedOnly;
        }

        if (
          editValues.createPlaceholdersForMissing !== undefined &&
          isFieldApplicable('createPlaceholdersForMissing', collection.type)
        ) {
          updatedFields.createPlaceholdersForMissing =
            editValues.createPlaceholdersForMissing;
        }

        // Merge updated fields into the base config
        const updatedConfig = { ...baseConfig, ...updatedFields };

        // Call appropriate API endpoint based on type
        if (collection.type === 'collection') {
          await axios.put(`/api/v1/collections/${updatedConfig.id}/settings`, {
            ...updatedConfig,
            // Strip computed fields
            isActive: undefined,
            missing: undefined,
          });
        } else if (collection.type === 'hub') {
          await axios.put(`/api/v1/defaulthubs/${updatedConfig.id}/settings`, {
            ...updatedConfig,
            // Strip computed fields
            isActive: undefined,
            collectionType: undefined,
            missing: undefined,
          });
        } else if (collection.type === 'preExisting') {
          await axios.put(`/api/v1/preexisting/${updatedConfig.id}/settings`, {
            ...updatedConfig,
            // Strip computed fields
            isActive: undefined,
            collectionType: undefined,
            missing: undefined,
          });
        }

        successCount++;
      } catch (error) {
        addToast(
          intl.formatMessage(messages.errorToast, {
            name: collection.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            appearance: 'error',
            autoDismiss: true,
          }
        );
      }
    }

    setIsSaving(false);

    if (successCount > 0) {
      addToast(
        intl.formatMessage(messages.successToast, { count: successCount }),
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );
      // Call onSave to revalidate without closing modal
      onSave();
      // Clear edit values after successful save
      setEditValues({});
    }
  };

  return (
    <Modal
      title={intl.formatMessage(messages.bulkEditTitle)}
      onCancel={onClose}
      onOk={handleSave}
      okText={
        isSaving
          ? intl.formatMessage(messages.saving)
          : intl.formatMessage(messages.save)
      }
      okDisabled={isSaving || selectedIds.size === 0}
      cancelText={intl.formatMessage(messages.close)}
      backgroundClickable={false}
      customMaxWidth="sm:max-w-7xl"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-400">
          {intl.formatMessage(messages.bulkEditDescription)}
        </p>

        {/* Controls bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-700 bg-stone-800 p-3">
          <div className="flex items-center gap-3">
            <Button buttonSize="sm" onClick={handleSelectAll}>
              <CheckIcon className="mr-1 h-4 w-4" />
              {intl.formatMessage(messages.selectAll)}
            </Button>
            <Button buttonSize="sm" onClick={handleDeselectAll}>
              <XMarkIcon className="mr-1 h-4 w-4" />
              {intl.formatMessage(messages.deselectAll)}
            </Button>
            <span className="text-sm text-gray-400">
              {intl.formatMessage(messages.selectedCount, {
                count: selectedIds.size,
              })}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <FunnelIcon className="h-4 w-4 text-gray-400" />

            {/* Type Filter */}
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
          </div>
        </div>

        {/* Table container with horizontal scroll */}
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full min-w-max table-fixed">
            <thead className="sticky top-0 z-10 bg-stone-800">
              <tr className="border-b border-gray-700">
                <th className="sticky left-0 z-20 w-12 bg-stone-800 px-3 py-2 text-left text-xs font-medium text-gray-400 shadow-[2px_0_4px_rgba(0,0,0,0.3)]">
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.size === filteredAndSortedCollections.length
                    }
                    onChange={() => {
                      if (
                        selectedIds.size === filteredAndSortedCollections.length
                      ) {
                        handleDeselectAll();
                      } else {
                        handleSelectAll();
                      }
                    }}
                    className="h-4 w-4 rounded border-gray-600 bg-stone-700 text-orange-500 focus:ring-orange-500"
                  />
                </th>
                <th
                  className="sticky left-12 z-20 w-48 cursor-pointer bg-stone-800 px-3 py-2 text-left text-xs font-medium text-gray-400 shadow-[2px_0_4px_rgba(0,0,0,0.3)] hover:text-gray-300"
                  onClick={() => handleColumnSort('name')}
                >
                  {intl.formatMessage(messages.collectionName)}
                  {renderSortIndicator('name')}
                </th>
                <th
                  className="sticky left-60 z-20 w-32 cursor-pointer bg-stone-800 px-3 py-2 text-left text-xs font-medium text-gray-400 shadow-[2px_0_0_0_rgb(75,85,99)] hover:text-gray-300"
                  onClick={() => handleColumnSort('library')}
                >
                  {intl.formatMessage(messages.library)}
                  {renderSortIndicator('library')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-left text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('type')}
                >
                  {intl.formatMessage(messages.type)}
                  {renderSortIndicator('type')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('usersHome')}
                >
                  {intl.formatMessage(messages.usersHome)}
                  {renderSortIndicator('usersHome')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('serverOwnerHome')}
                >
                  {intl.formatMessage(messages.serverOwnerHome)}
                  {renderSortIndicator('serverOwnerHome')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('libraryRecommended')}
                >
                  {intl.formatMessage(messages.libraryRecommended)}
                  {renderSortIndicator('libraryRecommended')}
                </th>
                <th
                  className="w-24 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('maxItems')}
                >
                  {intl.formatMessage(messages.maxItems)}
                  {renderSortIndicator('maxItems')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('randomizeHomeOrder')}
                >
                  {intl.formatMessage(messages.randomizeHomeOrder)}
                  {renderSortIndicator('randomizeHomeOrder')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('reverseOrder')}
                >
                  {intl.formatMessage(messages.reverseOrder)}
                  {renderSortIndicator('reverseOrder')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('randomizeOrder')}
                >
                  {intl.formatMessage(messages.randomizeOrder)}
                  {renderSortIndicator('randomizeOrder')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('downloadMode')}
                >
                  {intl.formatMessage(messages.downloadMode)}
                  {renderSortIndicator('downloadMode')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('searchMissingMovies')}
                >
                  {intl.formatMessage(messages.searchMissingMovies)}
                  {renderSortIndicator('searchMissingMovies')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('searchMissingTV')}
                >
                  {intl.formatMessage(messages.searchMissingTV)}
                  {renderSortIndicator('searchMissingTV')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('autoApproveMovies')}
                >
                  {intl.formatMessage(messages.autoApproveMovies)}
                  {renderSortIndicator('autoApproveMovies')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('autoApproveTV')}
                >
                  {intl.formatMessage(messages.autoApproveTV)}
                  {renderSortIndicator('autoApproveTV')}
                </th>
                <th
                  className="w-24 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('maxSeasonsToRequest')}
                >
                  {intl.formatMessage(messages.maxSeasonsToRequest)}
                  {renderSortIndicator('maxSeasonsToRequest')}
                </th>
                <th
                  className="w-24 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('seasonsPerShowLimit')}
                >
                  {intl.formatMessage(messages.seasonsPerShowLimit)}
                  {renderSortIndicator('seasonsPerShowLimit')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('seasonGrabOrder')}
                >
                  {intl.formatMessage(messages.seasonGrabOrder)}
                  {renderSortIndicator('seasonGrabOrder')}
                </th>
                <th
                  className="w-24 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('maxPositionToProcess')}
                >
                  {intl.formatMessage(messages.maxPositionToProcess)}
                  {renderSortIndicator('maxPositionToProcess')}
                </th>
                <th
                  className="w-24 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('minimumYear')}
                >
                  {intl.formatMessage(messages.minimumYear)}
                  {renderSortIndicator('minimumYear')}
                </th>
                <th
                  className="w-24 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('minimumImdbRating')}
                >
                  {intl.formatMessage(messages.minimumImdbRating)}
                  {renderSortIndicator('minimumImdbRating')}
                </th>
                <th
                  className="w-24 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() =>
                    handleColumnSort('minimumRottenTomatoesRating')
                  }
                >
                  {intl.formatMessage(messages.minimumRottenTomatoesRating)}
                  {renderSortIndicator('minimumRottenTomatoesRating')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() => handleColumnSort('showUnwatchedOnly')}
                >
                  {intl.formatMessage(messages.showUnwatchedOnly)}
                  {renderSortIndicator('showUnwatchedOnly')}
                </th>
                <th
                  className="w-32 cursor-pointer px-3 py-2 text-center text-xs font-medium text-gray-400 hover:text-gray-300"
                  onClick={() =>
                    handleColumnSort('createPlaceholdersForMissing')
                  }
                >
                  {intl.formatMessage(messages.createPlaceholders)}
                  {renderSortIndicator('createPlaceholdersForMissing')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedCollections.length === 0 ? (
                <tr>
                  <td
                    colSpan={24}
                    className="px-3 py-8 text-center text-sm text-gray-500"
                  >
                    {intl.formatMessage(messages.noCollections)}
                  </td>
                </tr>
              ) : (
                <>
                  {/* Data rows */}
                  {filteredAndSortedCollections.map((collection) => (
                    <tr
                      key={collection.id}
                      className={`group border-b border-gray-800 transition-colors hover:bg-stone-800/50 ${
                        selectedIds.has(collection.id) ? 'bg-stone-800/30' : ''
                      }`}
                    >
                      <td
                        className={`sticky left-0 z-10 px-3 py-2 transition-colors ${
                          selectedIds.has(collection.id)
                            ? 'bg-stone-800/30 group-hover:bg-stone-800/40'
                            : 'bg-stone-800 group-hover:bg-stone-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(collection.id)}
                          onChange={() => toggleSelection(collection.id)}
                          className="h-4 w-4 rounded border-gray-600 bg-stone-700 text-orange-500 focus:ring-orange-500"
                        />
                      </td>
                      <td
                        className={`sticky left-12 z-10 truncate px-3 py-2 text-sm text-white transition-colors ${
                          selectedIds.has(collection.id)
                            ? 'bg-stone-800/30 group-hover:bg-stone-800/40'
                            : 'bg-stone-800 group-hover:bg-stone-700'
                        }`}
                      >
                        {collection.name}
                      </td>
                      <td
                        className={`sticky left-60 z-10 truncate px-3 py-2 text-sm text-gray-400 shadow-[2px_0_0_0_rgb(75,85,99)] transition-colors ${
                          selectedIds.has(collection.id)
                            ? 'bg-stone-800/30 group-hover:bg-stone-800/40'
                            : 'bg-stone-800 group-hover:bg-stone-700'
                        }`}
                      >
                        {collection.libraryName}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-400">
                        {collection.type === 'collection'
                          ? 'Agregarr'
                          : collection.type === 'hub'
                          ? 'Plex Hub'
                          : 'Pre-existing'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable('usersHome', collection.type)
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.visibilityConfig.usersHome
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable('serverOwnerHome', collection.type)
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.visibilityConfig.serverOwnerHome
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable(
                            'libraryRecommended',
                            collection.type
                          )
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.visibilityConfig.libraryRecommended
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable('maxItems', collection.type)
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.maxItems || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable(
                            'randomizeHomeOrder',
                            collection.type
                          )
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.randomizeHomeOrder
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable('reverseOrder', collection.type)
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.reverseOrder
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable('randomizeOrder', collection.type)
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.randomizeOrder
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable('downloadMode', collection.type)
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.downloadMode || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable(
                            'searchMissingMovies',
                            collection.type
                          )
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.searchMissingMovies
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable('searchMissingTV', collection.type)
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.searchMissingTV
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable(
                            'autoApproveMovies',
                            collection.type
                          )
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.autoApproveMovies
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable('autoApproveTV', collection.type)
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.autoApproveTV
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable(
                            'maxSeasonsToRequest',
                            collection.type
                          )
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.maxSeasonsToRequest || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable(
                            'seasonsPerShowLimit',
                            collection.type
                          )
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.seasonsPerShowLimit || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable('seasonGrabOrder', collection.type)
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.seasonGrabOrder
                          ? collection.seasonGrabOrder.charAt(0).toUpperCase() +
                            collection.seasonGrabOrder.slice(1)
                          : '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable(
                            'maxPositionToProcess',
                            collection.type
                          )
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.maxPositionToProcess || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable('minimumYear', collection.type)
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.minimumYear || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable(
                            'minimumImdbRating',
                            collection.type
                          )
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.minimumImdbRating || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center text-sm ${
                          !isFieldApplicable(
                            'minimumRottenTomatoesRating',
                            collection.type
                          )
                            ? 'text-gray-600 opacity-30'
                            : 'text-gray-300'
                        }`}
                      >
                        {collection.minimumRottenTomatoesRating || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable(
                            'showUnwatchedOnly',
                            collection.type
                          )
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.showUnwatchedOnly
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-3 py-2 text-center ${
                          !isFieldApplicable(
                            'createPlaceholdersForMissing',
                            collection.type
                          )
                            ? 'opacity-30'
                            : ''
                        }`}
                      >
                        <CheckIcon
                          className={`mx-auto h-4 w-4 ${
                            collection.createPlaceholdersForMissing
                              ? 'text-green-500'
                              : 'text-gray-600'
                          }`}
                        />
                      </td>
                    </tr>
                  ))}

                  {/* Edit row at bottom */}
                  <tr className="sticky bottom-0 border-t-2 border-orange-500 bg-stone-800">
                    <td
                      className="sticky left-0 z-10 bg-stone-800 px-3 py-3 shadow-[2px_0_0_0_rgb(75,85,99)]"
                      colSpan={3}
                    >
                      <div className="text-xs font-medium text-orange-400">
                        {intl.formatMessage(messages.editValues)}
                      </div>
                    </td>
                    <td className="px-3 py-3"></td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.visibilityConfig?.usersHome === undefined
                            ? ''
                            : editValues.visibilityConfig.usersHome
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            visibilityConfig: {
                              ...editValues.visibilityConfig,
                              usersHome:
                                e.target.value === ''
                                  ? undefined
                                  : e.target.value === 'true',
                            },
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.visibilityConfig?.serverOwnerHome ===
                          undefined
                            ? ''
                            : editValues.visibilityConfig.serverOwnerHome
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            visibilityConfig: {
                              ...editValues.visibilityConfig,
                              serverOwnerHome:
                                e.target.value === ''
                                  ? undefined
                                  : e.target.value === 'true',
                            },
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.visibilityConfig?.libraryRecommended ===
                          undefined
                            ? ''
                            : editValues.visibilityConfig.libraryRecommended
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            visibilityConfig: {
                              ...editValues.visibilityConfig,
                              libraryRecommended:
                                e.target.value === ''
                                  ? undefined
                                  : e.target.value === 'true',
                            },
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={editValues.maxItems || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            maxItems:
                              e.target.value === ''
                                ? ''
                                : Number(e.target.value),
                          })
                        }
                        placeholder="-"
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                        min={1}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.randomizeHomeOrder === undefined
                            ? ''
                            : editValues.randomizeHomeOrder
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            randomizeHomeOrder:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.reverseOrder === undefined
                            ? ''
                            : editValues.reverseOrder
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            reverseOrder:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.randomizeOrder === undefined
                            ? ''
                            : editValues.randomizeOrder
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            randomizeOrder:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={editValues.downloadMode || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            downloadMode:
                              e.target.value === ''
                                ? undefined
                                : (e.target.value as 'overseerr' | 'direct'),
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="overseerr">
                          {intl.formatMessage(messages.overseerrMode)}
                        </option>
                        <option value="direct">
                          {intl.formatMessage(messages.directMode)}
                        </option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.searchMissingMovies === undefined
                            ? ''
                            : editValues.searchMissingMovies
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            searchMissingMovies:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.searchMissingTV === undefined
                            ? ''
                            : editValues.searchMissingTV
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            searchMissingTV:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.autoApproveMovies === undefined
                            ? ''
                            : editValues.autoApproveMovies
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            autoApproveMovies:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.autoApproveTV === undefined
                            ? ''
                            : editValues.autoApproveTV
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            autoApproveTV:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={editValues.maxSeasonsToRequest || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            maxSeasonsToRequest:
                              e.target.value === ''
                                ? ''
                                : Number(e.target.value),
                          })
                        }
                        placeholder="-"
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                        min={0}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={editValues.seasonsPerShowLimit || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            seasonsPerShowLimit:
                              e.target.value === ''
                                ? ''
                                : Number(e.target.value),
                          })
                        }
                        placeholder="-"
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                        min={0}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={editValues.seasonGrabOrder || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            seasonGrabOrder: e.target.value as
                              | 'first'
                              | 'latest'
                              | 'airing'
                              | '',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="first">First</option>
                        <option value="latest">Latest</option>
                        <option value="airing">Airing</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={editValues.maxPositionToProcess || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            maxPositionToProcess:
                              e.target.value === ''
                                ? ''
                                : Number(e.target.value),
                          })
                        }
                        placeholder="-"
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                        min={0}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={editValues.minimumYear || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            minimumYear:
                              e.target.value === ''
                                ? ''
                                : Number(e.target.value),
                          })
                        }
                        placeholder="-"
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                        min={1900}
                        max={2100}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={editValues.minimumImdbRating || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            minimumImdbRating:
                              e.target.value === ''
                                ? ''
                                : Number(e.target.value),
                          })
                        }
                        placeholder="-"
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                        min={0}
                        max={10}
                        step={0.1}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={editValues.minimumRottenTomatoesRating || ''}
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            minimumRottenTomatoesRating:
                              e.target.value === ''
                                ? ''
                                : Number(e.target.value),
                          })
                        }
                        placeholder="-"
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                        min={0}
                        max={100}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.showUnwatchedOnly === undefined
                            ? ''
                            : editValues.showUnwatchedOnly
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            showUnwatchedOnly:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={
                          editValues.createPlaceholdersForMissing === undefined
                            ? ''
                            : editValues.createPlaceholdersForMissing
                            ? 'true'
                            : 'false'
                        }
                        onChange={(e) =>
                          setEditValues({
                            ...editValues,
                            createPlaceholdersForMissing:
                              e.target.value === ''
                                ? undefined
                                : e.target.value === 'true',
                          })
                        }
                        className="w-full rounded border border-gray-600 bg-stone-700 px-2 py-1 text-xs text-white"
                      >
                        <option value="">-</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
};

export default BulkEditModal;
