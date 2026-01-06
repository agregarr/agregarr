import HomeCollectionsView from '@app/components/Collections/Views/Home';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useUser } from '@app/hooks/useUser';
import type { NextPage } from 'next';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  homeTitle: 'Home',
  homeDescription:
    'Collections and Hubs on the Home screen. Ordering is shared between Home and Recommended views, but can have separate visibility settings.',
});

const Index: NextPage = () => {
  const intl = useIntl();
  const { user } = useUser();

  if (!user) {
    return <LoadingSpinner />;
  }

  // Admin-only app - no permission checks needed

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.homeTitle)} />
      <div className="mb-8">
        <h3 className="heading text-white">
          {intl.formatMessage(messages.homeTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.homeDescription)}
        </p>
      </div>

      <HomeCollectionsView />
    </>
  );
};

export default Index;
