import PageTitle from '@app/components/Common/PageTitle';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  posters: 'Posters',
  posterOverlays: 'Poster Overlays',
  collectionPosters: 'Collection Posters',
});

interface PostersLayoutProps {
  children: React.ReactNode;
}

interface TabRoute {
  text: string;
  route: string;
  regex: RegExp;
}

const PostersLayout = ({ children }: PostersLayoutProps) => {
  const intl = useIntl();
  const router = useRouter();

  const tabs: TabRoute[] = [
    {
      text: intl.formatMessage(messages.posterOverlays),
      route: '/posters/overlays',
      regex: /^\/posters\/overlays/,
    },
    {
      text: intl.formatMessage(messages.collectionPosters),
      route: '/posters/collections',
      regex: /^\/posters\/collections/,
    },
  ];

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.posters)} />
      <div className="mt-6">
        <nav className="flex space-x-2 rounded-xl bg-stone-900/40 p-1.5">
          {tabs.map((tab) => {
            const isActive = router.pathname.match(tab.regex);
            return (
              <Link key={tab.route} href={tab.route}>
                <a
                  className={`rounded-lg px-6 py-3 text-base font-semibold leading-6 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-opacity-75 ${
                    isActive
                      ? 'border border-orange-500 bg-orange-500 bg-opacity-80 text-white shadow-md'
                      : 'border border-stone-600 text-stone-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {tab.text}
                </a>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="mt-8 text-white">{children}</div>
    </>
  );
};

export default PostersLayout;
