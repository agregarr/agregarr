import type { CollectionFormConfig } from '@app/types/collections';
import { MusicalNoteIcon, PlusIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import { useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  customTheme: 'Custom Theme Music',
  addTheme: 'Add Theme',
  uploading: 'Uploading theme...',
  remove: 'Remove',
  play: 'Play',
  pause: 'Pause',
  themeUploadHelp:
    'Upload a custom theme music file for this collection (MP3, WAV, FLAC, OGG, AAC, or M4A, max 10MB). Theme will be applied to Plex during the next collection sync.',
  themeUploadHelpMulti:
    'Upload custom theme music files for each selected library. Themes will be applied to Plex collections during the next sync.',
  themeRemoveConfirm: 'Theme will be removed on next collection sync',
  themeUploadSuccess:
    'Theme uploaded successfully. Will be applied on next collection sync.',
  themeUploadErrorSize: 'File size must be less than 10MB',
  themeUploadErrorType:
    'Only MP3, WAV, FLAC, OGG, AAC, and M4A files are allowed',
  themeUploadErrorGeneric: 'Upload failed',
  themeUploadErrorNetwork: 'Network error occurred',
});

interface Library {
  key: string;
  name: string;
  type: string;
}

interface ThemeUploadSectionProps {
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

const ThemeUploadSection = ({
  values,
  setFieldValue,
  addToast,
  fieldId = 'customTheme',
  libraries = [],
  selectedLibraryIds = [],
}: ThemeUploadSectionProps) => {
  const intl = useIntl();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const [uploadingForLibrary, setUploadingForLibrary] = useState<string | null>(
    null
  );
  const [playingLibrary, setPlayingLibrary] = useState<string | null>(null);

  // Get current theme data as Record<string, string>
  const currentThemes = (() => {
    const customTheme = values.customTheme;
    if (!customTheme) return {};
    if (typeof customTheme === 'string') {
      // Legacy single theme - convert to per-library format
      return selectedLibraryIds.length > 0
        ? { [selectedLibraryIds[0]]: customTheme }
        : {};
    }
    return customTheme;
  })();

  // Get selected libraries with their details
  const selectedLibraries = libraries.filter((lib) =>
    selectedLibraryIds.includes(lib.key)
  );

  const handleRemoveTheme = (libraryId: string) => {
    // Stop playing if currently playing
    if (playingLibrary === libraryId) {
      audioRefs.current[libraryId]?.pause();
      setPlayingLibrary(null);
    }

    const updatedThemes = { ...currentThemes };
    delete updatedThemes[libraryId];

    // If no themes left, set to empty object
    setFieldValue(
      fieldId,
      Object.keys(updatedThemes).length > 0 ? updatedThemes : {}
    );

    addToast(intl.formatMessage(messages.themeRemoveConfirm), {
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
    const allowedTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/flac',
      'audio/ogg',
      'audio/aac',
      'audio/x-m4a',
    ];
    if (!allowedTypes.includes(file.type)) {
      addToast(intl.formatMessage(messages.themeUploadErrorType), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      addToast(intl.formatMessage(messages.themeUploadErrorSize), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setUploadingForLibrary(libraryId);

    try {
      const formData = new FormData();
      formData.append('theme', file);

      const response = await axios.post('/upload-theme', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const { filename } = response.data;

      // Update the theme for the specific library
      const newThemes = { ...currentThemes };
      newThemes[libraryId] = filename;

      // Save the updated themes to form
      setFieldValue(
        fieldId,
        Object.keys(newThemes).length > 0 ? newThemes : null
      );

      addToast(intl.formatMessage(messages.themeUploadSuccess), {
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
            intl.formatMessage(messages.themeUploadErrorNetwork),
          {
            appearance: 'error',
            autoDismiss: true,
          }
        );
      } else {
        addToast(intl.formatMessage(messages.themeUploadErrorGeneric), {
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

  const handlePlayPause = (libraryId: string) => {
    const audio = audioRefs.current[libraryId];
    if (!audio) return;

    if (playingLibrary === libraryId) {
      audio.pause();
      setPlayingLibrary(null);
    } else {
      // Pause any other playing audio
      if (playingLibrary) {
        audioRefs.current[playingLibrary]?.pause();
      }
      audio.play();
      setPlayingLibrary(libraryId);
    }
  };

  const handleAudioEnded = (libraryId: string) => {
    if (playingLibrary === libraryId) {
      setPlayingLibrary(null);
    }
  };

  if (selectedLibraryIds.length === 0) {
    return (
      <div className="label-tip">
        Select libraries first to upload custom themes.
      </div>
    );
  }

  return (
    <>
      {/* Horizontal library theme uploads */}
      <div className="flex flex-wrap gap-4">
        {selectedLibraries.map((library) => {
          const libraryTheme = currentThemes[library.key];
          const isUploading = uploadingForLibrary === library.key;
          const isPlaying = playingLibrary === library.key;

          return (
            <div key={library.key} className="flex flex-col items-center">
              <div className="mb-2 text-xs text-gray-500">{library.name}</div>

              {/* Theme preview or upload button */}
              <div className="group relative">
                {libraryTheme ? (
                  <div className="relative">
                    {/* Hidden audio element */}
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio
                      ref={(el) => (audioRefs.current[library.key] = el)}
                      src={`/theme-files/${libraryTheme}`}
                      onEnded={() => handleAudioEnded(library.key)}
                    />

                    {/* Theme display */}
                    <div className="flex h-16 w-28 items-center justify-center rounded border bg-stone-800 shadow-sm">
                      <MusicalNoteIcon className="h-8 w-8 text-orange-500" />
                    </div>

                    {/* Hover controls */}
                    <div className="absolute inset-0 flex items-center justify-center space-x-1 rounded bg-black bg-opacity-50 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => handlePlayPause(library.key)}
                        className="rounded bg-stone-700 p-1 text-xs text-white hover:bg-stone-600"
                        title={isPlaying ? 'Pause' : 'Play'}
                        disabled={isUploading}
                      >
                        {isPlaying ? '⏸' : '▶'}
                      </button>
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
                        onClick={() => handleRemoveTheme(library.key)}
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
                        {intl.formatMessage(messages.uploading)}
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
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/flac,audio/ogg,audio/aac,audio/x-m4a"
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
        {intl.formatMessage(messages.themeUploadHelpMulti)}
      </div>
    </>
  );
};

export default ThemeUploadSection;
