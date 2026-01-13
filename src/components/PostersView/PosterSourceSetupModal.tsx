import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  title: 'Choose Poster Source',
  description: 'Select the source to use as the base poster for overlays.',
  tmdbOption: 'TMDB Posters',
  tmdbDescription:
    'Grabs the most popular poster from TMDB every run, language option can be selected in Settings -> General',
  plexOption: 'Plex Posters',
  plexDescription:
    'Plex posters will be downloaded and used as the base poster for future overlay runs. If you want to change the base poster used, just update it in Plex and Agregarr will detect the change on the next run and download the new poster and use it going forward.',
  localOption: 'Local Posters',
  localDescription:
    'Use custom poster images from organized folders. Place images in the folder structure shown below. Can be populated with Plex Posters. Falls back to TMDB if file not found.',
  localFolderFormat: 'Folder Format',
  localFolderExample:
    '/config/plex-base-posters/{LibraryName}-{ID}/{Title} ({Year}) tmdb-{TMDBID}/',
  localFileFormat: 'Supported Files',
  localFilesSupported: 'poster.jpg, poster.png, or any .jpg/.png/.webp file',
  generateFolders: 'Generate Folder Structure',
  generateFoldersDescription:
    'Create empty folders for all library items upfront. Note: Folders are also created automatically when overlays are applied to new items.',
  populateFromPlex: 'Populate from Plex',
  populateFromPlexDescription:
    'Download all current Plex posters and save them to local folders. Great for migrating from Plex posters to local posters.',
  generatingFoldersTitle: 'Generating Folder Structure',
  populatingTitle: 'Populating from Plex',
  operationComplete: 'Operation Complete',
  cancelOperation: 'Cancel Operation',
  cancel: 'Cancel',
  continue: 'Continue',
  redownloadPlexPosters: 'Re-download Plex Posters',
  redownloadWarningTitle: 'WARNING: Re-download Plex Posters',
  redownloadWarningMessage:
    'This will re-download ALL posters from Plex. If you have NOT cleaned your Plex posters (removed overlays), this will cause overlays to be applied ON TOP of existing overlays. Only proceed if you have reset all your Plex posters to clean, non-overlaid versions.',
  redownloadConfirmPrompt: 'Type "I HAVE CLEAN POSTERS" exactly to confirm:',
  redownloadConfirmPlaceholder: 'Type here...',
  redownloadInvalidConfirmation:
    'You must type "I HAVE CLEAN POSTERS" exactly to proceed',
  downloadingTitle: 'Downloading Base Posters',
  downloadingDescription:
    'Downloading posters from your Plex libraries for overlay processing...',
  downloadComplete: 'Download Complete',
  cancelDownload: 'Cancel Download',
  runInBackground: 'Run in Background',
  itemsFailed: '{count} items failed (no poster available)',
  settingsSaved: 'Settings saved successfully',
  settingsFailed: 'Failed to save settings',
  confirm: 'Confirm',
  redownloadInstructions:
    'Only re-download if you have reset all your Plex posters to clean versions (Plex Dance or Manual)',
  utilityButtons: 'Utility buttons to help manage local posters:',
});

interface PosterSourceSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  isInitialSetup?: boolean; // True if this is first-time setup, false if changing settings later
  currentPosterSource?: 'tmdb' | 'plex' | 'local'; // Current saved poster source
}

interface OperationStatus {
  running: boolean;
  cancelled: boolean;
  libraries: {
    [libraryId: string]: {
      libraryName: string;
      current: number;
      total: number;
      failed: number;
      skipped?: number;
    };
  };
  overallProgress: {
    current: number;
    total: number;
    failed: number;
    skipped?: number;
    percentage: number;
  };
}

type DownloadStatus = OperationStatus;

