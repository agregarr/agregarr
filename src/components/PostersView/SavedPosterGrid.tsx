import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import type {
  EditorMode,
  PosterEditorData,
} from '@app/components/PosterEditor';
import { PosterEditorModal } from '@app/components/PosterEditor';
import {
  CheckIcon,
  DocumentDuplicateIcon,
  PencilIcon,
  PhotoIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  edit: 'Edit',
  duplicate: 'Duplicate',
  delete: 'Delete',
  confirmDelete: 'Are you sure you want to delete this poster?',
  deletePoster: 'Delete Poster',
  cancel: 'Cancel',
  noPosters: 'No saved posters found',
  createFirstPoster: 'Create your first poster to get started',
  createPoster: 'Create Poster',
  lastUpdated: 'Last updated',
  selectAll: 'Select All',
  deselectAll: 'Deselect All',
  deleteSelected: 'Delete Selected ({count})',
  confirmBulkDelete:
    'Are you sure you want to delete {count} selected poster(s)?',
  deleting: 'Deleting... ({current}/{total})',
  posterInUse: 'Poster is Currently in Use',
  posterInUseDescription:
    'This poster is currently being used by the following collections:',
  deleteAnyway: 'Delete Anyway',
  postersInUse: 'Some Posters Are in Use',
  postersInUseDescription:
    'The following posters are currently in use. Do you want to delete them anyway?',
  deleteUnusedOnly: 'Delete Unused Only',
  deleteAllAnyway: 'Delete All Anyway',
});

interface SavedPoster {
  id: number | string;
  name: string;
  description?: string;
  posterData: PosterEditorData | null;
  filename?: string;
  thumbnailFilename?: string;
  createdAt: string;
  updatedAt: string;
  updatedAtMs?: number | null; // Numeric timestamp for cache-busting
  isEditable?: boolean;
}

interface SavedPosterGridProps {
  savedPosters: SavedPoster[];
  onPosterUpdate: () => void;
}

