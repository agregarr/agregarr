import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { CheckIcon } from '@heroicons/react/24/solid';
import type {
  OverseerrSettings,
  RadarrSettings,
  SonarrSettings,
  WatchlistSyncSettings as WatchlistSyncSettingsType,
} from '@server/lib/settings';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import CreatableSelect from 'react-select/creatable';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

interface OptionType {
  label: string;
  value: number;
}

const messages = defineMessages({
  watchlistsync: 'Plex Watchlist Sync',
  watchlistsyncDescription:
    "Automatically sync Plex watchlists from Overseerr users and add items to Radarr and Sonarr. Requires Overseerr to be configured. NOTE: Overseerr has this functionality built in, however it recognises placeholder files as being available, and doesn't request the item.",
  overseerrNotConfigured:
    'Overseerr must be configured before you can enable watchlist sync. Please configure Overseerr in the settings above.',
  enableOwner: 'Enable for server owner',
  enableUsers: 'Enable for all Overseerr users',
  radarrConfiguration: 'Movie Watchlist (Radarr)',
  sonarrConfiguration: 'TV Show Watchlist (Sonarr)',
  radarrServer: 'Radarr Server',
  sonarrServer: 'Sonarr Server',
  qualityProfile: 'Quality Profile',
  rootFolder: 'Root Folder',
  tags: 'Tags',
  monitorByDefault: 'Monitor by default',
  searchOnAdd: 'Search on add',
  seasonFolders: 'Season folders',
  save: 'Save Changes',
  saving: 'Saving…',
  lastSync: 'Last Sync',
  noRadarrConfigured: 'No Radarr servers configured',
  noSonarrConfigured: 'No Sonarr servers configured',
  selectServer: 'Select a server...',
  selectProfile: 'Select a profile...',
  selectFolder: 'Select a folder...',
  selectTags: 'Select tags...',
  createTag: "Add new tag '{tagName}'",
  tagCreated: 'Tag created successfully',
  tagCreationFailed: 'Failed to create tag',
  tagWithUsername: 'Tag with Plex username',
  tagWithUsernameDescription:
    'Automatically tag downloaded media with the Plex username of the user who added it to their watchlist',
  settingsSaved: 'Watchlist sync settings saved successfully',
  settingsSaveFailed: 'Failed to save watchlist sync settings',
});

