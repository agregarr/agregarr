import type { CollectionFormConfig } from '@app/types/collections';
import { PlusIcon } from '@heroicons/react/24/solid';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import PosterSelectionPopover from './PosterSelectionPopover';

const messages = defineMessages({
  customPoster: 'Custom Poster',
  customPosters: 'Custom Posters',
  addPoster: 'Add Poster',
  addPosters: 'Add Posters',
  uploading: 'Uploading poster...',
  remove: 'Remove',
  posterSize: '500x750px',
  posterUploadHelp:
    'Upload a custom poster image for this collection (JPEG, PNG, or WebP, max 10MB). Poster will be applied to Plex during the next collection sync.',
  posterUploadHelpMulti:
    'Upload custom poster images for each selected library. Posters will be applied to Plex collections during the next sync.',
  posterRemoveConfirm: 'Poster will be removed on next collection sync',
  posterUploadSuccess:
    'Poster uploaded successfully. Will be applied on next collection sync.',
  posterUploadErrorSize: 'File size must be less than 10MB',
  posterUploadErrorType: 'Only JPEG, PNG, and WebP files are allowed',
  posterUploadErrorGeneric: 'Upload failed',
  posterUploadErrorNetwork: 'Network error occurred',
  autoPoster: 'Auto-generate posters',
  autoPosterHelp:
    'Automatically generate posters using the collection name during sync. Uncheck to manually upload custom posters instead.',
});

interface Library {
  key: string;
  name: string;
  type: string;
}

interface PosterUploadSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | null
  ) => void;
  addToast: (
    message: string,
    options?: {
      appearance?: 'success' | 'error' | 'warning' | 'info';
      autoDismiss?: boolean;
    }
  ) => void;
  fieldId?: string;
  // Multi-library support (optional)
  libraries?: Library[];
  selectedLibraryIds?: string[];
}

const PosterUploadSection = ({
  values,
  setFieldValue,
  addToast,
  fieldId = 'customPoster',
  libraries = [],
  selectedLibraryIds = [],
}: PosterUploadSectionProps) => {
  const intl = useIntl();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLibraryKey, setSelectedLibraryKey] = useState<string | null>(
    null
  );

  // Convert library type to media type for poster generation
  const getMediaTypeFromLibraryType = (libraryType: string): 'movie' | 'tv' => {
    switch (libraryType.toLowerCase()) {
      case 'movie':
        return 'movie';
      case 'show':
      case 'tv':
        return 'tv';
      default:
        return 'movie'; // Default fallback
    }
  };

  // Get current poster data as Record<string, string>
  const currentPosters = (() => {
    const customPoster = values.customPoster;
    if (!customPoster) return {};
    if (typeof customPoster === 'string') {
      // Legacy single poster - convert to per-library format
      return selectedLibraryIds.length > 0
        ? { [selectedLibraryIds[0]]: customPoster }
        : {};
    }
    return customPoster;
  })();

  // Get selected libraries with their details
  const selectedLibraries = libraries.filter((lib) =>
    selectedLibraryIds.includes(lib.key)
  );

  // Auto-poster is available for all collections, enabled by default
  const isAutoPosterEnabled = values.autoPoster ?? true; // Default to true if not set

  const handleAutoPosterChange = (enabled: boolean) => {
    setFieldValue('autoPoster', enabled);
  };

  const handleRemovePoster = (libraryId: string) => {
    const updatedPosters = { ...currentPosters };
    delete updatedPosters[libraryId];

    // If no posters left, set to empty object
    setFieldValue(
      'customPoster',
      Object.keys(updatedPosters).length > 0 ? updatedPosters : {}
    );

    addToast(intl.formatMessage(messages.posterRemoveConfirm), {
      appearance: 'info',
      autoDismiss: true,
    });
  };

  const handleButtonClick = (libraryId: string) => {
    setSelectedLibraryKey(libraryId);
    setModalOpen(true);
  };

  const handlePosterSelect = (filename: string) => {
    if (!selectedLibraryKey) return;

    // Update the poster for the specific library
    const newPosters = { ...currentPosters };
    if (filename) {
      newPosters[selectedLibraryKey] = filename;
    } else {
      delete newPosters[selectedLibraryKey];
    }

    // Save the updated posters to form
    setFieldValue(
      fieldId,
      Object.keys(newPosters).length > 0 ? newPosters : null
    );

    // Show success message
    addToast(intl.formatMessage(messages.posterUploadSuccess), {
      appearance: 'success',
      autoDismiss: true,
    });
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedLibraryKey(null);
  };

  if (selectedLibraryIds.length === 0) {
    return (
      <div className="label-tip">
        Select libraries first to upload custom posters.
      </div>
    );
  }

  return (
    <>
      {/* Auto-poster toggle for all collections */}
      <div className="mb-6">
        <div className="form-input-field">
          <label className="checkbox-container">
            <input
              type="checkbox"
              checked={isAutoPosterEnabled}
              onChange={(e) => handleAutoPosterChange(e.target.checked)}
            />
            <span className="checkmark" />
            <span className="text-label">
              {intl.formatMessage(messages.autoPoster)}
            </span>
          </label>
        </div>
        <div className="label-tip">
          {intl.formatMessage(messages.autoPosterHelp)}
        </div>
      </div>

      {/* Manual poster uploads - only show when auto-poster is disabled */}
      {!isAutoPosterEnabled && (
        <>
          {/* Horizontal library poster uploads */}
          <div className="flex flex-wrap gap-4">
            {selectedLibraries.map((library) => {
              const libraryPoster = currentPosters[library.key];

              return (
                <div key={library.key} className="flex flex-col items-center">
                  <div className="mb-2 text-xs text-gray-500">
                    {library.name}
                  </div>

                  {/* Poster preview or upload button */}
                  <div className="group relative">
                    {libraryPoster ? (
                      <div className="relative">
                        <img
                          src={`/posters/${libraryPoster}`}
                          alt={`Poster for ${library.name}`}
                          className="h-24 w-16 rounded border object-cover shadow-sm"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src =
                              '/images/overseerr_poster_not_found.png';
                          }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center space-x-1 rounded bg-black bg-opacity-50 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => handleButtonClick(library.key)}
                            className="rounded bg-stone-700 p-1 text-xs text-white hover:bg-stone-600"
                            title="Change"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemovePoster(library.key)}
                            className="rounded bg-stone-700 p-1 text-xs text-red-400 hover:bg-stone-600"
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="flex h-24 w-16 cursor-pointer items-center justify-center rounded border-2 border-dashed border-gray-300 transition-colors hover:border-orange-500"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleButtonClick(library.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleButtonClick(library.key);
                          }
                        }}
                      >
                        <PlusIcon className="h-6 w-6 text-gray-400" />
                      </div>
                    )}

                    {/* Poster Selection Popover */}
                    <PosterSelectionPopover
                      isOpen={modalOpen && selectedLibraryKey === library.key}
                      onClose={handleModalClose}
                      onSelect={handlePosterSelect}
                      currentPoster={libraryPoster}
                      libraryName={library.name}
                      addToast={addToast}
                      collectionConfig={{
                        name: values.name || 'Collection',
                        type: values.type,
                        subtype: values.subtype,
                        mediaType: getMediaTypeFromLibraryType(library.type),
                        template: values.template,
                        customMovieTemplate: values.customMovieTemplate,
                        customTVTemplate: values.customTVTemplate,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="label-tip">
            {intl.formatMessage(messages.posterUploadHelpMulti)}
          </div>
        </>
      )}
    </>
  );
};

export default PosterUploadSection;
