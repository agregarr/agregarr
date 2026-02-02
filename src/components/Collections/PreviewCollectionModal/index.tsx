import RTFresh from '@app/assets/rt_fresh.svg';
import RTRotten from '@app/assets/rt_rotten.svg';
import TmdbLogo from '@app/assets/tmdb_logo.svg';
import ExclusionsModal from '@app/components/Collections/ExclusionsModal';
import RadarrOptionsModal from '@app/components/Collections/RadarrOptionsModal';
import SeasonSelectionModal from '@app/components/Collections/SeasonSelectionModal';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  previewCollection: 'Preview Collection',
  errorLoadingPreview: 'Failed to load preview',
  noItems: 'No items found',
  placeholder: 'Placeholder',
  downloadViaRadarr: 'Download via Radarr',
  downloadViaSonarr: 'Download via Sonarr',
  downloadViaOverseerr: 'Request via Overseerr',
  downloadSuccess: 'Download request sent successfully',
  downloadError: 'Failed to send download request',
  close: 'Close',
  viewOnImdb: 'View on IMDb',
  noOverview: 'No overview available',
  refresh: 'Refresh',
  refreshConfirm:
    'This will fetch fresh data from the external source and may take some time. Continue?',
  excludeItem: 'Exclude from all collections',
  itemExcluded: 'Item excluded from all collections',
  excludeError: 'Failed to exclude item',
  viewExclusions: 'View Exclusions',
  noPoster: 'No Poster',
});

interface PreviewItem {
  ratingKey?: string;
  tmdbId: number;
  tvdbId?: number;
  title: string;
  year?: number;
  mediaType?: 'movie' | 'tv';
  posterUrl: string;
  backdropPath?: string;
  inLibrary: boolean;
  isPlaceholder?: boolean;
  monitored?: boolean;
  overview?: string;
  imdbId?: string;
  tmdbRating?: number;
}

interface ItemRatings {
  imdb?: {
    imdbId: string;
    rating: number | null;
    votes: number | null;
  } | null;
  rt?: {
    title: string;
    year: number;
    criticsRating: string;
    criticsScore: number;
    audienceRating?: string;
    audienceScore?: number;
    url: string;
  } | null;
}

interface Library {
  id: string;
  name: string;
  type: string;
}

interface PreviewCollectionModalProps {
  onCancel: () => void;
  previewConfig: {
    type: string;
    subtype?: string;
    collectionName?: string;
    libraryIds: string[];
    libraries: Library[];
    customUrl?: string;
    maxItems?: number;
    // TMDB advanced discover filters
    tmdbAdvancedFilters?: Record<string, unknown>;
    tmdbMovieSortBy?: string;
    tmdbTvSortBy?: string;
    timePeriod?: string;
    minimumPlays?: number;
    customDays?: number;
    network?: string;
    country?: string;
    provider?: string;
    // Radarr/Sonarr tag specific fields
    radarrTagId?: number;
    sonarrTagId?: number;
    radarrInstanceId?: number;
    sonarrInstanceId?: number;
    // Multi-source specific fields
    isMultiSource?: boolean;
    sources?: {
      id: string;
      type: string;
      subtype?: string;
      customUrl?: string;
      timePeriod?: string;
      priority: number;
      customDays?: number;
      minimumPlays?: number;
      networksCountry?: string;
    }[];
    combineMode?: 'interleaved' | 'list_order' | 'randomised' | 'cycle_lists';
  };
}

