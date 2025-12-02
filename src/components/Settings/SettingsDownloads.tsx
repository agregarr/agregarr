import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import FolderBrowser from '@app/components/Common/FolderBrowser';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import OverseerrModal from '@app/components/Settings/OverseerrModal';
import RadarrModal from '@app/components/Settings/RadarrModal';
import SonarrModal from '@app/components/Settings/SonarrModal';
import globalMessages from '@app/i18n/globalMessages';
import { Transition } from '@headlessui/react';
import { ArrowDownOnSquareIcon, FolderIcon } from '@heroicons/react/24/outline';
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid';
import type {
  MainSettings,
  OverseerrSettings,
  RadarrSettings,
  SonarrSettings,
} from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { Fragment, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR, { mutate } from 'swr';

const messages = defineMessages({
  downloads: 'Downloads',
  downloadsDescription:
    'Grab missing items automatically using Radarr, Sonarr, or Overseerr.',
  radarrsettings: 'Radarr Settings',
  sonarrsettings: 'Sonarr Settings',
  serviceSettingsDescription:
    'Configure your {serverType} server(s) below. You can connect multiple {serverType} servers, but only one can be marked as default. Collections can override which server to use for downloads.',
  deleteserverconfirm: 'Are you sure you want to delete this server?',
  ssl: 'SSL',
  default: 'Default',
  default4k: 'Default 4K',
  is4k: '4K',
  address: 'Address',
  activeProfile: 'Active Profile',
  addoverseerr: 'Add Overseerr Connection',
  addradarr: 'Add Radarr Server',
  addsonarr: 'Add Sonarr Server',
  noDefaultServer:
    'At least one {serverType} server must be marked as default in order for {mediaType} requests to be processed.',
  noDefaultNon4kServer:
    'If you only have a single {serverType} server for both non-4K and 4K content (or if you only download 4K content), your {serverType} server should <strong>NOT</strong> be designated as a 4K server.',
  noDefault4kServer:
    'A 4K {serverType} server must be marked as default in order to enable users to submit 4K {mediaType} requests.',
  mediaTypeMovie: 'movie',
  mediaTypeSeries: 'series',
  deleteServer: 'Delete {serverType} Server',
  overseerrSettings: 'Overseerr Settings',
  overseerrSettingsDescription:
    'Configure connection to add missing items as Requests in Overseerr.',
  overseerrHostname: 'Hostname or IP Address',
  overseerrPort: 'Port',
  overseerrApiKey: 'API Key',
  overseerrApiKeyTip:
    'Get your API key from Overseerr Settings > General > API Key',
  overseerrUseSsl: 'Use SSL',
  overseerrUrlBase: 'URL Base',
  overseerrExternalUrl: 'External URL',
  overseerrServerId: 'Default Server',
  overseerrServerIdTip: 'Default Radarr/Sonarr server for requests',
  overseerrProfileId: 'Default Quality Profile',
  overseerrProfileIdTip: 'Default quality profile for requests',
  overseerrRootFolder: 'Default Root Folder',
  overseerrRootFolderTip: 'Default root folder for requests',
  testOverseerrConnection: 'Test Connection',
  overseerrConnectionSuccess: 'Connected to Overseerr successfully!',
  overseerrConnectionFailure: 'Failed to connect to Overseerr',
  toastOverseerrSettingsSuccess: 'Overseerr settings saved successfully!',
  toastOverseerrSettingsFailure:
    'Something went wrong while saving Overseerr settings.',
  save: 'Save Changes',
  saving: 'Saving…',
  testing: 'Testing…',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKey: 'You must provide an API key',
  validationUrl: 'You must provide a valid URL',
  validationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationUrlBaseLeadingSlash: 'URL base must have a leading slash',
  validationUrlBaseTrailingSlash: 'URL base must not end in a trailing slash',
  serviceUserSettings: 'Service User Settings',
  serviceUserSettingsDescription:
    'Configure how Agregarr creates users in Overseerr for tracking requests.',
  granularUsers: 'Create Overseerr users for Requests',
  toastServiceUserSettingsSuccess: 'Service user settings saved successfully!',
  toastServiceUserSettingsFailure:
    'Something went wrong while saving service user settings.',
  placeholderSettings: 'Placeholder Root Folders',
  placeholderSettingsDescription:
    'Configure root folders for placeholder files. These paths should match the mounted Plex library paths inside the Agregarr container.',
  placeholderMovieRootFolder: 'Movie Placeholder Root Folder',
  placeholderTVRootFolder: 'TV Placeholder Root Folder',
  placeholderMovieRootFolderTip:
    'Path where movie placeholder files will be created',
  placeholderTVRootFolderTip: 'Path where TV placeholder files will be created',
  browse: 'Browse',
  toastPlaceholderSettingsSuccess: 'Placeholder settings saved successfully!',
  toastPlaceholderSettingsFailure:
    'Something went wrong while saving placeholder settings.',
});

interface ServerInstanceProps {
  name: string;
  isDefault?: boolean;
  is4k?: boolean;
  hostname: string;
  port: number;
  isSSL?: boolean;
  externalUrl?: string;
  isSonarr?: boolean;
  isOverseerr?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const ServerInstance = ({
  name,
  hostname,
  port,
  is4k = false,
  isDefault = false,
  isSSL = false,
  isSonarr = false,
  isOverseerr = false,
  externalUrl,
  onEdit,
  onDelete,
}: ServerInstanceProps) => {
  const intl = useIntl();

  const internalUrl =
    (isSSL ? 'https://' : 'http://') + hostname + ':' + String(port);
  const serviceUrl = externalUrl ?? internalUrl;

  return (
    <li className="col-span-1 rounded-lg bg-stone-800 shadow ring-1 ring-stone-500">
      <div className="flex w-full items-center justify-between space-x-6 p-6">
        <div className="flex-1 truncate">
          <div className="mb-2 flex items-center space-x-2">
            <h3 className="truncate font-medium leading-5 text-white">
              <a
                href={serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="transition duration-300 hover:text-white hover:underline"
              >
                {name}
              </a>
            </h3>
            {isDefault && !is4k && (
              <Badge badgeType="success">
                {intl.formatMessage(messages.default)}
              </Badge>
            )}
            {isDefault && is4k && (
              <Badge badgeType="success">
                {intl.formatMessage(messages.default4k)}
              </Badge>
            )}
            {!isDefault && is4k && (
              <Badge badgeType="warning">
                {intl.formatMessage(messages.is4k)}
              </Badge>
            )}
            {isSSL && (
              <Badge badgeType="success">
                {intl.formatMessage(messages.ssl)}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm leading-5 text-stone-300">
            <span className="mr-2 font-bold">
              {intl.formatMessage(messages.address)}
            </span>
            <a
              href={internalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="transition duration-300 hover:text-white hover:underline"
            >
              {internalUrl}
            </a>
          </p>
        </div>
        <a
          href={serviceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-50 hover:opacity-100"
        >
          {isOverseerr ? (
            <img
              src="/services/overseerr.svg"
              alt="Overseerr"
              className="h-10 w-10 flex-shrink-0"
            />
          ) : isSonarr ? (
            <img
              src="/services/sonarr.svg"
              alt="Sonarr"
              className="h-10 w-10 flex-shrink-0"
            />
          ) : (
            <img
              src="/services/radarr.svg"
              alt="Radarr"
              className="h-10 w-10 flex-shrink-0"
            />
          )}
        </a>
      </div>
      <div className="border-t border-stone-500">
        <div className="-mt-px flex">
          <div className="flex w-0 flex-1 border-r border-stone-500">
            <button
              onClick={() => onEdit()}
              className="focus:ring-orange relative -mr-px inline-flex w-0 flex-1 items-center justify-center rounded-bl-lg border border-transparent py-4 text-sm font-medium leading-5 text-stone-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-stone-500 focus:outline-none"
            >
              <PencilIcon className="mr-2 h-5 w-5" />
              <span>{intl.formatMessage(globalMessages.edit)}</span>
            </button>
          </div>
          <div className="-ml-px flex w-0 flex-1">
            <button
              onClick={() => onDelete()}
              className="focus:ring-orange relative inline-flex w-0 flex-1 items-center justify-center rounded-br-lg border border-transparent py-4 text-sm font-medium leading-5 text-stone-200 transition duration-150 ease-in-out hover:text-white focus:z-10 focus:border-stone-500 focus:outline-none"
            >
              <TrashIcon className="mr-2 h-5 w-5" />
              <span>{intl.formatMessage(globalMessages.delete)}</span>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
};

interface SettingsDownloadsProps {
  onComplete?: () => void;
}

const SettingsDownloads = ({ onComplete }: SettingsDownloadsProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [folderBrowser, setFolderBrowser] = useState<{
    isOpen: boolean;
    type: 'movie' | 'tv' | null;
  }>({ isOpen: false, type: null });
  const [editOverseerrModal, setEditOverseerrModal] = useState<{
    open: boolean;
  }>({
    open: false,
  });

  const {
    data: radarrData,
    error: radarrError,
    mutate: revalidateRadarr,
  } = useSWR<RadarrSettings[]>('/api/v1/settings/radarr');
  const {
    data: sonarrData,
    error: sonarrError,
    mutate: revalidateSonarr,
  } = useSWR<SonarrSettings[]>('/api/v1/settings/sonarr');
  const { data: dataMain, mutate: revalidateMain } = useSWR<MainSettings>(
    '/api/v1/settings/main'
  );
  const [editRadarrModal, setEditRadarrModal] = useState<{
    open: boolean;
    radarr: RadarrSettings | null;
  }>({
    open: false,
    radarr: null,
  });
  const [editSonarrModal, setEditSonarrModal] = useState<{
    open: boolean;
    sonarr: SonarrSettings | null;
  }>({
    open: false,
    sonarr: null,
  });
  const [deleteServerModal, setDeleteServerModal] = useState<{
    open: boolean;
    type: 'radarr' | 'sonarr';
    serverId: number | null;
  }>({
    open: false,
    type: 'radarr',
    serverId: null,
  });

  const { data: dataOverseerr, mutate: revalidateOverseerr } =
    useSWR<OverseerrSettings>('/api/v1/settings/overseerr');

  const deleteServer = async () => {
    await axios.delete(
      `/api/v1/settings/${deleteServerModal.type}/${deleteServerModal.serverId}`
    );
    setDeleteServerModal({ open: false, serverId: null, type: 'radarr' });
    revalidateRadarr();
    revalidateSonarr();
    mutate('/api/v1/settings/public');
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.downloads),
          intl.formatMessage(globalMessages.settings),
        ]}
      />

      <div className="mb-6">
        <h3 className="heading">{intl.formatMessage(messages.downloads)}</h3>
        <p className="description">
          {intl.formatMessage(messages.downloadsDescription)}
        </p>
        {!!onComplete && (
          <div className="section">
            <Alert
              title="You only need Overseerr (Recommended) or Radarr/Sonarr to grab missing items, but you can configure both for more flexibility across Collections."
              type="info"
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {editRadarrModal.open && (
        <RadarrModal
          radarr={editRadarrModal.radarr}
          onClose={() => setEditRadarrModal({ open: false, radarr: null })}
          onSave={() => {
            revalidateRadarr();
            mutate('/api/v1/settings/public');
            setEditRadarrModal({ open: false, radarr: null });
          }}
        />
      )}
      {editSonarrModal.open && (
        <SonarrModal
          sonarr={editSonarrModal.sonarr}
          onClose={() => setEditSonarrModal({ open: false, sonarr: null })}
          onSave={() => {
            revalidateSonarr();
            mutate('/api/v1/settings/public');
            setEditSonarrModal({ open: false, sonarr: null });
          }}
        />
      )}
      <Transition
        as={Fragment}
        show={deleteServerModal.open}
        enter="transition-opacity ease-in-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity ease-in-out duration-300"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <Modal
          okText={intl.formatMessage(globalMessages.delete)}
          okButtonType="danger"
          onOk={() => deleteServer()}
          onCancel={() =>
            setDeleteServerModal({
              open: false,
              serverId: null,
              type: 'radarr',
            })
          }
          title={intl.formatMessage(messages.deleteServer, {
            serverType:
              deleteServerModal.type === 'radarr' ? 'Radarr' : 'Sonarr',
          })}
        >
          {intl.formatMessage(messages.deleteserverconfirm)}
        </Modal>
      </Transition>

      {/* Modals */}
      {editOverseerrModal.open && (
        <OverseerrModal
          overseerr={dataOverseerr || null}
          onClose={() => setEditOverseerrModal({ open: false })}
          onSave={() => {
            revalidateOverseerr();
            mutate('/api/v1/settings/public');
            setEditOverseerrModal({ open: false });
          }}
        />
      )}

      {/* Overseerr Settings */}
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.overseerrSettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.overseerrSettingsDescription)}
        </p>
      </div>
      <div className="section">
        <ul className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {dataOverseerr?.hostname ? (
            <ServerInstance
              key="overseerr-config"
              name="Overseerr"
              hostname={dataOverseerr.hostname}
              port={dataOverseerr.port || 5055}
              isOverseerr={true}
              externalUrl={dataOverseerr.externalUrl}
              onEdit={() => setEditOverseerrModal({ open: true })}
              onDelete={() => {
                // We can't actually delete Overseerr, just clear the settings
                // For now, disable the delete button by not providing the handler
              }}
            />
          ) : (
            <li className="col-span-1 rounded-lg border-2 border-dashed border-stone-400 shadow">
              <div className="flex h-full w-full items-center justify-center">
                <Button
                  buttonType="ghost"
                  onClick={() => setEditOverseerrModal({ open: true })}
                >
                  <PlusIcon />
                  <span>{intl.formatMessage(messages.addoverseerr)}</span>
                </Button>
              </div>
            </li>
          )}
        </ul>
      </div>

      {/* Radarr Settings */}
      <div className="mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.radarrsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.serviceSettingsDescription, {
            serverType: 'Radarr',
          })}
        </p>
      </div>
      <div className="section">
        {!radarrData && !radarrError && <LoadingSpinner />}
        {radarrData && !radarrError && (
          <>
            {radarrData.length > 0 &&
              (!radarrData.some((radarr) => radarr.isDefault) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'Radarr',
                    mediaType: intl.formatMessage(messages.mediaTypeMovie),
                  })}
                />
              ) : !radarrData.some(
                  (radarr) => radarr.isDefault && !radarr.is4k
                ) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultNon4kServer, {
                    serverType: 'Radarr',
                    strong: (msg: React.ReactNode) => (
                      <strong className="font-semibold text-white">
                        {msg}
                      </strong>
                    ),
                  })}
                />
              ) : (
                radarrData.some((radarr) => radarr.is4k) &&
                !radarrData.some(
                  (radarr) => radarr.isDefault && radarr.is4k
                ) && (
                  <Alert
                    title={intl.formatMessage(messages.noDefault4kServer, {
                      serverType: 'Radarr',
                      mediaType: intl.formatMessage(messages.mediaTypeMovie),
                    })}
                  />
                )
              ))}
            <ul className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
              {radarrData.map((radarr) => (
                <ServerInstance
                  key={`radarr-config-${radarr.id}`}
                  name={radarr.name || `${radarr.hostname}:${radarr.port}`}
                  hostname={radarr.hostname}
                  port={radarr.port}
                  isSSL={radarr.useSsl}
                  isDefault={radarr.isDefault}
                  is4k={radarr.is4k}
                  externalUrl={radarr.externalUrl}
                  onEdit={() => setEditRadarrModal({ open: true, radarr })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: radarr.id,
                      type: 'radarr',
                    })
                  }
                />
              ))}
              <li className="col-span-1 rounded-lg border-2 border-dashed border-stone-400 shadow">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="ghost"
                    onClick={() =>
                      setEditRadarrModal({ open: true, radarr: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addradarr)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>

      {/* Sonarr Settings */}
      <div className="mt-10 mb-6">
        <h3 className="heading">
          {intl.formatMessage(messages.sonarrsettings)}
        </h3>
        <p className="description">
          {intl.formatMessage(messages.serviceSettingsDescription, {
            serverType: 'Sonarr',
          })}
        </p>
      </div>
      <div className="section">
        {!sonarrData && !sonarrError && <LoadingSpinner />}
        {sonarrData && !sonarrError && (
          <>
            {sonarrData.length > 0 &&
              (!sonarrData.some((sonarr) => sonarr.isDefault) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultServer, {
                    serverType: 'Sonarr',
                    mediaType: intl.formatMessage(messages.mediaTypeSeries),
                  })}
                />
              ) : !sonarrData.some(
                  (sonarr) => sonarr.isDefault && !sonarr.is4k
                ) ? (
                <Alert
                  title={intl.formatMessage(messages.noDefaultNon4kServer, {
                    serverType: 'Sonarr',
                    strong: (msg: React.ReactNode) => (
                      <strong className="font-semibold text-white">
                        {msg}
                      </strong>
                    ),
                  })}
                />
              ) : (
                sonarrData.some((sonarr) => sonarr.is4k) &&
                !sonarrData.some(
                  (sonarr) => sonarr.isDefault && sonarr.is4k
                ) && (
                  <Alert
                    title={intl.formatMessage(messages.noDefault4kServer, {
                      serverType: 'Sonarr',
                      mediaType: intl.formatMessage(messages.mediaTypeSeries),
                    })}
                  />
                )
              ))}
            <ul className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
              {sonarrData.map((sonarr) => (
                <ServerInstance
                  key={`sonarr-config-${sonarr.id}`}
                  name={sonarr.name || `${sonarr.hostname}:${sonarr.port}`}
                  hostname={sonarr.hostname}
                  port={sonarr.port}
                  isSSL={sonarr.useSsl}
                  isDefault={sonarr.isDefault}
                  is4k={sonarr.is4k}
                  isSonarr={true}
                  externalUrl={sonarr.externalUrl}
                  onEdit={() => setEditSonarrModal({ open: true, sonarr })}
                  onDelete={() =>
                    setDeleteServerModal({
                      open: true,
                      serverId: sonarr.id,
                      type: 'sonarr',
                    })
                  }
                />
              ))}
              <li className="col-span-1 rounded-lg border-2 border-dashed border-stone-400 shadow">
                <div className="flex h-full w-full items-center justify-center">
                  <Button
                    buttonType="ghost"
                    onClick={() =>
                      setEditSonarrModal({ open: true, sonarr: null })
                    }
                  >
                    <PlusIcon />
                    <span>{intl.formatMessage(messages.addsonarr)}</span>
                  </Button>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>

      {/* Placeholder Root Folders Settings */}
      <div className="section">
        <div className="mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.placeholderSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.placeholderSettingsDescription)}
          </p>
        </div>
        <Formik
          initialValues={{
            placeholderMovieRootFolder:
              dataMain?.placeholderMovieRootFolder || '',
            placeholderTVRootFolder: dataMain?.placeholderTVRootFolder || '',
          }}
          enableReinitialize
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/main', {
                placeholderMovieRootFolder: values.placeholderMovieRootFolder,
                placeholderTVRootFolder: values.placeholderTVRootFolder,
              });

              addToast(
                intl.formatMessage(messages.toastPlaceholderSettingsSuccess),
                {
                  appearance: 'success',
                  autoDismiss: true,
                }
              );
            } catch (e) {
              addToast(
                intl.formatMessage(messages.toastPlaceholderSettingsFailure),
                {
                  appearance: 'error',
                  autoDismiss: true,
                }
              );
            } finally {
              revalidateMain();
            }
          }}
        >
          {({ values, handleSubmit, setFieldValue, isSubmitting }) => (
            <form className="section" onSubmit={handleSubmit}>
              {/* Folder Browser Modals */}
              {folderBrowser.isOpen && folderBrowser.type === 'movie' && (
                <FolderBrowser
                  isOpen={true}
                  onClose={() =>
                    setFolderBrowser({ isOpen: false, type: null })
                  }
                  onSelect={(path) => {
                    setFieldValue('placeholderMovieRootFolder', path);
                  }}
                  initialPath={values.placeholderMovieRootFolder || '/'}
                  title={intl.formatMessage(
                    messages.placeholderMovieRootFolder
                  )}
                />
              )}
              {folderBrowser.isOpen && folderBrowser.type === 'tv' && (
                <FolderBrowser
                  isOpen={true}
                  onClose={() =>
                    setFolderBrowser({ isOpen: false, type: null })
                  }
                  onSelect={(path) => {
                    setFieldValue('placeholderTVRootFolder', path);
                  }}
                  initialPath={values.placeholderTVRootFolder || '/'}
                  title={intl.formatMessage(messages.placeholderTVRootFolder)}
                />
              )}

              {/* Movie Root Folder */}
              <div className="form-row">
                <label
                  htmlFor="placeholderMovieRootFolder"
                  className="text-label"
                >
                  {intl.formatMessage(messages.placeholderMovieRootFolder)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.placeholderMovieRootFolderTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="flex space-x-2">
                    <div className="form-input-field flex-1">
                      <Field
                        id="placeholderMovieRootFolder"
                        name="placeholderMovieRootFolder"
                        type="text"
                        placeholder="/data/media/movies"
                      />
                    </div>
                    <Button
                      buttonType="default"
                      type="button"
                      onClick={() =>
                        setFolderBrowser({ isOpen: true, type: 'movie' })
                      }
                    >
                      <FolderIcon className="h-5 w-5" />
                      <span>{intl.formatMessage(messages.browse)}</span>
                    </Button>
                  </div>
                </div>
              </div>

              {/* TV Root Folder */}
              <div className="form-row">
                <label htmlFor="placeholderTVRootFolder" className="text-label">
                  {intl.formatMessage(messages.placeholderTVRootFolder)}
                  <span className="label-tip">
                    {intl.formatMessage(messages.placeholderTVRootFolderTip)}
                  </span>
                </label>
                <div className="form-input-area">
                  <div className="flex space-x-2">
                    <div className="form-input-field flex-1">
                      <Field
                        id="placeholderTVRootFolder"
                        name="placeholderTVRootFolder"
                        type="text"
                        placeholder="/data/media/tv"
                      />
                    </div>
                    <Button
                      buttonType="default"
                      type="button"
                      onClick={() =>
                        setFolderBrowser({ isOpen: true, type: 'tv' })
                      }
                    >
                      <FolderIcon className="h-5 w-5" />
                      <span>{intl.formatMessage(messages.browse)}</span>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="actions">
                <div className="flex justify-end">
                  <span className="inline-flex rounded-md shadow-sm">
                    <Button
                      buttonType="primary"
                      type="submit"
                      disabled={isSubmitting}
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
          )}
        </Formik>
      </div>
    </>
  );
};

export default SettingsDownloads;
