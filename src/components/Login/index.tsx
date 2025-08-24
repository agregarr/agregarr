import PageTitle from '@app/components/Common/PageTitle';
// LanguagePicker removed - English-only support
import PlexLoginButton from '@app/components/PlexLoginButton';
import { useUser } from '@app/hooks/useUser';
import { Transition } from '@headlessui/react';
import { XCircleIcon } from '@heroicons/react/24/solid';
import axios from 'axios';
import { useRouter } from 'next/dist/client/router';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  signin: 'Sign In',
  signinheader: 'Sign in to continue',
  signinwithplex: 'Sign in with Plex',
});

const Login = () => {
  const intl = useIntl();
  const [error, setError] = useState('');
  const [isProcessing, setProcessing] = useState(false);
  const [authToken, setAuthToken] = useState<string | undefined>(undefined);
  const { user, revalidate } = useUser();
  const router = useRouter();

  // Effect that is triggered when the `authToken` comes back from the Plex OAuth
  // We take the token and attempt to sign in. If we get a success message, we will
  // ask swr to revalidate the user which _should_ come back with a valid user.
  useEffect(() => {
    const login = async () => {
      setProcessing(true);
      try {
        const response = await axios.post('/api/v1/auth/plex', { authToken });

        if (response.data?.id) {
          revalidate();
        }
      } catch (e) {
        setError(e.response.data.message);
        setAuthToken(undefined);
        setProcessing(false);
      }
    };
    if (authToken) {
      login();
    }
  }, [authToken, revalidate]);

  // Effect that is triggered whenever `useUser`'s user changes. If we get a new
  // valid user, we redirect the user to the home page as the login was successful.
  useEffect(() => {
    if (user) {
      router.push('/');
    }
  }, [user, router]);

  return (
    <div className="relative flex min-h-screen flex-col justify-center bg-stone-900 py-12">
      <PageTitle title={intl.formatMessage(messages.signin)} />
      {/* Language picker removed - English-only support */}
      <div className="relative z-40 px-4 sm:mx-auto sm:w-full sm:max-w-md">
        <img
          src="/logo_stacked.svg"
          className="mb-10 max-w-full sm:mx-auto"
          alt="Logo"
        />
        <div
          className="rounded-md border border-gray-600 bg-stone-800 bg-opacity-50 p-4 text-white"
          style={{ backdropFilter: 'blur(5px)' }}
        >
          <Transition
            as="div"
            show={!!error}
            enter="transition-opacity duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="mb-6 rounded-md bg-red-600 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <XCircleIcon className="h-5 w-5 text-red-300" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-300">{error}</h3>
                </div>
              </div>
            </div>
          </Transition>
          <div className="mb-2 flex justify-center text-xl font-bold">
            {intl.formatMessage(messages.signinheader)}
          </div>
          <div className="mb-2 flex justify-center pb-6 text-sm">
            {intl.formatMessage(messages.signinwithplex)}
          </div>
          <div className="flex items-center justify-center">
            <PlexLoginButton
              isProcessing={isProcessing}
              onAuthToken={(authToken) => setAuthToken(authToken)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
