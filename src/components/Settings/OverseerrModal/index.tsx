import Modal from '@app/components/Common/Modal';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import globalMessages from '@app/i18n/globalMessages';
import { Transition } from '@headlessui/react';
import type {
  OverseerrSettings,
  ServiceUserSettings,
} from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';
import * as Yup from 'yup';

const messages = defineMessages({
  createoverseerr: 'Add Overseerr Connection',
  editoverseerr: 'Edit Overseerr Connection',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  toastOverseerrTestSuccess: 'Overseerr connection established successfully!',
  toastOverseerrTestFailure: 'Failed to connect to Overseerr.',
  add: 'Add Connection',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  apiKeyTip: 'Get your API key from Overseerr Settings > General > API Key',
  urlBase: 'URL Base',
  externalUrl: 'External URL',
  serverId: 'Default Server',
  serverIdTip: 'Default Radarr/Sonarr server for requests',
  profileId: 'Default Quality Profile',
  profileIdTip: 'Default quality profile for requests',
  rootFolder: 'Default Root Folder',
  rootFolderTip: 'Default root folder for requests',
  selectServer: 'Select a server',
  selectProfile: 'Select a quality profile',
  selectRootFolder: 'Select a root folder',
  loadingServers: 'Loading servers…',
  loadingProfiles: 'Loading quality profiles…',
  loadingRootFolders: 'Loading root folders…',
  testFirstServers: 'Test connection to load servers',
  testFirstProfiles: 'Select a server first',
  testFirstRootFolders: 'Select a server first',
  validationUrl: 'You must provide a valid URL',
  validationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationUrlBaseLeadingSlash: 'URL base must have a leading slash',
  validationUrlBaseTrailingSlash: 'URL base must not end in a trailing slash',
  granularUsers: 'Create Overseerr users for Requests',
});

interface TestResponse {
  servers: {
    radarr: {
      id: number;
      name: string;
      hostname: string;
      port: number;
      is4k: boolean;
      isDefault: boolean;
    }[];
    sonarr: {
      id: number;
      name: string;
      hostname: string;
      port: number;
      is4k: boolean;
      isDefault: boolean;
    }[];
  };
  radarrServerOptions: Record<
    number,
    {
      profiles: { id: number; name: string }[];
      rootFolders: { id: number; path: string }[];
    }
  >;
  sonarrServerOptions: Record<
    number,
    {
      profiles: { id: number; name: string }[];
      rootFolders: { id: number; path: string }[];
    }
  >;
}

