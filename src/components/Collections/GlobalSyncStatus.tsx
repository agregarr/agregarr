import Spinner from '@app/assets/spinner.svg';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import React, { useCallback } from 'react';
import useSWR from 'swr';

interface GlobalSyncStatusResponse {
  running: boolean;
  currentStage?: string;
  totalCollections?: number;
  processedCollections?: number;
  progress?: number;
  lastGlobalSyncAt?: string;
  globalSyncError?: string;
  collectionsNeedingSync: number;
  nextSyncAt?: string;
}

interface GlobalSyncStatusProps {
  isStarting?: boolean;
  onSyncStart?: (refreshFn: () => void) => void;
  onSyncComplete?: () => void;
}

const GlobalSyncStatus: React.FC<GlobalSyncStatusProps> = ({
  isStarting = false,
  onSyncStart,
  onSyncComplete,
}) => {
  const { data: syncStatus, mutate } = useSWR<GlobalSyncStatusResponse>(
    '/api/v1/collections/sync/status',
    (url: string) => axios.get(url).then((res) => res.data),
    {
      refreshInterval: (data) => (data?.running ? 1000 : 5000), // Refresh every 1 second while running, 5 seconds when idle
    }
  );

  // Create a stable callback function
  const refreshSync = useCallback(() => {
    mutate();
  }, [mutate]);

  // Track previous running state to detect completion
  const prevRunningRef = React.useRef<boolean>();

  // Expose the mutate function to parent via callback
  React.useEffect(() => {
    if (onSyncStart) {
      onSyncStart(refreshSync);
    }
  }, [onSyncStart, refreshSync]);

  // Detect sync completion and trigger callback
  React.useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const isRunning = syncStatus?.running;

    // If sync just completed (was running but now stopped), trigger onSyncComplete
    if (wasRunning === true && isRunning === false && onSyncComplete) {
      onSyncComplete();
    }

    // Update the ref for next comparison
    prevRunningRef.current = isRunning;
  }, [syncStatus?.running, onSyncComplete]);

  if (!syncStatus) {
    return null;
  }

  const formatRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInMinutes < 1) {
      return 'Just now';
    } else if (diffInMinutes < 60) {
      return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;
    } else if (diffInHours < 24) {
      return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`;
    } else {
      return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`;
    }
  };

  const formatFutureTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMs = date.getTime() - now.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const remainingMinutes = diffInMinutes % 60;

    // Round to nearest hour based on 30-minute threshold
    const diffInHours =
      remainingMinutes >= 30
        ? Math.ceil(diffInMinutes / 60)
        : Math.floor(diffInMinutes / 60);

    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInMs < 0) {
      return 'Overdue';
    } else if (diffInMinutes < 1) {
      return 'Soon';
    } else if (diffInMinutes < 60) {
      return `in ${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'}`;
    } else if (diffInHours < 24) {
      const exactHours = Math.floor(diffInMinutes / 60);
      if (exactHours < 2 && remainingMinutes > 0) {
        return `in ${exactHours} hour${
          exactHours === 1 ? '' : 's'
        } ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
      } else {
        return `in ${diffInHours} hour${diffInHours === 1 ? '' : 's'}`;
      }
    } else {
      return `in ${diffInDays} day${diffInDays === 1 ? '' : 's'}`;
    }
  };

  return (
    <div className="flex items-center space-x-3 text-xs text-gray-400">
      {/* Show immediate placeholder when starting */}
      {isStarting && !syncStatus?.running && (
        <div className="flex items-center space-x-2">
          <Spinner className="h-3 w-3 animate-spin" />
          <span>Starting sync...</span>
        </div>
      )}

      {/* Currently Running with Progress */}
      {syncStatus?.running && (
        <div className="flex items-center space-x-2">
          <Spinner className="h-3 w-3 animate-spin" />
          <span>
            {syncStatus.currentStage || 'Syncing...'}
            {syncStatus.totalCollections &&
              syncStatus.totalCollections > 0 &&
              syncStatus.processedCollections !== undefined && (
                <span className="ml-1">
                  ({syncStatus.processedCollections}/
                  {syncStatus.totalCollections})
                </span>
              )}
          </span>
        </div>
      )}

      {/* Sync Error Display */}
      {!syncStatus?.running && syncStatus?.globalSyncError && (
        <div className="flex items-center space-x-1">
          <ExclamationTriangleIcon className="h-3 w-3" />
          <span title={syncStatus.globalSyncError}>Last sync failed</span>
        </div>
      )}

      {/* Collections Needing Sync Count - Only when not running and no error */}
      {!syncStatus?.running &&
        !syncStatus?.globalSyncError &&
        (syncStatus?.collectionsNeedingSync || 0) > 0 && (
          <span>
            {syncStatus.collectionsNeedingSync} collection
            {syncStatus.collectionsNeedingSync === 1 ? '' : 's'} pending
          </span>
        )}

      {/* Last Sync Time - Only when not running and no pending/errors */}
      {!syncStatus?.running &&
        !syncStatus?.globalSyncError &&
        (syncStatus?.collectionsNeedingSync || 0) === 0 &&
        syncStatus?.lastGlobalSyncAt && (
          <div className="flex flex-col">
            <span>
              Last sync: {formatRelativeTime(syncStatus.lastGlobalSyncAt)}
            </span>
            {/* Next Sync Time - Only show if we have a next sync time */}
            {syncStatus?.nextSyncAt && (
              <span>Next sync: {formatFutureTime(syncStatus.nextSyncAt)}</span>
            )}
          </div>
        )}

      {/* Never Synced - Only when not running and no pending/errors */}
      {!syncStatus?.running &&
        !syncStatus?.globalSyncError &&
        (syncStatus?.collectionsNeedingSync || 0) === 0 &&
        !syncStatus?.lastGlobalSyncAt && (
          <div className="flex flex-col">
            <span>No sync yet</span>
            {/* Next Sync Time - Only show if we have a next sync time */}
            {syncStatus?.nextSyncAt && (
              <span>Next sync: {formatFutureTime(syncStatus.nextSyncAt)}</span>
            )}
          </div>
        )}
    </div>
  );
};

export default GlobalSyncStatus;