const PosterSourceSetupModal: React.FC<PosterSourceSetupModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  isInitialSetup = false,
  // TODO: Change default to 'plex' before release to latest (currently 'tmdb' to protect existing develop users)
  currentPosterSource = 'tmdb',
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const [selectedSource, setSelectedSource] = useState<
    'tmdb' | 'plex' | 'local'
  >(currentPosterSource);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(
    null
  );
  const [isGeneratingFolders, setIsGeneratingFolders] = useState(false);
  const [generateFoldersStatus, setGenerateFoldersStatus] =
    useState<OperationStatus | null>(null);
  const [isPopulatingFromPlex, setIsPopulatingFromPlex] = useState(false);
  const [populateFromPlexStatus, setPopulateFromPlexStatus] =
    useState<OperationStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showRedownloadConfirm, setShowRedownloadConfirm] = useState(false);
  const [redownloadConfirmText, setRedownloadConfirmText] = useState('');

  // Reset to current saved value when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedSource(currentPosterSource);
      setShowRedownloadConfirm(false);
      setRedownloadConfirmText('');
    }
  }, [isOpen, currentPosterSource]);

  // Close re-download confirmation when switching away from Plex
  useEffect(() => {
    if (selectedSource !== 'plex') {
      setShowRedownloadConfirm(false);
      setRedownloadConfirmText('');
    }
  }, [selectedSource]);

  // Poll download status
  useEffect(() => {
    if (!isDownloading) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          '/api/v1/overlay-settings/download-status'
        );
        const status: DownloadStatus = await response.json();
        setDownloadStatus(status);

        if (!status.running) {
          setIsDownloading(false);
          if (!status.cancelled) {
            addToast(intl.formatMessage(messages.downloadComplete), {
              appearance: 'success',
              autoDismiss: true,
            });
            onComplete();
            onClose();
          }
        }
      } catch (error) {
        // Silently fail - status will be polled again
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isDownloading, addToast, intl, onComplete, onClose]);

  // Poll folder generation status
  useEffect(() => {
    if (!isGeneratingFolders) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          '/api/v1/overlay-settings/generate-local-folders-status'
        );
        const status: OperationStatus = await response.json();
        setGenerateFoldersStatus(status);

        if (!status.running) {
          setIsGeneratingFolders(false);
          if (!status.cancelled) {
            addToast(intl.formatMessage(messages.operationComplete), {
              appearance: 'success',
              autoDismiss: true,
            });
          }
        }
      } catch (error) {
        // Silently fail - status will be polled again
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isGeneratingFolders, addToast, intl]);

  // Poll Plex population status
  useEffect(() => {
    if (!isPopulatingFromPlex) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          '/api/v1/overlay-settings/populate-local-from-plex-status'
        );
        const status: OperationStatus = await response.json();
        setPopulateFromPlexStatus(status);

        if (!status.running) {
          setIsPopulatingFromPlex(false);
          if (!status.cancelled) {
            addToast(intl.formatMessage(messages.operationComplete), {
              appearance: 'success',
              autoDismiss: true,
            });
          }
        }
      } catch (error) {
        // Silently fail - status will be polled again
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPopulatingFromPlex, addToast, intl]);

  const startDownload = async () => {
    try {
      const downloadResponse = await fetch(
        '/api/v1/overlay-settings/download-base-posters',
        {
          method: 'POST',
        }
      );

      if (!downloadResponse.ok) {
        throw new Error('Failed to start download');
      }

      setIsDownloading(true);
      setShowRedownloadConfirm(false);
      setRedownloadConfirmText('');
    } catch (error) {
      addToast(intl.formatMessage(messages.settingsFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const startGenerateFolders = async () => {
    try {
      const response = await fetch(
        '/api/v1/overlay-settings/generate-local-folders',
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to start folder generation');
      }

      setIsGeneratingFolders(true);
    } catch (error) {
      addToast(intl.formatMessage(messages.settingsFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const startPopulateFromPlex = async () => {
    try {
      const response = await fetch(
        '/api/v1/overlay-settings/populate-local-from-plex',
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to start Plex population');
      }

      setIsPopulatingFromPlex(true);
    } catch (error) {
      addToast(intl.formatMessage(messages.settingsFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleContinue = async () => {
    setIsSaving(true);

    try {
      // Save settings
      const response = await fetch('/api/v1/overlay-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultPosterSource: selectedSource }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      if (selectedSource === 'plex') {
        // Only auto-download on initial setup
        if (isInitialSetup) {
          await startDownload();
        } else {
          // If not initial setup, just save the setting
          addToast(intl.formatMessage(messages.settingsSaved), {
            appearance: 'success',
            autoDismiss: true,
          });
          onComplete();
        }
      } else {
        // TMDB or Local source - no download needed
        addToast(intl.formatMessage(messages.settingsSaved), {
          appearance: 'success',
          autoDismiss: true,
        });
        onComplete();
      }
    } catch (error) {
      addToast(intl.formatMessage(messages.settingsFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRedownloadConfirm = async () => {
    if (redownloadConfirmText !== 'I HAVE CLEAN POSTERS') {
      addToast(intl.formatMessage(messages.redownloadInvalidConfirmation), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    // Save settings first before downloading
    try {
      const response = await fetch('/api/v1/overlay-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultPosterSource: selectedSource }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      // Settings saved, now start download
      await startDownload();
    } catch (error) {
      addToast(intl.formatMessage(messages.settingsFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleCancelDownload = async () => {
    try {
      await fetch('/api/v1/overlay-settings/cancel-download', {
        method: 'POST',
      });
    } catch (error) {
      // Silently fail
    }
  };

  if (!isOpen) return null;

  // Get appropriate title based on operation
  const getModalTitle = () => {
    if (isDownloading) return intl.formatMessage(messages.downloadingTitle);
    return intl.formatMessage(messages.title);
  };

  return (
    <Modal
      title={getModalTitle()}
      onCancel={onClose}
      cancelText={intl.formatMessage(messages.cancel)}
      okText=""
    >
      {!isDownloading ? (
        <div className="space-y-6">
          <p className="text-sm text-gray-300">
            {intl.formatMessage(messages.description)}
          </p>

          {/* Plex Option */}
          <div
            className={`cursor-pointer rounded-lg border-2 p-4 transition ${
              selectedSource === 'plex'
                ? 'border-indigo-500 bg-indigo-500 bg-opacity-10'
                : 'border-gray-600 hover:border-gray-500'
            }`}
            onClick={() => setSelectedSource('plex')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedSource('plex');
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start">
                <input
                  type="radio"
                  checked={selectedSource === 'plex'}
                  onChange={() => setSelectedSource('plex')}
                  className="mt-1"
                />
                <div className="ml-3">
                  <div className="font-medium text-white">
                    {intl.formatMessage(messages.plexOption)}
                  </div>
                  <div className="mt-1 text-sm text-gray-400">
                    {intl.formatMessage(messages.plexDescription)}
                  </div>
                </div>
              </div>
              {currentPosterSource === 'plex' && (
                <CheckCircleIcon className="h-6 w-6 flex-shrink-0 text-green-500" />
              )}
            </div>
          </div>

          {/* Local Option */}
          <div
            className={`cursor-pointer rounded-lg border-2 p-4 transition ${
              selectedSource === 'local'
                ? 'border-indigo-500 bg-indigo-500 bg-opacity-10'
                : 'border-gray-600 hover:border-gray-500'
            }`}
            onClick={() => setSelectedSource('local')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedSource('local');
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start">
                <input
                  type="radio"
                  checked={selectedSource === 'local'}
                  onChange={() => setSelectedSource('local')}
                  className="mt-1"
                />
                <div className="ml-3">
                  <div className="font-medium text-white">
                    {intl.formatMessage(messages.localOption)}
                  </div>
                  <div className="mt-1 text-sm text-gray-400">
                    {intl.formatMessage(messages.localDescription)}
                  </div>
                  <div className="mt-2 rounded bg-gray-800 p-2 font-mono text-xs text-gray-300">
                    <div className="mb-1 font-semibold text-gray-200">
                      {intl.formatMessage(messages.localFolderFormat)}:
                    </div>
                    <div className="text-gray-400">
                      {intl.formatMessage(messages.localFolderExample)}
                    </div>
                    <div className="mt-2 font-semibold text-gray-200">
                      {intl.formatMessage(messages.localFileFormat)}:
                    </div>
                    <div className="text-gray-400">
                      {intl.formatMessage(messages.localFilesSupported)}
                    </div>
                  </div>
                </div>
              </div>
              {currentPosterSource === 'local' && (
                <CheckCircleIcon className="h-6 w-6 flex-shrink-0 text-green-500" />
              )}
            </div>
          </div>

          {/* TMDB Option */}
          <div
            className={`cursor-pointer rounded-lg border-2 p-4 transition ${
              selectedSource === 'tmdb'
                ? 'border-indigo-500 bg-indigo-500 bg-opacity-10'
                : 'border-gray-600 hover:border-gray-500'
            }`}
            onClick={() => setSelectedSource('tmdb')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedSource('tmdb');
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start">
                <input
                  type="radio"
                  checked={selectedSource === 'tmdb'}
                  onChange={() => setSelectedSource('tmdb')}
                  className="mt-1"
                />
                <div className="ml-3">
                  <div className="font-medium text-white">
                    {intl.formatMessage(messages.tmdbOption)}
                  </div>
                  <div className="mt-1 text-sm text-gray-400">
                    {intl.formatMessage(messages.tmdbDescription)}
                  </div>
                </div>
              </div>
              {currentPosterSource === 'tmdb' && (
                <CheckCircleIcon className="h-6 w-6 flex-shrink-0 text-green-500" />
              )}
            </div>
          </div>

          {/* Show re-download button if not initial setup and Plex is selected */}
          {!isInitialSetup &&
            selectedSource === 'plex' &&
            !showRedownloadConfirm && (
              <div className="rounded-lg border-2 border-gray-600 bg-gray-600 bg-opacity-10 p-4">
                <p className="mb-3 text-sm text-gray-200">
                  {intl.formatMessage(messages.redownloadInstructions)}
                </p>
                <Button
                  buttonType="warning"
                  onClick={() => setShowRedownloadConfirm(true)}
                >
                  {intl.formatMessage(messages.redownloadPlexPosters)}
                </Button>
              </div>
            )}

          {/* Confirmation dialog for re-download */}
          {showRedownloadConfirm && (
            <div className="space-y-4 rounded-lg border-2 border-red-600 bg-red-600 bg-opacity-10 p-4">
              <div className="text-red-200">
                <div className="mb-2 text-lg font-bold">
                  {intl.formatMessage(messages.redownloadWarningTitle)}
                </div>
                <p className="mb-4 text-sm">
                  {intl.formatMessage(messages.redownloadWarningMessage)}
                </p>
                <label className="mb-2 block text-sm font-medium">
                  {intl.formatMessage(messages.redownloadConfirmPrompt)}
                </label>
                <input
                  type="text"
                  value={redownloadConfirmText}
                  onChange={(e) => setRedownloadConfirmText(e.target.value)}
                  placeholder={intl.formatMessage(
                    messages.redownloadConfirmPlaceholder
                  )}
                  className="w-full rounded-md border-gray-600 bg-gray-800 px-3 py-2 text-white"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <Button
                  buttonType="default"
                  onClick={() => {
                    setShowRedownloadConfirm(false);
                    setRedownloadConfirmText('');
                  }}
                >
                  {intl.formatMessage(messages.cancel)}
                </Button>
                <Button
                  buttonType="danger"
                  onClick={handleRedownloadConfirm}
                  disabled={redownloadConfirmText !== 'I HAVE CLEAN POSTERS'}
                >
                  {intl.formatMessage(messages.confirm)}
                </Button>
              </div>
            </div>
          )}

          {/* Utility buttons for Local source */}
          {selectedSource === 'local' && !showRedownloadConfirm && (
            <div className="space-y-3 rounded-lg border-2 border-gray-600 bg-gray-600 bg-opacity-10 p-4">
              <p className="mb-3 text-sm text-gray-200">
                {intl.formatMessage(messages.utilityButtons)}
              </p>
              <div className="space-y-4">
                {/* Generate Folders Section */}
                <div>
                  <Button
                    buttonType="primary"
                    onClick={startGenerateFolders}
                    className="w-full"
                    disabled={isGeneratingFolders || isPopulatingFromPlex}
                  >
                    {isGeneratingFolders ? (
                      <span className="flex items-center justify-center">
                        <LoadingSpinner />
                        <span className="ml-2">
                          {intl.formatMessage(messages.generatingFoldersTitle)}
                        </span>
                      </span>
                    ) : (
                      intl.formatMessage(messages.generateFolders)
                    )}
                  </Button>
                  <p className="mt-1 text-xs text-gray-400">
                    {intl.formatMessage(messages.generateFoldersDescription)}
                  </p>

                  {/* Inline progress for folder generation */}
                  {isGeneratingFolders && generateFoldersStatus && (
                    <div className="mt-3 space-y-2">
                      {Object.entries(generateFoldersStatus.libraries).map(
                        ([libraryId, lib]) => (
                          <div key={libraryId} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-white">
                                {lib.libraryName}
                              </span>
                              <span className="text-gray-400">
                                {lib.current}/{lib.total} (
                                {lib.total > 0
                                  ? Math.round((lib.current / lib.total) * 100)
                                  : 0}
                                %)
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                              <div
                                className="h-full bg-indigo-500 transition-all"
                                style={{
                                  width: `${
                                    lib.total > 0
                                      ? (lib.current / lib.total) * 100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                          </div>
                        )
                      )}
                      {generateFoldersStatus.running && (
                        <div className="flex justify-end pt-1">
                          <button
                            onClick={() => {
                              fetch(
                                '/api/v1/overlay-settings/cancel-generate-local-folders',
                                {
                                  method: 'POST',
                                }
                              ).catch(() => {
                                // Silently fail
                              });
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            {intl.formatMessage(messages.cancelOperation)}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Populate from Plex Section */}
                <div>
                  <Button
                    buttonType="primary"
                    onClick={startPopulateFromPlex}
                    className="w-full"
                    disabled={isGeneratingFolders || isPopulatingFromPlex}
                  >
                    {isPopulatingFromPlex ? (
                      <span className="flex items-center justify-center">
                        <LoadingSpinner />
                        <span className="ml-2">
                          {intl.formatMessage(messages.populatingTitle)}
                        </span>
                      </span>
                    ) : (
                      intl.formatMessage(messages.populateFromPlex)
                    )}
                  </Button>
                  <p className="mt-1 text-xs text-gray-400">
                    {intl.formatMessage(messages.populateFromPlexDescription)}
                  </p>

                  {/* Inline progress for Plex population */}
                  {isPopulatingFromPlex && populateFromPlexStatus && (
                    <div className="mt-3 space-y-2">
                      {Object.entries(populateFromPlexStatus.libraries).map(
                        ([libraryId, lib]) => (
                          <div key={libraryId} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-white">
                                {lib.libraryName}
                              </span>
                              <span className="text-gray-400">
                                {lib.current}/{lib.total} (
                                {lib.total > 0
                                  ? Math.round((lib.current / lib.total) * 100)
                                  : 0}
                                %)
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                              <div
                                className="h-full bg-indigo-500 transition-all"
                                style={{
                                  width: `${
                                    lib.total > 0
                                      ? (lib.current / lib.total) * 100
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                          </div>
                        )
                      )}
                      {populateFromPlexStatus.running && (
                        <div className="flex justify-end pt-1">
                          <button
                            onClick={() => {
                              fetch(
                                '/api/v1/overlay-settings/cancel-populate-local-from-plex',
                                {
                                  method: 'POST',
                                }
                              ).catch(() => {
                                // Silently fail
                              });
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            {intl.formatMessage(messages.cancelOperation)}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Only show Continue button when not in re-download confirmation flow */}
          {!showRedownloadConfirm && (
            <div className="flex justify-end">
              <Button
                buttonType="primary"
                onClick={handleContinue}
                disabled={isSaving}
              >
                {isSaving ? (
                  <LoadingSpinner />
                ) : (
                  intl.formatMessage(messages.continue)
                )}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-gray-300">
            {intl.formatMessage(messages.downloadingDescription)}
          </p>

          {downloadStatus && (
            <div className="space-y-4">
              {Object.entries(downloadStatus.libraries).map(
                ([libraryId, lib]) => (
                  <div key={libraryId} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-white">
                        {lib.libraryName}
                      </span>
                      <span className="text-gray-400">
                        {lib.current}/{lib.total} (
                        {lib.total > 0
                          ? Math.round((lib.current / lib.total) * 100)
                          : 0}
                        %)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
                      <div
                        className="h-full bg-indigo-500 transition-all"
                        style={{
                          width: `${
                            lib.total > 0 ? (lib.current / lib.total) * 100 : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )
              )}

              {downloadStatus.overallProgress.failed > 0 && (
                <p className="text-sm text-yellow-500">
                  {intl.formatMessage(messages.itemsFailed, {
                    count: downloadStatus.overallProgress.failed,
                  })}
                </p>
              )}
            </div>
          )}

          {downloadStatus?.running && (
            <div className="flex justify-end space-x-3">
              <Button buttonType="default" onClick={onClose}>
                {intl.formatMessage(messages.runInBackground)}
              </Button>
              <Button buttonType="danger" onClick={handleCancelDownload}>
                {intl.formatMessage(messages.cancelDownload)}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default PosterSourceSetupModal;
