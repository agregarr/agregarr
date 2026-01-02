import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import globalMessages from '@app/i18n/globalMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type {
  MaintainerrSettings,
  MDBListSettings,
  MyAnimeListSettings,
  TautulliSettings,
  TraktSettings,
} from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages({
  sources: 'Sources',
  sourcesDescription: 'Configure sources for Collection generation.',
  tautulliSettings: 'Tautulli Settings',
  tautulliSettingsDescription:
    'Optionally configure the settings for your Tautulli server. Agregarr fetches watch history data for your Plex media from Tautulli.',
  tautulliHostname: 'Hostname or IP Address',
  tautulliPort: 'Port',
  tautulliUseSsl: 'Use SSL',
  urlBase: 'URL Base',
  tautulliApiKey: 'API Key',
  externalUrl: 'External URL',
  validationApiKey: 'You must provide an API key',
  validationUrl: 'You must provide a valid URL',
  validationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationUrlBaseLeadingSlash: 'URL base must have a leading slash',
  validationUrlBaseTrailingSlash: 'URL base must not end in a trailing slash',
  toastTautulliSettingsSuccess: 'Tautulli settings saved successfully!',
  toastTautulliSettingsFailure:
    'Something went wrong while saving Tautulli settings.',
  traktSettings: 'Trakt Settings',
  traktBasicSetup: 'Basic Trakt Setup',
  traktBasicDescription:
    'Use public Trakt features like trending, popular, and public custom lists. Just enter your Client ID.',
  traktBasicTip:
    'Create an application at https://trakt.tv/oauth/applications/new with redirect URI urn:ietf:wg:oauth:2.0:oob and copy the Client ID.',
  traktOAuthSetup: 'Advanced OAuth Setup (Optional)',
  traktOAuthDescription: 'Enable Trakt OAuth for access to private lists',
  traktOAuthBenefits: 'Access private lists, watchlists, and recommendations.',
  traktConnect: 'Connect with Trakt',
  traktConnectFailed: 'Unable to start Trakt OAuth flow',
  traktOauthSuccess: 'Trakt authorized successfully!',
  traktClientId: 'Trakt Client ID',
  traktClientSecret: 'Trakt Client Secret',
  traktAccessToken: 'Trakt Access Token',
  traktCredentialsTip:
    'Create an application at https://trakt.tv/oauth/applications/new and copy the Client ID, Client Secret, and personal Access Token.',
  traktAccessTokenTip:
    'The access token is fetched via OAuth and auto-refreshed.',
  traktStatusLabel: 'Status',
  traktStatusConnected: 'Connected',
  traktStatusPending: 'Not tested',
  traktStatusMissing: 'Not configured',
  traktCredsHint:
    '(redirect URI: urn:ietf:wg:oauth:2.0:oob) and copy the Client ID above, and Client Secret below.',
  traktReconnect: 'Reconnect',
  traktDisconnect: 'Disconnect',
  traktDisconnected: 'Disconnected from Trakt',
  traktDisconnectFailed: 'Unable to disconnect from Trakt',
  toastTraktSettingsSuccess: 'Trakt settings saved successfully!',
  toastTraktSettingsFailure:
    'Something went wrong while saving Trakt settings.',
  testTraktConnection: 'Test Connection',
  traktConnectionSuccess: 'Connected to Trakt successfully!',
  traktConnectionFailure: 'Failed to connect to Trakt',
  mdblistSettings: 'MDBList Settings',
  mdblistSettingsDescription:
    'Configure your MDBList API key to enable MDBList-based collections with user lists and top lists.',
  mdblistApiKey: 'MDBList API Key',
  toastMdblistSettingsSuccess: 'MDBList settings saved successfully!',
  toastMdblistSettingsFailure:
    'Something went wrong while saving MDBList settings.',
  testMdblistConnection: 'Test Connection',
  mdblistConnectionSuccess: 'Connected to MDBList successfully!',
  mdblistConnectionFailure: 'Failed to connect to MDBList',
  myanimelistSettings: 'MyAnimeList Settings',
  myanimelistSettingsDescription:
    'Configure your MyAnimeList API key to enable MyAnimeList-based anime collections.',
  myanimelistApiKey: 'MyAnimeList API Key',
  toastMyanimelistSettingsSuccess: 'MyAnimeList settings saved successfully!',
  toastMyanimelistSettingsFailure:
    'Something went wrong while saving MyAnimeList settings.',
  testMyanimelistConnection: 'Test Connection',
  myanimelistConnectionSuccess: 'Connected to MyAnimeList successfully!',
  myanimelistConnectionFailure: 'Failed to connect to MyAnimeList',
  maintainerrSettings: 'Maintainerr Settings (Poster Overlays Only)',
  maintainerrSettingsDescription:
    'Configure Maintainerr connection for overlay conditions based on action countdowns.',
  maintainerrHostname: 'Hostname or IP Address',
  maintainerrPort: 'Port',
  maintainerrUseSsl: 'Use SSL',
  maintainerrApiKey: 'API Key',
  toastMaintainerrSettingsSuccess: 'Maintainerr settings saved successfully!',
  toastMaintainerrSettingsFailure:
    'Something went wrong while saving Maintainerr settings.',
  testMaintainerrConnection: 'Test Connection',
  maintainerrConnectionSuccess: 'Connected to Maintainerr successfully!',
  maintainerrConnectionFailure: 'Failed to connect to Maintainerr',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  testTautulliConnection: 'Test Connection',
  tautulliConnectionSuccess: 'Connected to Tautulli successfully!',
  tautulliConnectionFailure: 'Failed to connect to Tautulli',
  testing: 'Testing...',
  save: 'Save Changes',
  saving: 'Saving…',
});

interface SettingsSourcesProps {
  onComplete?: () => void;
}

