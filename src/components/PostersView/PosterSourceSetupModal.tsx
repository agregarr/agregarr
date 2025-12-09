import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  title: 'Choose Poster Source',
  description:
    'NOTE: If you have already setup poster overlays in a previous develop build and this is your first time seeing this screen, then you must select TMDB Posters, otherwise overlays will be applied on top of overlays. If you want to use your own base posters, setup your posters in Plex, and change the below setting to Plex Posters which will download your current Plex posters.',
  tmdbOption: 'TMDB Posters',
  tmdbDescription:
    'Grabs the most popular poster from TMDB every run, language option can be selected in Settings -> General',
  plexOption: 'Plex Posters',
  plexDescription:
    'Plex posters will be downloaded and used as the base poster for future overlay runs. If you want to change the base poster used, just update it in Plex and Agregarr will detect the change on the next run and download the new poster and use it going forward.',
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
  downloadFailed: 'Download Failed',
  cancelDownload: 'Cancel Download',
  runInBackground: 'Run in Background',
  close: 'Close',
  itemsFailed: '{count} items failed (no poster available)',
  savingSettings: 'Saving settings...',
  settingsSaved: 'Settings saved successfully',
  settingsFailed: 'Failed to save settings',
  confirm: 'Confirm',
});

interface PosterSourceSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  isInitialSetup?: boolean; // True if this is first-time setup, false if changing settings later
  currentPosterSource?: 'tmdb' | 'plex'; // Current saved poster source
}

interface DownloadStatus {
  running: boolean;
  cancelled: boolean;
  libraries: {
    [libraryId: string]: {
      libraryName: string;
      current: number;
      total: number;
      failed: number;
    };
  };
  overallProgress: {
    current: number;
    total: number;
    failed: number;
    percentage: number;
  };
}

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

  const [selectedSource, setSelectedSource] = useState<'tmdb' | 'plex'>(
    currentPosterSource
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(
    null
  );
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
        // TMDB source - no download needed
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

  return (
    <Modal
      title={
        isDownloading
          ? intl.formatMessage(messages.downloadingTitle)
          : intl.formatMessage(messages.title)
      }
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
                  Only re-download if you have reset all your Plex posters to
                  clean versions (
                  <a
                    href="https://forums.plex.tv/t/the-plex-dance/197064"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-yellow-100"
                  >
                    Plex Dance
                  </a>{' '}
                  or Manual)
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
