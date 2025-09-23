import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import { Transition } from '@headlessui/react';
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CogIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  FunnelIcon,
  TvIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import type React from 'react';
import { Fragment, useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  allMissingItems: 'All Missing Items',
  close: 'Close',
  filter: 'Filter',
  clearFilters: 'Clear Filters',
  mediaType: 'Media Type',
  status: 'Status',
  source: 'Source',
  service: 'Service',
  allMediaTypes: 'All Media Types',
  movies: 'Movies',
  tvShows: 'TV Shows',
  allStatuses: 'All Statuses',
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
  available: 'Available',
  processing: 'Processing',
  failed: 'Failed',
  partiallyAvailable: 'Partially Available',
  allSources: 'All Sources',
  trakt: 'Trakt',
  tmdb: 'TMDB',
  imdb: 'IMDb',
  letterboxd: 'Letterboxd',
  allServices: 'All Services',
  overseerr: 'Overseerr',
  radarr: 'Radarr',
  sonarr: 'Sonarr',
  noResults: 'No missing items found',
  noResultsDesc: 'Try adjusting your filters to see more results',
  requestedFrom: 'From {collection}',
  requestedVia: 'via {source}',
  autoRequest: 'Auto',
  manualRequest: 'Manual',
  itemsPerPage: 'Items per page',
  showing: 'Showing {start} to {end} of {total} items',
  previous: 'Previous',
  next: 'Next',
  refreshing: 'Refreshing...',
  syncStatus: 'Sync Status',
  syncing: 'Syncing...',
});

interface MissingItem {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  year?: number;
  collectionName: string;
  collectionSource: string;
  collectionSubtype?: string;
  requestService: string;
  requestMethod: string;
  requestStatus:
    | 'pending'
    | 'approved'
    | 'declined'
    | 'available'
    | 'processing'
    | 'failed'
    | 'partially_available';
  overseerrRequestId?: number;
  requestedBy?: {
    id: number;
    displayName: string;
  };
  createdAt: string;
  requestedAt?: string;
}

interface MissingItemsResponse {
  results: MissingItem[];
  total: number;
  limit: number;
  offset: number;
}

