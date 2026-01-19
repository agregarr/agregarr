import type { GetServerSideProps, NextPage } from 'next';

const PostersIndexPage: NextPage = () => {
  return null;
};

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/posters/overlays',
      permanent: true,
    },
  };
};

export default PostersIndexPage;
