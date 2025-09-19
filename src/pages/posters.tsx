import PageTitle from '@app/components/Common/PageTitle';
import PostersView from '@app/components/PostersView';
import Head from 'next/head';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  posters: 'Posters',
  postersDescription: 'Manage poster templates and saved posters',
});

const PostersPage: React.FC = () => {
  const intl = useIntl();

  return (
    <>
      <Head>
        <title>{intl.formatMessage(messages.posters)} - Agregarr</title>
      </Head>
      <PageTitle title={intl.formatMessage(messages.posters)} />
      <div className="mb-6">
        <p className="text-stone-300">
          {intl.formatMessage(messages.postersDescription)}
        </p>
      </div>
      <PostersView />
    </>
  );
};

export default PostersPage;