interface MissingItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MissingItemsModal: React.FC<MissingItemsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const intl = useIntl();
  const [filters, setFilters] = useState({
    mediaType: '',
    status: '',
    collectionSource: '',
    requestService: '',
  });
  const [pagination, setPagination] = useState({
    limit: 20,
    offset: 0,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Build query string from filters and pagination
  const queryParams = new URLSearchParams();
  queryParams.set('limit', pagination.limit.toString());
  queryParams.set('offset', pagination.offset.toString());

  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      queryParams.set(key, value);
    }
  });

  const {
    data: missingItemsData,
    error,
    mutate,
    isValidating,
  } = useSWR<MissingItemsResponse>(
    isOpen ? `/api/v1/missing-items?${queryParams.toString()}` : null
  );

  // Reset pagination when filters change
  useEffect(() => {
    setPagination((prev) => ({ ...prev, offset: 0 }));
  }, [filters]);

  const getMediaIcon = (mediaType: string, size = 'h-5 w-5') => {
    switch (mediaType) {
      case 'movie':
        return <FilmIcon className={`${size} text-orange-400`} />;
      case 'tv':
        return <TvIcon className={`${size} text-orange-400`} />;
      default:
        return null;
    }
  };

  const getStatusIcon = (status: string, size = 'h-4 w-4') => {
    switch (status) {
      case 'pending':
        return <ClockIcon className={`${size} text-yellow-400`} />;
      case 'approved':
        return <CheckCircleIcon className={`${size} text-green-400`} />;
      case 'declined':
        return <XCircleIcon className={`${size} text-red-400`} />;
      case 'available':
        return <CheckCircleIcon className={`${size} text-orange-400`} />;
      case 'processing':
        return <CogIcon className={`${size} animate-spin text-orange-300`} />;
      case 'failed':
        return <ExclamationTriangleIcon className={`${size} text-red-500`} />;
      case 'partially_available':
        return <CheckCircleIcon className={`${size} text-green-300`} />;
      default:
        return <ClockIcon className={`${size} text-gray-400`} />;
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'pending':
        return intl.formatMessage(messages.pending);
      case 'approved':
        return intl.formatMessage(messages.approved);
      case 'declined':
        return intl.formatMessage(messages.declined);
      case 'available':
        return intl.formatMessage(messages.available);
      case 'processing':
        return intl.formatMessage(messages.processing);
      case 'failed':
        return intl.formatMessage(messages.failed);
      case 'partially_available':
        return intl.formatMessage(messages.partiallyAvailable);
      default:
        return status;
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      mediaType: '',
      status: '',
      collectionSource: '',
      requestService: '',
    });
  };

  const handlePageChange = (direction: 'prev' | 'next') => {
    setPagination((prev) => ({
      ...prev,
      offset:
        direction === 'next'
          ? prev.offset + prev.limit
          : Math.max(0, prev.offset - prev.limit),
    }));
  };

  const handleSyncStatus = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch('/api/v1/missing-items/sync', {
        method: 'POST',
      });
      if (response.ok) {
        // Refresh the data after sync
        await mutate();
      }
    } catch (error) {
      // Error handled by finally block
    } finally {
      setIsSyncing(false);
    }
  };

  const totalPages = missingItemsData
    ? Math.ceil(missingItemsData.total / pagination.limit)
    : 0;
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  const getTmdbImageUrl = (posterPath?: string): string | undefined => {
    if (!posterPath) return undefined;
    return `https://image.tmdb.org/t/p/w154${posterPath}`;
  };

  return (
    <Transition
      as={Fragment}
      appear
      show={isOpen}
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Modal
        onCancel={onClose}
        onOk={onClose}
        title={intl.formatMessage(messages.allMissingItems)}
        cancelText={intl.formatMessage(messages.close)}
        okText=""
      >
        <div className="space-y-4">
          {/* Filter Section */}
          <div className="border-b border-gray-700 pb-4">
            <div className="mb-4 flex items-center justify-between">
              <Button
                buttonType="ghost"
                buttonSize="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                <FunnelIcon className="mr-2 h-4 w-4" />
                {intl.formatMessage(messages.filter)}
              </Button>
              <div className="flex space-x-2">
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={clearFilters}
                >
                  {intl.formatMessage(messages.clearFilters)}
                </Button>
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={() => mutate()}
                  disabled={isValidating}
                >
                  {isValidating
                    ? intl.formatMessage(messages.refreshing)
                    : 'Refresh'}
                </Button>
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={handleSyncStatus}
                  disabled={isSyncing || isValidating}
                >
                  {isSyncing
                    ? intl.formatMessage(messages.syncing)
                    : intl.formatMessage(messages.syncStatus)}
                </Button>
              </div>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {/* Media Type Filter */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-300">
                    {intl.formatMessage(messages.mediaType)}
                  </label>
                  <select
                    value={filters.mediaType}
                    onChange={(e) =>
                      handleFilterChange('mediaType', e.target.value)
                    }
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">
                      {intl.formatMessage(messages.allMediaTypes)}
                    </option>
                    <option value="movie">
                      {intl.formatMessage(messages.movies)}
                    </option>
                    <option value="tv">
                      {intl.formatMessage(messages.tvShows)}
                    </option>
                  </select>
                </div>

                {/* Status Filter */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-300">
                    {intl.formatMessage(messages.status)}
                  </label>
                  <select
                    value={filters.status}
                    onChange={(e) =>
                      handleFilterChange('status', e.target.value)
                    }
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">
                      {intl.formatMessage(messages.allStatuses)}
                    </option>
                    <option value="pending">
                      {intl.formatMessage(messages.pending)}
                    </option>
                    <option value="approved">
                      {intl.formatMessage(messages.approved)}
                    </option>
                    <option value="declined">
                      {intl.formatMessage(messages.declined)}
                    </option>
                    <option value="available">
                      {intl.formatMessage(messages.available)}
                    </option>
                    <option value="processing">
                      {intl.formatMessage(messages.processing)}
                    </option>
                    <option value="failed">
                      {intl.formatMessage(messages.failed)}
                    </option>
                    <option value="partially_available">
                      {intl.formatMessage(messages.partiallyAvailable)}
                    </option>
                  </select>
                </div>

                {/* Source Filter */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-300">
                    {intl.formatMessage(messages.source)}
                  </label>
                  <select
                    value={filters.collectionSource}
                    onChange={(e) =>
                      handleFilterChange('collectionSource', e.target.value)
                    }
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">
                      {intl.formatMessage(messages.allSources)}
                    </option>
                    <option value="trakt">
                      {intl.formatMessage(messages.trakt)}
                    </option>
                    <option value="tmdb">
                      {intl.formatMessage(messages.tmdb)}
                    </option>
                    <option value="imdb">
                      {intl.formatMessage(messages.imdb)}
                    </option>
                    <option value="letterboxd">
                      {intl.formatMessage(messages.letterboxd)}
                    </option>
                  </select>
                </div>

                {/* Service Filter */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-300">
                    {intl.formatMessage(messages.service)}
                  </label>
                  <select
                    value={filters.requestService}
                    onChange={(e) =>
                      handleFilterChange('requestService', e.target.value)
                    }
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">
                      {intl.formatMessage(messages.allServices)}
                    </option>
                    <option value="overseerr">
                      {intl.formatMessage(messages.overseerr)}
                    </option>
                    <option value="radarr">
                      {intl.formatMessage(messages.radarr)}
                    </option>
                    <option value="sonarr">
                      {intl.formatMessage(messages.sonarr)}
                    </option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Results Section */}
          <div className="min-h-96">
            {error ? (
              <div className="py-8 text-center">
                <p className="mb-2 text-red-400">
                  Failed to load missing items
                </p>
                <p className="text-sm text-gray-400">{error.message}</p>
              </div>
            ) : !missingItemsData ? (
              <div className="flex justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : missingItemsData.results.length === 0 ? (
              <div className="py-12 text-center">
                <div className="mb-4">
                  <FilmIcon className="mx-auto h-16 w-16 text-gray-500" />
                </div>
                <p className="mb-2 text-lg text-gray-400">
                  {intl.formatMessage(messages.noResults)}
                </p>
                <p className="text-sm text-gray-500">
                  {intl.formatMessage(messages.noResultsDesc)}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {missingItemsData.results.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center space-x-3 rounded-lg border border-gray-700 p-4 transition-colors hover:border-gray-600"
                  >
                    <div className="flex-shrink-0">
                      {item.posterPath ? (
                        <div className="relative">
                          <img
                            src={getTmdbImageUrl(item.posterPath)}
                            alt={item.title}
                            className="h-24 w-16 rounded border border-gray-600 object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const iconDiv = e.currentTarget
                                .nextElementSibling as HTMLElement;
                              if (iconDiv) iconDiv.style.display = 'block';
                            }}
                          />
                          <div className="hidden">
                            {getMediaIcon(item.mediaType, 'w-16 h-16')}
                          </div>
                        </div>
                      ) : (
                        getMediaIcon(item.mediaType, 'w-16 h-16')
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">
                        {item.title}
                        {item.year && (
                          <span className="ml-1 text-gray-400">
                            ({item.year})
                          </span>
                        )}
                      </p>
                      <div className="flex items-center space-x-2 text-sm text-gray-400">
                        <span>
                          {intl.formatMessage(messages.requestedFrom, {
                            collection: item.collectionName,
                          })}
                        </span>
                        <span>•</span>
                        <span>
                          {intl.formatMessage(messages.requestedVia, {
                            source: item.collectionSource,
                          })}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center space-x-2 text-xs text-gray-500">
                        <span
                          className={`rounded px-2 py-1 ${
                            item.requestMethod === 'auto'
                              ? 'bg-green-900 text-green-300'
                              : 'bg-orange-900 text-orange-300'
                          }`}
                        >
                          {item.requestMethod === 'auto'
                            ? intl.formatMessage(messages.autoRequest)
                            : intl.formatMessage(messages.manualRequest)}
                        </span>
                        <span>•</span>
                        <span>
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex-shrink-0 text-right">
                      <div className="mb-1 flex items-center text-sm">
                        {getStatusIcon(item.requestStatus)}
                        <span className="ml-1 text-gray-300">
                          {getStatusLabel(item.requestStatus)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.requestService}
                      </div>
                      {item.requestedBy && (
                        <div className="mt-1 text-xs text-gray-500">
                          by {item.requestedBy.displayName}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {missingItemsData && missingItemsData.total > 0 && (
            <div className="flex items-center justify-between border-t border-gray-700 pt-4">
              <div className="text-sm text-gray-400">
                {intl.formatMessage(messages.showing, {
                  start: pagination.offset + 1,
                  end: Math.min(
                    pagination.offset + pagination.limit,
                    missingItemsData.total
                  ),
                  total: missingItemsData.total,
                })}
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={() => handlePageChange('prev')}
                  disabled={pagination.offset === 0}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                  {intl.formatMessage(messages.previous)}
                </Button>
                <span className="px-3 py-1 text-sm text-gray-300">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  buttonType="ghost"
                  buttonSize="sm"
                  onClick={() => handlePageChange('next')}
                  disabled={
                    pagination.offset + pagination.limit >=
                    missingItemsData.total
                  }
                >
                  {intl.formatMessage(messages.next)}
                  <ChevronRightIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </Transition>
  );
};

export default MissingItemsModal;