const SettingsSources = ({ onComplete }: SettingsSourcesProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const router = useRouter();
  const [isTesting, setIsTesting] = useState(false);
  const [isStartingTraktAuth, setIsStartingTraktAuth] = useState(false);
  const [traktBasicTestSuccess, setTraktBasicTestSuccess] = useState(false);
  const [mdblistTestSuccess, setMdblistTestSuccess] = useState(false);
  const [myanimelistTestSuccess, setMyanimelistTestSuccess] = useState(false);
  const [tautulliTestSuccess, setTautulliTestSuccess] = useState(false);
  const [maintainerrTestSuccess, setMaintainerrTestSuccess] = useState(false);
  const [testingService, setTestingService] = useState<string | null>(null);
  const [isDisconnectingTrakt, setIsDisconnectingTrakt] = useState(false);

  // Store the values that were successfully tested to detect changes
  const [testedTraktBasicClientId, setTestedTraktBasicClientId] =
    useState<string>('');
  const [testedMdblistValues, setTestedMdblistValues] = useState<string>('');
  const [testedMyanimelistValues, setTestedMyanimelistValues] =
    useState<string>('');
  const [testedTautulliValues, setTestedTautulliValues] = useState<string>('');
  const [testedMaintainerrValues, setTestedMaintainerrValues] =
    useState<string>('');

  // Check if we're in setup mode
  const isSetupMode = !!onComplete;

  const { data: dataTautulli, mutate: revalidateTautulli } =
    useSWR<TautulliSettings>('/api/v1/settings/tautulli');
  const { data: dataTrakt, mutate: revalidateTrakt } = useSWR<TraktSettings>(
    '/api/v1/settings/trakt'
  );
  const { data: dataMdblist, mutate: revalidateMdblist } =
    useSWR<MDBListSettings>('/api/v1/settings/mdblist');
  const { data: dataMyanimelist, mutate: revalidateMyanimelist } =
    useSWR<MyAnimeListSettings>('/api/v1/settings/myanimelist');
  const { data: dataMaintainerr, mutate: revalidateMaintainerr } =
    useSWR<MaintainerrSettings>('/api/v1/settings/maintainerr');
  const [showTraktCodeModal, setShowTraktCodeModal] = useState(false);
  const [traktCode, setTraktCode] = useState('');
  const [isExchangingCode, setIsExchangingCode] = useState(false);

  // Reset test success states when data changes (prevents gaming the system)
  useEffect(() => {
    setTraktBasicTestSuccess(false);
    setTestedTraktBasicClientId('');
  }, [dataTrakt?.apiKey, dataTrakt?.clientId]);

  useEffect(() => {
    if (router.query.traktAuth === 'success') {
      addToast(intl.formatMessage(messages.traktOauthSuccess), {
        appearance: 'success',
        autoDismiss: true,
      });
      revalidateTrakt();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { traktAuth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, {
        shallow: true,
      });
    }
  }, [router, addToast, intl, revalidateTrakt]);

  useEffect(() => {
    setMdblistTestSuccess(false);
  }, [dataMdblist?.apiKey]);

  useEffect(() => {
    setTautulliTestSuccess(false);
  }, [dataTautulli?.hostname, dataTautulli?.port, dataTautulli?.apiKey]);

  useEffect(() => {
    setMyanimelistTestSuccess(false);
  }, [dataMyanimelist?.apiKey]);

  useEffect(() => {
    setMaintainerrTestSuccess(false);
  }, [
    dataMaintainerr?.hostname,
    dataMaintainerr?.port,
    dataMaintainerr?.apiKey,
    dataMaintainerr?.useSsl,
    dataMaintainerr?.urlBase,
  ]);

  const TautulliValidationSchema = Yup.object().shape(
    {
      tautulliHostname: Yup.string()
        .nullable()
        .matches(
          /^(([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])$/i,
          intl.formatMessage(messages.validationHostnameRequired)
        ),
      tautulliPort: Yup.number()
        .typeError(intl.formatMessage(messages.validationPortRequired))
        .nullable(),
      tautulliUrlBase: Yup.string()
        .test(
          'leading-slash',
          intl.formatMessage(messages.validationUrlBaseLeadingSlash),
          (value) => !value || value.startsWith('/')
        )
        .test(
          'no-trailing-slash',
          intl.formatMessage(messages.validationUrlBaseTrailingSlash),
          (value) => !value || !value.endsWith('/')
        ),
      tautulliApiKey: Yup.string().nullable(),
      tautulliExternalUrl: Yup.string()
        .url(intl.formatMessage(messages.validationUrl))
        .test(
          'no-trailing-slash',
          intl.formatMessage(messages.validationUrlTrailingSlash),
          (value) => !value || !value.endsWith('/')
        ),
    },
    [
      ['tautulliHostname', 'tautulliPort'],
      ['tautulliHostname', 'tautulliApiKey'],
      ['tautulliPort', 'tautulliApiKey'],
    ]
  );

  const TraktBasicSettingsSchema = Yup.object().shape({
    traktClientId: Yup.string().nullable(),
  });

  const TraktOAuthSettingsSchema = Yup.object().shape({
    traktClientSecret: Yup.string().nullable(),
    traktAccessToken: Yup.string().nullable(),
  });

  const MdblistSettingsSchema = Yup.object().shape({
    mdblistApiKey: Yup.string().nullable(),
  });

  const MyanimelistSettingsSchema = Yup.object().shape({
    myanimelistApiKey: Yup.string().nullable(),
  });

  const MaintainerrValidationSchema = Yup.object().shape(
    {
      maintainerrHostname: Yup.string()
        .nullable()
        .matches(
          /^(([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])$/i,
          intl.formatMessage(messages.validationHostnameRequired)
        ),
      maintainerrPort: Yup.number()
        .typeError(intl.formatMessage(messages.validationPortRequired))
        .nullable(),
      maintainerrUrlBase: Yup.string()
        .test(
          'leading-slash',
          intl.formatMessage(messages.validationUrlBaseLeadingSlash),
          (value) => !value || value.startsWith('/')
        )
        .test(
          'no-trailing-slash',
          intl.formatMessage(messages.validationUrlBaseTrailingSlash),
          (value) => !value || !value.endsWith('/')
        ),
      maintainerrApiKey: Yup.string().nullable(),
      maintainerrExternalUrl: Yup.string()
        .url(intl.formatMessage(messages.validationUrl))
        .test(
          'no-trailing-slash',
          intl.formatMessage(messages.validationUrlTrailingSlash),
          (value) => !value || !value.endsWith('/')
        ),
    },
    [
      ['maintainerrHostname', 'maintainerrPort'],
      ['maintainerrHostname', 'maintainerrApiKey'],
      ['maintainerrPort', 'maintainerrApiKey'],
    ]
  );

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.sources),
          intl.formatMessage(globalMessages.settings),
        ]}
      />

      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.sources)}</h3>
        <p className="description">
          {intl.formatMessage(messages.sourcesDescription)}
        </p>
        <div className="section">
          <Alert
            title="IMDb, TMDB, and Letterboxd sources do not require any setup"
            type="info"
          />
        </div>
      </div>

      {/* Trakt Settings */}
      <div className="section">
        <div className="mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.traktSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.traktBasicDescription)}
          </p>
        </div>
      </div>

      <Formik
        initialValues={{
          traktClientId: dataTrakt?.clientId || dataTrakt?.apiKey || '',
        }}
        validationSchema={TraktBasicSettingsSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/trakt', {
              clientId: values.traktClientId,
              clientSecret: dataTrakt?.clientSecret,
              accessToken: dataTrakt?.accessToken,
              refreshToken: dataTrakt?.refreshToken,
              tokenExpiresAt: dataTrakt?.tokenExpiresAt,
            });
            addToast(intl.formatMessage(messages.toastTraktSettingsSuccess), {
              appearance: 'success',
              autoDismiss: true,
            });
          } catch (e) {
            addToast(intl.formatMessage(messages.toastTraktSettingsFailure), {
              appearance: 'error',
              autoDismiss: true,
            });
          } finally {
            revalidateTrakt();
          }
        }}
      >
        {({ handleSubmit, isSubmitting, isValid, values }) => {
          const testBasicConnection = async () => {
            if (!values.traktClientId) {
              return;
            }
            try {
              setIsTesting(true);
              setTestingService('trakt-basic');
              const response = await axios.post('/api/v1/settings/trakt/test', {
                clientId: values.traktClientId,
              });
              if (response.data.success) {
                setTraktBasicTestSuccess(true);
                setTestedTraktBasicClientId(values.traktClientId || '');
                addToast(intl.formatMessage(messages.traktConnectionSuccess), {
                  autoDismiss: true,
                  appearance: 'success',
                });
              } else {
                setTraktBasicTestSuccess(false);
                addToast(intl.formatMessage(messages.traktConnectionFailure), {
                  autoDismiss: true,
                  appearance: 'error',
                });
              }
            } catch (e) {
              setTraktBasicTestSuccess(false);
              const errorMessage =
                e.response?.data?.message ||
                intl.formatMessage(messages.traktConnectionFailure);
              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setIsTesting(false);
              setTestingService(null);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="traktClientId" className="text-label">
                  {intl.formatMessage(messages.traktClientId)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.traktBasicTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="traktClientId"
                      name="traktClientId"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="default"
                      type="button"
                      disabled={!values.traktClientId || isTesting}
                      onClick={(e) => {
                        e.preventDefault();
                        testBasicConnection();
                      }}
                    >
                      {isTesting && testingService === 'trakt-basic'
                        ? intl.formatMessage(messages.testing)
                        : intl.formatMessage(messages.testTraktConnection)}
                    </Button>
                  </span>
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !isValid ||
                        (isSetupMode &&
                          !!values.traktClientId &&
                          (!traktBasicTestSuccess ||
                            testedTraktBasicClientId !==
                              (values.traktClientId || '')))
                      }
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(messages.saving)
                          : intl.formatMessage(messages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          );
        }}
      </Formik>

      {/* OAuth Setup - subsection within Trakt Settings */}
      <div className="section">
        <div className="mt-6 mb-4">
          <h4 className="mb-2 text-lg font-semibold text-white">
            {intl.formatMessage(messages.traktOAuthSetup)}
          </h4>
          <p className="text-sm text-gray-300">
            {intl.formatMessage(messages.traktOAuthDescription)}
          </p>
          <p className="mt-2 text-sm text-gray-400">
            {intl.formatMessage(messages.traktOAuthBenefits)}
          </p>
        </div>
      </div>

      <Formik
        initialValues={{
          traktClientSecret: dataTrakt?.clientSecret || '',
          traktAccessToken: dataTrakt?.accessToken || '',
          traktRefreshToken: dataTrakt?.refreshToken || '',
          traktTokenExpiresAt: dataTrakt?.tokenExpiresAt,
        }}
        validationSchema={TraktOAuthSettingsSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/trakt', {
              clientId: dataTrakt?.clientId || dataTrakt?.apiKey,
              clientSecret: values.traktClientSecret,
              accessToken: values.traktAccessToken,
              refreshToken: values.traktRefreshToken,
              tokenExpiresAt: values.traktTokenExpiresAt,
            });
            addToast(intl.formatMessage(messages.toastTraktSettingsSuccess), {
              appearance: 'success',
              autoDismiss: true,
            });
          } catch (e) {
            addToast(intl.formatMessage(messages.toastTraktSettingsFailure), {
              appearance: 'error',
              autoDismiss: true,
            });
          } finally {
            revalidateTrakt();
          }
        }}
      >
        {({ handleSubmit, values, setFieldValue }) => {
          const isConnected = !!values.traktAccessToken;
          const hasClientId = !!(dataTrakt?.clientId || dataTrakt?.apiKey);
          const hasClientSecret = !!values.traktClientSecret;
          const canConnect = hasClientId && hasClientSecret;

          const extractTraktCode = (raw: string) => {
            const trimmed = raw.trim();
            if (!trimmed) return '';
            const match = trimmed.match(/[?&]code=([^&]+)/);
            if (match?.[1]) {
              return decodeURIComponent(match[1]);
            }
            return trimmed;
          };

          const exchangeTraktCode = async (codeToUse?: string) => {
            const code = extractTraktCode(codeToUse ?? traktCode);
            if (!code) {
              addToast('Please paste the code from Trakt.', {
                appearance: 'error',
                autoDismiss: true,
              });
              return;
            }
            try {
              setIsExchangingCode(true);
              const response = await axios.post(
                '/api/v1/trakt/oauth/exchange',
                {
                  code,
                  clientId: dataTrakt?.clientId || dataTrakt?.apiKey,
                  clientSecret: values.traktClientSecret,
                }
              );

              if (response.data?.accessToken) {
                setFieldValue('traktAccessToken', response.data.accessToken);
              }
              if (response.data?.refreshToken) {
                setFieldValue('traktRefreshToken', response.data.refreshToken);
              }
              if (response.data?.tokenExpiresAt) {
                setFieldValue(
                  'traktTokenExpiresAt',
                  response.data.tokenExpiresAt
                );
              }
              addToast(intl.formatMessage(messages.traktOauthSuccess), {
                appearance: 'success',
                autoDismiss: true,
              });
              revalidateTrakt();
              setShowTraktCodeModal(false);
              setTraktCode('');
            } catch (error) {
              const serverMessage =
                error.response?.data?.message ||
                intl.formatMessage(messages.traktConnectFailed);
              addToast(serverMessage, {
                appearance: 'error',
                autoDismiss: true,
              });
            } finally {
              setIsExchangingCode(false);
            }
          };

          const startTraktAuthFlow = async () => {
            if (!canConnect) {
              addToast('Please configure Client ID and Client Secret first.', {
                appearance: 'error',
                autoDismiss: true,
              });
              return;
            }

            setShowTraktCodeModal(true);
            setTraktCode('');

            const authorizeUrl = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${encodeURIComponent(
              dataTrakt?.clientId || dataTrakt?.apiKey || ''
            )}&redirect_uri=urn:ietf:wg:oauth:2.0:oob`;

            try {
              setIsStartingTraktAuth(true);
              const opened = window.open(
                authorizeUrl,
                '_blank',
                'noopener,noreferrer'
              );
              if (!opened) {
                addToast(intl.formatMessage(messages.traktConnectFailed), {
                  appearance: 'error',
                  autoDismiss: true,
                });
              }
            } catch (error) {
              const serverMessage =
                error.response?.data?.message ||
                intl.formatMessage(messages.traktConnectFailed);
              addToast(serverMessage, {
                appearance: 'error',
                autoDismiss: true,
              });
            } finally {
              setIsStartingTraktAuth(false);
            }
          };

          const disconnectTrakt = async () => {
            try {
              setIsDisconnectingTrakt(true);
              await axios.post('/api/v1/settings/trakt', {
                clientId: dataTrakt?.clientId || dataTrakt?.apiKey,
                clientSecret: values.traktClientSecret,
                accessToken: '',
                refreshToken: '',
                tokenExpiresAt: undefined,
              });
              setFieldValue('traktAccessToken', '');
              setFieldValue('traktRefreshToken', '');
              setFieldValue('traktTokenExpiresAt', undefined);
              addToast(intl.formatMessage(messages.traktDisconnected), {
                appearance: 'success',
                autoDismiss: true,
              });
              revalidateTrakt();
            } catch (error) {
              const serverMessage =
                error.response?.data?.message ||
                intl.formatMessage(messages.traktDisconnectFailed);
              addToast(serverMessage, {
                appearance: 'error',
                autoDismiss: true,
              });
            } finally {
              setIsDisconnectingTrakt(false);
            }
          };

          return (
            <>
              <div className="section">
                {isConnected ? (
                  <div className="rounded-lg border border-gray-700 bg-stone-900 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <Badge badgeType="success">
                          {intl.formatMessage(messages.traktStatusConnected)}
                        </Badge>
                        <p className="text-sm text-gray-300">
                          OAuth tokens are saved and will auto-refresh.
                          Reconnect to update, or disconnect to remove them.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          buttonType="primary"
                          onClick={(e) => {
                            e.preventDefault();
                            startTraktAuthFlow();
                          }}
                          disabled={isStartingTraktAuth}
                        >
                          {isStartingTraktAuth
                            ? intl.formatMessage(messages.testing)
                            : intl.formatMessage(messages.traktReconnect)}
                        </Button>
                        <Button
                          buttonType="default"
                          onClick={(e) => {
                            e.preventDefault();
                            disconnectTrakt();
                          }}
                          disabled={isDisconnectingTrakt}
                        >
                          {intl.formatMessage(messages.traktDisconnect)}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
                    {!hasClientId && (
                      <Alert title="Configure Basic Setup First" type="warning">
                        You must configure and save your Trakt Client ID in the
                        Basic Setup section above before setting up OAuth.
                      </Alert>
                    )}
                    <div className="form-row">
                      <label htmlFor="traktClientSecret" className="text-label">
                        {intl.formatMessage(messages.traktClientSecret)}
                        <span className="label-tip">
                          {intl.formatMessage(messages.traktCredsHint)}
                        </span>
                      </label>
                      <div className="form-input-area">
                        <div className="form-input-field">
                          <SensitiveInput
                            as="field"
                            id="traktClientSecret"
                            name="traktClientSecret"
                            autoComplete="off"
                            disabled={!hasClientId}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="text-label">Connect with Trakt</div>
                      <div className="form-input-area">
                        <Button
                          buttonType="primary"
                          onClick={(e) => {
                            e.preventDefault();
                            startTraktAuthFlow();
                          }}
                          disabled={!canConnect || isStartingTraktAuth}
                        >
                          {isStartingTraktAuth
                            ? intl.formatMessage(messages.testing)
                            : intl.formatMessage(messages.traktConnect)}
                        </Button>
                      </div>
                    </div>
                  </form>
                )}
              </div>

              {showTraktCodeModal && (
                <Modal
                  title="Enter Trakt Code"
                  subTitle="Paste the code from the Trakt authorization window."
                  onCancel={() => {
                    setShowTraktCodeModal(false);
                    setTraktCode('');
                  }}
                  onOk={(e) => {
                    e?.preventDefault();
                    exchangeTraktCode();
                  }}
                  okText="Exchange Code"
                  okDisabled={!traktCode.trim()}
                  loading={isExchangingCode}
                >
                  <div className="space-y-3">
                    <p className="text-sm text-gray-300">
                      After approving access in the Trakt window, copy the code
                      shown and paste it here to finish connecting.
                    </p>
                    <input
                      type="text"
                      className="w-full rounded-md border border-gray-700 bg-stone-800 px-3 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                      placeholder="e.g. 86f043a6 or full native URL"
                      value={traktCode}
                      onChange={(e) => setTraktCode(e.target.value)}
                    />
                  </div>
                </Modal>
              )}
            </>
          );
        }}
      </Formik>

      {/* MDBList Settings */}
      <div className="section">
        <div className="mt-10 mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.mdblistSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.mdblistSettingsDescription)}
          </p>
        </div>
      </div>
      <Formik
        initialValues={{
          mdblistApiKey: dataMdblist?.apiKey,
        }}
        validationSchema={MdblistSettingsSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/mdblist', {
              apiKey: values.mdblistApiKey,
            });
            addToast(intl.formatMessage(messages.toastMdblistSettingsSuccess), {
              appearance: 'success',
              autoDismiss: true,
            });
          } catch (e) {
            addToast(intl.formatMessage(messages.toastMdblistSettingsFailure), {
              appearance: 'error',
              autoDismiss: true,
            });
          } finally {
            revalidateMdblist();
          }
        }}
      >
        {({ handleSubmit, isSubmitting, isValid, values }) => {
          const testMdblistConnection = async () => {
            if (!values.mdblistApiKey) {
              return;
            }
            try {
              setIsTesting(true);
              setTestingService('mdblist');
              const response = await axios.post(
                '/api/v1/settings/mdblist/test',
                {
                  apiKey: values.mdblistApiKey,
                }
              );
              if (response.data.success) {
                setMdblistTestSuccess(true);
                setTestedMdblistValues(values.mdblistApiKey || '');
                addToast(
                  intl.formatMessage(messages.mdblistConnectionSuccess),
                  {
                    autoDismiss: true,
                    appearance: 'success',
                  }
                );
              } else {
                setMdblistTestSuccess(false);
                addToast(
                  intl.formatMessage(messages.mdblistConnectionFailure),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              }
            } catch (e) {
              setMdblistTestSuccess(false);

              // Use server's detailed error message if available
              let errorMessage =
                e.response?.data?.message ||
                intl.formatMessage(messages.mdblistConnectionFailure);

              // If no server message, provide client-side diagnostics
              if (!e.response?.data?.message) {
                if (e.code === 'ECONNREFUSED') {
                  errorMessage +=
                    ' - Connection refused. Check network connectivity.';
                } else if (e.code === 'ENOTFOUND') {
                  errorMessage +=
                    ' - Unable to reach MDBList API. Check network connectivity.';
                } else if (e.code === 'ETIMEDOUT') {
                  errorMessage +=
                    ' - Connection timeout. Check network connectivity.';
                } else if (e.message) {
                  errorMessage += ` - ${e.message}`;
                }
              }

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setTestingService(null);
              setIsTesting(false);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="mdblistApiKey" className="text-label">
                  {intl.formatMessage(messages.mdblistApiKey)}
                  <span className="label-tip mb-2">
                    Get your API key from
                    <code>https://mdblist.com/preferences/</code> and generate a
                    new API key.
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="mdblistApiKey"
                      name="mdblistApiKey"
                      autoComplete="one-time-code"
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="default"
                      type="button"
                      disabled={!values.mdblistApiKey || isTesting}
                      onClick={(e) => {
                        e.preventDefault();
                        testMdblistConnection();
                      }}
                    >
                      {isTesting
                        ? intl.formatMessage(messages.testing)
                        : intl.formatMessage(messages.testMdblistConnection)}
                    </Button>
                  </span>
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !isValid ||
                        (isSetupMode &&
                          !!values.mdblistApiKey &&
                          (!mdblistTestSuccess ||
                            testedMdblistValues !==
                              (values.mdblistApiKey || '')))
                      }
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(messages.saving)
                          : intl.formatMessage(messages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          );
        }}
      </Formik>

      {/* Tautulli Settings */}
      <div className="section">
        <div className="mt-10 mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.tautulliSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.tautulliSettingsDescription)}
          </p>
        </div>
      </div>
      <Formik
        initialValues={{
          tautulliHostname: dataTautulli?.hostname,
          tautulliPort: dataTautulli?.port ?? 8181,
          tautulliUseSsl: dataTautulli?.useSsl ?? false,
          tautulliUrlBase: dataTautulli?.urlBase,
          tautulliApiKey: dataTautulli?.apiKey,
          tautulliExternalUrl: dataTautulli?.externalUrl,
        }}
        validationSchema={TautulliValidationSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/tautulli', {
              hostname: values.tautulliHostname,
              port: Number(values.tautulliPort),
              apiKey: values.tautulliApiKey,
              useSsl: values.tautulliUseSsl,
              urlBase: values.tautulliUrlBase,
              externalUrl: values.tautulliExternalUrl,
            });
            addToast(
              intl.formatMessage(messages.toastTautulliSettingsSuccess),
              {
                appearance: 'success',
                autoDismiss: true,
              }
            );
          } catch (e) {
            addToast(
              intl.formatMessage(messages.toastTautulliSettingsFailure),
              {
                appearance: 'error',
                autoDismiss: true,
              }
            );
          } finally {
            revalidateTautulli();
          }
        }}
      >
        {({
          errors,
          touched,
          handleSubmit,
          setFieldValue,
          isSubmitting,
          isValid,
          values,
        }) => {
          const testTautulliConnection = async () => {
            if (
              !values.tautulliHostname ||
              !values.tautulliPort ||
              !values.tautulliApiKey
            ) {
              return;
            }
            setIsTesting(true);
            setTestingService('tautulli');
            try {
              const response = await axios.post(
                '/api/v1/settings/tautulli/test',
                {
                  hostname: values.tautulliHostname,
                  port: Number(values.tautulliPort),
                  apiKey: values.tautulliApiKey,
                  useSsl: values.tautulliUseSsl,
                  urlBase: values.tautulliUrlBase,
                }
              );
              if (response.data.success) {
                setTautulliTestSuccess(true);
                setTestedTautulliValues(
                  `${values.tautulliHostname}:${values.tautulliPort}:${values.tautulliApiKey}:${values.tautulliUseSsl}:${values.tautulliUrlBase}`
                );

                // Show success message for connection
                addToast(
                  intl.formatMessage(messages.tautulliConnectionSuccess),
                  {
                    autoDismiss: true,
                    appearance: 'success',
                  }
                );
              } else {
                setTautulliTestSuccess(false);
                addToast(
                  intl.formatMessage(messages.tautulliConnectionFailure),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              }
            } catch (error) {
              setTautulliTestSuccess(false);

              // Use server's detailed error message if available
              let errorMessage =
                error.response?.data?.message ||
                intl.formatMessage(messages.tautulliConnectionFailure);

              // If no server message, provide client-side diagnostics
              if (!error.response?.data?.message) {
                if (error.code === 'ECONNREFUSED') {
                  errorMessage +=
                    ' - Connection refused. Check hostname and port.';
                } else if (error.code === 'ENOTFOUND') {
                  errorMessage += ' - Host not found. Check hostname.';
                } else if (error.code === 'ETIMEDOUT') {
                  errorMessage +=
                    ' - Connection timeout. Check network connectivity.';
                } else if (error.message) {
                  errorMessage += ` - ${error.message}`;
                }
              }

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setTestingService(null);
              setIsTesting(false);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="tautulliHostname" className="text-label">
                  {intl.formatMessage(messages.tautulliHostname)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-stone-800 px-3 text-gray-100 sm:text-sm">
                      {values.tautulliUseSsl ? 'https://' : 'http://'}
                    </span>
                    <Field
                      type="text"
                      inputMode="url"
                      id="tautulliHostname"
                      name="tautulliHostname"
                      className="rounded-r-only flex-1"
                    />
                  </div>
                  {errors.tautulliHostname && touched.tautulliHostname && (
                    <div className="error">{errors.tautulliHostname}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="tautulliPort" className="text-label">
                  {intl.formatMessage(messages.tautulliPort)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <Field
                    type="text"
                    inputMode="numeric"
                    id="tautulliPort"
                    name="tautulliPort"
                    className="short"
                  />
                  {errors.tautulliPort && touched.tautulliPort && (
                    <div className="error">{errors.tautulliPort}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="tautulliUseSsl" className="checkbox-label">
                  {intl.formatMessage(messages.tautulliUseSsl)}
                </label>
                <div className="form-input-area">
                  <Field
                    type="checkbox"
                    id="tautulliUseSsl"
                    name="tautulliUseSsl"
                    onChange={() => {
                      setFieldValue('tautulliUseSsl', !values.tautulliUseSsl);
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="tautulliUrlBase" className="text-label">
                  {intl.formatMessage(messages.urlBase)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      type="text"
                      inputMode="url"
                      id="tautulliUrlBase"
                      name="tautulliUrlBase"
                      autoComplete="off"
                      data-1pignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="tautulliApiKey" className="text-label">
                  {intl.formatMessage(messages.tautulliApiKey)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="tautulliApiKey"
                      name="tautulliApiKey"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="tautulliExternalUrl" className="text-label">
                  {intl.formatMessage(messages.externalUrl)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      type="text"
                      inputMode="url"
                      id="tautulliExternalUrl"
                      name="tautulliExternalUrl"
                      autoComplete="off"
                      data-1pignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="default"
                      type="button"
                      onClick={testTautulliConnection}
                      disabled={
                        !values.tautulliHostname ||
                        !values.tautulliPort ||
                        !values.tautulliApiKey ||
                        isTesting
                      }
                    >
                      {isTesting
                        ? intl.formatMessage(messages.testing)
                        : intl.formatMessage(messages.testTautulliConnection)}
                    </Button>
                  </span>
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !isValid ||
                        (isSetupMode &&
                          !!values.tautulliApiKey &&
                          (!tautulliTestSuccess ||
                            testedTautulliValues !==
                              `${values.tautulliHostname}:${values.tautulliPort}:${values.tautulliApiKey}:${values.tautulliUseSsl}:${values.tautulliUrlBase}`))
                      }
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(messages.saving)
                          : intl.formatMessage(messages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          );
        }}
      </Formik>

      {/* MyAnimeList Settings */}
      <div className="section">
        <div className="mt-10 mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.myanimelistSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.myanimelistSettingsDescription)}
          </p>
        </div>
      </div>
      <Formik
        initialValues={{
          myanimelistApiKey: dataMyanimelist?.apiKey,
        }}
        validationSchema={MyanimelistSettingsSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/myanimelist', {
              apiKey: values.myanimelistApiKey,
            });
            addToast(
              intl.formatMessage(messages.toastMyanimelistSettingsSuccess),
              {
                appearance: 'success',
                autoDismiss: true,
              }
            );
          } catch (e) {
            addToast(
              intl.formatMessage(messages.toastMyanimelistSettingsFailure),
              {
                appearance: 'error',
                autoDismiss: true,
              }
            );
          } finally {
            revalidateMyanimelist();
          }
        }}
      >
        {({ handleSubmit, isSubmitting, isValid, values }) => {
          const testMyanimelistConnection = async () => {
            if (!values.myanimelistApiKey) {
              return;
            }
            try {
              setIsTesting(true);
              setTestingService('myanimelist');
              const response = await axios.post(
                '/api/v1/settings/myanimelist/test',
                {
                  apiKey: values.myanimelistApiKey,
                }
              );
              if (response.data.success) {
                setMyanimelistTestSuccess(true);
                setTestedMyanimelistValues(values.myanimelistApiKey || '');
                addToast(
                  intl.formatMessage(messages.myanimelistConnectionSuccess),
                  {
                    autoDismiss: true,
                    appearance: 'success',
                  }
                );
              } else {
                setMyanimelistTestSuccess(false);
                addToast(
                  intl.formatMessage(messages.myanimelistConnectionFailure),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              }
            } catch (e) {
              setMyanimelistTestSuccess(false);

              const serverMessage = e.response?.data?.message;
              let errorMessage =
                serverMessage ||
                intl.formatMessage(messages.myanimelistConnectionFailure);

              if (!serverMessage) {
                if (e.response?.status) {
                  errorMessage += ` (HTTP ${e.response.status})`;
                } else if (e.code === 'ECONNREFUSED') {
                  errorMessage +=
                    ' - Connection refused. Check network connectivity.';
                } else if (e.code === 'ENOTFOUND') {
                  errorMessage +=
                    ' - Unable to reach MyAnimeList API. Check network connectivity.';
                } else if (e.code === 'ETIMEDOUT') {
                  errorMessage +=
                    ' - Connection timeout. Check network connectivity.';
                } else if (e.message) {
                  errorMessage += ` - ${e.message}`;
                }
              }

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setTestingService(null);
              setIsTesting(false);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="myanimelistApiKey" className="text-label">
                  {intl.formatMessage(messages.myanimelistApiKey)}
                  <span className="label-tip mb-2">
                    Get your API key from{' '}
                    <code>https://myanimelist.net/apiconfig</code> copy the{' '}
                    <code>Client ID</code>. Critical fields: App Type -{' '}
                    <code>Web</code>, App Redirect URL -{' '}
                    <code>http://localhost/</code>, Homepage URL -{' '}
                    <code>https://github.com/agregarr/agregarr</code>,{' '}
                    <code>Non-Commerical</code>, <code>Hobbyist</code>
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="myanimelistApiKey"
                      name="myanimelistApiKey"
                      autoComplete="one-time-code"
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="default"
                      type="button"
                      disabled={!values.myanimelistApiKey || isTesting}
                      onClick={(e) => {
                        e.preventDefault();
                        testMyanimelistConnection();
                      }}
                    >
                      {isTesting
                        ? intl.formatMessage(messages.testing)
                        : intl.formatMessage(
                            messages.testMyanimelistConnection
                          )}
                    </Button>
                  </span>
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !isValid ||
                        (isSetupMode &&
                          !!values.myanimelistApiKey &&
                          (!myanimelistTestSuccess ||
                            testedMyanimelistValues !==
                              (values.myanimelistApiKey || '')))
                      }
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(messages.saving)
                          : intl.formatMessage(messages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          );
        }}
      </Formik>

      {/* Maintainerr Settings */}
      <div className="section">
        <div className="mt-10 mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.maintainerrSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.maintainerrSettingsDescription)}
          </p>
        </div>
      </div>
      <Formik
        initialValues={{
          maintainerrHostname: dataMaintainerr?.hostname,
          maintainerrPort: dataMaintainerr?.port ?? 6246,
          maintainerrUseSsl: dataMaintainerr?.useSsl ?? false,
          maintainerrUrlBase: dataMaintainerr?.urlBase,
          maintainerrApiKey: dataMaintainerr?.apiKey,
          maintainerrExternalUrl: dataMaintainerr?.externalUrl,
        }}
        validationSchema={MaintainerrValidationSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/maintainerr', {
              hostname: values.maintainerrHostname,
              port: Number(values.maintainerrPort),
              apiKey: values.maintainerrApiKey,
              useSsl: values.maintainerrUseSsl,
              urlBase: values.maintainerrUrlBase,
              externalUrl: values.maintainerrExternalUrl,
            });
            addToast(
              intl.formatMessage(messages.toastMaintainerrSettingsSuccess),
              {
                appearance: 'success',
                autoDismiss: true,
              }
            );
          } catch (e) {
            addToast(
              intl.formatMessage(messages.toastMaintainerrSettingsFailure),
              {
                appearance: 'error',
                autoDismiss: true,
              }
            );
          } finally {
            revalidateMaintainerr();
          }
        }}
      >
        {({
          errors,
          touched,
          handleSubmit,
          setFieldValue,
          isSubmitting,
          isValid,
          values,
        }) => {
          const testMaintainerrConnection = async () => {
            if (
              !values.maintainerrHostname ||
              !values.maintainerrPort ||
              !values.maintainerrApiKey
            ) {
              return;
            }
            setIsTesting(true);
            setTestingService('maintainerr');
            try {
              const response = await axios.post(
                '/api/v1/settings/maintainerr/test',
                {
                  hostname: values.maintainerrHostname,
                  port: Number(values.maintainerrPort),
                  apiKey: values.maintainerrApiKey,
                  useSsl: values.maintainerrUseSsl,
                  urlBase: values.maintainerrUrlBase,
                }
              );
              if (response.data.success) {
                setMaintainerrTestSuccess(true);
                setTestedMaintainerrValues(
                  `${values.maintainerrHostname}:${values.maintainerrPort}:${values.maintainerrApiKey}:${values.maintainerrUseSsl}:${values.maintainerrUrlBase}`
                );

                addToast(
                  intl.formatMessage(messages.maintainerrConnectionSuccess),
                  {
                    autoDismiss: true,
                    appearance: 'success',
                  }
                );
              } else {
                setMaintainerrTestSuccess(false);
                addToast(
                  intl.formatMessage(messages.maintainerrConnectionFailure),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              }
            } catch (error) {
              setMaintainerrTestSuccess(false);

              let errorMessage =
                error.response?.data?.message ||
                intl.formatMessage(messages.maintainerrConnectionFailure);

              if (!error.response?.data?.message) {
                if (error.code === 'ECONNREFUSED') {
                  errorMessage +=
                    ' - Connection refused. Check hostname and port.';
                } else if (error.code === 'ENOTFOUND') {
                  errorMessage += ' - Host not found. Check hostname.';
                } else if (error.code === 'ETIMEDOUT') {
                  errorMessage +=
                    ' - Connection timeout. Check network connectivity.';
                } else if (error.message) {
                  errorMessage += ` - ${error.message}`;
                }
              }

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setTestingService(null);
              setIsTesting(false);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="maintainerrHostname" className="text-label">
                  {intl.formatMessage(messages.maintainerrHostname)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-stone-800 px-3 text-gray-100 sm:text-sm">
                      {values.maintainerrUseSsl ? 'https://' : 'http://'}
                    </span>
                    <Field
                      type="text"
                      inputMode="url"
                      id="maintainerrHostname"
                      name="maintainerrHostname"
                      className="rounded-r-only flex-1"
                    />
                  </div>
                  {errors.maintainerrHostname &&
                    touched.maintainerrHostname && (
                      <div className="error">{errors.maintainerrHostname}</div>
                    )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="maintainerrPort" className="text-label">
                  {intl.formatMessage(messages.maintainerrPort)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <Field
                    type="text"
                    inputMode="numeric"
                    id="maintainerrPort"
                    name="maintainerrPort"
                    className="short"
                  />
                  {errors.maintainerrPort && touched.maintainerrPort && (
                    <div className="error">{errors.maintainerrPort}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="maintainerrUseSsl" className="checkbox-label">
                  {intl.formatMessage(messages.maintainerrUseSsl)}
                </label>
                <div className="form-input-area">
                  <Field
                    type="checkbox"
                    id="maintainerrUseSsl"
                    name="maintainerrUseSsl"
                    onChange={() => {
                      setFieldValue(
                        'maintainerrUseSsl',
                        !values.maintainerrUseSsl
                      );
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="maintainerrUrlBase" className="text-label">
                  {intl.formatMessage(messages.urlBase)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      type="text"
                      inputMode="url"
                      id="maintainerrUrlBase"
                      name="maintainerrUrlBase"
                      autoComplete="off"
                      data-1pignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="maintainerrApiKey" className="text-label">
                  {intl.formatMessage(messages.maintainerrApiKey)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="maintainerrApiKey"
                      name="maintainerrApiKey"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="maintainerrExternalUrl" className="text-label">
                  {intl.formatMessage(messages.externalUrl)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      type="text"
                      inputMode="url"
                      id="maintainerrExternalUrl"
                      name="maintainerrExternalUrl"
                      autoComplete="off"
                      data-1pignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <div className="flex justify-end">
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="default"
                      type="button"
                      onClick={testMaintainerrConnection}
                      disabled={
                        !values.maintainerrHostname ||
                        !values.maintainerrPort ||
                        !values.maintainerrApiKey ||
                        isTesting
                      }
                    >
                      {isTesting
                        ? intl.formatMessage(messages.testing)
                        : intl.formatMessage(
                            messages.testMaintainerrConnection
                          )}
                    </Button>
                  </span>
                  <span className="ml-3 inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !isValid ||
                        (isSetupMode &&
                          !!values.maintainerrApiKey &&
                          (!maintainerrTestSuccess ||
                            testedMaintainerrValues !==
                              `${values.maintainerrHostname}:${values.maintainerrPort}:${values.maintainerrApiKey}:${values.maintainerrUseSsl}:${values.maintainerrUrlBase}`))
                      }
                    >
                      <ArrowDownOnSquareIcon />
                      <span>
                        {isSubmitting
                          ? intl.formatMessage(messages.saving)
                          : intl.formatMessage(messages.save)}
                      </span>
                    </Button>
                  </span>
                </div>
              </div>
            </form>
          );
        }}
      </Formik>

      {/* Helper info for Downloads page */}
      <div className="section mt-10">
        <Alert
          title={
            isSetupMode
              ? 'Overseerr, Radarr, and Sonarr are configured on the next page'
              : 'Overseerr, Radarr, and Sonarr are configured on the Downloads page'
          }
          type="info"
        >
          {isSetupMode ? (
            <>
              To use Overseerr Requests as a collection source, Radarr/Sonarr
              tags and &ldquo;Coming Soon&rdquo; collections, or to enable
              automatic downloading of missing items, configure these services
              on the <strong>Downloads</strong> page (next step in setup).
            </>
          ) : (
            <>
              To use Overseerr Requests as a collection source, Radarr/Sonarr
              tags and &ldquo;Coming Soon&rdquo; collections, or to enable
              automatic downloading of missing items, configure these services
              on the <strong>Settings → Downloads</strong> page.
            </>
          )}
        </Alert>
      </div>
    </>
  );
};

export default SettingsSources;
