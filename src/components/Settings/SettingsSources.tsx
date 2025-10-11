import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import PageTitle from '@app/components/Common/PageTitle';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import globalMessages from '@app/i18n/globalMessages';
import { ArrowDownOnSquareIcon } from '@heroicons/react/24/outline';
import type {
  MDBListSettings,
  MyAnimeListSettings,
  OverseerrSettings,
  TautulliSettings,
  TraktSettings,
} from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages({
  sources: 'Sources',
  sourcesDescription: 'Configure sources for Collection generation.',
  overseerrSettings: 'Overseerr Settings',
  overseerrSettingsDescription:
    'Configure connection to Overseerr to enable Collection creation based on Requests. Users Collections are hidden from all other users (except server owner) through the use of labels and restrictions',
  overseerrHostname: 'Hostname or IP Address',
  overseerrPort: 'Port',
  overseerrApiKey: 'API Key',
  overseerrApiKeyTip:
    'Get your API key from Overseerr Settings > General > API Key',
  overseerrUseSsl: 'Use SSL',
  overseerrUrlBase: 'URL Base',
  overseerrExternalUrl: 'External URL',
  testOverseerrConnection: 'Test Connection',
  overseerrConnectionSuccess: 'Connected to Overseerr successfully!',
  overseerrConnectionFailure: 'Failed to connect to Overseerr',
  toastOverseerrSettingsSuccess: 'Overseerr settings saved successfully!',
  toastOverseerrSettingsFailure:
    'Something went wrong while saving Overseerr settings.',
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
  traktSettingsDescription:
    'Configure your Trakt API key to enable Trakt-based collections with preset lists and custom list option.',
  traktApiKey: 'Trakt API Key',
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
  const [isTesting, setIsTesting] = useState(false);
  const [traktTestSuccess, setTraktTestSuccess] = useState(false);
  const [mdblistTestSuccess, setMdblistTestSuccess] = useState(false);
  const [myanimelistTestSuccess, setMyanimelistTestSuccess] = useState(false);
  const [overseerrTestSuccess, setOverseerrTestSuccess] = useState(false);
  const [tautulliTestSuccess, setTautulliTestSuccess] = useState(false);

  // Store the values that were successfully tested to detect changes
  const [testedTraktValues, setTestedTraktValues] = useState<string>('');
  const [testedMdblistValues, setTestedMdblistValues] = useState<string>('');
  const [testedMyanimelistValues, setTestedMyanimelistValues] =
    useState<string>('');
  const [testedOverseerrValues, setTestedOverseerrValues] =
    useState<string>('');
  const [testedTautulliValues, setTestedTautulliValues] = useState<string>('');

  // Check if we're in setup mode
  const isSetupMode = !!onComplete;

  const { data: dataOverseerr, mutate: revalidateOverseerr } =
    useSWR<OverseerrSettings>('/api/v1/settings/overseerr');
  const { data: dataTautulli, mutate: revalidateTautulli } =
    useSWR<TautulliSettings>('/api/v1/settings/tautulli');
  const { data: dataTrakt, mutate: revalidateTrakt } = useSWR<TraktSettings>(
    '/api/v1/settings/trakt'
  );
  const { data: dataMdblist, mutate: revalidateMdblist } =
    useSWR<MDBListSettings>('/api/v1/settings/mdblist');
  const { data: dataMyanimelist, mutate: revalidateMyanimelist } =
    useSWR<MyAnimeListSettings>('/api/v1/settings/myanimelist');

  // Reset test success states when data changes (prevents gaming the system)
  useEffect(() => {
    setTraktTestSuccess(false);
  }, [dataTrakt?.apiKey]);

  useEffect(() => {
    setMdblistTestSuccess(false);
  }, [dataMdblist?.apiKey]);

  useEffect(() => {
    setOverseerrTestSuccess(false);
  }, [dataOverseerr?.hostname, dataOverseerr?.port, dataOverseerr?.apiKey]);

  useEffect(() => {
    setTautulliTestSuccess(false);
  }, [dataTautulli?.hostname, dataTautulli?.port, dataTautulli?.apiKey]);

  useEffect(() => {
    setMyanimelistTestSuccess(false);
  }, [dataMyanimelist?.apiKey]);

  const OverseerrValidationSchema = Yup.object().shape({
    overseerrHostname: Yup.string()
      .nullable()
      .matches(
        /^(([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])$/i,
        intl.formatMessage(messages.validationHostnameRequired)
      ),
    overseerrPort: Yup.number().nullable(),
    overseerrUrlBase: Yup.string()
      .nullable()
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
    overseerrApiKey: Yup.string().nullable(),
    overseerrExternalUrl: Yup.string()
      .url(intl.formatMessage(messages.validationUrl))
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
  });

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

  const TraktSettingsSchema = Yup.object().shape({
    traktApiKey: Yup.string().nullable(),
  });

  const MdblistSettingsSchema = Yup.object().shape({
    mdblistApiKey: Yup.string().nullable(),
  });

  const MyanimelistSettingsSchema = Yup.object().shape({
    myanimelistApiKey: Yup.string().nullable(),
  });

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
        <div className="mt-10 mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.traktSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.traktSettingsDescription)}
          </p>
        </div>
      </div>
      <Formik
        initialValues={{
          traktApiKey: dataTrakt?.apiKey,
        }}
        validationSchema={TraktSettingsSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/trakt', {
              apiKey: values.traktApiKey,
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
          const testTraktConnection = async () => {
            if (!values.traktApiKey) {
              return;
            }
            try {
              setIsTesting(true);
              const response = await axios.post('/api/v1/settings/trakt/test', {
                apiKey: values.traktApiKey,
              });
              if (response.data.success) {
                setTraktTestSuccess(true);
                setTestedTraktValues(values.traktApiKey || '');
                addToast(intl.formatMessage(messages.traktConnectionSuccess), {
                  autoDismiss: true,
                  appearance: 'success',
                });
              } else {
                setTraktTestSuccess(false);
                addToast(intl.formatMessage(messages.traktConnectionFailure), {
                  autoDismiss: true,
                  appearance: 'error',
                });
              }
            } catch (e) {
              setTraktTestSuccess(false);

              // Provide specific error details to help users diagnose connection issues
              let errorMessage = intl.formatMessage(
                messages.traktConnectionFailure
              );
              if (e.response?.status === 401) {
                errorMessage +=
                  ' - Invalid API key. Check your Trakt Client ID.';
              } else if (e.response?.status) {
                errorMessage += ` (HTTP ${e.response.status})`;
              } else if (e.code === 'ECONNREFUSED') {
                errorMessage +=
                  ' - Connection refused. Check network connectivity.';
              } else if (e.code === 'ENOTFOUND') {
                errorMessage +=
                  ' - Unable to reach Trakt API. Check network connectivity.';
              } else if (e.code === 'ETIMEDOUT') {
                errorMessage +=
                  ' - Connection timeout. Check network connectivity.';
              } else if (e.message) {
                errorMessage += ` - ${e.message}`;
              }

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setIsTesting(false);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="traktApiKey" className="text-label">
                  {intl.formatMessage(messages.traktApiKey)}
                  <span className="label-tip mb-2">
                    Get your API key from
                    <code>https://trakt.tv/oauth/applications/new</code> and
                    copy the Client ID. Use{' '}
                    <code>urn:ietf:wg:oauth:2.0:oob</code> as the redirect URI
                    when creating the application.
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="traktApiKey"
                      name="traktApiKey"
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
                      disabled={!values.traktApiKey || isTesting}
                      onClick={(e) => {
                        e.preventDefault();
                        testTraktConnection();
                      }}
                    >
                      {isTesting
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
                          !!values.traktApiKey &&
                          (!traktTestSuccess ||
                            testedTraktValues !== (values.traktApiKey || '')))
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

              // Provide specific error details to help users diagnose connection issues
              let errorMessage = intl.formatMessage(
                messages.mdblistConnectionFailure
              );
              if (e.response?.status === 401) {
                errorMessage +=
                  ' - Invalid API key. Check your MDBList API key.';
              } else if (e.response?.status) {
                errorMessage += ` (HTTP ${e.response.status})`;
              } else if (e.code === 'ECONNREFUSED') {
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

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
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

      {/* Overseerr Settings */}
      <div className="section">
        <div className="mt-10 mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.overseerrSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.overseerrSettingsDescription)}
          </p>
        </div>
      </div>
      <Formik
        initialValues={{
          overseerrHostname: dataOverseerr?.hostname,
          overseerrPort: dataOverseerr?.port ?? 5055,
          overseerrUseSsl: dataOverseerr?.useSsl ?? false,
          overseerrUrlBase: dataOverseerr?.urlBase,
          overseerrApiKey: dataOverseerr?.apiKey,
          overseerrExternalUrl: dataOverseerr?.externalUrl,
        }}
        validationSchema={OverseerrValidationSchema}
        enableReinitialize
        onSubmit={async (values) => {
          try {
            await axios.post('/api/v1/settings/overseerr', {
              hostname: values.overseerrHostname,
              port: Number(values.overseerrPort),
              apiKey: values.overseerrApiKey,
              useSsl: values.overseerrUseSsl,
              urlBase: values.overseerrUrlBase,
              externalUrl: values.overseerrExternalUrl,
            });
            addToast(
              intl.formatMessage(messages.toastOverseerrSettingsSuccess),
              {
                appearance: 'success',
                autoDismiss: true,
              }
            );
          } catch (e) {
            addToast(
              intl.formatMessage(messages.toastOverseerrSettingsFailure),
              {
                appearance: 'error',
                autoDismiss: true,
              }
            );
          } finally {
            revalidateOverseerr();
          }
        }}
      >
        {({
          errors,
          touched,
          values,
          handleSubmit,
          setFieldValue,
          isSubmitting,
          isValid,
        }) => {
          const testConnection = async () => {
            if (
              !values.overseerrHostname ||
              !values.overseerrPort ||
              !values.overseerrApiKey
            ) {
              return;
            }
            try {
              setIsTesting(true);
              const response = await axios.post('/api/v1/overseerr/test', {
                hostname: values.overseerrHostname,
                port: Number(values.overseerrPort),
                apiKey: values.overseerrApiKey,
                useSsl: values.overseerrUseSsl,
                urlBase: values.overseerrUrlBase,
              });
              if (response.data.success) {
                setOverseerrTestSuccess(true);
                setTestedOverseerrValues(
                  `${values.overseerrHostname}:${values.overseerrPort}:${values.overseerrApiKey}:${values.overseerrUseSsl}:${values.overseerrUrlBase}`
                );

                // Show success message for connection
                addToast(
                  `${intl.formatMessage(
                    messages.overseerrConnectionSuccess
                  )} (v${response.data.version || 'unknown'})`,
                  {
                    autoDismiss: true,
                    appearance: 'success',
                  }
                );

                // Show additional info about template data if available
                if (response.data.templateDataMessage) {
                  addToast(response.data.templateDataMessage, {
                    autoDismiss: true,
                    appearance: response.data.templateDataSuccess
                      ? 'success'
                      : 'warning',
                  });
                }
              } else {
                setOverseerrTestSuccess(false);
                addToast(
                  intl.formatMessage(messages.overseerrConnectionFailure),
                  {
                    autoDismiss: true,
                    appearance: 'error',
                  }
                );
              }
            } catch (e) {
              setOverseerrTestSuccess(false);

              // Provide specific error details to help users diagnose connection issues
              let errorMessage = intl.formatMessage(
                messages.overseerrConnectionFailure
              );
              if (e.response?.status) {
                errorMessage += ` (HTTP ${e.response.status})`;
              } else if (e.code === 'ECONNREFUSED') {
                errorMessage +=
                  ' - Connection refused. Check hostname and port.';
              } else if (e.code === 'ENOTFOUND') {
                errorMessage += ' - Host not found. Check hostname.';
              } else if (e.code === 'ETIMEDOUT') {
                errorMessage +=
                  ' - Connection timeout. Check network connectivity.';
              } else if (e.message) {
                errorMessage += ` - ${e.message}`;
              }

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setIsTesting(false);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="overseerrHostname" className="text-label">
                  {intl.formatMessage(messages.overseerrHostname)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-stone-800 px-3 text-gray-100 sm:text-sm">
                      {values.overseerrUseSsl ? 'https://' : 'http://'}
                    </span>
                    <Field
                      type="text"
                      inputMode="url"
                      id="overseerrHostname"
                      name="overseerrHostname"
                      className="rounded-r-only flex-1"
                    />
                  </div>
                  {errors.overseerrHostname && touched.overseerrHostname && (
                    <div className="error">{errors.overseerrHostname}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="overseerrPort" className="text-label">
                  {intl.formatMessage(messages.overseerrPort)}
                  <span className="label-required">*</span>
                </label>
                <div className="form-input-area">
                  <Field
                    type="text"
                    inputMode="numeric"
                    id="overseerrPort"
                    name="overseerrPort"
                    placeholder="5055"
                    className="short"
                  />
                  {errors.overseerrPort && touched.overseerrPort && (
                    <div className="error">{errors.overseerrPort}</div>
                  )}
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="overseerrUseSsl" className="checkbox-label">
                  {intl.formatMessage(messages.overseerrUseSsl)}
                </label>
                <div className="form-input-area">
                  <Field
                    type="checkbox"
                    id="overseerrUseSsl"
                    name="overseerrUseSsl"
                    onChange={() => {
                      setFieldValue('overseerrUseSsl', !values.overseerrUseSsl);
                    }}
                  />
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="overseerrUrlBase" className="text-label">
                  {intl.formatMessage(messages.overseerrUrlBase)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      type="text"
                      inputMode="url"
                      id="overseerrUrlBase"
                      name="overseerrUrlBase"
                      autoComplete="off"
                      data-1pignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="overseerrApiKey" className="text-label">
                  {intl.formatMessage(messages.overseerrApiKey)}
                  <span className="label-required">*</span>
                  <span className="label-tip">
                    {intl.formatMessage(messages.overseerrApiKeyTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <SensitiveInput
                      as="field"
                      id="overseerrApiKey"
                      name="overseerrApiKey"
                      type="text"
                      placeholder="Your Overseerr API Key"
                    />
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label htmlFor="overseerrExternalUrl" className="text-label">
                  {intl.formatMessage(messages.overseerrExternalUrl)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <Field
                      type="text"
                      inputMode="url"
                      id="overseerrExternalUrl"
                      name="overseerrExternalUrl"
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
                      disabled={
                        !values.overseerrHostname ||
                        !values.overseerrPort ||
                        !values.overseerrApiKey ||
                        isTesting
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        testConnection();
                      }}
                    >
                      {isTesting
                        ? intl.formatMessage(messages.testing)
                        : intl.formatMessage(messages.testOverseerrConnection)}
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
                          !!values.overseerrApiKey &&
                          (!overseerrTestSuccess ||
                            testedOverseerrValues !==
                              `${values.overseerrHostname}:${values.overseerrPort}:${values.overseerrApiKey}:${values.overseerrUseSsl}:${values.overseerrUrlBase}`))
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
                  `${intl.formatMessage(
                    messages.tautulliConnectionSuccess
                  )} (v${response.data.version || 'unknown'})`,
                  {
                    autoDismiss: true,
                    appearance: 'success',
                  }
                );

                // Show version compatibility info if available
                if (response.data.versionCheckMessage) {
                  addToast(response.data.versionCheckMessage, {
                    autoDismiss: true,
                    appearance: response.data.versionCheckSuccess
                      ? 'success'
                      : 'warning',
                  });
                }
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

              // Provide specific error details to help users diagnose connection issues
              let errorMessage = intl.formatMessage(
                messages.tautulliConnectionFailure
              );
              if (error.response?.status) {
                errorMessage += ` (HTTP ${error.response.status})`;
              } else if (error.code === 'ECONNREFUSED') {
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

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
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

              let errorMessage = intl.formatMessage(
                messages.myanimelistConnectionFailure
              );
              if (e.response?.status === 401) {
                errorMessage +=
                  ' - Invalid API key. Check your MyAnimeList API key.';
              } else if (e.response?.status) {
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

              addToast(errorMessage, {
                autoDismiss: true,
                appearance: 'error',
              });
            } finally {
              setIsTesting(false);
            }
          };

          return (
            <form className="section" onSubmit={handleSubmit}>
              <div className="form-row">
                <label htmlFor="myanimelistApiKey" className="text-label">
                  {intl.formatMessage(messages.myanimelistApiKey)}
                  <span className="label-tip mb-2">
                    Get your API key from MyAnimeList developer settings.
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
    </>
  );
};

export default SettingsSources;
