import Modal from '@app/components/Common/Modal';
import type { SonarrSettings } from '@server/lib/settings';
import axios from 'axios';
import type React from 'react';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  selectSeasons: 'Select Seasons',
  selectSeasonsDescription: 'Choose which seasons to download',
  season: 'Season {seasonNumber}',
  download: 'Download',
  cancel: 'Cancel',
  loadingSeasons: 'Loading seasons...',
  selectAll: 'Select All',
  deselectAll: 'Deselect All',
  selectServer: 'Select Server',
  selectProfile: 'Select Quality Profile',
  selectRootFolder: 'Select Root Folder',
  loading: 'Loading...',
  serverPlaceholder: 'Choose a Sonarr server...',
  profilePlaceholder: 'Choose a quality profile...',
  rootFolderPlaceholder: 'Choose a root folder...',
  selectServerFirst: 'Select a server first',
  sonarrOptions: 'Sonarr Download Options',
});

interface SeasonSelectionModalProps {
  tmdbId: number;
  title: string;
  service: 'overseerr' | 'sonarr';
  onCancel: () => void;
  onConfirm: (
    selectedSeasons: number[],
    serverId?: number,
    profileId?: number,
    rootFolder?: string
  ) => void;
}

interface Season {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  air_date?: string;
}

const SeasonSelectionModal: React.FC<SeasonSelectionModalProps> = ({
  tmdbId,
  title,
  service,
  onCancel,
  onConfirm,
}) => {
  const intl = useIntl();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(
    new Set()
  );
  const [loading, setLoading] = useState(true);

  // Sonarr options (only for sonarr service)
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null
  );
  const [selectedRootFolder, setSelectedRootFolder] = useState<string | null>(
    null
  );

  // Fetch Sonarr servers (only if service is sonarr)
  const { data: sonarrServers, isLoading: serversLoading } = useSWR<
    SonarrSettings[]
  >(service === 'sonarr' ? '/api/v1/settings/sonarr' : null);

  // Set default server for Sonarr
  useEffect(() => {
    if (service === 'sonarr' && sonarrServers && !selectedServerId) {
      if (sonarrServers.length === 1) {
        setSelectedServerId(sonarrServers[0].id);
      } else {
        const defaultServer = sonarrServers.find((s) => s.isDefault);
        if (defaultServer) {
          setSelectedServerId(defaultServer.id);
        }
      }
    }
  }, [service, sonarrServers, selectedServerId]);

  // Fetch profiles for selected Sonarr server
  const { data: sonarrProfiles, isLoading: profilesLoading } = useSWR<
    { id: number; name: string }[]
  >(
    service === 'sonarr' && selectedServerId
      ? `/api/v1/settings/sonarr/${selectedServerId}/profiles`
      : null
  );

  // Fetch root folders for selected Sonarr server
  const { data: sonarrRootFolders, isLoading: rootFoldersLoading } = useSWR<
    { id: number; path: string }[]
  >(
    service === 'sonarr' && selectedServerId
      ? `/api/v1/settings/sonarr/${selectedServerId}/rootfolders`
      : null
  );

  // Auto-select first profile and root folder for Sonarr
  useEffect(() => {
    if (
      service === 'sonarr' &&
      sonarrProfiles &&
      sonarrProfiles.length > 0 &&
      !selectedProfileId
    ) {
      setSelectedProfileId(sonarrProfiles[0].id);
    }
  }, [service, sonarrProfiles, selectedProfileId]);

  useEffect(() => {
    if (
      service === 'sonarr' &&
      sonarrRootFolders &&
      sonarrRootFolders.length > 0 &&
      !selectedRootFolder
    ) {
      setSelectedRootFolder(sonarrRootFolders[0].path);
    }
  }, [service, sonarrRootFolders, selectedRootFolder]);

  useEffect(() => {
    const fetchSeasons = async () => {
      try {
        setLoading(true);
        const response = await axios.get(
          `https://api.themoviedb.org/3/tv/${tmdbId}`,
          {
            params: {
              api_key: 'db55323b8d3e4154498498a75642b381', // Public TMDB key
            },
          }
        );

        // Filter out season 0 (specials) and sort by season number
        const filteredSeasons = (response.data.seasons || [])
          .filter((s: Season) => s.season_number > 0)
          .sort((a: Season, b: Season) => a.season_number - b.season_number);

        setSeasons(filteredSeasons);

        // Select all seasons by default
        const allSeasonNumbers = new Set<number>(
          filteredSeasons.map((s: Season) => s.season_number)
        );
        setSelectedSeasons(allSeasonNumbers);
      } catch (error) {
        // Failed to fetch seasons - will show empty list
      } finally {
        setLoading(false);
      }
    };

    fetchSeasons();
  }, [tmdbId]);

  const handleToggleSeason = (seasonNumber: number) => {
    const newSelected = new Set(selectedSeasons);
    if (newSelected.has(seasonNumber)) {
      newSelected.delete(seasonNumber);
    } else {
      newSelected.add(seasonNumber);
    }
    setSelectedSeasons(newSelected);
  };

  const handleSelectAll = () => {
    const allSeasonNumbers = new Set<number>(
      seasons.map((s) => s.season_number)
    );
    setSelectedSeasons(allSeasonNumbers);
  };

  const handleDeselectAll = () => {
    setSelectedSeasons(new Set());
  };

  const handleConfirm = () => {
    const selectedArray = Array.from(selectedSeasons).sort((a, b) => a - b);
    if (service === 'sonarr') {
      onConfirm(
        selectedArray,
        selectedServerId || undefined,
        selectedProfileId || undefined,
        selectedRootFolder || undefined
      );
    } else {
      onConfirm(selectedArray);
    }
  };

  const isSonarrValid =
    service !== 'sonarr' ||
    (selectedServerId !== null &&
      selectedProfileId !== null &&
      selectedRootFolder !== null);

  return (
    <Modal
      title={
        service === 'sonarr'
          ? intl.formatMessage(messages.sonarrOptions)
          : intl.formatMessage(messages.selectSeasons)
      }
      subTitle={title}
      onCancel={onCancel}
      onOk={handleConfirm}
      okText={intl.formatMessage(messages.download)}
      cancelText={intl.formatMessage(messages.cancel)}
      okDisabled={selectedSeasons.size === 0 || !isSonarrValid}
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-400">
            {intl.formatMessage(messages.loadingSeasons)}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Sonarr Options - only show for sonarr service */}
          {service === 'sonarr' && (
            <div className="space-y-4 border-b border-gray-700 pb-4">
              {/* Server Selection - only show if multiple servers */}
              {sonarrServers && sonarrServers.length > 1 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-300">
                    {intl.formatMessage(messages.selectServer)}
                  </label>
                  <select
                    value={selectedServerId || ''}
                    onChange={(e) => {
                      setSelectedServerId(Number(e.target.value));
                      setSelectedProfileId(null);
                      setSelectedRootFolder(null);
                    }}
                    className="w-full rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-white"
                    disabled={serversLoading}
                  >
                    <option value="">
                      {intl.formatMessage(messages.serverPlaceholder)}
                    </option>
                    {sonarrServers.map((server) => (
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
                  className="w-full rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-white"
                  disabled={!selectedServerId || profilesLoading}
                >
                  <option value="">
                    {!selectedServerId
                      ? intl.formatMessage(messages.selectServerFirst)
                      : profilesLoading
                      ? intl.formatMessage(messages.loading)
                      : intl.formatMessage(messages.profilePlaceholder)}
                  </option>
                  {sonarrProfiles?.map((profile) => (
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
                  className="w-full rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-white"
                  disabled={!selectedServerId || rootFoldersLoading}
                >
                  <option value="">
                    {!selectedServerId
                      ? intl.formatMessage(messages.selectServerFirst)
                      : rootFoldersLoading
                      ? intl.formatMessage(messages.loading)
                      : intl.formatMessage(messages.rootFolderPlaceholder)}
                  </option>
                  {sonarrRootFolders?.map((folder) => (
                    <option key={folder.id} value={folder.path}>
                      {folder.path}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="text-sm text-gray-400">
            {intl.formatMessage(messages.selectSeasonsDescription)}
          </div>

          {/* Select All / Deselect All buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleSelectAll}
              className="rounded-md bg-gray-700 px-3 py-1 text-sm text-gray-300 transition hover:bg-gray-600"
            >
              {intl.formatMessage(messages.selectAll)}
            </button>
            <button
              onClick={handleDeselectAll}
              className="rounded-md bg-gray-700 px-3 py-1 text-sm text-gray-300 transition hover:bg-gray-600"
            >
              {intl.formatMessage(messages.deselectAll)}
            </button>
          </div>

          {/* Season checkboxes */}
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {seasons.map((season) => (
              <label
                key={season.id}
                className="flex cursor-pointer items-center space-x-3 rounded-md p-2 transition hover:bg-gray-800"
              >
                <input
                  type="checkbox"
                  checked={selectedSeasons.has(season.season_number)}
                  onChange={() => handleToggleSeason(season.season_number)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-orange-500 focus:ring-orange-500 focus:ring-offset-gray-900"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-200">
                    {season.name ||
                      intl.formatMessage(messages.season, {
                        seasonNumber: season.season_number,
                      })}
                  </div>
                  {season.episode_count > 0 && (
                    <div className="text-xs text-gray-500">
                      {season.episode_count} episode
                      {season.episode_count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {selectedSeasons.size > 0 && (
            <div className="rounded-md bg-gray-800 p-3 text-sm text-gray-300">
              Selected: {selectedSeasons.size} season
              {selectedSeasons.size !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default SeasonSelectionModal;
