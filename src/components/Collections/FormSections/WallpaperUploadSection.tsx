import type { CollectionFormConfig } from '@app/types/collections';
import { PlusIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import { useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  uploadingWallpaper: 'Uploading wallpaper...',
  wallpaperUploadHelpMulti:
    'Upload custom wallpaper images for each selected library. Wallpapers will be applied to Plex collections during the next sync.',
  wallpaperRemoveConfirm: 'Wallpaper will be removed on next collection sync',
  wallpaperUploadSuccess:
    'Wallpaper uploaded successfully. Will be applied on next collection sync.',
  wallpaperUploadErrorSize: 'File size must be less than 10MB',
  wallpaperUploadErrorType: 'Only JPEG, PNG, and WebP files are allowed',
  wallpaperUploadErrorGeneric: 'Upload failed',
  wallpaperUploadErrorNetwork: 'Network error occurred',
  selectLibrariesForWallpapers:
    'Select libraries first to upload custom wallpapers.',
});

interface Library {
  key: string;
  name: string;
  type: string;
}

interface WallpaperUploadSectionProps {
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
  libraries?: Library[];
  selectedLibraryIds?: string[];
}

const WallpaperUploadSection = ({
  values,
  setFieldValue,
  addToast,
  fieldId = 'customWallpaper',
  libraries = [],
  selectedLibraryIds = [],
}: WallpaperUploadSectionProps) => {
  const intl = useIntl();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingForLibrary, setUploadingForLibrary] = useState<string | null>(
    null
  );

  // Get current wallpaper data as Record<string, string>
  const currentWallpapers = (() => {
    const customWallpaper = values.customWallpaper;
    if (!customWallpaper) return {};
    if (typeof customWallpaper === 'string') {
      // Legacy single wallpaper - convert to per-library format
      return selectedLibraryIds.length > 0
        ? { [selectedLibraryIds[0]]: customWallpaper }
        : {};
    }
    return customWallpaper;
  })();

  // Get selected libraries with their details
  const selectedLibraries = libraries.filter((lib) =>
    selectedLibraryIds.includes(lib.key)
  );

  const handleRemoveWallpaper = (libraryId: string) => {
    const updatedWallpapers = { ...currentWallpapers };
    delete updatedWallpapers[libraryId];

    // If no wallpapers left, set to empty object
    setFieldValue(
      fieldId,
      Object.keys(updatedWallpapers).length > 0 ? updatedWallpapers : {}
    );

    addToast(intl.formatMessage(messages.wallpaperRemoveConfirm), {
      appearance: 'info',
      autoDismiss: true,
    });
  };

  const handleFileSelect = async (
    libraryId: string,
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      addToast(intl.formatMessage(messages.wallpaperUploadErrorType), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      addToast(intl.formatMessage(messages.wallpaperUploadErrorSize), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setUploadingForLibrary(libraryId);

    try {
      const formData = new FormData();
      formData.append('wallpaper', file);

      const response = await axios.post('/api/v1/uploads/wallpaper', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const { filename } = response.data;

      // Update the wallpaper for the specific library
      const newWallpapers = { ...currentWallpapers };
      newWallpapers[libraryId] = filename;

      // Save the updated wallpapers to form
      setFieldValue(
        fieldId,
        Object.keys(newWallpapers).length > 0 ? newWallpapers : null
      );

      addToast(intl.formatMessage(messages.wallpaperUploadSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });

      // Reset file input
      const fileInput = fileInputRefs.current[libraryId];
      if (fileInput) {
        fileInput.value = '';
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        addToast(
          error.response?.data?.error ||
            intl.formatMessage(messages.wallpaperUploadErrorNetwork),
          {
            appearance: 'error',
            autoDismiss: true,
          }
        );
      } else {
        addToast(intl.formatMessage(messages.wallpaperUploadErrorGeneric), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } finally {
      setUploadingForLibrary(null);
    }
  };

  const handleButtonClick = (libraryId: string) => {
    fileInputRefs.current[libraryId]?.click();
  };

  if (selectedLibraryIds.length === 0) {
    return (
      <div className="label-tip">
        {intl.formatMessage(messages.selectLibrariesForWallpapers)}
      </div>
    );
  }

  return (
    <>
      {/* Horizontal library wallpaper uploads */}
      <div className="flex flex-wrap gap-4">
        {selectedLibraries.map((library) => {
          const libraryWallpaper = currentWallpapers[library.key];
          const isUploading = uploadingForLibrary === library.key;

          return (
            <div key={library.key} className="flex flex-col items-center">
              <div className="mb-2 text-xs text-gray-500">{library.name}</div>

              {/* Wallpaper preview or upload button */}
              <div className="group relative">
                {libraryWallpaper ? (
                  <div className="relative">
                    <img
                      src={`/wallpaper-files/${libraryWallpaper}`}
                      alt={`Wallpaper for ${library.name}`}
                      className="h-16 w-28 rounded border object-cover shadow-sm"
                    />
                    <div className="absolute inset-0 flex items-center justify-center space-x-1 rounded bg-black bg-opacity-50 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => handleButtonClick(library.key)}
                        className="rounded bg-stone-700 p-1 text-xs text-white hover:bg-stone-600"
                        title="Change"
                        disabled={isUploading}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveWallpaper(library.key)}
                        className="rounded bg-stone-700 p-1 text-xs text-red-400 hover:bg-stone-600"
                        title="Remove"
                        disabled={isUploading}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`flex h-16 w-28 cursor-pointer items-center justify-center rounded border-2 border-dashed border-gray-300 transition-colors hover:border-orange-500 ${
                      isUploading ? 'cursor-wait opacity-50' : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      !isUploading && handleButtonClick(library.key)
                    }
                    onKeyDown={(e) => {
                      if (
                        !isUploading &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault();
                        handleButtonClick(library.key);
                      }
                    }}
                  >
                    {isUploading ? (
                      <span className="text-xs text-gray-400">
                        {intl.formatMessage(messages.uploadingWallpaper)}
                      </span>
                    ) : (
                      <PlusIcon className="h-6 w-6 text-gray-400" />
                    )}
                  </div>
                )}

                {/* Hidden file input */}
                <input
                  ref={(el) => (fileInputRefs.current[library.key] = el)}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleFileSelect(library.key, e)}
                  disabled={isUploading}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="label-tip">
        {intl.formatMessage(messages.wallpaperUploadHelpMulti)}
      </div>
    </>
  );
};

export default WallpaperUploadSection;