const PreviewCollectionModal = ({
  onCancel,
  previewConfig,
}: PreviewCollectionModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [activeLibraryId, setActiveLibraryId] = useState(
    previewConfig.libraryIds[0]
  );
  const [sessionIdsByLibrary, setSessionIdsByLibrary] = useState<
    Record<string, string>
  >({});
  const [statusByLibrary, setStatusByLibrary] = useState<
    Record<
      string,
      {
        running: boolean;
        currentStage: string;
        progress: number;
        error?: string;
        completed: boolean;
        result?: {
          items: PreviewItem[];
          totalItems: number;
          matchedCount: number;
          missingCount: number;
        };
      }
    >
  >({});
  const [hoveredItem, setHoveredItem] = useState<number | null>(null);
  const [infoTooltipItem, setInfoTooltipItem] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const tooltipCloseTimer = useRef<NodeJS.Timeout | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [downloadingItems, setDownloadingItems] = useState<Set<number>>(
    new Set()
  );
  const [requestedItems, setRequestedItems] = useState<Set<string>>(new Set());
  const [radarrOptionsItem, setRadarrOptionsItem] = useState<{
    tmdbId: number;
    title: string;
    backdropPath?: string;
  } | null>(null);
  const [seasonSelectionItem, setSeasonSelectionItem] = useState<{
    tmdbId: number;
    title: string;
    service: 'overseerr' | 'sonarr';
    backdropPath?: string;
  } | null>(null);
  const [ratingsCache, setRatingsCache] = useState<Record<number, ItemRatings>>(
    {}
  );
  const [loadingRatings, setLoadingRatings] = useState<Set<number>>(new Set());
  const [cycleIndex, setCycleIndex] = useState(0);
  const [excludedItems, setExcludedItems] = useState<Set<number>>(new Set());
  const [showExclusionsModal, setShowExclusionsModal] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(false);

  const [runKey, setRunKey] = useState(0);
  const lastRunSignatureRef = useRef<string | null>(null);
  const lastConfigSignatureRef = useRef<string | null>(null);

  const stableStringify = (value: unknown): string => {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  };

  const configSignature = stableStringify({
    type: previewConfig.type,
    subtype: previewConfig.subtype,
    customUrl: previewConfig.customUrl,
    tmdbAdvancedFilters: previewConfig.tmdbAdvancedFilters,
    tmdbMovieSortBy: previewConfig.tmdbMovieSortBy,
    tmdbTvSortBy: previewConfig.tmdbTvSortBy,
    maxItems: previewConfig.maxItems
      ? Number(previewConfig.maxItems)
      : undefined,
    timePeriod: previewConfig.timePeriod,
    minimumPlays: previewConfig.minimumPlays
      ? Number(previewConfig.minimumPlays)
      : undefined,
    customDays: previewConfig.customDays
      ? Number(previewConfig.customDays)
      : undefined,
    network: previewConfig.network,
    country: previewConfig.country,
    provider: previewConfig.provider,
    radarrTagId: previewConfig.radarrTagId,
    sonarrTagId: previewConfig.sonarrTagId,
    radarrInstanceId: previewConfig.radarrInstanceId,
    sonarrInstanceId: previewConfig.sonarrInstanceId,
    isMultiSource: previewConfig.isMultiSource,
    sources: previewConfig.sources,
    combineMode: previewConfig.combineMode,
    libraryIds: previewConfig.libraryIds,
  });

  const runSignature = stableStringify({
    configSignature,
    cycleIndex,
  });

  // When the config changes, automatically run a fresh preview (bypassing cache).
  // Note: we compare against the last config signature we ran, persisted in localStorage.
  useEffect(() => {
    if (lastRunSignatureRef.current === runSignature) return;
    lastRunSignatureRef.current = runSignature;

    const storageKey = 'preview-last-config-signature';
    const storedLastConfigSignature =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(storageKey)
        : null;
    const previousConfigSignature =
      lastConfigSignatureRef.current ?? storedLastConfigSignature;

    const shouldForceRefresh =
      !!previousConfigSignature && previousConfigSignature !== configSignature;

    // Clear existing sessions/status and start a new run.
    setSessionIdsByLibrary({});
    setStatusByLibrary({});
    setForceRefresh(shouldForceRefresh);
    setRunKey((prev) => prev + 1);

    lastConfigSignatureRef.current = configSignature;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, configSignature);
    }
  }, [runSignature, configSignature]);

  // Load requested items from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('preview-requested-items');
      if (stored) {
        setRequestedItems(new Set(JSON.parse(stored)));
      }
    } catch (err) {
      // Ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    const startPreviewForLibrary = async (libraryId: string) => {
      try {
        // Start the preview - this returns immediately with a session ID
        const response = await axios.post('/api/v1/collections/preview', {
          type: previewConfig.type,
          subtype: previewConfig.subtype,
          libraryId,
          customUrl: previewConfig.customUrl,
          tmdbAdvancedFilters: previewConfig.tmdbAdvancedFilters,
          tmdbMovieSortBy: previewConfig.tmdbMovieSortBy,
          tmdbTvSortBy: previewConfig.tmdbTvSortBy,
          maxItems: previewConfig.maxItems
            ? Number(previewConfig.maxItems)
            : undefined,
          timePeriod: previewConfig.timePeriod,
          minimumPlays: previewConfig.minimumPlays
            ? Number(previewConfig.minimumPlays)
            : undefined,
          customDays: previewConfig.customDays
            ? Number(previewConfig.customDays)
            : undefined,
          network: previewConfig.network,
          country: previewConfig.country,
          provider: previewConfig.provider,
          // Radarr/Sonarr tag specific fields
          radarrTagId: previewConfig.radarrTagId,
          sonarrTagId: previewConfig.sonarrTagId,
          radarrInstanceId: previewConfig.radarrInstanceId,
          sonarrInstanceId: previewConfig.sonarrInstanceId,
          forceRefresh: forceRefresh,
          // Multi-source specific fields
          isMultiSource: previewConfig.isMultiSource,
          sources: previewConfig.sources,
          combineMode: previewConfig.combineMode,
          cycleIndex: cycleIndex,
        });

        const sessionId = response.data.sessionId;
        setSessionIdsByLibrary((prev) => ({ ...prev, [libraryId]: sessionId }));
      } catch (err) {
        setStatusByLibrary((prev) => ({
          ...prev,
          [libraryId]: {
            running: false,
            currentStage: 'Error',
            progress: 0,
            completed: true,
            error:
              err instanceof Error ? err.message : 'Failed to start preview',
          },
        }));
      }
    };

    // Start preview for all selected libraries
    previewConfig.libraryIds.forEach((libraryId) => {
      startPreviewForLibrary(libraryId);
    });

    // Reset forceRefresh after kicking off a run (so future runs only bypass cache when needed)
    if (forceRefresh) {
      setForceRefresh(false);
    }
    // runKey is an intentional trigger - we capture current config values at the moment it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  // Poll for status updates
  useEffect(() => {
    const intervals: NodeJS.Timeout[] = [];

    Object.entries(sessionIdsByLibrary).forEach(([libraryId, sessionId]) => {
      const interval = setInterval(async () => {
        try {
          const response = await axios.get(
            `/api/v1/collections/preview/status/${sessionId}`
          );
          const status = response.data;

          setStatusByLibrary((prev) => ({ ...prev, [libraryId]: status }));

          // Stop polling if completed
          if (status.completed) {
            clearInterval(interval);
          }
        } catch (err) {
          // Session might not exist yet or has errored - ignore polling errors
          // They will resolve once the session is created
        }
      }, 1000); // Poll every second

      intervals.push(interval);
    });

    return () => {
      intervals.forEach((interval) => clearInterval(interval));
    };
  }, [sessionIdsByLibrary]);

  const handleDownload = useCallback(
    async (
      tmdbId: number,
      title: string,
      mediaType: 'movie' | 'tv',
      service: 'radarr' | 'sonarr' | 'overseerr',
      backdropPath?: string
    ) => {
      // For Radarr (movies), show options modal
      if (service === 'radarr' && mediaType === 'movie') {
        setRadarrOptionsItem({ tmdbId, title, backdropPath });
        return;
      }

      // For TV shows with Overseerr or Sonarr, show season selection modal
      if (
        mediaType === 'tv' &&
        (service === 'overseerr' || service === 'sonarr')
      ) {
        setSeasonSelectionItem({ tmdbId, title, service, backdropPath });
        return;
      }

      // For Overseerr movies, download directly
      try {
        setDownloadingItems((prev) => new Set(prev).add(tmdbId));

        await axios.post('/api/v1/collections/preview/download', {
          tmdbId,
          mediaType,
          service,
          sourceType: previewConfig.type,
          subtype: previewConfig.subtype,
          collectionName: previewConfig.collectionName,
        });

        // Mark as requested and save to localStorage
        const requestKey = `${tmdbId}-${service}`;
        setRequestedItems((prev) => {
          const next = new Set(prev).add(requestKey);
          try {
            localStorage.setItem(
              'preview-requested-items',
              JSON.stringify(Array.from(next))
            );
          } catch (err) {
            // Ignore localStorage errors
          }
          return next;
        });

        addToast(intl.formatMessage(messages.downloadSuccess), {
          appearance: 'success',
          autoDismiss: true,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error && err.message
            ? err.message
            : intl.formatMessage(messages.downloadError);
        addToast(errorMessage, {
          appearance: 'error',
          autoDismiss: true,
        });
      } finally {
        setDownloadingItems((prev) => {
          const next = new Set(prev);
          next.delete(tmdbId);
          return next;
        });
      }
    },
    [
      addToast,
      intl,
      previewConfig.collectionName,
      previewConfig.subtype,
      previewConfig.type,
    ]
  );

  const handleSeasonSelection = useCallback(
    async (
      selectedSeasons: number[],
      serverId?: number,
      profileId?: number,
      rootFolder?: string
    ) => {
      if (!seasonSelectionItem) return;

      const { tmdbId, service } = seasonSelectionItem;

      try {
        setDownloadingItems((prev) => new Set(prev).add(tmdbId));
        setSeasonSelectionItem(null); // Close modal

        await axios.post('/api/v1/collections/preview/download', {
          tmdbId,
          mediaType: 'tv',
          service,
          seasons: selectedSeasons,
          serverId,
          profileId,
          rootFolder,
          sourceType: previewConfig.type,
          subtype: previewConfig.subtype,
          collectionName: previewConfig.collectionName,
        });

        // Mark as requested and save to localStorage
        const requestKey = `${tmdbId}-${service}`;
        setRequestedItems((prev) => {
          const next = new Set(prev).add(requestKey);
          try {
            localStorage.setItem(
              'preview-requested-items',
              JSON.stringify(Array.from(next))
            );
          } catch (err) {
            // Ignore localStorage errors
          }
          return next;
        });

        addToast(intl.formatMessage(messages.downloadSuccess), {
          appearance: 'success',
          autoDismiss: true,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error && err.message
            ? err.message
            : intl.formatMessage(messages.downloadError);
        addToast(errorMessage, {
          appearance: 'error',
          autoDismiss: true,
        });
      } finally {
        setDownloadingItems((prev) => {
          const next = new Set(prev);
          next.delete(tmdbId);
          return next;
        });
      }
    },
    [
      seasonSelectionItem,
      addToast,
      intl,
      previewConfig.collectionName,
      previewConfig.subtype,
      previewConfig.type,
    ]
  );

  const handleRadarrOptions = useCallback(
    async (serverId: number, profileId: number, rootFolder: string) => {
      if (!radarrOptionsItem) return;

      const { tmdbId } = radarrOptionsItem;

      try {
        setDownloadingItems((prev) => new Set(prev).add(tmdbId));
        setRadarrOptionsItem(null); // Close modal

        await axios.post('/api/v1/collections/preview/download', {
          tmdbId,
          mediaType: 'movie',
          service: 'radarr',
          serverId,
          profileId,
          rootFolder,
          sourceType: previewConfig.type,
          subtype: previewConfig.subtype,
          collectionName: previewConfig.collectionName,
        });

        // Mark as requested and save to localStorage
        const requestKey = `${tmdbId}-radarr`;
        setRequestedItems((prev) => {
          const next = new Set(prev).add(requestKey);
          try {
            localStorage.setItem(
              'preview-requested-items',
              JSON.stringify(Array.from(next))
            );
          } catch (err) {
            // Ignore localStorage errors
          }
          return next;
        });

        addToast(intl.formatMessage(messages.downloadSuccess), {
          appearance: 'success',
          autoDismiss: true,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error && err.message
            ? err.message
            : intl.formatMessage(messages.downloadError);
        addToast(errorMessage, {
          appearance: 'error',
          autoDismiss: true,
        });
      } finally {
        setDownloadingItems((prev) => {
          const next = new Set(prev);
          next.delete(tmdbId);
          return next;
        });
      }
    },
    [
      radarrOptionsItem,
      addToast,
      intl,
      previewConfig.collectionName,
      previewConfig.subtype,
      previewConfig.type,
    ]
  );

  const handleExcludeItem = useCallback(
    async (tmdbId: number, mediaType: 'movie' | 'tv') => {
      try {
        await axios.post('/api/v1/exclusions', {
          tmdbId,
          mediaType,
        });

        setExcludedItems((prev) => new Set(prev).add(tmdbId));

        addToast(intl.formatMessage(messages.itemExcluded), {
          appearance: 'success',
          autoDismiss: true,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error && err.message
            ? err.message
            : intl.formatMessage(messages.excludeError);
        addToast(errorMessage, {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    },
    [addToast, intl]
  );

  const activeStatus = statusByLibrary[activeLibraryId];
  const activeItems = activeStatus?.result?.items || [];
  const isLoading = activeStatus?.running || !activeStatus;
  const error = activeStatus?.error;
  const currentStage = activeStatus?.currentStage || 'Initializing...';
  const progress = activeStatus?.progress || 0;

  // Handler to refresh preview data
  const handleRefresh = () => {
    const { sources, combineMode } = previewConfig;

    // For cycle_lists mode, just cycle to next source (no confirmation needed)
    if (combineMode === 'cycle_lists' && sources) {
      setCycleIndex((prev) => (prev + 1) % sources.length);
      return;
    }

    // For all other cases, confirm before forcing a refresh
    if (window.confirm(intl.formatMessage(messages.refreshConfirm))) {
      // Clear existing sessions and status
      setSessionIdsByLibrary({});
      setStatusByLibrary({});
      // Always bypass cache on manual refresh
      setForceRefresh(true);
      setRunKey((prev) => prev + 1);
    }
  };

  return (
    <>
      <Modal
        title={intl.formatMessage(messages.previewCollection)}
        onCancel={onCancel}
        cancelText={intl.formatMessage(messages.close)}
        customMaxWidth="sm:max-w-6xl"
        // View Exclusions button
        onOk={() => setShowExclusionsModal(true)}
        okText={intl.formatMessage(messages.viewExclusions)}
        okButtonType="default"
        // Show Refresh button for all scenarios
        onTertiary={handleRefresh}
        tertiaryText={intl.formatMessage(messages.refresh)}
        tertiaryButtonType="default"
      >
        <div className="w-full">
          {/* Library tabs - only show if multiple libraries */}
          {previewConfig.libraryIds.length > 1 && (
            <div className="mb-4 border-b border-gray-700">
              <nav className="-mb-px flex space-x-4">
                {previewConfig.libraries.map((library) => (
                  <button
                    key={library.id}
                    onClick={() => setActiveLibraryId(library.id)}
                    className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
                      activeLibraryId === library.id
                        ? 'border-orange-500 text-orange-500'
                        : 'border-transparent text-gray-400 hover:border-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {library.name}
                    {statusByLibrary[library.id]?.running && (
                      <span className="ml-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent"></span>
                    )}
                  </button>
                ))}
              </nav>
            </div>
          )}

          {isLoading && (
            <div className="flex h-96 flex-col items-center justify-center">
              <LoadingSpinner />
              <div className="mt-4 text-center">
                <div className="text-sm font-medium text-gray-300">
                  {currentStage}
                </div>
                <div className="mt-2 w-64">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
                    <div
                      className="h-full bg-orange-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-gray-400">{progress}%</div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex h-96 items-center justify-center">
              <div className="text-red-500">
                {intl.formatMessage(messages.errorLoadingPreview)}: {error}
              </div>
            </div>
          )}

          {!isLoading && !error && activeItems.length === 0 && (
            <div className="flex h-96 items-center justify-center">
              <div className="text-gray-400">
                {intl.formatMessage(messages.noItems)}
              </div>
            </div>
          )}

          {!isLoading && !error && activeItems.length > 0 && (
            <div
              className="max-h-[70vh] overflow-y-auto"
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
                {activeItems.map((item, index) => (
                  <div
                    key={`${item.tmdbId}-${index}`}
                    className="relative"
                    onMouseEnter={() => setHoveredItem(item.tmdbId)}
                    onMouseLeave={() => setHoveredItem(null)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div
                      className={`relative rounded-lg ${
                        item.inLibrary && !item.isPlaceholder
                          ? 'ring-2 ring-orange-500'
                          : item.isPlaceholder
                          ? 'ring-2 ring-yellow-500'
                          : 'ring-2 ring-gray-500'
                      }`}
                      style={{ aspectRatio: '2/3' }}
                    >
                      {/* Image wrapper with overflow hidden */}
                      <div className="absolute inset-0 overflow-hidden rounded-lg">
                        {item.posterUrl ? (
                          <Image
                            src={item.posterUrl}
                            alt={item.title}
                            layout="fill"
                            objectFit="cover"
                            loading="eager"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gray-800">
                            <span className="text-xs text-gray-500">
                              {intl.formatMessage(messages.noPoster)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Placeholder Badge - Bottom center */}
                      {item.isPlaceholder && (
                        <div className="absolute bottom-0 left-0 right-0 z-30 flex justify-center pb-2">
                          <span className="rounded-full bg-yellow-600 bg-opacity-90 px-3 py-1 text-xs font-semibold text-white">
                            {intl.formatMessage(messages.placeholder)}
                          </span>
                        </div>
                      )}

                      {/* Exclude Button - Top left, shows on hover */}
                      {hoveredItem === item.tmdbId &&
                        !excludedItems.has(item.tmdbId) && (
                          <div className="absolute left-2 top-2 z-40">
                            <button
                              className="rounded-full bg-red-600 bg-opacity-60 p-1 transition hover:bg-opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (item.mediaType) {
                                  handleExcludeItem(
                                    item.tmdbId,
                                    item.mediaType
                                  );
                                }
                              }}
                              title={intl.formatMessage(messages.excludeItem)}
                            >
                              <svg
                                className="h-5 w-5 text-white"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={3}
                                strokeLinecap="round"
                              >
                                <line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                            </button>
                          </div>
                        )}

                      {/* Excluded indicator - Shows when item is excluded */}
                      {excludedItems.has(item.tmdbId) && (
                        <div className="absolute left-2 top-2 z-40">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-600 bg-opacity-90">
                            <svg
                              className="h-5 w-5 text-white"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </div>
                        </div>
                      )}

                      {/* Info Icon - Shows on hover */}
                      {hoveredItem === item.tmdbId && (
                        <>
                          <div
                            ref={iconRef}
                            className="absolute right-2 top-2 z-40"
                          >
                            <button
                              className="rounded-full bg-black bg-opacity-70 p-1 transition hover:bg-opacity-90"
                              onMouseEnter={async (e) => {
                                // Cancel any pending close
                                if (tooltipCloseTimer.current) {
                                  clearTimeout(tooltipCloseTimer.current);
                                  tooltipCloseTimer.current = null;
                                }
                                setInfoTooltipItem(item.tmdbId);

                                // Simple, clear positioning: left or right of icon, avoid clipping
                                const buttonRect =
                                  e.currentTarget.getBoundingClientRect();
                                const tooltipWidth = 320; // w-80 = 320px
                                const padding = 12;

                                // 1. Choose horizontal position (left or right of icon)
                                const spaceRight =
                                  window.innerWidth - buttonRect.right;
                                const spaceLeft = buttonRect.left;

                                let left: number;
                                if (spaceRight >= tooltipWidth + padding) {
                                  // Position to the right
                                  left = buttonRect.right + padding;
                                } else if (
                                  spaceLeft >=
                                  tooltipWidth + padding
                                ) {
                                  // Position to the left
                                  left =
                                    buttonRect.left - tooltipWidth - padding;
                                } else {
                                  // Not enough space on either side - center on screen
                                  left = Math.max(
                                    padding,
                                    (window.innerWidth - tooltipWidth) / 2
                                  );
                                }

                                // 2. Choose vertical position and calculate max height
                                // Start aligned with button
                                let top = buttonRect.top;

                                // Calculate max height from this position to bottom of screen
                                let maxHeight =
                                  window.innerHeight - top - padding;

                                // If there's not enough space below, shift up to use space above
                                const desiredHeight = 500; // reasonable height for most tooltips
                                if (maxHeight < desiredHeight) {
                                  const spaceAbove = buttonRect.top - padding;
                                  // Shift up to get more height, but don't go past top of screen
                                  const neededShift = Math.min(
                                    desiredHeight - maxHeight,
                                    spaceAbove
                                  );
                                  top = buttonRect.top - neededShift;
                                  maxHeight =
                                    window.innerHeight - top - padding;
                                }

                                // Final safety check - don't go off top
                                top = Math.max(padding, top);
                                maxHeight = window.innerHeight - top - padding;

                                setTooltipPosition({ top, left, maxHeight });

                                // Fetch ratings if not already cached
                                if (
                                  !ratingsCache[item.tmdbId] &&
                                  !loadingRatings.has(item.tmdbId)
                                ) {
                                  setLoadingRatings((prev) =>
                                    new Set(prev).add(item.tmdbId)
                                  );
                                  try {
                                    const endpoint =
                                      item.mediaType === 'movie'
                                        ? `/api/v1/ratings/movie/${item.tmdbId}`
                                        : `/api/v1/ratings/tv/${item.tmdbId}`;

                                    // Build query string with proper encoding
                                    // Note: encodeURIComponent is necessary for OpenAPI validation
                                    const queryParams = new URLSearchParams();
                                    if (item.title)
                                      queryParams.append(
                                        'title',
                                        encodeURIComponent(item.title)
                                      );
                                    if (item.year)
                                      queryParams.append(
                                        'year',
                                        item.year.toString()
                                      );
                                    if (item.imdbId)
                                      queryParams.append('imdbId', item.imdbId);

                                    const response = await axios.get(
                                      `${endpoint}?${queryParams.toString()}`
                                    );
                                    setRatingsCache((prev) => ({
                                      ...prev,
                                      [item.tmdbId]: response.data,
                                    }));
                                  } catch (err) {
                                    // Silently fail - ratings are optional
                                  } finally {
                                    setLoadingRatings((prev) => {
                                      const next = new Set(prev);
                                      next.delete(item.tmdbId);
                                      return next;
                                    });
                                  }
                                }
                              }}
                              onMouseLeave={() => {
                                // Delay closing to allow moving to tooltip
                                tooltipCloseTimer.current = setTimeout(() => {
                                  setInfoTooltipItem(null);
                                  setTooltipPosition(null);
                                }, 200);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              title="Show info"
                            >
                              <InformationCircleIcon className="h-5 w-5 text-white" />
                            </button>
                          </div>
                        </>
                      )}

                      {/* Tooltip rendered via portal at document level */}
                      {infoTooltipItem === item.tmdbId &&
                      tooltipPosition &&
                      typeof window !== 'undefined'
                        ? createPortal(
                            /* eslint-disable-next-line jsx-a11y/no-static-element-interactions */
                            <div
                              ref={tooltipRef}
                              className="fixed z-[9999] w-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-xl"
                              style={{
                                top: `${tooltipPosition.top}px`,
                                left: `${tooltipPosition.left}px`,
                                maxHeight: `${tooltipPosition.maxHeight}px`,
                              }}
                              onMouseDown={(e) => {
                                // Prevent modal backdrop from detecting this as an outside click
                                e.stopPropagation();
                              }}
                              onMouseUp={(e) => {
                                // Prevent modal backdrop from detecting this as an outside click
                                e.stopPropagation();
                              }}
                              onMouseEnter={() => {
                                // Cancel close when hovering tooltip
                                if (tooltipCloseTimer.current) {
                                  clearTimeout(tooltipCloseTimer.current);
                                  tooltipCloseTimer.current = null;
                                }
                              }}
                              onMouseLeave={() => {
                                // Close when leaving tooltip
                                setInfoTooltipItem(null);
                                setTooltipPosition(null);
                              }}
                            >
                              <div className="text-sm text-white">
                                <div className="mb-3 text-base font-semibold">
                                  {item.title}
                                  {item.year && (
                                    <span className="block text-sm text-gray-400">
                                      ({item.year})
                                    </span>
                                  )}
                                </div>
                                <div className="mb-4 text-gray-300">
                                  {item.overview ||
                                    intl.formatMessage(messages.noOverview)}
                                </div>

                                {/* Ratings with logos */}
                                <div className="mb-4 flex flex-col gap-2.5">
                                  {item.tmdbRating && (
                                    <div className="flex items-center gap-2.5">
                                      <TmdbLogo className="h-5 w-auto" />
                                      <span className="text-base font-medium text-white">
                                        {Math.round(item.tmdbRating * 10)}%
                                      </span>
                                    </div>
                                  )}
                                  {ratingsCache[item.tmdbId]?.imdb?.rating && (
                                    <div className="flex items-center gap-2.5">
                                      <img
                                        src="/services/imdb.svg"
                                        alt="IMDB"
                                        className="h-5 w-auto"
                                      />
                                      <span className="text-base font-medium text-white">
                                        {
                                          ratingsCache[item.tmdbId]?.imdb
                                            ?.rating
                                        }
                                        /10
                                      </span>
                                    </div>
                                  )}
                                  {ratingsCache[item.tmdbId]?.rt && (
                                    <div className="flex items-center gap-2.5">
                                      {(ratingsCache[item.tmdbId]?.rt
                                        ?.criticsScore ?? 0) >= 60 ? (
                                        <RTFresh className="h-5 w-auto" />
                                      ) : (
                                        <RTRotten className="h-5 w-auto" />
                                      )}
                                      <span className="text-base font-medium text-white">
                                        {
                                          ratingsCache[item.tmdbId]?.rt
                                            ?.criticsScore
                                        }
                                        %
                                      </span>
                                    </div>
                                  )}
                                  {loadingRatings.has(item.tmdbId) &&
                                    !ratingsCache[item.tmdbId] && (
                                      <div className="text-sm text-gray-400">
                                        Loading ratings...
                                      </div>
                                    )}
                                </div>

                                {item.imdbId && (
                                  <a
                                    href={`https://www.imdb.com/title/${item.imdbId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block rounded bg-yellow-600 px-2 py-1 text-xs font-medium text-black transition hover:bg-yellow-500"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {intl.formatMessage(messages.viewOnImdb)}
                                  </a>
                                )}
                              </div>
                            </div>,
                            document.body
                          )
                        : null}

                      {/* Download Buttons - Bottom of poster with logos */}
                      {/* Show download buttons if: not in library OR (is a placeholder AND not monitored) */}
                      {(!item.inLibrary ||
                        (item.isPlaceholder && !item.monitored)) &&
                        hoveredItem === item.tmdbId && (
                          <div className="absolute bottom-2 left-2 right-2 z-10 flex justify-center gap-2">
                            {item.mediaType === 'movie' && item.tmdbId > 0 && (
                              <>
                                <button
                                  onClick={() =>
                                    handleDownload(
                                      item.tmdbId,
                                      item.title,
                                      'movie',
                                      'radarr',
                                      item.backdropPath
                                    )
                                  }
                                  disabled={downloadingItems.has(item.tmdbId)}
                                  className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                                  title={intl.formatMessage(
                                    messages.downloadViaRadarr
                                  )}
                                >
                                  {downloadingItems.has(item.tmdbId) ? (
                                    <span className="text-xs text-white">
                                      ...
                                    </span>
                                  ) : (
                                    <>
                                      <img
                                        src="/services/radarr.svg"
                                        alt="Radarr"
                                        className="h-full w-full"
                                      />
                                      {requestedItems.has(
                                        `${item.tmdbId}-radarr`
                                      ) && (
                                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-600 bg-opacity-80">
                                          <svg
                                            className="h-6 w-6 text-white"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={3}
                                              d="M5 13l4 4L19 7"
                                            />
                                          </svg>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={() =>
                                    handleDownload(
                                      item.tmdbId,
                                      item.title,
                                      'movie',
                                      'overseerr',
                                      item.backdropPath
                                    )
                                  }
                                  disabled={downloadingItems.has(item.tmdbId)}
                                  className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                                  title={intl.formatMessage(
                                    messages.downloadViaOverseerr
                                  )}
                                >
                                  {downloadingItems.has(item.tmdbId) ? (
                                    <span className="text-xs text-white">
                                      ...
                                    </span>
                                  ) : (
                                    <>
                                      <img
                                        src="/services/overseerr.svg"
                                        alt="Overseerr"
                                        className="h-full w-full"
                                      />
                                      {requestedItems.has(
                                        `${item.tmdbId}-overseerr`
                                      ) && (
                                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-600 bg-opacity-80">
                                          <svg
                                            className="h-6 w-6 text-white"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={3}
                                              d="M5 13l4 4L19 7"
                                            />
                                          </svg>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </button>
                              </>
                            )}
                            {item.mediaType === 'tv' && (
                              <>
                                <button
                                  onClick={() =>
                                    handleDownload(
                                      item.tmdbId,
                                      item.title,
                                      'tv',
                                      'sonarr',
                                      item.backdropPath
                                    )
                                  }
                                  disabled={downloadingItems.has(item.tmdbId)}
                                  className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                                  title={intl.formatMessage(
                                    messages.downloadViaSonarr
                                  )}
                                >
                                  {downloadingItems.has(item.tmdbId) ? (
                                    <span className="text-xs text-white">
                                      ...
                                    </span>
                                  ) : (
                                    <>
                                      <img
                                        src="/services/sonarr.svg"
                                        alt="Sonarr"
                                        className="h-full w-full"
                                      />
                                      {requestedItems.has(
                                        `${item.tmdbId}-sonarr`
                                      ) && (
                                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-600 bg-opacity-80">
                                          <svg
                                            className="h-6 w-6 text-white"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={3}
                                              d="M5 13l4 4L19 7"
                                            />
                                          </svg>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </button>
                                {/* Only show Overseerr button if item has TMDB ID */}
                                {item.tmdbId > 0 && (
                                  <button
                                    onClick={() =>
                                      handleDownload(
                                        item.tmdbId,
                                        item.title,
                                        'tv',
                                        'overseerr',
                                        item.backdropPath
                                      )
                                    }
                                    disabled={downloadingItems.has(item.tmdbId)}
                                    className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                                    title={intl.formatMessage(
                                      messages.downloadViaOverseerr
                                    )}
                                  >
                                    {downloadingItems.has(item.tmdbId) ? (
                                      <span className="text-xs text-white">
                                        ...
                                      </span>
                                    ) : (
                                      <>
                                        <img
                                          src="/services/overseerr.svg"
                                          alt="Overseerr"
                                          className="h-full w-full"
                                        />
                                        {requestedItems.has(
                                          `${item.tmdbId}-overseerr`
                                        ) && (
                                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-600 bg-opacity-80">
                                            <svg
                                              className="h-6 w-6 text-white"
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={3}
                                                d="M5 13l4 4L19 7"
                                              />
                                            </svg>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Exclusions Modal */}
      {showExclusionsModal && (
        <ExclusionsModal onCancel={() => setShowExclusionsModal(false)} />
      )}

      {/* Radarr Options Modal */}
      {radarrOptionsItem && (
        <RadarrOptionsModal
          tmdbId={radarrOptionsItem.tmdbId}
          title={radarrOptionsItem.title}
          backdropPath={radarrOptionsItem.backdropPath}
          onCancel={() => setRadarrOptionsItem(null)}
          onConfirm={handleRadarrOptions}
        />
      )}

      {/* Season Selection Modal */}
      {seasonSelectionItem && (
        <SeasonSelectionModal
          tmdbId={seasonSelectionItem.tmdbId}
          title={seasonSelectionItem.title}
          service={seasonSelectionItem.service}
          backdropPath={seasonSelectionItem.backdropPath}
          onCancel={() => setSeasonSelectionItem(null)}
          onConfirm={handleSeasonSelection}
        />
      )}
    </>
  );
};

export default PreviewCollectionModal;
