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
import WatchlistSyncSettings from '@app/components/Settings/WatchlistSyncSettings';
import globalMessages from '@app/i18n/globalMessages';
import { Transition } from '@headlessui/react';
import { ArrowDownOnSquareIcon, FolderIcon } from '@heroicons/react/24/outline';
import { PencilIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid';
import type {
  MainSettings,
  OverseerrSettings,
  PlexSettings,
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
    'Grab missing items automatically using Radarr, Sonarr, or Seerr.',
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
  addoverseerr: 'Add Seerr Connection',
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
  overseerrSettings: 'Seerr Settings',
  overseerrSettingsDescription:
    'Configure connection to add missing items as Requests in Seerr.',
  save: 'Save Changes',
  saving: 'Saving…',
  placeholderSettings: 'Placeholder Root Folders',
  placeholderSettingsDescription:
    'Configure root folders for placeholder files for each library. These paths should match the mounted Plex library paths inside the Agregarr container.',
  libraryPlaceholderFolder: 'Placeholder Folder for {libraryName}',
  libraryPlaceholderFolderTip:
    'Path where placeholder files will be created for this library',
  browse: 'Browse',
  toastPlaceholderSettingsSuccess: 'Placeholder settings saved successfully!',
  toastPlaceholderSettingsFailure:
    'Something went wrong while saving placeholder settings.',
  youtubeSettings: 'YouTube Cookie Configuration',
  youtubeSettingsDescription:
    'Recommended: Set up YouTube cookies to prevent bot detection and IP bans when downloading trailers for placeholder feature. Once banned, adding cookies may not be enough to unban you (from downloading youtube videos without being signed in)',
  firefoxExtension: 'Firefox',
  chromeExtension: 'Chrome',
  youtubeCookiesNotFound: 'YouTube cookies file not found',
  youtubeCookiesNotFoundMessage:
    'The {cookiesPath} file was not found in your config directory. Without this file, YouTube trailer downloads may fail due to bot detection.',
  youtubeCookiesFound: 'YouTube cookies file found',
  youtubeCookiesFoundMessage:
    'The {cookiesPath} file is configured and will be used for YouTube trailer downloads.',
  youtubeCookiesFoundButDisabled:
    'YouTube cookies are configured, but YouTube trailer downloads are disabled below',
  youtubeCookiesFoundButDisabledMessage:
    'The {cookiesPath} file is configured, but the "Skip YouTube Trailer Downloads" option is enabled. YouTube trailers will not be downloaded even though cookies are available.',
  youtubeSetupInstructionsTitle: 'Setup Instructions:',
  youtubeSetupStep1:
    'Install a browser extension to export cookies: {firefoxLink} / {chromeLink}',
  youtubeSetupStep2: 'Visit YouTube while logged in to your account',
  youtubeSetupStep3:
    'Export cookies and save as {cookiesPath} in your Agregarr config directory',
  noLibrariesFound: 'No libraries found. Configure your Plex connection first.',
  skipYoutubeTrailerDownloads: 'Skip YouTube Trailer Downloads',
  skipYoutubeTrailerDownloadsDescription:
    'Use only the hardcoded placeholder video instead of downloading YouTube trailers. This dramatically speeds up placeholder creation, but placeholders will use a generic video instead of actual trailers.',
  toastYoutubeSettingsSuccess: 'YouTube settings saved successfully!',
  toastYoutubeSettingsFailure:
    'Something went wrong while saving YouTube settings.',
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
              alt="Seerr"
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
    libraryKey: string | null;
  }>({ isOpen: false, type: null, libraryKey: null });
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
  const { data: plexSettings } = useSWR<PlexSettings>('/api/v1/settings/plex');
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
    type: 'radarr' | 'sonarr' | 'overseerr';
    serverId: number | null;
  }>({
    open: false,
    type: 'radarr',
    serverId: null,
  });

  const { data: dataOverseerr, mutate: revalidateOverseerr } =
    useSWR<OverseerrSettings>('/api/v1/settings/overseerr');

  const { data: youtubeCookiesStatus } = useSWR<{ exists: boolean }>(
    '/api/v1/settings/youtube-cookies-status'
  );

  const deleteServer = async () => {
    if (deleteServerModal.type === 'overseerr') {
      await axios.delete('/api/v1/settings/overseerr');
      setDeleteServerModal({ open: false, serverId: null, type: 'radarr' });
      revalidateOverseerr();
      mutate('/api/v1/settings/public');
    } else {
      await axios.delete(
        `/api/v1/settings/${deleteServerModal.type}/${deleteServerModal.serverId}`
      );
      setDeleteServerModal({ open: false, serverId: null, type: 'radarr' });
      revalidateRadarr();
      revalidateSonarr();
      mutate('/api/v1/settings/public');
    }
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
              title="You only need Seerr (Recommended) or Radarr/Sonarr to grab missing items, but you can configure both for more flexibility across Collections."
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
              deleteServerModal.type === 'radarr'
                ? 'Radarr'
                : deleteServerModal.type === 'sonarr'
                ? 'Sonarr'
                : 'Seerr',
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
        <h3 className="heading flex items-center">
          <img src="/services/overseerr.svg" alt="" className="mr-2 h-7 w-7" />
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
              name="Seerr"
              hostname={dataOverseerr.hostname}
              port={dataOverseerr.port || 5055}
              isOverseerr={true}
              externalUrl={dataOverseerr.externalUrl}
              onEdit={() => setEditOverseerrModal({ open: true })}
              onDelete={() =>
                setDeleteServerModal({
                  open: true,
                  serverId: null,
                  type: 'overseerr',
                })
              }
            />
          ) : (
            <li className="col-span-1 min-h-[160px] rounded-lg border-2 border-dashed border-stone-400 shadow">
              <button
                onClick={() => setEditOverseerrModal({ open: true })}
                className="flex h-full w-full items-center justify-center gap-2 text-stone-400 transition hover:text-white"
              >
                <PlusIcon className="h-6 w-6" />
                <span>{intl.formatMessage(messages.addoverseerr)}</span>
              </button>
            </li>
          )}
        </ul>
      </div>

      {/* Radarr Settings */}
      <div className="mb-6">
        <h3 className="heading flex items-center">
          <img src="/services/radarr.svg" alt="" className="mr-2 h-7 w-7" />
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
              <li className="col-span-1 min-h-[160px] rounded-lg border-2 border-dashed border-stone-400 shadow">
                <button
                  onClick={() =>
                    setEditRadarrModal({ open: true, radarr: null })
                  }
                  className="flex h-full w-full items-center justify-center gap-2 text-stone-400 transition hover:text-white"
                >
                  <PlusIcon className="h-6 w-6" />
                  <span>{intl.formatMessage(messages.addradarr)}</span>
                </button>
              </li>
            </ul>
          </>
        )}
      </div>

      {/* Sonarr Settings */}
      <div className="mt-10 mb-6">
        <h3 className="heading flex items-center">
          <img src="/services/sonarr.svg" alt="" className="mr-2 h-7 w-7" />
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
              <li className="col-span-1 min-h-[160px] rounded-lg border-2 border-dashed border-stone-400 shadow">
                <button
                  onClick={() =>
                    setEditSonarrModal({ open: true, sonarr: null })
                  }
                  className="flex h-full w-full items-center justify-center gap-2 text-stone-400 transition hover:text-white"
                >
                  <PlusIcon className="h-6 w-6" />
                  <span>{intl.formatMessage(messages.addsonarr)}</span>
                </button>
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
            placeholderMovieRootFolders:
              dataMain?.placeholderMovieRootFolders || {},
            placeholderTVRootFolders: dataMain?.placeholderTVRootFolders || {},
          }}
          enableReinitialize
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/main', {
                placeholderMovieRootFolders: values.placeholderMovieRootFolders,
                placeholderTVRootFolders: values.placeholderTVRootFolders,
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
              {/* Folder Browser Modal */}
              {folderBrowser.isOpen && folderBrowser.libraryKey && (
                <FolderBrowser
                  isOpen={true}
                  onClose={() =>
                    setFolderBrowser({
                      isOpen: false,
                      type: null,
                      libraryKey: null,
                    })
                  }
                  onSelect={(path) => {
                    if (folderBrowser.libraryKey) {
                      const fieldName =
                        folderBrowser.type === 'movie'
                          ? 'placeholderMovieRootFolders'
                          : 'placeholderTVRootFolders';
                      setFieldValue(fieldName, {
                        ...values[fieldName],
                        [folderBrowser.libraryKey]: path,
                      });
                    }
                  }}
                  initialPath={
                    folderBrowser.libraryKey
                      ? (folderBrowser.type === 'movie'
                          ? values.placeholderMovieRootFolders?.[
                              folderBrowser.libraryKey
                            ]
                          : values.placeholderTVRootFolders?.[
                              folderBrowser.libraryKey
                            ]) || '/'
                      : '/'
                  }
                  title={
                    folderBrowser.libraryKey
                      ? intl.formatMessage(messages.libraryPlaceholderFolder, {
                          libraryName:
                            plexSettings?.libraries.find(
                              (lib) => lib.key === folderBrowser.libraryKey
                            )?.name || folderBrowser.libraryKey,
                        })
                      : 'Browse'
                  }
                />
              )}

              {/* Per-Library Configuration */}
              {plexSettings?.libraries && plexSettings.libraries.length > 0 ? (
                <div className="space-y-4">
                  {plexSettings.libraries
                    .filter(
                      (lib) => lib.type === 'movie' || lib.type === 'show'
                    )
                    .map((library) => {
                      const isMovie = library.type === 'movie';
                      const fieldName = isMovie
                        ? 'placeholderMovieRootFolders'
                        : 'placeholderTVRootFolders';
                      const currentValue =
                        (isMovie
                          ? values.placeholderMovieRootFolders?.[library.key]
                          : values.placeholderTVRootFolders?.[library.key]) ||
                        '';

                      return (
                        <div key={library.key} className="form-row">
                          <label
                            htmlFor={`placeholder-${library.key}`}
                            className="text-label"
                          >
                            {intl.formatMessage(
                              messages.libraryPlaceholderFolder,
                              {
                                libraryName: library.name,
                              }
                            )}
                            <span className="label-tip">
                              {intl.formatMessage(
                                messages.libraryPlaceholderFolderTip
                              )}
                            </span>
                          </label>
                          <div className="form-input-area">
                            <div className="flex space-x-2">
                              <div className="form-input-field flex-1">
                                <Field
                                  id={`placeholder-${library.key}`}
                                  name={`${fieldName}.${library.key}`}
                                  type="text"
                                  placeholder={
                                    isMovie
                                      ? '/data/media/movies'
                                      : '/data/media/tv'
                                  }
                                  value={currentValue}
                                  onChange={(
                                    e: React.ChangeEvent<HTMLInputElement>
                                  ) => {
                                    setFieldValue(fieldName, {
                                      ...values[fieldName],
                                      [library.key]: e.target.value,
                                    });
                                  }}
                                />
                              </div>
                              <Button
                                buttonType="default"
                                type="button"
                                onClick={() =>
                                  setFolderBrowser({
                                    isOpen: true,
                                    type:
                                      library.type === 'movie' ? 'movie' : 'tv',
                                    libraryKey: library.key,
                                  })
                                }
                              >
                                <FolderIcon className="h-5 w-5" />
                                <span>
                                  {intl.formatMessage(messages.browse)}
                                </span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="text-sm text-stone-400">
                  {intl.formatMessage(messages.noLibrariesFound)}
                </div>
              )}

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

      {/* YouTube Settings */}
      <div className="section">
        <div className="mb-6">
          <h3 className="heading">
            {intl.formatMessage(messages.youtubeSettings)}
          </h3>
          <p className="description">
            {intl.formatMessage(messages.youtubeSettingsDescription)}
          </p>
        </div>
        {youtubeCookiesStatus && !youtubeCookiesStatus.exists && (
          <Alert
            title={intl.formatMessage(messages.youtubeCookiesNotFound)}
            type="warning"
          >
            <p>
              {intl.formatMessage(messages.youtubeCookiesNotFoundMessage, {
                cookiesPath: (
                  <code className="rounded bg-stone-700 px-1 py-0.5 font-mono text-sm">
                    youtube-cookies.txt
                  </code>
                ),
              })}
            </p>
          </Alert>
        )}
        {youtubeCookiesStatus && youtubeCookiesStatus.exists && (
          <div className="mb-4 rounded-md bg-stone-800 p-4 ring-1 ring-stone-600">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className={`h-5 w-5 ${
                    dataMain?.skipYoutubeTrailerDownloads
                      ? 'text-yellow-400'
                      : 'text-green-400'
                  }`}
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  {dataMain?.skipYoutubeTrailerDownloads ? (
                    <path
                      fillRule="evenodd"
                      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                      clipRule="evenodd"
                    />
                  ) : (
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  )}
                </svg>
              </div>
              <div className="ml-3 flex-1">
                <p
                  className={`text-sm font-medium ${
                    dataMain?.skipYoutubeTrailerDownloads
                      ? 'text-yellow-300'
                      : 'text-stone-300'
                  }`}
                >
                  {intl.formatMessage(
                    dataMain?.skipYoutubeTrailerDownloads
                      ? messages.youtubeCookiesFoundButDisabled
                      : messages.youtubeCookiesFound
                  )}
                </p>
                <p
                  className={`mt-1 text-sm ${
                    dataMain?.skipYoutubeTrailerDownloads
                      ? 'text-yellow-200'
                      : 'text-stone-400'
                  }`}
                >
                  {intl.formatMessage(
                    dataMain?.skipYoutubeTrailerDownloads
                      ? messages.youtubeCookiesFoundButDisabledMessage
                      : messages.youtubeCookiesFoundMessage,
                    {
                      cookiesPath: (
                        <code
                          className={`rounded px-1 py-0.5 font-mono text-sm ${
                            dataMain?.skipYoutubeTrailerDownloads
                              ? 'bg-yellow-950'
                              : 'bg-stone-700'
                          }`}
                        >
                          youtube-cookies.txt
                        </code>
                      ),
                    }
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* YouTube Trailer Download Toggle */}
        <Formik
          initialValues={{
            skipYoutubeTrailerDownloads:
              dataMain?.skipYoutubeTrailerDownloads || false,
          }}
          enableReinitialize
          onSubmit={async (values) => {
            try {
              await axios.post('/api/v1/settings/main', {
                skipYoutubeTrailerDownloads: values.skipYoutubeTrailerDownloads,
              });

              addToast(
                intl.formatMessage(messages.toastYoutubeSettingsSuccess),
                {
                  appearance: 'success',
                  autoDismiss: true,
                }
              );
            } catch (e) {
              addToast(
                intl.formatMessage(messages.toastYoutubeSettingsFailure),
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
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <label
                  htmlFor="skipYoutubeTrailerDownloads"
                  className="checkbox-label"
                >
                  <span className="mr-2">
                    {intl.formatMessage(messages.skipYoutubeTrailerDownloads)}
                  </span>
                  <span className="label-tip">
                    {intl.formatMessage(
                      messages.skipYoutubeTrailerDownloadsDescription
                    )}
                  </span>
                </label>
                <div className="form-input-area">
                  <Field
                    type="checkbox"
                    id="skipYoutubeTrailerDownloads"
                    name="skipYoutubeTrailerDownloads"
                    checked={values.skipYoutubeTrailerDownloads}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setFieldValue(
                        'skipYoutubeTrailerDownloads',
                        e.target.checked
                      );
                    }}
                  />
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

        <div className="space-y-3 text-sm text-stone-400">
          <p className="font-medium text-stone-300">
            {intl.formatMessage(messages.youtubeSetupInstructionsTitle)}
          </p>
          <ol className="ml-4 list-decimal space-y-2">
            <li>
              {intl.formatMessage(messages.youtubeSetupStep1, {
                firefoxLink: (
                  <a
                    href="https://addons.mozilla.org/en-US/firefox/addon/export-cookies-txt/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-500 hover:underline"
                  >
                    {intl.formatMessage(messages.firefoxExtension)}
                  </a>
                ),
                chromeLink: (
                  <a
                    href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-500 hover:underline"
                  >
                    {intl.formatMessage(messages.chromeExtension)}
                  </a>
                ),
              })}
            </li>
            <li>{intl.formatMessage(messages.youtubeSetupStep2)}</li>
            <li>
              {intl.formatMessage(messages.youtubeSetupStep3, {
                cookiesPath: (
                  <code className="rounded bg-stone-700 px-1 py-0.5 font-mono text-sm">
                    youtube-cookies.txt
                  </code>
                ),
              })}
            </li>
          </ol>
        </div>
      </div>

      {/* Plex Watchlist Sync Settings */}
      <WatchlistSyncSettings />
    </>
  );
};

export default SettingsDownloads;
