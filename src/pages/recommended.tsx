import RecommendedCollectionsView from '@app/components/Collections/Views/Recommended';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useUser } from '@app/hooks/useUser';
import type { NextPage } from 'next';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  recommendedTitle: 'Recommended',
  recommendedDescription:
    'Collections and Hubs in the Recommended tabs. Ordering is shared between Home and Recommended views, but can have seperate visibility setings.',
  noCollections: 'No recommended collections configured yet',
});

const RecommendedPage: NextPage = () => {
  const intl = useIntl();
  const { user } = useUser();

  if (!user) {
    return <LoadingSpinner />;
  }

  // Admin-only app - no permission checks needed

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.recommendedTitle)} />
      <div className="mb-8">
        <h3 className="heading text-white">
          {intl.formatMessage(messages.recommendedTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.recommendedDescription)}
        </p>
      </div>

      <RecommendedCollectionsView />
    </>
  );
};

export default RecommendedPage;
