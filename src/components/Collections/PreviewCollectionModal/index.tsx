import RTFresh from '@app/assets/rt_fresh.svg';
import RTRotten from '@app/assets/rt_rotten.svg';
import TmdbLogo from '@app/assets/tmdb_logo.svg';
import RadarrOptionsModal from '@app/components/Collections/RadarrOptionsModal';
import SeasonSelectionModal from '@app/components/Collections/SeasonSelectionModal';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  previewCollection: 'Preview Collection',
  loadingPreview: 'Loading preview...',
  errorLoadingPreview: 'Failed to load preview',
  noItems: 'No items found',
  inLibrary: 'In Library',
  missing: 'Missing',
  downloadViaRadarr: 'Download via Radarr',
  downloadViaSonarr: 'Download via Sonarr',
  downloadViaOverseerr: 'Request via Overseerr',
  downloadSuccess: 'Download request sent successfully',
  downloadError: 'Failed to send download request',
  close: 'Close',
  viewOnImdb: 'View on IMDb',
  noOverview: 'No overview available',
});

interface PreviewItem {
  ratingKey?: string;
  tmdbId: number;
  title: string;
  year?: number;
  mediaType?: 'movie' | 'tv';
  posterUrl: string;
  inLibrary: boolean;
  overview?: string;
  imdbId?: string;
  tmdbRating?: number;
}

