import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { Permission, useUser } from '@app/hooks/useUser';
import type { NextPage } from 'next';
import { defineMessages, useIntl } from 'react-intl';
// useSWR import removed - not used in simplified dashboard
import CollectionStatsGrid from '@app/components/Dashboard/CollectionStatsGrid';
import DashboardStats from '@app/components/Dashboard/DashboardStats';
import MissingItemsFeed from '@app/components/Dashboard/MissingItemsFeed';

const messages = defineMessages({
  dashboardTitle: 'Dashboard',
  dashboardDescription:
    'Overview of your Agregarr statistics and collection performance',
});

const DashboardPage: NextPage = () => {
  const intl = useIntl();
  const { user, hasPermission } = useUser();

  if (!user) {
    return <LoadingSpinner />;
  }

  if (!hasPermission(Permission.ADMIN)) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.dashboardTitle)} />
        <div className="mb-8">
          <h3 className="heading text-white">Access Denied</h3>
          <p className="description">
            You don&apos;t have permission to access this page.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.dashboardTitle)} />
      <div className="mb-8">
        <h3 className="heading text-white">
          {intl.formatMessage(messages.dashboardTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.dashboardDescription)}
        </p>
      </div>

      <div className="space-y-6">
        {/* Overview Stats */}
        <DashboardStats />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Collection Statistics */}
          <div className="lg:col-span-1">
            <CollectionStatsGrid />
          </div>

          {/* Recently Added Missing Items */}
          <div className="lg:col-span-1">
            <MissingItemsFeed />
          </div>
        </div>
      </div>
    </>
  );
};

export default DashboardPage;
