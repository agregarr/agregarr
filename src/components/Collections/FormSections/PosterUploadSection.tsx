import type { CollectionFormConfig } from '@app/types/collections';
import { PlusIcon } from '@heroicons/react/24/solid';
import type React from 'react';
import { useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  customPoster: 'Custom Poster',
  addPoster: 'Add Poster',
  uploading: 'Uploading poster...',
  remove: 'Remove',
  posterSize: '500x750px',
  posterUploadHelp:
    'Upload a custom poster image for this collection (JPEG, PNG, or WebP, max 10MB). Poster will be applied to Plex during the next collection sync.',
  posterRemoveConfirm: 'Poster will be removed on next collection sync',
  posterUploadSuccess:
    'Poster uploaded successfully. Will be applied on next collection sync.',
  posterUploadErrorSize: 'File size must be less than 10MB',
  posterUploadErrorType: 'Only JPEG, PNG, and WebP files are allowed',
  posterUploadErrorGeneric: 'Upload failed',
  posterUploadErrorNetwork: 'Network error occurred',
});

interface PosterUploadSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | null
  ) => void;
  posterUploading: boolean;
  setPosterUploading: (loading: boolean) => void;
  addToast: (
    message: string,
    options?: {
      appearance?: 'success' | 'error' | 'warning' | 'info';
      autoDismiss?: boolean;
    }
  ) => void;
  fieldId?: string;
  apiEndpoint?: string;
  isEnhanced?: boolean;
}

const PosterUploadSection = ({
  values,
  setFieldValue,
  posterUploading,
  setPosterUploading,
  addToast,
  fieldId = 'customPoster',
  apiEndpoint = '/api/v1/collections/poster',
  isEnhanced = false,
}: PosterUploadSectionProps) => {
  const intl = useIntl();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePosterUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size on client side
    if (file.size > 10 * 1024 * 1024) {
      addToast(intl.formatMessage(messages.posterUploadErrorSize), {
        appearance: 'error',
      });
      e.target.value = ''; // Reset file input
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      addToast(intl.formatMessage(messages.posterUploadErrorType), {
        appearance: 'error',
      });
      e.target.value = ''; // Reset file input
      return;
    }

    setPosterUploading(true);
    try {
      const formData = new FormData();
      formData.append('poster', file);

      // Use upload endpoint for enhanced forms, regular endpoint for normal forms
      const uploadEndpoint = isEnhanced ? `${apiEndpoint}/upload` : apiEndpoint;
      const response = await fetch(uploadEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setFieldValue('customPoster', result.filename);
        addToast(intl.formatMessage(messages.posterUploadSuccess), {
          appearance: 'success',
        });
      } else {
        const error = await response.json();
        addToast(
          `${intl.formatMessage(messages.posterUploadErrorGeneric)}: ${
            error.error
          }`,
          { appearance: 'error' }
        );
        e.target.value = ''; // Reset file input on error
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : intl.formatMessage(messages.posterUploadErrorNetwork);
      addToast(
        `${intl.formatMessage(messages.posterUploadErrorGeneric)}: ${message}`,
        { appearance: 'error' }
      );
      e.target.value = ''; // Reset file input on error
    } finally {
      setPosterUploading(false);
    }
  };

  const handleRemovePoster = () => {
    setFieldValue('customPoster', '');
    addToast(intl.formatMessage(messages.posterRemoveConfirm), {
      appearance: 'info',
    });
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        id={fieldId}
        accept="image/jpeg,image/png,image/webp"
        disabled={posterUploading}
        onChange={handlePosterUpload}
        className="hidden"
      />

      {/* Styled upload button - only show if no poster is uploaded */}
      {!values.customPoster && (
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={posterUploading}
          className={`
              inline-flex items-center rounded-lg border border-dashed border-transparent bg-transparent px-4
              py-2 text-sm font-medium text-orange-300 transition-colors
              duration-200 hover:text-orange-400 focus:outline-none focus:ring-2
              focus:ring-orange-500 focus:ring-offset-2
              ${
                posterUploading
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer hover:text-orange-400'
              }
            `}
        >
          <PlusIcon className="mr-2 h-5 w-5" />
          {intl.formatMessage(messages.addPoster)}
        </button>
      )}

      {posterUploading && (
        <div
          className={`mt-2 ${
            isEnhanced
              ? 'text-sm text-orange-400'
              : 'flex items-center space-x-2'
          }`}
        >
          {isEnhanced ? (
            intl.formatMessage(messages.uploading)
          ) : (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-orange-600"></div>
              <span className="text-sm text-gray-600">
                {intl.formatMessage(messages.uploading)}
              </span>
            </>
          )}
        </div>
      )}

      {values.customPoster && !posterUploading && (
        <div className="mt-2 flex items-center space-x-3">
          <img
            src={`/api/v1/collections/poster/${values.customPoster}`}
            alt="Custom poster preview"
            className="h-20 w-14 rounded border object-cover shadow-sm"
            onError={(e) => {
              // Handle broken image URLs
              const target = e.target as HTMLImageElement;
              target.src = '/images/overseerr_poster_not_found.png';
            }}
          />
          <div className="flex flex-col space-y-2">
            <button
              type="button"
              onClick={handleButtonClick}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              Change Poster
            </button>
            <button
              type="button"
              onClick={handleRemovePoster}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 hover:text-red-800"
            >
              {intl.formatMessage(messages.remove)}
            </button>
            <span className="text-xs text-gray-500">
              {intl.formatMessage(messages.posterSize)}
            </span>
          </div>
        </div>
      )}

      <div className="label-tip">
        {intl.formatMessage(messages.posterUploadHelp)}
      </div>
    </>
  );
};

export default PosterUploadSection;
