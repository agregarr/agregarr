import OverlaysPageView from '@app/components/Posters/OverlaysPageView';
import PostersLayout from '@app/components/Posters/PostersLayout';
import Head from 'next/head';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  posterOverlays: 'Poster Overlays',
});

const PostersOverlaysPage: React.FC = () => {
  const intl = useIntl();
  const pageTitle = `${intl.formatMessage(messages.posterOverlays)} - Agregarr`;

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
      </Head>
      <PostersLayout>
        <OverlaysPageView />
      </PostersLayout>
    </>
  );
};

export default PostersOverlaysPage;
