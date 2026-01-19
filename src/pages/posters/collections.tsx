import CollectionsPageView from '@app/components/Posters/CollectionsPageView';
import PostersLayout from '@app/components/Posters/PostersLayout';
import Head from 'next/head';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  collectionPosters: 'Collection Posters',
});

const PostersCollectionsPage: React.FC = () => {
  const intl = useIntl();
  const pageTitle = `${intl.formatMessage(
    messages.collectionPosters
  )} - Agregarr`;

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <PostersLayout>
        <CollectionsPageView />
      </PostersLayout>
    </>
  );
};

export default PostersCollectionsPage;
