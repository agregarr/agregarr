import Layout from '@app/components/Layout';
import LoadingBar from '@app/components/LoadingBar';
// PWAHeader removed - PWA functionality not needed in Agregarr
// ServiceWorkerSetup removed - PWA functionality not needed in Agregarr
// StatusChecker removed - not needed in Agregarr
import Toast from '@app/components/Toast';
import ToastContainer from '@app/components/ToastContainer';
import { InteractionProvider } from '@app/context/InteractionContext';
import type { AvailableLocale } from '@app/context/LanguageContext';
import { LanguageContext } from '@app/context/LanguageContext';
import { SettingsProvider } from '@app/context/SettingsContext';
import { UserContext } from '@app/context/UserContext';
import type { User } from '@app/hooks/useUser';
import { useUser } from '@app/hooks/useUser';
import '@app/styles/globals.css';
import { polyfillIntl } from '@app/utils/polyfillIntl';
import type { PublicSettingsResponse } from '@server/interfaces/api/settingsInterfaces';
import axios from 'axios';
import type { AppInitialProps, AppProps } from 'next/app';
import App from 'next/app';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { ToastProvider } from 'react-toast-notifications';
import { SWRConfig } from 'swr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadLocaleData = (locale: AvailableLocale): Promise<any> => {
  switch (locale) {
    default:
      return import('../i18n/locale/en.json');
  }
};

// Custom types so we can correctly type our GetInitialProps function
// with our combined user prop
// This is specific to _app.tsx. Other pages will not need to do this!
type NextAppComponentType = typeof App;
type MessagesType = Record<string, string>;

interface ExtendedAppProps extends AppProps {
  user: User;
  messages: MessagesType;
  locale: AvailableLocale;
  currentSettings: PublicSettingsResponse;
}

if (typeof window === 'undefined') {
  global.Intl = require('intl');
}

const CoreApp: Omit<NextAppComponentType, 'origGetInitialProps'> = ({
  Component,
  pageProps,
  router,
  user,
  messages,
  locale,
  currentSettings,
}: ExtendedAppProps) => {
  let component: React.ReactNode;
  const [loadedMessages, setMessages] = useState<MessagesType>(messages);
  const [currentLocale, setLocale] = useState<AvailableLocale>(locale);

  useEffect(() => {
    loadLocaleData(currentLocale).then(setMessages);
  }, [currentLocale]);

  // Permission check removed - single admin setup for Agregarr
  useUser();

  // Badge functionality removed - not needed in Agregarr desktop app

  if (router.pathname.match(/(login|setup|resetpassword)/)) {
    component = <Component {...pageProps} />;
  } else {
    component = (
      <Layout>
        <Component {...pageProps} />
      </Layout>
    );
  }

  return (
    <SWRConfig
      value={{
        fetcher: (url) => axios.get(url).then((res) => res.data),
        fallback: {
          '/api/v1/auth/me': user,
        },
      }}
    >
      <LanguageContext.Provider value={{ locale: currentLocale, setLocale }}>
        <IntlProvider
          locale={currentLocale}
          defaultLocale="en"
          messages={loadedMessages}
        >
          <LoadingBar />
          <SettingsProvider currentSettings={currentSettings}>
            <InteractionProvider>
              <ToastProvider components={{ Toast, ToastContainer }}>
                <Head>
                  <title>{currentSettings.applicationTitle}</title>
                  <meta
                    name="viewport"
                    content="initial-scale=1, viewport-fit=cover, width=device-width"
                  ></meta>
                  {/* PWAHeader removed - PWA functionality not needed in Agregarr */}
                </Head>
                {/* StatusChecker removed - not needed in Agregarr */}
                {/* ServiceWorkerSetup removed - PWA functionality not needed in Agregarr */}
                <UserContext initialUser={user}>{component}</UserContext>
              </ToastProvider>
            </InteractionProvider>
          </SettingsProvider>
        </IntlProvider>
      </LanguageContext.Provider>
    </SWRConfig>
  );
};

CoreApp.getInitialProps = async (initialProps) => {
  const { ctx, router } = initialProps;
  let user: User | undefined = undefined;
  let currentSettings: PublicSettingsResponse = {
    initialized: false,
    applicationTitle: '',
    applicationUrl: '',
    hideAvailable: false,
    movie4kEnabled: false,
    series4kEnabled: false,
    localLogin: true,
    partialRequestsEnabled: true,
    vapidPublic: '',
    enablePushRegistration: false,
    locale: 'en',
    emailEnabled: false,
    newPlexLogin: true,
  };

  if (ctx.res) {
    // Check if app is initialized and redirect if necessary
    const response = await axios.get<PublicSettingsResponse>(
      `http://${process.env.HOST || 'localhost'}:${
        process.env.PORT || 7171
      }/api/v1/settings/public`
    );

    currentSettings = response.data;

    const initialized = response.data.initialized;

    if (!initialized) {
      if (!router.pathname.match(/(setup|login\/plex)/)) {
        ctx.res.writeHead(307, {
          Location: '/setup',
        });
        ctx.res.end();
      }
    } else {
      try {
        // Attempt to get the user by running a request to the local api
        const response = await axios.get<User>(
          `http://${process.env.HOST || 'localhost'}:${
            process.env.PORT || 7171
          }/api/v1/auth/me`,
          {
            headers:
              ctx.req && ctx.req.headers.cookie
                ? { cookie: ctx.req.headers.cookie }
                : undefined,
          }
        );
        user = response.data;

        if (router.pathname.match(/(setup|login)/)) {
          ctx.res.writeHead(307, {
            Location: '/',
          });
          ctx.res.end();
        }
      } catch (e) {
        // If there is no user, and ctx.res is set (to check if we are on the server side)
        // _AND_ we are not already on the login or setup route, redirect to /login with a 307
        // before anything actually renders
        if (!router.pathname.match(/(login|setup|resetpassword)/)) {
          ctx.res.writeHead(307, {
            Location: '/login',
          });
          ctx.res.end();
        }
      }
    }
  }

  // Run the default getInitialProps for the main nextjs initialProps
  const appInitialProps: AppInitialProps = await App.getInitialProps(
    initialProps
  );

  const locale = user?.settings?.locale
    ? user.settings.locale
    : currentSettings.locale;

  const messages = await loadLocaleData(locale as AvailableLocale);
  await polyfillIntl(locale);

  return { ...appInitialProps, user, messages, locale, currentSettings };
};

export default CoreApp;
