import Badge from '@app/components/Common/Badge';
import type {
  EditorMode,
  PosterEditorData,
} from '@app/components/PosterEditor';
import { PosterEditorModal } from '@app/components/PosterEditor';
import {
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

  // Reset delete confirmation when clicking outside or pressing escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDeleteConfirmId(null);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      // Reset delete confirmation when clicking outside the button
      const target = e.target as Element;
      if (!target.closest('[data-delete-button]')) {
        setDeleteConfirmId(null);
      }
    };

    if (deleteConfirmId !== null) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [deleteConfirmId]);

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

  const handleDelete = async (posterId: number | string) => {
    try {
      const response = await fetch(`/api/v1/posters/saved/${posterId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        onPosterUpdate();
        setDeleteConfirmId(null);
      } else if (response.status === 409) {
        // Poster is in use by collections
        const errorData = await response.json();
        const collectionNames =
          errorData.collections?.join(', ') || 'unknown collections';
        alert(
          `Cannot delete poster: it's currently used by ${collectionNames}`
        );
        setDeleteConfirmId(null);
      } else {
        throw new Error('Failed to delete poster');
      }
    } catch (error) {
      // Error logged silently for debugging
      setDeleteConfirmId(null);
    }
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
                  src={`/api/v1/posters/thumbnails/${poster.thumbnailFilename}`}
                  alt={poster.name}
                  className="h-full w-full object-cover"
                />
              ) : poster.filename ? (
                <img
                  src={`/api/v1/posters/files/${poster.filename}`}
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
              <div className="absolute top-1 left-1">
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
    </>
  );
};

export default SavedPosterGrid;