interface ItemRatings {
  imdb?: {
    title: string;
    url: string;
    criticsScore: number;
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
    libraryIds: string[];
    libraries: Library[];
    customUrl?: string;
    maxItems?: number;
    timePeriod?: string;
    minimumPlays?: number;
    customDays?: number;
    network?: string;
    country?: string;
    provider?: string;
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
  const [tooltipOpenLeft, setTooltipOpenLeft] = useState(false);
  const [tooltipOpenAbove, setTooltipOpenAbove] = useState(false);
  const iconRef = useRef<HTMLDivElement>(null);
  const tooltipCloseTimer = useRef<NodeJS.Timeout | null>(null);
  const [downloadingItems, setDownloadingItems] = useState<Set<number>>(
    new Set()
  );
  const [requestedItems, setRequestedItems] = useState<Set<string>>(new Set());
  const [radarrOptionsItem, setRadarrOptionsItem] = useState<{
    tmdbId: number;
    title: string;
  } | null>(null);
  const [seasonSelectionItem, setSeasonSelectionItem] = useState<{
    tmdbId: number;
    title: string;
    service: 'overseerr' | 'sonarr';
  } | null>(null);
  const [ratingsCache, setRatingsCache] = useState<Record<number, ItemRatings>>(
    {}
  );
  const [loadingRatings, setLoadingRatings] = useState<Set<number>>(new Set());

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
          maxItems: previewConfig.maxItems,
          timePeriod: previewConfig.timePeriod,
          minimumPlays: previewConfig.minimumPlays,
          customDays: previewConfig.customDays,
          network: previewConfig.network,
          country: previewConfig.country,
          provider: previewConfig.provider,
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
  }, [previewConfig]);

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
      service: 'radarr' | 'sonarr' | 'overseerr'
    ) => {
      // For Radarr (movies), show options modal
      if (service === 'radarr' && mediaType === 'movie') {
        setRadarrOptionsItem({ tmdbId, title });
        return;
      }

      // For TV shows with Overseerr or Sonarr, show season selection modal
      if (
        mediaType === 'tv' &&
        (service === 'overseerr' || service === 'sonarr')
      ) {
        setSeasonSelectionItem({ tmdbId, title, service });
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
    [addToast, intl, previewConfig.type]
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
    [seasonSelectionItem, addToast, intl, previewConfig.type]
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
    [radarrOptionsItem, addToast, intl, previewConfig.type]
  );

  const activeStatus = statusByLibrary[activeLibraryId];
  const activeItems = activeStatus?.result?.items || [];
  const isLoading = activeStatus?.running || !activeStatus;
  const error = activeStatus?.error;
  const currentStage = activeStatus?.currentStage || 'Initializing...';
  const progress = activeStatus?.progress || 0;

  return (
    <Modal
      title={intl.formatMessage(messages.previewCollection)}
      onCancel={onCancel}
      cancelText={intl.formatMessage(messages.close)}
      customMaxWidth="sm:max-w-6xl"
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
                      item.inLibrary
                        ? 'ring-2 ring-orange-500'
                        : 'ring-2 ring-gray-500'
                    }`}
                    style={{ aspectRatio: '2/3' }}
                  >
                    {/* Image wrapper with overflow hidden */}
                    <div className="absolute inset-0 overflow-hidden rounded-lg">
                      {item.posterUrl ? (
                        <img
                          src={item.posterUrl}
                          alt={item.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gray-800">
                          <span className="text-xs text-gray-500">
                            No Poster
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Info Icon - Shows on hover */}
                    {hoveredItem === item.tmdbId && (
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
                            // Check if tooltip would clip on right/bottom of the modal container
                            const buttonRect =
                              e.currentTarget.getBoundingClientRect();
                            const container =
                              e.currentTarget.closest('.max-h-\\[70vh\\]');
                            if (container) {
                              const containerRect =
                                container.getBoundingClientRect();
                              const spaceOnRight =
                                containerRect.right - buttonRect.right;
                              const spaceBelow =
                                containerRect.bottom - buttonRect.bottom;
                              setTooltipOpenLeft(spaceOnRight < 280); // 280px = 256px tooltip + 24px margin
                              setTooltipOpenAbove(spaceBelow < 200); // Approximate tooltip height
                            }

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
                                if (item.imdbId && item.mediaType === 'movie')
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
                            }, 200);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          title="Show info"
                        >
                          <InformationCircleIcon className="h-5 w-5 text-white" />
                        </button>

                        {/* Info Tooltip - Small popup */}
                        {infoTooltipItem === item.tmdbId && (
                          <div
                            className={`absolute z-50 w-80 rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-xl ${
                              tooltipOpenLeft ? 'right-0' : 'left-0'
                            } ${tooltipOpenAbove ? 'bottom-8' : 'top-8'}`}
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
                              <div className="mb-4 max-h-40 overflow-y-auto text-gray-300">
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
                                {ratingsCache[item.tmdbId]?.imdb && (
                                  <div className="flex items-center gap-2.5">
                                    <img
                                      src="/services/imdb.svg"
                                      alt="IMDB"
                                      className="h-5 w-auto"
                                    />
                                    <span className="text-base font-medium text-white">
                                      {
                                        ratingsCache[item.tmdbId]?.imdb
                                          ?.criticsScore
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
                          </div>
                        )}
                      </div>
                    )}

                    {/* Download Buttons - Bottom of poster with logos */}
                    {!item.inLibrary && hoveredItem === item.tmdbId && (
                      <div className="absolute bottom-2 left-2 right-2 z-10 flex justify-center gap-2">
                        {item.mediaType === 'movie' && (
                          <>
                            <button
                              onClick={() =>
                                handleDownload(
                                  item.tmdbId,
                                  item.title,
                                  'movie',
                                  'radarr'
                                )
                              }
                              disabled={downloadingItems.has(item.tmdbId)}
                              className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                              title={intl.formatMessage(
                                messages.downloadViaRadarr
                              )}
                            >
                              {downloadingItems.has(item.tmdbId) ? (
                                <span className="text-xs text-white">...</span>
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
                                  'overseerr'
                                )
                              }
                              disabled={downloadingItems.has(item.tmdbId)}
                              className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                              title={intl.formatMessage(
                                messages.downloadViaOverseerr
                              )}
                            >
                              {downloadingItems.has(item.tmdbId) ? (
                                <span className="text-xs text-white">...</span>
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
                                  'sonarr'
                                )
                              }
                              disabled={downloadingItems.has(item.tmdbId)}
                              className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                              title={intl.formatMessage(
                                messages.downloadViaSonarr
                              )}
                            >
                              {downloadingItems.has(item.tmdbId) ? (
                                <span className="text-xs text-white">...</span>
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
                            <button
                              onClick={() =>
                                handleDownload(
                                  item.tmdbId,
                                  item.title,
                                  'tv',
                                  'overseerr'
                                )
                              }
                              disabled={downloadingItems.has(item.tmdbId)}
                              className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-black bg-opacity-70 p-2 transition hover:bg-opacity-90 disabled:opacity-50"
                              title={intl.formatMessage(
                                messages.downloadViaOverseerr
                              )}
                            >
                              {downloadingItems.has(item.tmdbId) ? (
                                <span className="text-xs text-white">...</span>
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
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Radarr Options Modal */}
      {radarrOptionsItem && (
        <RadarrOptionsModal
          tmdbId={radarrOptionsItem.tmdbId}
          title={radarrOptionsItem.title}
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
          onCancel={() => setSeasonSelectionItem(null)}
          onConfirm={handleSeasonSelection}
        />
      )}
    </Modal>
  );
};

export default PreviewCollectionModal;