interface OverseerrModalProps {
  overseerr: OverseerrSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const OverseerrModal = ({
  onClose,
  overseerr,
  onSave,
}: OverseerrModalProps) => {
  const intl = useIntl();
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(overseerr ? true : false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResponse, setTestResponse] = useState<TestResponse>({
    servers: { radarr: [], sonarr: [] },
    radarrServerOptions: {},
    sonarrServerOptions: {},
  });

  const { data: dataServiceUser } = useSWR<ServiceUserSettings>(
    '/api/v1/settings/serviceuser'
  );

  const OverseerrSettingsSchema = Yup.object().shape({
    hostname: Yup.string()
      .required(intl.formatMessage(messages.validationHostnameRequired))
      .matches(
        /^(([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])$/i,
        intl.formatMessage(messages.validationHostnameRequired)
      ),
    port: Yup.number()
      .nullable()
      .required(intl.formatMessage(messages.validationPortRequired)),
    apiKey: Yup.string().required(
      intl.formatMessage(messages.validationApiKeyRequired)
    ),
    externalUrl: Yup.string()
      .url(intl.formatMessage(messages.validationUrl))
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
    urlBase: Yup.string()
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
  });

  const testConnection = useCallback(
    async ({
      hostname,
      port,
      apiKey,
      urlBase,
      useSsl = false,
    }: {
      hostname: string;
      port: number;
      apiKey: string;
      urlBase?: string;
      useSsl?: boolean;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post('/api/v1/overseerr/test', {
          hostname,
          apiKey,
          port: Number(port),
          urlBase,
          useSsl,
        });

        // Test response now includes ALL server options
        setTestResponse({
          servers: response.data.servers || { radarr: [], sonarr: [] },
          radarrServerOptions: response.data.radarrServerOptions || {},
          sonarrServerOptions: response.data.sonarrServerOptions || {},
        });

        setIsValidated(true);
        if (initialLoad.current) {
          // Show success message for connection
          addToast(intl.formatMessage(messages.toastOverseerrTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });

          // Show additional info about template data if available
          if (response.data.templateDataMessage) {
            addToast(response.data.templateDataMessage, {
              autoDismiss: true,
              appearance: response.data.templateDataSuccess
                ? 'success'
                : 'warning',
            });
          }
        }
      } catch (e) {
        setIsValidated(false);
        setTestResponse({
          servers: { radarr: [], sonarr: [] },
          radarrServerOptions: {},
          sonarrServerOptions: {},
        });
        if (initialLoad.current) {
          // Use server's detailed error message if available
          let errorMessage =
            e.response?.data?.message ||
            intl.formatMessage(messages.toastOverseerrTestFailure);

          // If no server message, provide client-side diagnostics
          if (!e.response?.data?.message) {
            if (e.code === 'ECONNREFUSED') {
              errorMessage += ' - Connection refused. Check hostname and port.';
            } else if (e.code === 'ENOTFOUND') {
              errorMessage += ' - Host not found. Check hostname.';
            } else if (e.code === 'ETIMEDOUT') {
              errorMessage +=
                ' - Connection timeout. Check network connectivity.';
            } else if (e.message) {
              errorMessage += ` - ${e.message}`;
            }
          }

          addToast(errorMessage, {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      } finally {
        setIsTesting(false);
        initialLoad.current = true;
      }
    },
    [addToast, intl]
  );

  useEffect(() => {
    if (overseerr) {
      testConnection({
        apiKey: overseerr.apiKey || '',
        hostname: overseerr.hostname || '',
        port: overseerr.port || 5055,
        urlBase: overseerr.urlBase,
        useSsl: overseerr.useSsl,
      });
    }
  }, [overseerr, testConnection]);

  return (
    <Transition
      as="div"
      appear
      show
      enter="transition-opacity ease-in-out duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity ease-in-out duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Formik
        initialValues={{
          hostname: overseerr?.hostname,
          port: overseerr?.port ?? 5055,
          useSsl: overseerr?.useSsl ?? false,
          apiKey: overseerr?.apiKey,
          urlBase: overseerr?.urlBase,
          externalUrl: overseerr?.externalUrl,
          radarrServerId: overseerr?.radarrServerId,
          radarrProfileId: overseerr?.radarrProfileId,
          radarrRootFolder: overseerr?.radarrRootFolder,
          sonarrServerId: overseerr?.sonarrServerId,
          sonarrProfileId: overseerr?.sonarrProfileId,
          sonarrRootFolder: overseerr?.sonarrRootFolder,
          userCreationMode: dataServiceUser?.userCreationMode || 'per-service',
        }}
        validationSchema={OverseerrSettingsSchema}
        onSubmit={async (values) => {
          try {
            const overseerrSubmission = {
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.useSsl,
              urlBase: values.urlBase,
              externalUrl: values.externalUrl,
              radarrServerId:
                values.radarrServerId !== undefined &&
                values.radarrServerId !== null
                  ? Number(values.radarrServerId)
                  : undefined,
              radarrProfileId:
                values.radarrProfileId !== undefined &&
                values.radarrProfileId !== null
                  ? Number(values.radarrProfileId)
                  : undefined,
              radarrRootFolder: values.radarrRootFolder,
              sonarrServerId:
                values.sonarrServerId !== undefined &&
                values.sonarrServerId !== null
                  ? Number(values.sonarrServerId)
                  : undefined,
              sonarrProfileId:
                values.sonarrProfileId !== undefined &&
                values.sonarrProfileId !== null
                  ? Number(values.sonarrProfileId)
                  : undefined,
              sonarrRootFolder: values.sonarrRootFolder,
            };

            const serviceUserSubmission = {
              userCreationMode: values.userCreationMode,
            };

            await axios.post('/api/v1/settings/overseerr', overseerrSubmission);
            await axios.post(
              '/api/v1/settings/serviceuser',
              serviceUserSubmission
            );
            onSave();
          } catch (e) {
            // Error handling
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
          return (
            <Modal
              onCancel={onClose}
              okButtonType="primary"
              okText={
                isSubmitting
                  ? intl.formatMessage(globalMessages.saving)
                  : overseerr
                  ? intl.formatMessage(globalMessages.save)
                  : intl.formatMessage(messages.add)
              }
              secondaryButtonType="warning"
              secondaryText={
                isTesting
                  ? intl.formatMessage(globalMessages.testing)
                  : intl.formatMessage(globalMessages.test)
              }
              onSecondary={() => {
                if (values.apiKey && values.hostname && values.port) {
                  testConnection({
                    apiKey: values.apiKey,
                    urlBase: values.urlBase,
                    hostname: values.hostname,
                    port: values.port,
                    useSsl: values.useSsl,
                  });
                }
              }}
              secondaryDisabled={
                !values.apiKey ||
                !values.hostname ||
                !values.port ||
                isTesting ||
                isSubmitting
              }
              okDisabled={!isValidated || isSubmitting || isTesting || !isValid}
              onOk={() => handleSubmit()}
              title={
                !overseerr
                  ? intl.formatMessage(messages.createoverseerr)
                  : intl.formatMessage(messages.editoverseerr)
              }
            >
              <div className="mb-6">
                <div className="form-row">
                  <label htmlFor="hostname" className="text-label">
                    {intl.formatMessage(messages.hostname)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <span className="protocol">
                        {values.useSsl ? 'https://' : 'http://'}
                      </span>
                      <Field
                        id="hostname"
                        name="hostname"
                        type="text"
                        inputMode="url"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          setFieldValue('hostname', e.target.value);
                        }}
                        className="rounded-r-only"
                      />
                    </div>
                    {errors.hostname &&
                      touched.hostname &&
                      typeof errors.hostname === 'string' && (
                        <div className="error">{errors.hostname}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="port" className="text-label">
                    {intl.formatMessage(messages.port)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      id="port"
                      name="port"
                      type="text"
                      inputMode="numeric"
                      className="short"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setIsValidated(false);
                        setFieldValue('port', e.target.value);
                      }}
                    />
                    {errors.port &&
                      touched.port &&
                      typeof errors.port === 'string' && (
                        <div className="error">{errors.port}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="useSsl" className="checkbox-label">
                    {intl.formatMessage(messages.ssl)}
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="useSsl"
                      name="useSsl"
                      onChange={() => {
                        setIsValidated(false);
                        setFieldValue('useSsl', !values.useSsl);
                      }}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="apiKey" className="text-label">
                    {intl.formatMessage(messages.apiKey)}
                    <span className="label-required">*</span>
                    <span className="label-tip">
                      {intl.formatMessage(messages.apiKeyTip)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <SensitiveInput
                        as="field"
                        id="apiKey"
                        name="apiKey"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          setFieldValue('apiKey', e.target.value);
                        }}
                      />
                    </div>
                    {errors.apiKey &&
                      touched.apiKey &&
                      typeof errors.apiKey === 'string' && (
                        <div className="error">{errors.apiKey}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="urlBase" className="text-label">
                    {intl.formatMessage(messages.urlBase)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="urlBase"
                        name="urlBase"
                        type="text"
                        inputMode="url"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          setFieldValue('urlBase', e.target.value);
                        }}
                      />
                    </div>
                    {errors.urlBase &&
                      touched.urlBase &&
                      typeof errors.urlBase === 'string' && (
                        <div className="error">{errors.urlBase}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="externalUrl" className="text-label">
                    {intl.formatMessage(messages.externalUrl)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="externalUrl"
                        name="externalUrl"
                        type="text"
                        inputMode="url"
                      />
                    </div>
                    {errors.externalUrl &&
                      touched.externalUrl &&
                      typeof errors.externalUrl === 'string' && (
                        <div className="error">{errors.externalUrl}</div>
                      )}
                  </div>
                </div>

                {/* Movies (Radarr) Defaults */}
                <div className="form-row">
                  <div className="text-label font-semibold">
                    Movies (Radarr) Defaults
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="radarrServerId" className="text-label">
                    Default Radarr Server
                    <span className="label-tip">
                      Default server for movie requests
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="radarrServerId"
                        name="radarrServerId"
                        disabled={!isValidated || isTesting}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          const serverId = e.target.value
                            ? parseInt(e.target.value)
                            : undefined;
                          setFieldValue('radarrServerId', serverId);
                          setFieldValue('radarrProfileId', undefined);
                          setFieldValue('radarrRootFolder', undefined);
                        }}
                      >
                        <option value="">
                          {isTesting
                            ? intl.formatMessage(messages.loadingServers)
                            : !isValidated
                            ? intl.formatMessage(messages.testFirstServers)
                            : intl.formatMessage(messages.selectServer)}
                        </option>
                        {testResponse.servers.radarr.map((server) => (
                          <option key={`radarr-${server.id}`} value={server.id}>
                            {server.name}
                          </option>
                        ))}
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="radarrProfileId" className="text-label">
                    Default Movie Profile
                    <span className="label-tip">
                      Default quality profile for movie requests
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="radarrProfileId"
                        name="radarrProfileId"
                        disabled={
                          values.radarrServerId === undefined ||
                          values.radarrServerId === null ||
                          !testResponse.radarrServerOptions[
                            Number(values.radarrServerId)
                          ]
                        }
                      >
                        <option value="">
                          {values.radarrServerId === undefined ||
                          values.radarrServerId === null
                            ? intl.formatMessage(messages.testFirstProfiles)
                            : intl.formatMessage(messages.selectProfile)}
                        </option>
                        {values.radarrServerId !== undefined &&
                          values.radarrServerId !== null &&
                          testResponse.radarrServerOptions[
                            Number(values.radarrServerId)
                          ]?.profiles.map((profile) => (
                            <option
                              key={`radarr-profile-${profile.id}`}
                              value={profile.id}
                            >
                              {profile.name}
                            </option>
                          ))}
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="radarrRootFolder" className="text-label">
                    Default Movie Root Folder
                    <span className="label-tip">
                      Default root folder for movie requests
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="radarrRootFolder"
                        name="radarrRootFolder"
                        disabled={
                          values.radarrServerId === undefined ||
                          values.radarrServerId === null ||
                          !testResponse.radarrServerOptions[
                            Number(values.radarrServerId)
                          ]
                        }
                      >
                        <option value="">
                          {values.radarrServerId === undefined ||
                          values.radarrServerId === null
                            ? intl.formatMessage(messages.testFirstRootFolders)
                            : intl.formatMessage(messages.selectRootFolder)}
                        </option>
                        {values.radarrServerId !== undefined &&
                          values.radarrServerId !== null &&
                          testResponse.radarrServerOptions[
                            Number(values.radarrServerId)
                          ]?.rootFolders.map((folder) => (
                            <option
                              key={`radarr-folder-${folder.id}`}
                              value={folder.path}
                            >
                              {folder.path}
                            </option>
                          ))}
                      </Field>
                    </div>
                  </div>
                </div>

                {/* TV Shows (Sonarr) Defaults */}
                <div className="form-row">
                  <div className="text-label font-semibold">
                    TV Shows (Sonarr) Defaults
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="sonarrServerId" className="text-label">
                    Default Sonarr Server
                    <span className="label-tip">
                      Default server for TV show requests
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="sonarrServerId"
                        name="sonarrServerId"
                        disabled={!isValidated || isTesting}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          const serverId = e.target.value
                            ? parseInt(e.target.value)
                            : undefined;
                          setFieldValue('sonarrServerId', serverId);
                          setFieldValue('sonarrProfileId', undefined);
                          setFieldValue('sonarrRootFolder', undefined);
                        }}
                      >
                        <option value="">
                          {isTesting
                            ? intl.formatMessage(messages.loadingServers)
                            : !isValidated
                            ? intl.formatMessage(messages.testFirstServers)
                            : intl.formatMessage(messages.selectServer)}
                        </option>
                        {testResponse.servers.sonarr.map((server) => (
                          <option key={`sonarr-${server.id}`} value={server.id}>
                            {server.name}
                          </option>
                        ))}
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="sonarrProfileId" className="text-label">
                    Default TV Profile
                    <span className="label-tip">
                      Default quality profile for TV show requests
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="sonarrProfileId"
                        name="sonarrProfileId"
                        disabled={
                          values.sonarrServerId === undefined ||
                          values.sonarrServerId === null ||
                          !testResponse.sonarrServerOptions[
                            Number(values.sonarrServerId)
                          ]
                        }
                      >
                        <option value="">
                          {values.sonarrServerId === undefined ||
                          values.sonarrServerId === null
                            ? intl.formatMessage(messages.testFirstProfiles)
                            : intl.formatMessage(messages.selectProfile)}
                        </option>
                        {values.sonarrServerId !== undefined &&
                          values.sonarrServerId !== null &&
                          testResponse.sonarrServerOptions[
                            Number(values.sonarrServerId)
                          ]?.profiles.map((profile) => (
                            <option
                              key={`sonarr-profile-${profile.id}`}
                              value={profile.id}
                            >
                              {profile.name}
                            </option>
                          ))}
                      </Field>
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <label htmlFor="sonarrRootFolder" className="text-label">
                    Default TV Root Folder
                    <span className="label-tip">
                      Default root folder for TV show requests
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="sonarrRootFolder"
                        name="sonarrRootFolder"
                        disabled={
                          values.sonarrServerId === undefined ||
                          values.sonarrServerId === null ||
                          !testResponse.sonarrServerOptions[
                            Number(values.sonarrServerId)
                          ]
                        }
                      >
                        <option value="">
                          {values.sonarrServerId === undefined ||
                          values.sonarrServerId === null
                            ? intl.formatMessage(messages.testFirstRootFolders)
                            : intl.formatMessage(messages.selectRootFolder)}
                        </option>
                        {values.sonarrServerId !== undefined &&
                          values.sonarrServerId !== null &&
                          testResponse.sonarrServerOptions[
                            Number(values.sonarrServerId)
                          ]?.rootFolders.map((folder) => (
                            <option
                              key={`sonarr-folder-${folder.id}`}
                              value={folder.path}
                            >
                              {folder.path}
                            </option>
                          ))}
                      </Field>
                    </div>
                  </div>
                </div>

                {/* Service User Settings */}
                <div className="form-row">
                  <label htmlFor="userCreationMode" className="text-label">
                    {intl.formatMessage(messages.granularUsers)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="userCreationMode"
                        name="userCreationMode"
                      >
                        <option value="single">Single user (Agregarr)</option>
                        <option value="per-service">
                          Per service (TraktAgregarr, TMDbAgregarr)
                        </option>
                        <option value="granular">
                          Granular (TraktTrendingAgregarr, TMDbPopularAgregarr)
                        </option>
                      </Field>
                    </div>
                  </div>
                </div>
              </div>
            </Modal>
          );
        }}
      </Formik>
    </Transition>
  );
};

export default OverseerrModal;
