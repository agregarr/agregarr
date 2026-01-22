import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import {
  CogIcon,
  ExclamationCircleIcon,
  FilmIcon,
  PlayIcon,
  RectangleStackIcon as CollectionIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  collections: 'Collections',
  collectionPlays: 'Collection Views',
  movieCollectionPlays: 'Movie Collection Views',
  tvCollectionPlays: 'TV Collection Views',
  preExistingCollections: 'Pre-existing',
  totalServer: 'total',
  thisWeek: 'this week',
  tautulliRequired: 'Tautulli Setup Required',
  tautulliDescriptionPlayStats:
    'Configure Tautulli in your settings to view play statistics from your Plex server.',
  configureTautulli: 'Configure Tautulli',
  failedToLoadDashboardStats: 'Failed to load dashboard statistics',
});

interface DashboardData {
  collections: {
    agregarr: number;
    preExisting: number;
    total: number;
    stats?: {
      topCollections: unknown[];
      totalCollections: number;
      collectionPlays: {
        total: number;
        movies: number;
        tv: number;
      };
    };
  };
  activity?: {
    totalPlays: number;
    moviePlays: number;
    tvPlays: number;
    collectionPlays: number;
  };
  tautulli?: {
    isConnected: boolean;
    error?: string;
    weeklyActivity?: {
      totalPlays: number;
      moviePlays: number;
      tvPlays: number;
      collectionPlays: number;
    };
  };
  timestamp: string;
}

const StatCard = ({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subtitle?: string;
}) => (
  <div className="rounded-lg bg-stone-800 p-6 shadow-sm">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-gray-400">{title}</p>
        <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="flex-shrink-0">
        <Icon className="h-8 w-8 text-orange-400" />
      </div>
    </div>
  </div>
);

const DashboardStats: React.FC = () => {
  const intl = useIntl();
  const { data: dashboardData, error } = useSWR<DashboardData>(
    '/api/v1/dashboard/stats'
  );

  if (error) {
    return (
      <div className="rounded-lg bg-stone-800 p-6 shadow-sm">
        <div className="text-center">
          <p className="text-red-400">
            {intl.formatMessage(messages.failedToLoadDashboardStats)}
          </p>
          <p className="mt-1 text-sm text-gray-500">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="rounded-lg bg-stone-800 p-6 shadow-sm">
        <div className="flex justify-center">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  // Check if Tautulli is not configured
  const isTautulliConfigured =
    dashboardData.tautulli?.isConnected === true ||
    dashboardData.activity !== null;

  // If Tautulli is not configured, show setup message
  if (!isTautulliConfigured) {
    return (
      <div className="rounded-lg bg-stone-800 p-6 shadow-sm">
        <div className="flex flex-col items-center py-8 text-center">
          <ExclamationCircleIcon className="mb-4 h-12 w-12 text-orange-400" />
          <h4 className="mb-2 text-lg font-semibold text-white">
            {intl.formatMessage(messages.tautulliRequired)}
          </h4>
          <p className="mb-6 max-w-md text-gray-400">
            {intl.formatMessage(messages.tautulliDescriptionPlayStats)}
          </p>
          <Link href="/settings/sources" passHref>
            <Button as="a" buttonType="primary">
              <CogIcon className="mr-2 h-5 w-5" />
              {intl.formatMessage(messages.configureTautulli)}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const collectionPlays =
    dashboardData.activity?.collectionPlays ||
    dashboardData.tautulli?.weeklyActivity?.collectionPlays ||
    0;
  const totalPlays =
    dashboardData.activity?.totalPlays ||
    dashboardData.tautulli?.weeklyActivity?.totalPlays ||
    0;
  const movieCollectionPlays =
    dashboardData.collections.stats?.collectionPlays.movies || 0;
  const tvCollectionPlays =
    dashboardData.collections.stats?.collectionPlays.tv || 0;
  const totalMoviePlays =
    dashboardData.activity?.moviePlays ||
    dashboardData.tautulli?.weeklyActivity?.moviePlays ||
    0;
  const totalTvPlays =
    dashboardData.activity?.tvPlays ||
    dashboardData.tautulli?.weeklyActivity?.tvPlays ||
    0;

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={intl.formatMessage(messages.collections)}
        value={dashboardData.collections.agregarr}
        icon={CollectionIcon}
        subtitle={`${
          dashboardData.collections.preExisting
        } ${intl.formatMessage(messages.preExistingCollections)}`}
      />

      <StatCard
        title={intl.formatMessage(messages.collectionPlays)}
        value={collectionPlays}
        icon={PlayIcon}
        subtitle={`${totalPlays} ${intl.formatMessage(
          messages.totalServer
        )} • ${intl.formatMessage(messages.thisWeek)}`}
      />

      <StatCard
        title={intl.formatMessage(messages.movieCollectionPlays)}
        value={movieCollectionPlays}
        icon={FilmIcon}
        subtitle={`${totalMoviePlays} ${intl.formatMessage(
          messages.totalServer
        )} • ${intl.formatMessage(messages.thisWeek)}`}
      />

      <StatCard
        title={intl.formatMessage(messages.tvCollectionPlays)}
        value={tvCollectionPlays}
        icon={TvIcon}
        subtitle={`${totalTvPlays} ${intl.formatMessage(
          messages.totalServer
        )} • ${intl.formatMessage(messages.thisWeek)}`}
      />
    </div>
  );
};

export default DashboardStats;
