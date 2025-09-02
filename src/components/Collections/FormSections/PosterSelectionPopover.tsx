import { PlusIcon, TrashIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  selectPoster: 'Select Poster',
  uploadNewPoster: 'Upload New Poster',
  generatePoster: 'Generate Poster',
  deletePoster: 'Delete Poster',
  noPosterAvailable: 'No posters available',
  uploading: 'Uploading...',
  generating: 'Generating...',
  deleting: 'Deleting...',
  posterUploadSuccess: 'Poster uploaded successfully',
  posterGenerateSuccess: 'Poster generated successfully',
  posterDeleteSuccess: 'Poster deleted successfully',
  posterUploadError: 'Failed to upload poster',
  posterGenerateError: 'Failed to generate poster',
  posterDeleteError: 'Failed to delete poster',
  confirmDelete: 'Are you sure you want to delete this poster?',
});

interface Poster {
  filename: string;
  url: string;
}

interface PosterSelectionPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (filename: string) => void;
  currentPoster?: string;
  libraryName?: string;
  addToast: (
    message: string,
    options?: {
      appearance?: 'success' | 'error' | 'warning' | 'info';
      autoDismiss?: boolean;
    }
  ) => void;
  // Collection config for poster generation
  collectionConfig?: {
    name: string;
    type?: string;
    subtype?: string;
    mediaType?: 'movie' | 'tv';
    template?: string;
    customMovieTemplate?: string;
    customTVTemplate?: string;
  };
}

const PosterSelectionPopover: React.FC<PosterSelectionPopoverProps> = ({
  isOpen,
  onClose,
  onSelect,
  currentPoster,
  libraryName,
  addToast,
  collectionConfig,
}) => {
  const intl = useIntl();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [posters, setPosters] = useState<Poster[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  // Fetch posters when popover opens
  useEffect(() => {
    const fetchPosters = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/v1/collections/posters');
        setPosters(response.data.posters || []);
      } catch (error) {
        addToast('Failed to load posters', { appearance: 'error' });
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      fetchPosters();
    }
  }, [isOpen, addToast]);

  const refetchPosters = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/v1/collections/posters');
      setPosters(response.data.posters || []);
    } catch (error) {
      addToast('Failed to load posters', { appearance: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input value so the same file can be selected again
    event.target.value = '';

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      addToast('Only JPEG, PNG, and WebP files are allowed', {
        appearance: 'error',
      });
      return;
    }

    // Validate file size (10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      addToast('File size must be less than 10MB', { appearance: 'error' });
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('poster', file);

      const response = await axios.post('/upload-poster', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Refresh poster list
      await refetchPosters();

      // Auto-select the newly uploaded poster
      onSelect(response.data.filename);
      onClose();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        addToast(error.response.data.error, { appearance: 'error' });
      } else {
        addToast(intl.formatMessage(messages.posterUploadError), {
          appearance: 'error',
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const handleGeneratePoster = async () => {
    if (!collectionConfig?.name) {
      addToast('Collection name is required to generate a poster', {
        appearance: 'error',
      });
      return;
    }

    try {
      setGenerating(true);

      const response = await axios.post('/api/v1/collections/generate-poster', {
        collectionName: collectionConfig.name,
        collectionType: collectionConfig.type,
        collectionSubtype: collectionConfig.subtype,
        mediaType: collectionConfig.mediaType,
        template: collectionConfig.template,
        customMovieTemplate: collectionConfig.customMovieTemplate,
        customTVTemplate: collectionConfig.customTVTemplate,
      });

      // Refresh poster list
      await refetchPosters();

      // Auto-select the newly generated poster
      onSelect(response.data.filename);
      onClose();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.error) {
        addToast(error.response.data.error, { appearance: 'error' });
      } else {
        addToast(intl.formatMessage(messages.posterGenerateError), {
          appearance: 'error',
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDeletePoster = async (
    filename: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();

    if (!window.confirm(intl.formatMessage(messages.confirmDelete))) {
      return;
    }

    try {
      setDeleting(filename);
      await axios.delete(`/api/v1/collections/poster/${filename}`);

      addToast(intl.formatMessage(messages.posterDeleteSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });

      // Refresh poster list
      await refetchPosters();

      // If this was the currently selected poster, clear the selection
      if (currentPoster === filename) {
        onSelect('');
      }
    } catch (error) {
      addToast(intl.formatMessage(messages.posterDeleteError), {
        appearance: 'error',
      });
    } finally {
      setDeleting(null);
    }
  };

  const handlePosterClick = (filename: string) => {
    onSelect(filename);
    onClose();
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute top-full left-0 z-50 mt-1 w-80 rounded-lg border-2 border-stone-600 bg-stone-800 shadow-xl shadow-black/30"
    >
      <div className="p-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">
            {intl.formatMessage(messages.selectPoster)}
            {libraryName && (
              <span className="ml-1 text-xs font-normal text-stone-400">
                for {libraryName}
              </span>
            )}
          </h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-orange-600"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Poster Grid - Compact */}
            {posters.length > 0 ? (
              <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto">
                {posters.map((poster) => (
                  <div
                    key={poster.filename}
                    className={`group relative cursor-pointer overflow-hidden rounded border transition-all ${
                      currentPoster === poster.filename
                        ? 'border-orange-500 ring-1 ring-orange-500'
                        : 'border-stone-600 hover:border-orange-400'
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handlePosterClick(poster.filename)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePosterClick(poster.filename);
                      }
                    }}
                  >
                    <div className="aspect-[2/3] bg-stone-700">
                      <img
                        src={poster.url}
                        alt="Poster"
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>

                    {/* Selection indicator */}
                    {currentPoster === poster.filename && (
                      <div className="absolute inset-0 flex items-center justify-center bg-orange-500 bg-opacity-20">
                        <div className="rounded-full bg-orange-500 p-1 text-white">
                          <svg
                            className="h-3 w-3"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>
                    )}

                    {/* Delete button */}
                    <button
                      type="button"
                      className="absolute top-1 right-1 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"
                      onClick={(e) => handleDeletePoster(poster.filename, e)}
                      disabled={deleting === poster.filename}
                    >
                      {deleting === poster.filename ? (
                        <div className="h-2 w-2 animate-spin rounded-full border border-white border-b-transparent"></div>
                      ) : (
                        <TrashIcon className="h-2 w-2" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-stone-400">
                {intl.formatMessage(messages.noPosterAvailable)}
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              {/* Generate Poster Button - Show only if collection config is provided */}
              {collectionConfig?.name && (
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded bg-orange-600 px-3 py-2 text-sm text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleGeneratePoster}
                  disabled={generating || uploading}
                >
                  {generating ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                      {intl.formatMessage(messages.generating)}
                    </>
                  ) : (
                    <>
                      <svg
                        className="mr-2 h-4 w-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      {intl.formatMessage(messages.generatePoster)}
                    </>
                  )}
                </button>
              )}

              {/* Upload New Poster Button - Compact */}
              <button
                type="button"
                className="flex w-full items-center justify-center rounded border border-dashed border-stone-600 px-3 py-2 text-sm text-white transition-colors hover:border-orange-500 disabled:opacity-50"
                onClick={triggerFileInput}
                disabled={uploading || generating}
              >
                {uploading ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-orange-600"></div>
                    {intl.formatMessage(messages.uploading)}
                  </>
                ) : (
                  <>
                    <PlusIcon className="mr-2 h-4 w-4 text-stone-400" />
                    {intl.formatMessage(messages.uploadNewPoster)}
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PosterSelectionPopover;
