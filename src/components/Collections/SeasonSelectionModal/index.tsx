import Modal from '@app/components/Common/Modal';
import globalMessages from '@app/i18n/globalMessages';
import type { SonarrSettings } from '@server/lib/settings';
import axios from 'axios';
import type React from 'react';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages({
  selectSeasons: 'Select Seasons',
  season: 'Season',
  seasonnumber: 'Season {number}',
  download: 'Download',
  cancel: 'Cancel',
  loadingSeasons: 'Loading seasons...',
  selectServer: 'Select Server',
  selectProfile: 'Select Quality Profile',
  selectRootFolder: 'Select Root Folder',
  loading: 'Loading...',
  serverPlaceholder: 'Choose a Sonarr server...',
  profilePlaceholder: 'Choose a quality profile...',
  rootFolderPlaceholder: 'Choose a root folder...',
  selectServerFirst: 'Select a server first',
  sonarrOptions: 'Sonarr Download Options',
  numberofepisodes: '# of Episodes',
});

interface SeasonSelectionModalProps {
  tmdbId: number;
  title: string;
  service: 'overseerr' | 'sonarr';
  backdropPath?: string;
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
  backdropPath: cachedBackdropPath,
  onCancel,
  onConfirm,
}) => {
  const intl = useIntl();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(
    new Set()
  );
  const [loading, setLoading] = useState(true);
  const [backdropPath, setBackdropPath] = useState<string | undefined>(
    undefined
  );

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
    service === 'sonarr' && selectedServerId !== null
      ? `/api/v1/settings/sonarr/${selectedServerId}/profiles`
      : null
  );

  // Fetch root folders for selected Sonarr server
  const { data: sonarrRootFolders, isLoading: rootFoldersLoading } = useSWR<
    { id: number; path: string }[]
  >(
    service === 'sonarr' && selectedServerId !== null
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

        // Use cached backdrop if available
        if (cachedBackdropPath) {
          setBackdropPath(cachedBackdropPath);
        }

        const response = await axios.get(`/api/v1/tv/${tmdbId}`);

        // Filter out season 0 (specials) and sort by season number
        const filteredSeasons = (response.data.seasons || [])
          .filter((s: Season) => s.season_number > 0)
          .sort((a: Season, b: Season) => a.season_number - b.season_number);

        setSeasons(filteredSeasons);

        // Only set backdrop from API if we don't have a cached one
        if (!cachedBackdropPath && response.data.backdrop_path) {
          setBackdropPath(response.data.backdrop_path);
        }

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
  }, [tmdbId, cachedBackdropPath]);

  const handleToggleSeason = (seasonNumber: number) => {
    const newSelected = new Set(selectedSeasons);
    if (newSelected.has(seasonNumber)) {
      newSelected.delete(seasonNumber);
    } else {
      newSelected.add(seasonNumber);
    }
    setSelectedSeasons(newSelected);
  };

  const toggleAllSeasons = () => {
    if (isAllSeasons()) {
      setSelectedSeasons(new Set());
    } else {
      const allSeasonNumbers = new Set<number>(
        seasons.map((s) => s.season_number)
      );
      setSelectedSeasons(allSeasonNumbers);
    }
  };

  const isAllSeasons = (): boolean => {
    return seasons.length > 0 && selectedSeasons.size === seasons.length;
  };

  const handleConfirm = () => {
    const selectedArray = Array.from(selectedSeasons).sort((a, b) => a - b);
    if (service === 'sonarr') {
      onConfirm(
        selectedArray,
        selectedServerId !== null ? selectedServerId : undefined,
        selectedProfileId !== null ? selectedProfileId : undefined,
        selectedRootFolder ?? undefined
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
      backdrop={
        backdropPath
          ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${backdropPath}`
          : undefined
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-400">
            {intl.formatMessage(messages.loadingSeasons)}
          </div>
        </div>
      ) : (
        <>
          {/* Sonarr Options - only show for sonarr service */}
          {service === 'sonarr' && (
            <div className="mb-6 space-y-4 border-b border-gray-700 pb-4">
              {/* Server Selection - only show if multiple servers */}
              {sonarrServers && sonarrServers.length > 1 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-300">
                    {intl.formatMessage(messages.selectServer)}
                  </label>
                  <select
                    value={
                      selectedServerId !== null ? String(selectedServerId) : ''
                    }
                    onChange={(e) => {
                      const rawValue = e.target.value;
                      setSelectedServerId(
                        rawValue === '' ? null : Number(rawValue)
                      );
                      setSelectedProfileId(null);
                      setSelectedRootFolder(null);
                    }}
                    className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                  value={selectedProfileId ?? ''}
                  onChange={(e) =>
                    setSelectedProfileId(
                      e.target.value === '' ? null : Number(e.target.value)
                    )
                  }
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
                  value={selectedRootFolder ?? ''}
                  onChange={(e) =>
                    setSelectedRootFolder(e.target.value || null)
                  }
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
                  {sonarrRootFolders?.map((folder) => (
                    <option key={folder.id} value={folder.path}>
                      {folder.path}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-col">
            <div className="-mx-4 sm:mx-0">
              <div className="inline-block min-w-full py-2 align-middle">
                <div className="overflow-hidden border border-gray-700 shadow backdrop-blur sm:rounded-lg">
                  <table className="min-w-full">
                    <thead>
                      <tr>
                        <th className="w-16 bg-gray-700 bg-opacity-80 px-4 py-3">
                          <span
                            role="checkbox"
                            tabIndex={0}
                            aria-checked={isAllSeasons()}
                            onClick={() => toggleAllSeasons()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Space') {
                                toggleAllSeasons();
                              }
                            }}
                            className="relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer items-center justify-center pt-2 focus:outline-none"
                          >
                            <span
                              aria-hidden="true"
                              className={`${
                                isAllSeasons() ? 'bg-orange-500' : 'bg-gray-800'
                              } absolute mx-auto h-4 w-9 rounded-full transition-colors duration-200 ease-in-out`}
                            />
                            <span
                              aria-hidden="true"
                              className={`${
                                isAllSeasons()
                                  ? 'translate-x-5'
                                  : 'translate-x-0'
                              } absolute left-0 inline-block h-5 w-5 rounded-full border border-gray-200 bg-white shadow transition-transform duration-200 ease-in-out group-focus:border-orange-300 group-focus:ring`}
                            />
                          </span>
                        </th>
                        <th className="bg-gray-700 bg-opacity-80 px-1 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                          {intl.formatMessage(messages.season)}
                        </th>
                        <th className="bg-gray-700 bg-opacity-80 px-5 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200 md:px-6">
                          {intl.formatMessage(messages.numberofepisodes)}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {seasons.map((season) => (
                        <tr key={season.id}>
                          <td className="whitespace-nowrap px-4 py-4 text-sm font-medium leading-5 text-gray-100">
                            <span
                              role="checkbox"
                              tabIndex={0}
                              aria-checked={selectedSeasons.has(
                                season.season_number
                              )}
                              onClick={() =>
                                handleToggleSeason(season.season_number)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Space') {
                                  handleToggleSeason(season.season_number);
                                }
                              }}
                              className="relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer items-center justify-center pt-2 focus:outline-none"
                            >
                              <span
                                aria-hidden="true"
                                className={`${
                                  selectedSeasons.has(season.season_number)
                                    ? 'bg-orange-500'
                                    : 'bg-gray-700'
                                } absolute mx-auto h-4 w-9 rounded-full transition-colors duration-200 ease-in-out`}
                              />
                              <span
                                aria-hidden="true"
                                className={`${
                                  selectedSeasons.has(season.season_number)
                                    ? 'translate-x-5'
                                    : 'translate-x-0'
                                } absolute left-0 inline-block h-5 w-5 rounded-full border border-gray-200 bg-white shadow transition-transform duration-200 ease-in-out group-focus:border-orange-300 group-focus:ring`}
                              />
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-1 py-4 text-sm font-medium leading-5 text-gray-100 md:px-6">
                            {season.season_number === 0
                              ? intl.formatMessage(globalMessages.specials)
                              : intl.formatMessage(messages.seasonnumber, {
                                  number: season.season_number,
                                })}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-sm leading-5 text-gray-200 md:px-6">
                            {season.episode_count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
};

export default SeasonSelectionModal;
