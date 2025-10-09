import Modal from '@app/components/Common/Modal';
import type { RadarrSettings } from '@server/lib/settings';
import axios from 'axios';
import type React from 'react';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  radarrOptions: 'Radarr Download Options',
  radarrOptionsDescription: 'Configure download settings for this movie',
  selectServer: 'Select Server',
  selectProfile: 'Select Quality Profile',
  selectRootFolder: 'Select Root Folder',
  download: 'Download',
  cancel: 'Cancel',
  loading: 'Loading...',
  serverPlaceholder: 'Choose a Radarr server...',
  profilePlaceholder: 'Choose a quality profile...',
  rootFolderPlaceholder: 'Choose a root folder...',
  selectServerFirst: 'Select a server first',
});

interface RadarrOptionsModalProps {
  tmdbId: number;
  title: string;
  backdropPath?: string;
  onCancel: () => void;
  onConfirm: (serverId: number, profileId: number, rootFolder: string) => void;
}

const RadarrOptionsModal: React.FC<RadarrOptionsModalProps> = ({
  tmdbId,
  title,
  backdropPath: cachedBackdropPath,
  onCancel,
  onConfirm,
}) => {
  const intl = useIntl();
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null
  );
  const [selectedRootFolder, setSelectedRootFolder] = useState<string | null>(
    null
  );
  const [backdropPath, setBackdropPath] = useState<string | undefined>(
    cachedBackdropPath
  );

  // Fetch movie details for backdrop - only if we don't have cached backdrop
  useEffect(() => {
    if (cachedBackdropPath) {
      return; // Already have cached backdrop
    }

    const fetchMovieBackdrop = async () => {
      try {
        const response = await axios.get(`/api/v1/movie/${tmdbId}`);

        if (response.data.backdrop_path) {
          setBackdropPath(response.data.backdrop_path);
        }
      } catch (error) {
        // Failed to fetch backdrop - will show without backdrop
      }
    };

    fetchMovieBackdrop();
  }, [tmdbId, cachedBackdropPath]);

  // Fetch Radarr servers
  const { data: radarrServers, isLoading: serversLoading } = useSWR<
    RadarrSettings[]
  >('/api/v1/settings/radarr');

  // Set default server (if only one or if one is marked as default)
  useEffect(() => {
    if (radarrServers && !selectedServerId) {
      if (radarrServers.length === 1) {
        setSelectedServerId(radarrServers[0].id);
      } else {
        const defaultServer = radarrServers.find((s) => s.isDefault);
        if (defaultServer) {
          setSelectedServerId(defaultServer.id);
        }
      }
    }
  }, [radarrServers, selectedServerId]);

  // Fetch profiles for selected server
  const { data: profiles, isLoading: profilesLoading } = useSWR<
    { id: number; name: string }[]
  >(
    selectedServerId !== null
      ? `/api/v1/settings/radarr/${selectedServerId}/profiles`
      : null
  );

  // Fetch root folders for selected server
  const { data: rootFolders, isLoading: rootFoldersLoading } = useSWR<
    { id: number; path: string }[]
  >(
    selectedServerId !== null
      ? `/api/v1/settings/radarr/${selectedServerId}/rootfolders`
      : null
  );

  // Auto-select first profile and root folder when they load
  useEffect(() => {
    if (profiles && profiles.length > 0 && !selectedProfileId) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (rootFolders && rootFolders.length > 0 && !selectedRootFolder) {
      setSelectedRootFolder(rootFolders[0].path);
    }
  }, [rootFolders, selectedRootFolder]);

  const handleConfirm = () => {
    if (selectedServerId && selectedProfileId && selectedRootFolder) {
      onConfirm(selectedServerId, selectedProfileId, selectedRootFolder);
    }
  };

  const isValid =
    selectedServerId !== null &&
    selectedProfileId !== null &&
    selectedRootFolder !== null;

  return (
    <Modal
      title={intl.formatMessage(messages.radarrOptions)}
      subTitle={title}
      onCancel={onCancel}
      cancelText={intl.formatMessage(messages.cancel)}
      onOk={handleConfirm}
      okText={intl.formatMessage(messages.download)}
      okDisabled={!isValid}
      backdrop={
        backdropPath
          ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${backdropPath}`
          : undefined
      }
    >
      <div className="space-y-4">
        {/* Server Selection - only show if multiple servers */}
        {radarrServers && radarrServers.length > 1 && (
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {intl.formatMessage(messages.selectServer)}
            </label>
            <select
              value={selectedServerId !== null ? String(selectedServerId) : ''}
              onChange={(e) => {
                setSelectedServerId(Number(e.target.value));
                setSelectedProfileId(null);
                setSelectedRootFolder(null);
              }}
              className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
              disabled={serversLoading}
            >
              <option value="">
                {intl.formatMessage(messages.serverPlaceholder)}
              </option>
              {radarrServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name || `${server.hostname}:${server.port}`}
                  {server.isDefault && ' (Default)'}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Quality Profile Selection */}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-300">
            {intl.formatMessage(messages.selectProfile)}
          </label>
          <select
            value={selectedProfileId || ''}
            onChange={(e) => setSelectedProfileId(Number(e.target.value))}
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            disabled={selectedServerId === null || profilesLoading}
          >
            <option value="">
              {selectedServerId === null
                ? intl.formatMessage(messages.selectServerFirst)
                : profilesLoading
                ? intl.formatMessage(messages.loading)
                : intl.formatMessage(messages.profilePlaceholder)}
            </option>
            {profiles?.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>

        {/* Root Folder Selection */}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-300">
            {intl.formatMessage(messages.selectRootFolder)}
          </label>
          <select
            value={selectedRootFolder || ''}
            onChange={(e) => setSelectedRootFolder(e.target.value)}
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            disabled={selectedServerId === null || rootFoldersLoading}
          >
            <option value="">
              {selectedServerId === null
                ? intl.formatMessage(messages.selectServerFirst)
                : rootFoldersLoading
                ? intl.formatMessage(messages.loading)
                : intl.formatMessage(messages.rootFolderPlaceholder)}
            </option>
            {rootFolders?.map((folder) => (
              <option key={folder.id} value={folder.path}>
                {folder.path}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
};

export default RadarrOptionsModal;
