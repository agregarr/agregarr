import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import axios from 'axios';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

const messages = defineMessages({
  globalExclusions: 'Global Exclusions',
  movies: 'Movies',
  tvShows: 'TV Shows',
  noExcludedMovies: 'No excluded movies',
  noExcludedShows: 'No excluded TV shows',
  removeFromExclusions: 'Remove from exclusions',
  exclusionRemoved: 'Item removed from exclusions',
  exclusionRemoveError: 'Failed to remove exclusion',
  loading: 'Loading exclusions...',
  close: 'Close',
  loadError: 'Failed to load exclusions',
});

interface EnrichedMovie {
  tmdbId: number;
  title: string;
  year?: number;
  posterPath?: string;
}

interface EnrichedShow {
  id: number;
  type: 'tmdb' | 'tvdb';
  title: string;
  year?: number;
  posterPath?: string;
}

interface GlobalExclusions {
  movies: EnrichedMovie[];
  shows: EnrichedShow[];
}

interface ExclusionsModalProps {
  onCancel: () => void;
}

const ExclusionsModal = ({ onCancel }: ExclusionsModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [activeTab, setActiveTab] = useState<'movies' | 'tv'>('movies');

  const {
    data: exclusions,
    error,
    mutate,
  } = useSWR<GlobalExclusions>('/api/v1/exclusions');

  const handleRemoveExclusion = async (
    tmdbId: number | undefined,
    tvdbId: number | undefined,
    mediaType: 'movie' | 'tv'
  ) => {
    try {
      await axios.delete('/api/v1/exclusions', {
        data: {
          tmdbId,
          tvdbId,
          mediaType,
        },
      });

      mutate();

      addToast(intl.formatMessage(messages.exclusionRemoved), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error && err.message
          ? err.message
          : intl.formatMessage(messages.exclusionRemoveError);
      addToast(errorMessage, {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const isLoading = !exclusions && !error;

  return (
    <Modal
      title={intl.formatMessage(messages.globalExclusions)}
      onCancel={onCancel}
      cancelText={intl.formatMessage(messages.close)}
      customMaxWidth="sm:max-w-3xl"
    >
      <div className="w-full">
        {/* Tabs */}
        <div className="mb-4 border-b border-gray-700">
          <nav className="-mb-px flex space-x-4">
            <button
              onClick={() => setActiveTab('movies')}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
                activeTab === 'movies'
                  ? 'border-orange-500 text-orange-500'
                  : 'border-transparent text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              {intl.formatMessage(messages.movies)}
              {exclusions && ` (${exclusions.movies.length})`}
            </button>
            <button
              onClick={() => setActiveTab('tv')}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
                activeTab === 'tv'
                  ? 'border-orange-500 text-orange-500'
                  : 'border-transparent text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              {intl.formatMessage(messages.tvShows)}
              {exclusions && ` (${exclusions.shows.length})`}
            </button>
          </nav>
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex h-96 items-center justify-center">
            <LoadingSpinner />
            <div className="ml-4 text-gray-400">
              {intl.formatMessage(messages.loading)}
            </div>
          </div>
        )}

        {error && (
          <div className="flex h-96 items-center justify-center text-red-500">
            {intl.formatMessage(messages.loadError)}
          </div>
        )}

        {exclusions && activeTab === 'movies' && (
          <div className="max-h-[60vh] overflow-y-auto">
            {exclusions.movies.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-gray-400">
                {intl.formatMessage(messages.noExcludedMovies)}
              </div>
            ) : (
              <div className="space-y-2">
                {exclusions.movies.map((movie) => (
                  <div
                    key={movie.tmdbId}
                    className="flex items-center justify-between rounded-lg bg-gray-800 p-3"
                  >
                    <div className="flex items-center space-x-3">
                      {movie.posterPath && (
                        <img
                          src={`https://image.tmdb.org/t/p/w92${movie.posterPath}`}
                          alt={movie.title}
                          className="h-14 w-10 rounded object-cover"
                        />
                      )}
                      <div>
                        <div className="font-medium text-white">
                          {movie.title}
                        </div>
                        {movie.year && (
                          <div className="text-sm text-gray-400">
                            {movie.year}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        handleRemoveExclusion(movie.tmdbId, undefined, 'movie')
                      }
                      className="rounded-full bg-red-600 p-2 transition hover:bg-red-700"
                      title={intl.formatMessage(messages.removeFromExclusions)}
                    >
                      <svg
                        className="h-4 w-4 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {exclusions && activeTab === 'tv' && (
          <div className="max-h-[60vh] overflow-y-auto">
            {exclusions.shows.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-gray-400">
                {intl.formatMessage(messages.noExcludedShows)}
              </div>
            ) : (
              <div className="space-y-2">
                {exclusions.shows.map((show) => (
                  <div
                    key={`${show.type}-${show.id}`}
                    className="flex items-center justify-between rounded-lg bg-gray-800 p-3"
                  >
                    <div className="flex items-center space-x-3">
                      {show.posterPath && (
                        <img
                          src={`https://image.tmdb.org/t/p/w92${show.posterPath}`}
                          alt={show.title}
                          className="h-14 w-10 rounded object-cover"
                        />
                      )}
                      <div>
                        <div className="font-medium text-white">
                          {show.title}
                        </div>
                        {show.year && (
                          <div className="text-sm text-gray-400">
                            {show.year}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        handleRemoveExclusion(
                          show.type === 'tmdb' ? show.id : undefined,
                          show.type === 'tvdb' ? show.id : undefined,
                          'tv'
                        )
                      }
                      className="rounded-full bg-red-600 p-2 transition hover:bg-red-700"
                      title={intl.formatMessage(messages.removeFromExclusions)}
                    >
                      <svg
                        className="h-4 w-4 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ExclusionsModal;
