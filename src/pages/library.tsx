import LibraryCollectionsView from '@app/components/Collections/Views/Library';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useUser } from '@app/hooks/useUser';
import type { NextPage } from 'next';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  libraryTitle: 'Library',
  libraryDescription:
    'Manage collections that appear in your Plex library tabs',
  noCollections: 'No library collections configured yet',
});

const LibraryPage: NextPage = () => {
  const intl = useIntl();
  const { user } = useUser();

  if (!user) {
    return <LoadingSpinner />;
  }

  // Admin-only app - no permission checks needed

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.libraryTitle)} />
      <div className="mb-8">
        <h3 className="heading text-white">
          {intl.formatMessage(messages.libraryTitle)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.libraryDescription)}
        </p>
      </div>

      <LibraryCollectionsView />
    </>
  );
};

export default LibraryPage;