const SavedPosterGrid: React.FC<SavedPosterGridProps> = ({
  savedPosters,
  onPosterUpdate,
}) => {
  const intl = useIntl();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<EditorMode>('edit-poster');
  const [selectedPoster, setSelectedPoster] = useState<SavedPoster | null>(
    null
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<
    number | string | null
  >(null);
  const [selectedPosters, setSelectedPosters] = useState<Set<number | string>>(
    new Set()
  );
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [deleteUsageModal, setDeleteUsageModal] = useState<{
    posterId: number | string;
    posterName: string;
    usedBy: {
      type: 'collection' | 'preExisting';
      id: string;
      name: string;
      libraryName: string;
    }[];
  } | null>(null);
  const [bulkDeleteUsageModal, setBulkDeleteUsageModal] = useState<{
    postersInUse: {
      id: number | string;
      name: string;
      usedBy: {
        type: 'collection' | 'preExisting';
        id: string;
        name: string;
        libraryName: string;
      }[];
    }[];
    unusedPosterIds: (number | string)[];
  } | null>(null);

  const showCheckboxes = selectedPosters.size > 0;
  const isDeleting = deletionProgress !== null;

  // Reset delete confirmation when clicking outside or pressing escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDeleteConfirmId(null);
        setBulkDeleteConfirm(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      // Reset delete confirmation when clicking outside the button
      const target = e.target as Element;
      if (!target.closest('[data-delete-button]')) {
        setDeleteConfirmId(null);
      }
      if (!target.closest('[data-bulk-delete-button]')) {
        setBulkDeleteConfirm(false);
      }
    };

    if (deleteConfirmId !== null || bulkDeleteConfirm) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [deleteConfirmId, bulkDeleteConfirm]);

  const handleEdit = (poster: SavedPoster) => {
    setSelectedPoster(poster);
    setModalMode('edit-poster');
    setIsModalOpen(true);
  };

  const handleDuplicate = (poster: SavedPoster) => {
    setSelectedPoster(poster);
    setModalMode('create-poster');
    setIsModalOpen(true);
  };

  const handleDelete = async (posterId: number | string, force = false) => {
    try {
      const url = force
        ? `/api/v1/posters/saved/${posterId}?force=true`
        : `/api/v1/posters/saved/${posterId}`;

      const response = await fetch(url, {
        method: 'DELETE',
      });

      if (response.ok || response.status === 204) {
        onPosterUpdate();
        setDeleteConfirmId(null);
        setDeleteUsageModal(null);
      } else if (response.status === 409) {
        // Poster is in use by collections
        const errorData = await response.json();
        const poster = savedPosters.find((p) => p.id === posterId);

        setDeleteUsageModal({
          posterId,
          posterName: poster?.name || posterId.toString(),
          usedBy: errorData.usedBy || [],
        });
        setDeleteConfirmId(null);
      } else {
        throw new Error('Failed to delete poster');
      }
    } catch (error) {
      // Error logged silently for debugging
      setDeleteConfirmId(null);
      setDeleteUsageModal(null);
    }
  };

  const handleConfirmForceDelete = async () => {
    if (deleteUsageModal) {
      await handleDelete(deleteUsageModal.posterId, true);
    }
  };

  const handleToggleSelect = (posterId: number | string) => {
    setSelectedPosters((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(posterId)) {
        newSet.delete(posterId);
      } else {
        newSet.add(posterId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    setSelectedPosters(new Set(savedPosters.map((p) => p.id)));
  };

  const handleDeselectAll = () => {
    setSelectedPosters(new Set());
    setBulkDeleteConfirm(false);
  };

  const handleBulkDelete = async () => {
    if (!bulkDeleteConfirm) {
      setBulkDeleteConfirm(true);
      return;
    }

    const postersToDelete = Array.from(selectedPosters);

    // Check which posters are in use
    const postersInUse: {
      id: number | string;
      name: string;
      usedBy: {
        type: 'collection' | 'preExisting';
        id: string;
        name: string;
        libraryName: string;
      }[];
    }[] = [];
    const unusedPosterIds: (number | string)[] = [];

    for (const posterId of postersToDelete) {
      try {
        const response = await fetch(`/api/v1/posters/saved/${posterId}`, {
          method: 'DELETE',
        });

        if (response.status === 409) {
          const errorData = await response.json();
          const poster = savedPosters.find((p) => p.id === posterId);
          postersInUse.push({
            id: posterId,
            name: poster?.name || posterId.toString(),
            usedBy: errorData.usedBy || [],
          });
        } else if (response.ok || response.status === 204) {
          // Successfully deleted unused poster
          unusedPosterIds.push(posterId);
        }
      } catch (error) {
        // Error checking - treat as unused and try to delete later
        unusedPosterIds.push(posterId);
      }
    }

    if (postersInUse.length > 0) {
      // Show modal with options
      setBulkDeleteUsageModal({
        postersInUse,
        unusedPosterIds,
      });
      setBulkDeleteConfirm(false);
    } else {
      // All deleted successfully
      onPosterUpdate();
      setSelectedPosters(new Set());
      setBulkDeleteConfirm(false);
    }
  };

  const handleBulkDeleteUnusedOnly = async () => {
    if (!bulkDeleteUsageModal) return;

    // The unused ones were already deleted during the check
    onPosterUpdate();
    setSelectedPosters(new Set());
    setBulkDeleteUsageModal(null);
  };

  const handleBulkDeleteAllAnyway = async () => {
    if (!bulkDeleteUsageModal) return;

    const { postersInUse } = bulkDeleteUsageModal;
    setDeletionProgress({ current: 0, total: postersInUse.length });

    for (let i = 0; i < postersInUse.length; i++) {
      const poster = postersInUse[i];
      setDeletionProgress({ current: i + 1, total: postersInUse.length });

      try {
        await fetch(`/api/v1/posters/saved/${poster.id}?force=true`, {
          method: 'DELETE',
        });
      } catch (error) {
        // Silent error - continue with next
      }
    }

    onPosterUpdate();
    setSelectedPosters(new Set());
    setBulkDeleteUsageModal(null);
    setDeletionProgress(null);
  };

  const handleSave = async (data: {
    name: string;
    description?: string;
    posterData: PosterEditorData;
  }) => {
    if (modalMode === 'edit-poster' && selectedPoster) {
      // Update existing poster
      const response = await fetch(
        `/api/v1/posters/saved/${selectedPoster.id}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: data.name,
            description: data.description,
            posterData: data.posterData,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update poster');
      }
    } else {
      // Create new poster (duplicate)
      const response = await fetch('/api/v1/posters/saved', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          posterData: data.posterData,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create poster');
      }
    }

    onPosterUpdate();
  };

  if (savedPosters.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto max-w-sm">
          <PhotoIcon className="mx-auto h-12 w-12 text-stone-400" />
          <p className="mt-4 text-lg text-stone-300">
            {intl.formatMessage(messages.noPosters)}
          </p>
          <p className="mt-2 text-stone-400">
            {intl.formatMessage(messages.createFirstPoster)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Bulk Action Toolbar */}
      {showCheckboxes && (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-stone-800 p-3">
          <Button buttonType="ghost" onClick={handleSelectAll}>
            {intl.formatMessage(messages.selectAll)}
          </Button>
          <Button buttonType="ghost" onClick={handleDeselectAll}>
            {intl.formatMessage(messages.deselectAll)}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-stone-400">
              {selectedPosters.size} selected
            </span>
            <Button
              buttonType="danger"
              data-bulk-delete-button
              onClick={handleBulkDelete}
              disabled={isDeleting}
            >
              {isDeleting && deletionProgress
                ? intl.formatMessage(messages.deleting, {
                    current: deletionProgress.current,
                    total: deletionProgress.total,
                  })
                : bulkDeleteConfirm
                ? intl.formatMessage(messages.confirmBulkDelete, {
                    count: selectedPosters.size,
                  })
                : intl.formatMessage(messages.deleteSelected, {
                    count: selectedPosters.size,
                  })}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        {savedPosters.map((poster) => (
          <div
            key={poster.id}
            className="group relative overflow-hidden rounded border border-stone-700 transition-colors duration-200 hover:border-orange-500"
          >
            {/* Compact Poster Preview */}
            <div className="relative aspect-[2/3] bg-stone-700">
              {poster.thumbnailFilename ? (
                <img
                  src={`/api/v1/posters/thumbnails/${
                    poster.thumbnailFilename
                  }?v=${poster.updatedAtMs || Date.now()}`}
                  alt={poster.name}
                  className="h-full w-full object-cover"
                />
              ) : poster.filename ? (
                <img
                  src={`/api/v1/posters/files/${poster.filename}?v=${
                    poster.updatedAtMs || Date.now()
                  }`}
                  alt={poster.name}
                  className="h-full w-full object-cover"
                />
              ) : poster.posterData ? (
                <div
                  className="flex h-full w-full items-center justify-center text-xs text-stone-400"
                  style={{
                    background:
                      poster.posterData.background.type === 'gradient'
                        ? `linear-gradient(to bottom, ${
                            poster.posterData.background.color || '#6366f1'
                          }, ${
                            poster.posterData.background.secondaryColor ||
                            '#1e1b4b'
                          })`
                        : poster.posterData.background.color || '#6366f1',
                  }}
                >
                  <div className="p-1 text-center text-xs font-semibold text-white">
                    {poster.name}
                  </div>
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-stone-600">
                  <PhotoIcon className="h-6 w-6 text-stone-400" />
                </div>
              )}

              {/* Checkbox - show on hover or when any checkbox is selected */}
              <div
                className={`absolute top-2 left-2 z-10 transition-opacity duration-200 ${
                  showCheckboxes
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleSelect(poster.id);
                  }}
                  className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-all ${
                    selectedPosters.has(poster.id)
                      ? 'border-orange-500 bg-orange-500'
                      : 'border-white bg-black bg-opacity-50 hover:border-orange-400'
                  }`}
                >
                  {selectedPosters.has(poster.id) && (
                    <CheckIcon className="h-3 w-3 text-white" />
                  )}
                </button>
              </div>

              {/* Overlay with actions - only show on hover */}
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 opacity-0 transition-all duration-200 group-hover:bg-opacity-40 group-hover:opacity-100">
                <div className="flex space-x-1">
                  {poster.isEditable !== false && (
                    <>
                      <button
                        onClick={() => handleEdit(poster)}
                        className="rounded bg-stone-700 p-1 text-white transition-colors hover:bg-stone-600"
                        title="Edit"
                      >
                        <PencilIcon className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleDuplicate(poster)}
                        className="rounded bg-stone-700 p-1 text-white transition-colors hover:bg-stone-600"
                        title="Duplicate"
                      >
                        <DocumentDuplicateIcon className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  <button
                    data-delete-button
                    onClick={() => {
                      if (deleteConfirmId === poster.id) {
                        handleDelete(poster.id);
                      } else {
                        setDeleteConfirmId(poster.id);
                      }
                    }}
                    className="rounded bg-red-600 px-2 py-1 text-white transition-colors hover:bg-red-700"
                    title={
                      deleteConfirmId === poster.id
                        ? 'Click to confirm deletion'
                        : 'Delete'
                    }
                  >
                    {deleteConfirmId === poster.id ? (
                      <span className="text-xs">Delete</span>
                    ) : (
                      <TrashIcon className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>

              {/* Status badges - show on image */}
              <div className="absolute top-1 right-1">
                {!poster.isEditable && (
                  <Badge badgeType="warning" className="text-xs">
                    File
                  </Badge>
                )}
              </div>
            </div>

            {/* Compact title */}
            <div className="bg-stone-800 p-2">
              <h3
                className="truncate text-xs font-medium text-white"
                title={poster.name}
              >
                {poster.name}
              </h3>
            </div>
          </div>
        ))}
      </div>

      <PosterEditorModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedPoster(null);
        }}
        mode={modalMode}
        initialData={selectedPoster?.posterData || undefined}
        initialName={selectedPoster?.name}
        initialDescription={selectedPoster?.description}
        onSave={handleSave}
      />

      {/* Single Poster Usage Modal */}
      {deleteUsageModal && (
        <Modal
          title={intl.formatMessage(messages.posterInUse)}
          onCancel={() => setDeleteUsageModal(null)}
          onOk={handleConfirmForceDelete}
          cancelText={intl.formatMessage(messages.cancel)}
          okText={intl.formatMessage(messages.deleteAnyway)}
          okButtonType="danger"
        >
          <div className="text-sm">
            <p className="mb-4">
              {intl.formatMessage(messages.posterInUseDescription)}
            </p>
            <ul className="space-y-2">
              {deleteUsageModal.usedBy.map((usage) => (
                <li
                  key={usage.id}
                  className="rounded-md bg-gray-800 p-3 text-gray-200"
                >
                  <div className="font-semibold">{usage.name}</div>
                  <div className="text-xs text-gray-400">
                    {usage.libraryName}
                    {usage.type === 'preExisting' && ' (Pre-existing)'}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}

      {/* Bulk Delete Usage Modal */}
      {bulkDeleteUsageModal && (
        <Modal
          title={intl.formatMessage(messages.postersInUse)}
          onCancel={() => setBulkDeleteUsageModal(null)}
          onOk={handleBulkDeleteAllAnyway}
          onSecondary={handleBulkDeleteUnusedOnly}
          cancelText={intl.formatMessage(messages.cancel)}
          okText={intl.formatMessage(messages.deleteAllAnyway)}
          secondaryText={intl.formatMessage(messages.deleteUnusedOnly)}
          okButtonType="danger"
          secondaryButtonType="warning"
          loading={deletionProgress !== null}
        >
          <div className="text-sm">
            <p className="mb-4">
              {intl.formatMessage(messages.postersInUseDescription)}
            </p>
            {bulkDeleteUsageModal.unusedPosterIds.length > 0 && (
              <p className="mb-4 text-green-400">
                {bulkDeleteUsageModal.unusedPosterIds.length} unused poster(s)
                have already been deleted.
              </p>
            )}
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {bulkDeleteUsageModal.postersInUse.map((poster) => (
                <div
                  key={poster.id}
                  className="rounded-md border border-gray-700 bg-gray-800 p-3"
                >
                  <div className="mb-2 font-semibold text-white">
                    {poster.name}
                  </div>
                  <ul className="space-y-1">
                    {poster.usedBy.map((usage) => (
                      <li
                        key={usage.id}
                        className="rounded bg-gray-900 px-2 py-1 text-xs text-gray-300"
                      >
                        {usage.name} ({usage.libraryName}
                        {usage.type === 'preExisting' && ' - Pre-existing'})
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default SavedPosterGrid;
