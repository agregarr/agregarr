import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import type {
  EditorMode,
  PosterEditorData,
} from '@app/components/PosterEditor';
import { PosterEditorModal } from '@app/components/PosterEditor';
import { Menu, Transition } from '@headlessui/react';
import {
  DocumentDuplicateIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PhotoIcon,
  TrashIcon,
} from '@heroicons/react/24/solid';
import { Fragment, useState } from 'react';
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
  id: number;
  name: string;
  description?: string;
  posterData: PosterEditorData;
  imagePath?: string;
  thumbnailPath?: string;
  createdAt: string;
  updatedAt: string;
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

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

  const handleDelete = async (posterId: number) => {
    const response = await fetch(`/api/v1/posters/saved/${posterId}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      onPosterUpdate();
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
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {savedPosters.map((poster) => (
          <div
            key={poster.id}
            className="hover:bg-stone-750 group relative overflow-hidden rounded-lg bg-stone-800 transition-colors duration-200"
          >
            {/* Poster Preview */}
            <div className="relative aspect-[2/3] bg-stone-700">
              {poster.thumbnailPath ? (
                <img
                  src={`/api/v1/posters/images/${poster.thumbnailPath}`}
                  alt={poster.name}
                  className="h-full w-full object-cover"
                />
              ) : (
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
                  <div className="p-4 text-center font-semibold text-white">
                    {poster.name}
                  </div>
                </div>
              )}
            </div>

            {/* Poster Info */}
            <div className="p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-white">
                    {poster.name}
                  </h3>
                  {poster.description && (
                    <p className="line-clamp-2 mt-1 text-xs text-stone-400">
                      {poster.description}
                    </p>
                  )}
                  <div className="mt-2 flex items-center space-x-2">
                    <Badge badgeType="default" className="text-xs">
                      {poster.posterData.width}x{poster.posterData.height}
                    </Badge>
                    <span className="text-xs text-stone-500">
                      {intl.formatMessage(messages.lastUpdated)}{' '}
                      {new Date(poster.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Actions Menu */}
                <Menu as="div" className="relative">
                  <Menu.Button className="flex items-center rounded-full p-1 text-stone-400 hover:bg-stone-700 hover:text-white">
                    <EllipsisVerticalIcon className="h-5 w-5" />
                  </Menu.Button>
                  <Transition
                    as={Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                  >
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-stone-700 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => handleEdit(poster)}
                            className={`${
                              active ? 'bg-stone-600' : ''
                            } flex w-full items-center px-4 py-2 text-left text-sm text-stone-200`}
                          >
                            <PencilIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.edit)}
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => handleDuplicate(poster)}
                            className={`${
                              active ? 'bg-stone-600' : ''
                            } flex w-full items-center px-4 py-2 text-left text-sm text-stone-200`}
                          >
                            <DocumentDuplicateIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.duplicate)}
                          </button>
                        )}
                      </Menu.Item>
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={() => setDeleteConfirmId(poster.id)}
                            className={`${
                              active ? 'bg-stone-600' : ''
                            } flex w-full items-center px-4 py-2 text-left text-sm text-red-400`}
                          >
                            <TrashIcon className="mr-3 h-4 w-4" />
                            {intl.formatMessage(messages.delete)}
                          </button>
                        )}
                      </Menu.Item>
                    </Menu.Items>
                  </Transition>
                </Menu>
              </div>
            </div>

            {/* Delete Confirmation */}
            {deleteConfirmId === poster.id && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 p-4">
                <div className="w-full max-w-sm rounded-lg bg-stone-800 p-4">
                  <h4 className="mb-2 font-medium text-white">
                    {intl.formatMessage(messages.deletePoster)}
                  </h4>
                  <p className="mb-4 text-sm text-stone-300">
                    {intl.formatMessage(messages.confirmDelete)}
                  </p>
                  <div className="flex space-x-2">
                    <Button
                      buttonType="danger"
                      onClick={() => handleDelete(poster.id)}
                      className="flex-1"
                    >
                      {intl.formatMessage(messages.delete)}
                    </Button>
                    <Button
                      buttonType="ghost"
                      onClick={() => setDeleteConfirmId(null)}
                      className="flex-1"
                    >
                      {intl.formatMessage(messages.cancel)}
                    </Button>
                  </div>
                </div>
              </div>
            )}
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
        initialData={selectedPoster?.posterData}
        onSave={handleSave}
      />
    </>
  );
};

export default SavedPosterGrid;