const WatchlistSyncSettings = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data: overseerrData } = useSWR<OverseerrSettings>(
    '/api/v1/settings/overseerr'
  );
  const { data: radarrData } = useSWR<RadarrSettings[]>(
    '/api/v1/settings/radarr'
  );
  const { data: sonarrData } = useSWR<SonarrSettings[]>(
    '/api/v1/settings/sonarr'
  );
  const {
    data: settings,
    mutate: revalidate,
    error,
  } = useSWR<WatchlistSyncSettingsType>('/api/v1/settings/watchlistsync');

  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<WatchlistSyncSettingsType>({
    enableOwner: false,
    enableUsers: false,
    radarr: { enabled: false },
    sonarr: { enabled: false },
  });

  const [selectedRadarrProfiles, setSelectedRadarrProfiles] = useState<
    { id: number; name: string }[]
  >([]);
  const [selectedRadarrFolders, setSelectedRadarrFolders] = useState<
    { id: number; path: string }[]
  >([]);
  const [selectedRadarrTags, setSelectedRadarrTags] = useState<
    { id: number; label: string }[]
  >([]);

  const [selectedSonarrProfiles, setSelectedSonarrProfiles] = useState<
    { id: number; name: string }[]
  >([]);
  const [selectedSonarrFolders, setSelectedSonarrFolders] = useState<
    { id: number; path: string }[]
  >([]);
  const [selectedSonarrTags, setSelectedSonarrTags] = useState<
    { id: number; label: string }[]
  >([]);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const loadRadarrSettings = async (serverId: number) => {
    try {
      const [profiles, folders, tags] = await Promise.all([
        axios.get(`/api/v1/settings/radarr/${serverId}/profiles`),
        axios.get(`/api/v1/settings/radarr/${serverId}/rootfolders`),
        axios.get(`/api/v1/settings/radarr/${serverId}/tags`),
      ]);
      setSelectedRadarrProfiles(profiles.data);
      setSelectedRadarrFolders(folders.data);
      setSelectedRadarrTags(tags.data);
    } catch {
      // Silently fail - user will see empty dropdowns
    }
  };

  const loadSonarrSettings = async (serverId: number) => {
    try {
      const [profiles, folders, tags] = await Promise.all([
        axios.get(`/api/v1/settings/sonarr/${serverId}/profiles`),
        axios.get(`/api/v1/settings/sonarr/${serverId}/rootfolders`),
        axios.get(`/api/v1/settings/sonarr/${serverId}/tags`),
      ]);
      setSelectedSonarrProfiles(profiles.data);
      setSelectedSonarrFolders(folders.data);
      setSelectedSonarrTags(tags.data);
    } catch {
      // Silently fail - user will see empty dropdowns
    }
  };

  const handleCreateRadarrTag = async (inputValue: string) => {
    if (!formData.radarr?.serverId && formData.radarr?.serverId !== 0) {
      return;
    }

    try {
      const response = await axios.post(
        `/api/v1/settings/radarr/${formData.radarr.serverId}/tags`,
        { label: inputValue }
      );
      const newTag = response.data;

      // Add new tag to the list
      setSelectedRadarrTags([...selectedRadarrTags, newTag]);

      // Add new tag to selected tags
      const currentTags = formData.radarr.tags || [];
      setFormData({
        ...formData,
        radarr: {
          ...formData.radarr,
          enabled: formData.radarr?.enabled ?? false,
          tags: [...currentTags, newTag.id],
        },
      });

      addToast(intl.formatMessage(messages.tagCreated), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (error) {
      addToast(intl.formatMessage(messages.tagCreationFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const handleCreateSonarrTag = async (inputValue: string) => {
    if (!formData.sonarr?.serverId && formData.sonarr?.serverId !== 0) {
      return;
    }

    try {
      const response = await axios.post(
        `/api/v1/settings/sonarr/${formData.sonarr.serverId}/tags`,
        { label: inputValue }
      );
      const newTag = response.data;

      // Add new tag to the list
      setSelectedSonarrTags([...selectedSonarrTags, newTag]);

      // Add new tag to selected tags
      const currentTags = formData.sonarr.tags || [];
      setFormData({
        ...formData,
        sonarr: {
          ...formData.sonarr,
          enabled: formData.sonarr?.enabled ?? false,
          tags: [...currentTags, newTag.id],
        },
      });

      addToast(intl.formatMessage(messages.tagCreated), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (error) {
      addToast(intl.formatMessage(messages.tagCreationFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  // Load Radarr profiles/folders/tags when server changes
  useEffect(() => {
    if (formData.radarr?.serverId !== undefined) {
      loadRadarrSettings(formData.radarr.serverId);
    }
  }, [formData.radarr?.serverId]);

  // Load Sonarr profiles/folders/tags when server changes
  useEffect(() => {
    if (formData.sonarr?.serverId !== undefined) {
      loadSonarrSettings(formData.sonarr.serverId);
    }
  }, [formData.sonarr?.serverId]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Auto-set enabled flags based on server selection
      const updatedData = {
        ...formData,
        radarr: {
          ...formData.radarr,
          enabled: formData.radarr?.serverId !== undefined,
        },
        sonarr: {
          ...formData.sonarr,
          enabled: formData.sonarr?.serverId !== undefined,
        },
      };
      await axios.post('/api/v1/settings/watchlistsync', updatedData);
      revalidate();
      addToast(intl.formatMessage(messages.settingsSaved), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch {
      addToast(intl.formatMessage(messages.settingsSaveFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const hasRadarrServers = radarrData && radarrData.length > 0;
  const hasSonarrServers = sonarrData && sonarrData.length > 0;
  const isSyncEnabled = formData.enableOwner || formData.enableUsers;
  const isOverseerrConfigured = overseerrData?.hostname ? true : false;

  if (error) {
    return (
      <Alert title="Failed to load watchlist sync settings" type="error" />
    );
  }

  if (!settings) {
    return <LoadingSpinner />;
  }

  return (
    <div className="section">
      <h3 className="heading">{intl.formatMessage(messages.watchlistsync)}</h3>
      <p className="description">
        {intl.formatMessage(messages.watchlistsyncDescription)}
      </p>

      {!isOverseerrConfigured && (
        <Alert
          type="warning"
          title={intl.formatMessage(messages.overseerrNotConfigured)}
        />
      )}

      <div className="form-row">
        <label htmlFor="enableOwner" className="checkbox-label">
          {intl.formatMessage(messages.enableOwner)}
        </label>
        <div className="form-input-area">
          <input
            type="checkbox"
            id="enableOwner"
            name="enableOwner"
            checked={formData.enableOwner}
            disabled={!isOverseerrConfigured}
            onChange={(e) =>
              setFormData({ ...formData, enableOwner: e.target.checked })
            }
          />
        </div>
      </div>

      <div className="form-row">
        <label htmlFor="enableUsers" className="checkbox-label">
          {intl.formatMessage(messages.enableUsers)}
        </label>
        <div className="form-input-area">
          <input
            type="checkbox"
            id="enableUsers"
            name="enableUsers"
            checked={formData.enableUsers}
            disabled={!isOverseerrConfigured}
            onChange={(e) =>
              setFormData({ ...formData, enableUsers: e.target.checked })
            }
          />
        </div>
      </div>

      {isSyncEnabled && (
        <>
          {/* Radarr Configuration */}
          <h4 className="group-heading mt-8 first:mt-0">
            {intl.formatMessage(messages.radarrConfiguration)}
          </h4>

          {!hasRadarrServers && (
            <Alert
              type="warning"
              title={intl.formatMessage(messages.noRadarrConfigured)}
            />
          )}

          {hasRadarrServers && (
            <>
              <div className="form-row">
                <label htmlFor="radarrServer" className="text-label">
                  {intl.formatMessage(messages.radarrServer)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <select
                      id="radarrServer"
                      name="radarrServer"
                      value={formData.radarr?.serverId ?? ''}
                      onChange={(e) => {
                        const serverId = e.target.value
                          ? Number(e.target.value)
                          : undefined;
                        setFormData({
                          ...formData,
                          radarr: {
                            ...formData.radarr,
                            enabled: serverId !== undefined,
                            serverId: serverId,
                          },
                        });
                      }}
                    >
                      <option value="">
                        {intl.formatMessage(messages.selectServer)}
                      </option>
                      {radarrData?.map((server: RadarrSettings) => (
                        <option key={server.id} value={server.id}>
                          {server.name}
                          {server.isDefault && !server.is4k && ' (Default)'}
                          {server.is4k && ' (4K)'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {formData.radarr?.serverId !== undefined && (
                <>
                  <div className="form-row">
                    <label htmlFor="radarrProfile" className="text-label">
                      {intl.formatMessage(messages.qualityProfile)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <select
                          id="radarrProfile"
                          name="radarrProfile"
                          value={formData.radarr.profileId ?? ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              radarr: {
                                enabled: formData.radarr?.enabled ?? false,
                                ...formData.radarr,
                                profileId: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              },
                            })
                          }
                        >
                          <option value="">
                            {intl.formatMessage(messages.selectProfile)}
                          </option>
                          {selectedRadarrProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="radarrFolder" className="text-label">
                      {intl.formatMessage(messages.rootFolder)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <select
                          id="radarrFolder"
                          name="radarrFolder"
                          value={formData.radarr.rootFolder ?? ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              radarr: {
                                enabled: formData.radarr?.enabled ?? false,
                                ...formData.radarr,
                                rootFolder: e.target.value || undefined,
                              },
                            })
                          }
                        >
                          <option value="">
                            {intl.formatMessage(messages.selectFolder)}
                          </option>
                          {selectedRadarrFolders.map((folder) => (
                            <option key={folder.id} value={folder.path}>
                              {folder.path}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="radarrTags" className="text-label">
                      {intl.formatMessage(messages.tags)}
                    </label>
                    <div className="form-input-area">
                      <CreatableSelect<OptionType, true>
                        options={selectedRadarrTags.map((tag) => ({
                          label: tag.label,
                          value: tag.id,
                        }))}
                        isMulti
                        placeholder={intl.formatMessage(messages.selectTags)}
                        className="react-select-container"
                        classNamePrefix="react-select"
                        value={
                          formData.radarr.tags
                            ?.map((tagId) => {
                              const foundTag = selectedRadarrTags.find(
                                (tag) => tag.id === tagId
                              );
                              if (!foundTag) {
                                return undefined;
                              }
                              return {
                                value: foundTag.id,
                                label: foundTag.label,
                              };
                            })
                            .filter(
                              (option) => option !== undefined
                            ) as OptionType[]
                        }
                        onChange={(value) => {
                          setFormData({
                            ...formData,
                            radarr: {
                              enabled: formData.radarr?.enabled ?? false,
                              ...formData.radarr,
                              tags: value?.map((v) => v.value),
                            },
                          });
                        }}
                        onCreateOption={handleCreateRadarrTag}
                        formatCreateLabel={(inputValue) =>
                          intl.formatMessage(messages.createTag, {
                            tagName: inputValue,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label
                      htmlFor="radarrTagWithUsername"
                      className="checkbox-label"
                    >
                      <span>
                        {intl.formatMessage(messages.tagWithUsername)}
                      </span>
                      <span className="label-tip">
                        {intl.formatMessage(
                          messages.tagWithUsernameDescription
                        )}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <input
                        type="checkbox"
                        id="radarrTagWithUsername"
                        name="radarrTagWithUsername"
                        checked={formData.radarr.tagWithUsername ?? false}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            radarr: {
                              enabled: formData.radarr?.enabled ?? false,
                              ...formData.radarr,
                              tagWithUsername: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="radarrMonitor" className="checkbox-label">
                      {intl.formatMessage(messages.monitorByDefault)}
                    </label>
                    <div className="form-input-area">
                      <input
                        type="checkbox"
                        id="radarrMonitor"
                        name="radarrMonitor"
                        checked={formData.radarr.monitor ?? true}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            radarr: {
                              enabled: formData.radarr?.enabled ?? false,
                              ...formData.radarr,
                              monitor: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="radarrSearch" className="checkbox-label">
                      {intl.formatMessage(messages.searchOnAdd)}
                    </label>
                    <div className="form-input-area">
                      <input
                        type="checkbox"
                        id="radarrSearch"
                        name="radarrSearch"
                        checked={formData.radarr.searchOnAdd ?? true}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            radarr: {
                              enabled: formData.radarr?.enabled ?? false,
                              ...formData.radarr,
                              searchOnAdd: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Sonarr Configuration */}
          <h4 className="group-heading mt-8 first:mt-0">
            {intl.formatMessage(messages.sonarrConfiguration)}
          </h4>

          {!hasSonarrServers && (
            <Alert
              type="warning"
              title={intl.formatMessage(messages.noSonarrConfigured)}
            />
          )}

          {hasSonarrServers && (
            <>
              <div className="form-row">
                <label htmlFor="sonarrServer" className="text-label">
                  {intl.formatMessage(messages.sonarrServer)}
                </label>
                <div className="form-input-area">
                  <div className="form-input-field">
                    <select
                      id="sonarrServer"
                      name="sonarrServer"
                      value={formData.sonarr?.serverId ?? ''}
                      onChange={(e) => {
                        const serverId = e.target.value
                          ? Number(e.target.value)
                          : undefined;
                        setFormData({
                          ...formData,
                          sonarr: {
                            ...formData.sonarr,
                            enabled: serverId !== undefined,
                            serverId: serverId,
                          },
                        });
                      }}
                    >
                      <option value="">
                        {intl.formatMessage(messages.selectServer)}
                      </option>
                      {sonarrData?.map((server: SonarrSettings) => (
                        <option key={server.id} value={server.id}>
                          {server.name}
                          {server.isDefault && !server.is4k && ' (Default)'}
                          {server.is4k && ' (4K)'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {formData.sonarr?.serverId !== undefined && (
                <>
                  <div className="form-row">
                    <label htmlFor="sonarrProfile" className="text-label">
                      {intl.formatMessage(messages.qualityProfile)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <select
                          id="sonarrProfile"
                          name="sonarrProfile"
                          value={formData.sonarr.profileId ?? ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              sonarr: {
                                enabled: formData.sonarr?.enabled ?? false,
                                ...formData.sonarr,
                                profileId: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              },
                            })
                          }
                        >
                          <option value="">
                            {intl.formatMessage(messages.selectProfile)}
                          </option>
                          {selectedSonarrProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="sonarrFolder" className="text-label">
                      {intl.formatMessage(messages.rootFolder)}
                    </label>
                    <div className="form-input-area">
                      <div className="form-input-field">
                        <select
                          id="sonarrFolder"
                          name="sonarrFolder"
                          value={formData.sonarr.rootFolder ?? ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              sonarr: {
                                enabled: formData.sonarr?.enabled ?? false,
                                ...formData.sonarr,
                                rootFolder: e.target.value || undefined,
                              },
                            })
                          }
                        >
                          <option value="">
                            {intl.formatMessage(messages.selectFolder)}
                          </option>
                          {selectedSonarrFolders.map((folder) => (
                            <option key={folder.id} value={folder.path}>
                              {folder.path}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="sonarrTags" className="text-label">
                      {intl.formatMessage(messages.tags)}
                    </label>
                    <div className="form-input-area">
                      <CreatableSelect<OptionType, true>
                        options={selectedSonarrTags.map((tag) => ({
                          label: tag.label,
                          value: tag.id,
                        }))}
                        isMulti
                        placeholder={intl.formatMessage(messages.selectTags)}
                        className="react-select-container"
                        classNamePrefix="react-select"
                        value={
                          formData.sonarr.tags
                            ?.map((tagId) => {
                              const foundTag = selectedSonarrTags.find(
                                (tag) => tag.id === tagId
                              );
                              if (!foundTag) {
                                return undefined;
                              }
                              return {
                                value: foundTag.id,
                                label: foundTag.label,
                              };
                            })
                            .filter(
                              (option) => option !== undefined
                            ) as OptionType[]
                        }
                        onChange={(value) => {
                          setFormData({
                            ...formData,
                            sonarr: {
                              enabled: formData.sonarr?.enabled ?? false,
                              ...formData.sonarr,
                              tags: value?.map((v) => v.value),
                            },
                          });
                        }}
                        onCreateOption={handleCreateSonarrTag}
                        formatCreateLabel={(inputValue) =>
                          intl.formatMessage(messages.createTag, {
                            tagName: inputValue,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label
                      htmlFor="sonarrTagWithUsername"
                      className="checkbox-label"
                    >
                      <span>
                        {intl.formatMessage(messages.tagWithUsername)}
                      </span>
                      <span className="label-tip">
                        {intl.formatMessage(
                          messages.tagWithUsernameDescription
                        )}
                      </span>
                    </label>
                    <div className="form-input-area">
                      <input
                        type="checkbox"
                        id="sonarrTagWithUsername"
                        name="sonarrTagWithUsername"
                        checked={formData.sonarr.tagWithUsername ?? false}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sonarr: {
                              enabled: formData.sonarr?.enabled ?? false,
                              ...formData.sonarr,
                              tagWithUsername: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="sonarrMonitor" className="checkbox-label">
                      {intl.formatMessage(messages.monitorByDefault)}
                    </label>
                    <div className="form-input-area">
                      <input
                        type="checkbox"
                        id="sonarrMonitor"
                        name="sonarrMonitor"
                        checked={formData.sonarr.monitor ?? true}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sonarr: {
                              enabled: formData.sonarr?.enabled ?? false,
                              ...formData.sonarr,
                              monitor: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="sonarrSearch" className="checkbox-label">
                      {intl.formatMessage(messages.searchOnAdd)}
                    </label>
                    <div className="form-input-area">
                      <input
                        type="checkbox"
                        id="sonarrSearch"
                        name="sonarrSearch"
                        checked={formData.sonarr.searchOnAdd ?? true}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sonarr: {
                              enabled: formData.sonarr?.enabled ?? false,
                              ...formData.sonarr,
                              searchOnAdd: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label
                      htmlFor="sonarrSeasonFolders"
                      className="checkbox-label"
                    >
                      {intl.formatMessage(messages.seasonFolders)}
                    </label>
                    <div className="form-input-area">
                      <input
                        type="checkbox"
                        id="sonarrSeasonFolders"
                        name="sonarrSeasonFolders"
                        checked={formData.sonarr.seasonFolder ?? true}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            sonarr: {
                              enabled: formData.sonarr?.enabled ?? false,
                              ...formData.sonarr,
                              seasonFolder: e.target.checked,
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Last Sync Info */}
      {settings?.lastSyncAt && (
        <div className="mt-4">
          <Badge badgeType="success">
            <CheckIcon className="mr-2" />
            <span>
              {intl.formatMessage(messages.lastSync)}:{' '}
              {new Date(settings.lastSyncAt).toLocaleString()}
            </span>
          </Badge>
        </div>
      )}

      {/* Action Buttons */}
      <div className="actions">
        <div className="flex justify-end">
          <Button buttonType="primary" onClick={handleSave} disabled={isSaving}>
            <span>
              {isSaving
                ? intl.formatMessage(messages.saving)
                : intl.formatMessage(messages.save)}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WatchlistSyncSettings;
