import type { CollectionFormConfig } from '@app/types/collections';
import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/24/solid';
import { Fragment, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
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
  selectTemplate: 'Select Template',
  defaultTemplate: 'Default Template',
  templateHelp:
    'Choose a template for auto-generated posters. Leave blank to use the default template.',
});

interface Library {
  key: string;
  name: string;
  type: string;
}

interface PosterTemplate {
  id: number;
  name: string;
  description?: string;
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

  // Fetch available poster templates
  const { data: templatesResponse } = useSWR<{ templates: PosterTemplate[] }>(
    '/api/v1/posters/templates'
  );
  const templates = templatesResponse?.templates;

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

  // Get current selected template
  const selectedTemplateId = values.autoPosterTemplate || null;
  const selectedTemplate = templates?.find((t) => t.id === selectedTemplateId);

  const handleAutoPosterChange = (enabled: boolean) => {
    setFieldValue('autoPoster', enabled);
  };

  const handleTemplateSelection = (templateId: number | null) => {
    setFieldValue('autoPosterTemplate', templateId);
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

        {/* Template selection when auto-poster is enabled */}
        {isAutoPosterEnabled && (
          <div className="mt-4">
            <label className="text-label">
              {intl.formatMessage(messages.selectTemplate)}
            </label>
            <Menu as="div" className="relative mt-2">
              <Menu.Button className="relative w-full cursor-default rounded-md bg-stone-700 py-2 pl-3 pr-10 text-left shadow-sm ring-1 ring-inset ring-stone-600 focus:outline-none focus:ring-2 focus:ring-orange-500 sm:text-sm">
                <span className="block truncate text-white">
                  {selectedTemplate?.name ||
                    intl.formatMessage(messages.defaultTemplate)}
                </span>
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                  <ChevronDownIcon
                    className="h-5 w-5 text-stone-400"
                    aria-hidden="true"
                  />
                </span>
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
                <Menu.Items className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-stone-700 py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={() => handleTemplateSelection(null)}
                        className={`relative w-full cursor-default select-none py-2 pl-3 pr-9 text-left ${
                          active ? 'bg-orange-600 text-white' : 'text-stone-200'
                        }`}
                      >
                        <span
                          className={`block truncate ${
                            selectedTemplateId === null
                              ? 'font-semibold'
                              : 'font-normal'
                          }`}
                        >
                          {intl.formatMessage(messages.defaultTemplate)}
                        </span>
                        {selectedTemplateId === null && (
                          <span
                            className={`absolute inset-y-0 right-0 flex items-center pr-4 ${
                              active ? 'text-white' : 'text-orange-600'
                            }`}
                          >
                            ✓
                          </span>
                        )}
                      </button>
                    )}
                  </Menu.Item>
                  {templates?.map((template) => (
                    <Menu.Item key={template.id}>
                      {({ active }) => (
                        <button
                          onClick={() => handleTemplateSelection(template.id)}
                          className={`relative w-full cursor-default select-none py-2 pl-3 pr-9 text-left ${
                            active
                              ? 'bg-orange-600 text-white'
                              : 'text-stone-200'
                          }`}
                        >
                          <span
                            className={`block truncate ${
                              selectedTemplateId === template.id
                                ? 'font-semibold'
                                : 'font-normal'
                            }`}
                          >
                            {template.name}
                          </span>
                          {template.description && (
                            <span className="block truncate text-xs text-stone-400">
                              {template.description}
                            </span>
                          )}
                          {selectedTemplateId === template.id && (
                            <span
                              className={`absolute inset-y-0 right-0 flex items-center pr-4 ${
                                active ? 'text-white' : 'text-orange-600'
                              }`}
                            >
                              ✓
                            </span>
                          )}
                        </button>
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Items>
              </Transition>
            </Menu>
            <div className="label-tip mt-1">
              {intl.formatMessage(messages.templateHelp)}
            </div>
          </div>
        )}
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
