import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  title: 'Reset All Posters',
  confirmTitle: 'Confirm Poster Reset',
  confirmDescription:
    'This will reset ALL posters in "{libraryName}" to their base versions (without overlays). The poster source setting ({posterSource}) will be respected.',
  tmdbSource: 'TMDB',
  plexSource: 'Plex',
  warning:
    'This operation cannot be undone. All overlay-modified posters in this library will be replaced.',
  confirm: 'Reset All Posters',
  cancel: 'Cancel',
  resettingTitle: 'Resetting Posters',
  resettingDescription:
    'Resetting all posters in your library to their base versions...',
  resetComplete: 'Reset Complete',
  resetFailed: 'Reset Failed',
  cancelReset: 'Cancel Reset',
  runInBackground: 'Run in Background',
  close: 'Close',
  itemsFailed: '{count} items failed',
  libraryLabel: 'Library: {name}',
  progressLabel: '{current} / {total}',
});

interface PosterResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  libraryId: string;
  libraryName: string;
  posterSource: 'tmdb' | 'plex';
}

interface ResetStatus {
  running: boolean;
  cancelled: boolean;
  currentLibrary: string;
  currentLibraryName: string;
  current: number;
  total: number;
  failed: number;
}

const PosterResetModal: React.FC<PosterResetModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  libraryId,
  libraryName,
  posterSource,
}) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const [isResetting, setIsResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<ResetStatus | null>(null);
  const [showConfirm, setShowConfirm] = useState(true);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setShowConfirm(true);
      setIsResetting(false);
      setResetStatus(null);
    }
  }, [isOpen]);

  // Poll reset status
  useEffect(() => {
    if (!isResetting) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/v1/overlay-settings/reset-status');
        const status: ResetStatus = await response.json();
        setResetStatus(status);

        if (!status.running) {
          setIsResetting(false);
          if (!status.cancelled) {
            addToast(intl.formatMessage(messages.resetComplete), {
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
  }, [isResetting, addToast, intl, onComplete, onClose]);

  const handleConfirm = async () => {
    setShowConfirm(false);
    setIsResetting(true);

    try {
      const response = await fetch(
        '/api/v1/overlay-settings/reset-library-posters',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ libraryId }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start reset');
      }
    } catch (error) {
      setIsResetting(false);
      setShowConfirm(true);
      addToast(
        error instanceof Error
          ? error.message
          : intl.formatMessage(messages.resetFailed),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    }
  };

  const handleCancelReset = async () => {
    try {
      await fetch('/api/v1/overlay-settings/cancel-reset', {
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
        isResetting
          ? intl.formatMessage(messages.resettingTitle)
          : intl.formatMessage(messages.confirmTitle)
      }
      onCancel={onClose}
      cancelText={intl.formatMessage(messages.cancel)}
      okText=""
    >
      {showConfirm && !isResetting ? (
        <div className="space-y-6">
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              {intl.formatMessage(messages.confirmDescription, {
                libraryName,
                posterSource:
                  posterSource === 'tmdb'
                    ? intl.formatMessage(messages.tmdbSource)
                    : intl.formatMessage(messages.plexSource),
              })}
            </p>

            <div className="rounded-lg border-2 border-yellow-600 bg-yellow-600 bg-opacity-10 p-4">
              <p className="text-sm text-yellow-200">
                ⚠️ {intl.formatMessage(messages.warning)}
              </p>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <Button buttonType="default" onClick={onClose}>
              {intl.formatMessage(messages.cancel)}
            </Button>
            <Button buttonType="danger" onClick={handleConfirm}>
              {intl.formatMessage(messages.confirm)}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-gray-300">
            {intl.formatMessage(messages.resettingDescription)}
          </p>

          {resetStatus && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-white">
                    {intl.formatMessage(messages.libraryLabel, {
                      name: resetStatus.currentLibraryName || libraryName,
                    })}
                  </span>
                  <span className="text-gray-400">
                    {intl.formatMessage(messages.progressLabel, {
                      current: resetStatus.current,
                      total: resetStatus.total,
                    })}{' '}
                    (
                    {resetStatus.total > 0
                      ? Math.round(
                          (resetStatus.current / resetStatus.total) * 100
                        )
                      : 0}
                    %)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{
                      width: `${
                        resetStatus.total > 0
                          ? (resetStatus.current / resetStatus.total) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              {resetStatus.failed > 0 && (
                <p className="text-sm text-yellow-500">
                  {intl.formatMessage(messages.itemsFailed, {
                    count: resetStatus.failed,
                  })}
                </p>
              )}
            </div>
          )}

          {resetStatus?.running && (
            <div className="flex justify-end space-x-3">
              <Button buttonType="default" onClick={onClose}>
                {intl.formatMessage(messages.runInBackground)}
              </Button>
              <Button buttonType="danger" onClick={handleCancelReset}>
                {intl.formatMessage(messages.cancelReset)}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default PosterResetModal;
