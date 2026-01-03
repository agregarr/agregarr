import Button from '@app/components/Common/Button';
import {
  CheckIcon,
  ExclamationTriangleIcon,
  ForwardIcon,
  FunnelIcon,
  StopIcon,
} from '@heroicons/react/24/outline';
import type React from 'react';
import { useMemo } from 'react';

export type JobState =
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface LibraryStatus {
  libraryId: string;
  running: boolean;
  state: JobState;
  libraryName: string;
  startTime: number;
  runningFor: number;
  totalItems: number;
  currentItem: number;
  currentTitle: string;
  filteredCount: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  progressPercent: number;
  estimatedSecondsRemaining: number | null;
}

interface LibraryProgressCardProps {
  status: LibraryStatus;
  onStop: () => void;
  isStopping?: boolean;
}

const formatTime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
};

const getBorderColor = (state: JobState): string => {
  switch (state) {
    case 'completed':
      return 'border-green-500';
    case 'cancelled':
    case 'cancelling':
      return 'border-amber-500';
    case 'failed':
      return 'border-red-500';
    case 'running':
    default:
      return 'border-orange-500';
  }
};

const getProgressBarColor = (state: JobState): string => {
  switch (state) {
    case 'completed':
      return 'bg-green-500';
    case 'cancelled':
    case 'cancelling':
      return 'bg-amber-500';
    case 'failed':
      return 'bg-red-500';
    case 'running':
    default:
      return 'bg-orange-500';
  }
};

const LibraryProgressCard: React.FC<LibraryProgressCardProps> = ({
  status,
  onStop,
  isStopping = false,
}) => {
  const borderColor = useMemo(
    () => getBorderColor(status.state),
    [status.state]
  );
  const progressBarColor = useMemo(
    () => getProgressBarColor(status.state),
    [status.state]
  );

  const eta = useMemo(() => {
    if (status.estimatedSecondsRemaining === null) return null;
    return formatTime(status.estimatedSecondsRemaining);
  }, [status.estimatedSecondsRemaining]);

  const totalProcessed = useMemo(
    () =>
      status.successCount +
      status.errorCount +
      status.skippedCount +
      status.filteredCount,
    [
      status.successCount,
      status.errorCount,
      status.skippedCount,
      status.filteredCount,
    ]
  );

  return (
    <div
      className={`rounded-lg border-2 ${borderColor} bg-stone-800 p-6 shadow-sm transition-all`}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {status.libraryName}
          </h3>
          <p className="text-xs text-gray-400">
            {status.state === 'cancelling'
              ? 'Stopping...'
              : status.state === 'running'
              ? 'In Progress'
              : status.state.charAt(0).toUpperCase() + status.state.slice(1)}
          </p>
        </div>
        <Button
          buttonType="danger"
          buttonSize="sm"
          onClick={onStop}
          disabled={status.state === 'cancelling' || isStopping}
          className="flex items-center gap-1.5"
        >
          <StopIcon className="h-4 w-4" />
          {isStopping ? 'Stopping...' : 'Stop'}
        </Button>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-300">Progress</span>
          <span className="text-xs text-gray-400">
            {status.progressPercent}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-700">
          <div
            className={`h-full transition-all duration-300 ${progressBarColor}`}
            style={{ width: `${status.progressPercent}%` }}
          />
        </div>
      </div>

      {/* Current Item */}
      {status.currentTitle && (
        <div className="mb-4 rounded-md bg-stone-900 p-3">
          <p className="text-xs text-gray-500">Processing</p>
          <p className="truncate text-sm font-medium text-white">
            {status.currentTitle}
          </p>
          <p className="text-xs text-gray-500">
            Item {status.currentItem} of {status.totalItems}
          </p>
        </div>
      )}

      {/* Stats Row */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md bg-stone-900 p-3">
          <div className="flex items-center gap-2">
            <CheckIcon className="h-4 w-4 text-green-400" />
            <span className="text-xs text-gray-400">Success</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-green-400">
            {status.successCount}
          </p>
        </div>

        <div className="rounded-md bg-stone-900 p-3">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-4 w-4 text-red-400" />
            <span className="text-xs text-gray-400">Errors</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-red-400">
            {status.errorCount}
          </p>
        </div>

        <div className="rounded-md bg-stone-900 p-3">
          <div className="flex items-center gap-2">
            <ForwardIcon className="h-4 w-4 text-amber-400" />
            <span className="text-xs text-gray-400">Unchanged</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-amber-400">
            {status.skippedCount}
          </p>
        </div>

        <div className="rounded-md bg-stone-900 p-3">
          <div className="flex items-center gap-2">
            <FunnelIcon className="h-4 w-4 text-blue-400" />
            <span className="text-xs text-gray-400">Filtered</span>
          </div>
          <p className="mt-1 text-lg font-semibold text-blue-400">
            {status.filteredCount}
          </p>
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          Processed {totalProcessed} / {status.totalItems}
        </span>
        {eta && (
          <span>
            ETA: <span className="text-gray-300">{eta}</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default LibraryProgressCard;
