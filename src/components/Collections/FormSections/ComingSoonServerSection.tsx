import IncludeExcludeToggle from '@app/components/Common/IncludeExcludeToggle';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { Field } from 'formik';
import { useEffect } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';
import useSWR from 'swr';

interface TagOption {
  value: number;
  label: string;
}

const messages = defineMessages({
  comingSoonServerSettings: 'Monitored Source Settings',
  comingSoonServerSettingsHelp:
    'Choose which Radarr/Sonarr server to pull monitored items from, and optionally filter by tags.',
  selectRadarrServer: 'Radarr Server (Movies)',
  selectSonarrServer: 'Sonarr Server (TV Shows)',
  selectServer: 'Select server...',
  allServers: 'All Servers',
  filterByTags: 'Filter by Tags',
  filterByTagsHelp: 'Filter monitored items by tags assigned in Radarr/Sonarr.',
  tagMode: 'Tag Filter Mode',
  includeHelp: 'Only include items with at least one of the selected tags.',
  excludeHelp: 'Exclude items that have any of the selected tags.',
  radarrTags: 'Radarr Tags',
  sonarrTags: 'Sonarr Tags',
  selectTags: 'Select tags...',
  selectServerFirst: 'Select a server first',
  noTags: 'No tags available on this server.',
});

interface ComingSoonServerSectionProps {
  values: {
    comingSoonRadarrServerId?: number;
    comingSoonSonarrServerId?: number;
    comingSoonFilterByTags?: boolean;
    comingSoonTagMode?: 'include' | 'exclude';
    comingSoonRadarrTagIds?: number[];
    comingSoonSonarrTagIds?: number[];
    [key: string]: unknown;
  };
  setFieldValue?: (field: string, value: unknown) => void;
}

const ComingSoonServerSection = ({
  values,
  setFieldValue,
}: ComingSoonServerSectionProps) => {
  const intl = useIntl();

  // Fetch Radarr and Sonarr servers
  const { data: radarrServers, isLoading: radarrLoading } = useSWR<
    RadarrSettings[]
  >('/api/v1/settings/radarr');
  const { data: sonarrServers, isLoading: sonarrLoading } = useSWR<
    SonarrSettings[]
  >('/api/v1/settings/sonarr');

  // Auto-select if only one server exists
  useEffect(() => {
    if (
      !radarrLoading &&
      radarrServers?.length === 1 &&
      values.comingSoonRadarrServerId === undefined
    ) {
      setFieldValue?.('comingSoonRadarrServerId', radarrServers[0].id);
    }
  }, [
    radarrLoading,
    radarrServers,
    values.comingSoonRadarrServerId,
    setFieldValue,
  ]);

  useEffect(() => {
    if (
      !sonarrLoading &&
      sonarrServers?.length === 1 &&
      values.comingSoonSonarrServerId === undefined
    ) {
      setFieldValue?.('comingSoonSonarrServerId', sonarrServers[0].id);
    }
  }, [
    sonarrLoading,
    sonarrServers,
    values.comingSoonSonarrServerId,
    setFieldValue,
  ]);

  // Effective server IDs (for fetching tags)
  const effectiveRadarrServerId =
    values.comingSoonRadarrServerId !== undefined
      ? values.comingSoonRadarrServerId
      : !radarrLoading && radarrServers?.length === 1
      ? radarrServers[0].id
      : undefined;

  const effectiveSonarrServerId =
    values.comingSoonSonarrServerId !== undefined
      ? values.comingSoonSonarrServerId
      : !sonarrLoading && sonarrServers?.length === 1
      ? sonarrServers[0].id
      : undefined;

  // Fetch tags for selected servers
  const { data: radarrTags } = useSWR<{ id: number; label: string }[]>(
    effectiveRadarrServerId !== undefined
      ? `/api/v1/settings/radarr/${effectiveRadarrServerId}/tags`
      : null
  );

  const { data: sonarrTags } = useSWR<{ id: number; label: string }[]>(
    effectiveSonarrServerId !== undefined
      ? `/api/v1/settings/sonarr/${effectiveSonarrServerId}/tags`
      : null
  );

  const radarrTagOptions: TagOption[] =
    radarrTags?.map((tag) => ({
      value: tag.id,
      label: tag.label,
    })) || [];

  const sonarrTagOptions: TagOption[] =
    sonarrTags?.map((tag) => ({
      value: tag.id,
      label: tag.label,
    })) || [];

  const selectedRadarrTagOptions = radarrTagOptions.filter((opt) =>
    values.comingSoonRadarrTagIds?.includes(opt.value)
  );

  const selectedSonarrTagOptions = sonarrTagOptions.filter((opt) =>
    values.comingSoonSonarrTagIds?.includes(opt.value)
  );

  const hasRadarrTags = radarrTagOptions.length > 0;
  const hasSonarrTags = sonarrTagOptions.length > 0;
  const hasAnyTags = hasRadarrTags || hasSonarrTags;

  const tagMode = values.comingSoonTagMode || 'include';

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {intl.formatMessage(messages.comingSoonServerSettingsHelp)}
      </p>

      {/* Radarr Server Selection */}
      {radarrServers && radarrServers.length > 1 && (
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">
            {intl.formatMessage(messages.selectRadarrServer)}
          </div>
          <div className="form-input-field">
            <Field
              as="select"
              name="comingSoonRadarrServerId"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const serverId = e.target.value
                  ? Number(e.target.value)
                  : undefined;
                setFieldValue?.('comingSoonRadarrServerId', serverId);
                // Clear radarr tags when server changes
                setFieldValue?.('comingSoonRadarrTagIds', []);
              }}
            >
              <option value="">
                {intl.formatMessage(messages.allServers)}
              </option>
              {radarrServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name || `${server.hostname}:${server.port}`}
                  {server.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </Field>
          </div>
        </div>
      )}

      {/* Sonarr Server Selection */}
      {sonarrServers && sonarrServers.length > 1 && (
        <div>
          <div className="mb-2 text-sm font-medium text-gray-300">
            {intl.formatMessage(messages.selectSonarrServer)}
          </div>
          <div className="form-input-field">
            <Field
              as="select"
              name="comingSoonSonarrServerId"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const serverId = e.target.value
                  ? Number(e.target.value)
                  : undefined;
                setFieldValue?.('comingSoonSonarrServerId', serverId);
                // Clear sonarr tags when server changes
                setFieldValue?.('comingSoonSonarrTagIds', []);
              }}
            >
              <option value="">
                {intl.formatMessage(messages.allServers)}
              </option>
              {sonarrServers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name || `${server.hostname}:${server.port}`}
                  {server.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </Field>
          </div>
        </div>
      )}

      {/* Filter by Tags - only show if at least one server has tags */}
      {(effectiveRadarrServerId !== undefined ||
        effectiveSonarrServerId !== undefined) &&
        hasAnyTags && (
          <div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="comingSoonFilterByTags"
                className="form-checkbox"
                checked={values.comingSoonFilterByTags ?? false}
                onChange={(e) => {
                  setFieldValue?.('comingSoonFilterByTags', e.target.checked);
                  if (!e.target.checked) {
                    setFieldValue?.('comingSoonRadarrTagIds', []);
                    setFieldValue?.('comingSoonSonarrTagIds', []);
                  }
                }}
              />
              <label
                htmlFor="comingSoonFilterByTags"
                className="ml-2 text-sm text-gray-300"
              >
                {intl.formatMessage(messages.filterByTags)}
              </label>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {intl.formatMessage(messages.filterByTagsHelp)}
            </p>

            {/* Tag filtering options */}
            {values.comingSoonFilterByTags && (
              <div className="mt-3 space-y-3 rounded-lg border border-orange-500/20 p-3">
                {/* Include/Exclude toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gray-300">
                    {intl.formatMessage(messages.tagMode)}
                  </label>
                  <IncludeExcludeToggle
                    mode={tagMode}
                    onModeChange={(newMode) =>
                      setFieldValue?.('comingSoonTagMode', newMode)
                    }
                  />
                </div>
                <p className="text-xs text-gray-500">
                  {tagMode === 'include'
                    ? intl.formatMessage(messages.includeHelp)
                    : intl.formatMessage(messages.excludeHelp)}
                </p>

                {/* Radarr Tags */}
                {hasRadarrTags && (
                  <div>
                    <label className="mb-1 block text-sm text-gray-300">
                      {intl.formatMessage(messages.radarrTags)}
                    </label>
                    <Select<TagOption, true>
                      isMulti
                      options={radarrTagOptions}
                      value={selectedRadarrTagOptions}
                      onChange={(newValue: MultiValue<TagOption>) => {
                        setFieldValue?.(
                          'comingSoonRadarrTagIds',
                          newValue?.map((v) => v.value) || []
                        );
                      }}
                      placeholder={intl.formatMessage(messages.selectTags)}
                      noOptionsMessage={() =>
                        intl.formatMessage(messages.noTags)
                      }
                      className="react-select-container"
                      classNamePrefix="react-select"
                      closeMenuOnSelect={false}
                    />
                  </div>
                )}

                {/* Sonarr Tags */}
                {hasSonarrTags && (
                  <div>
                    <label className="mb-1 block text-sm text-gray-300">
                      {intl.formatMessage(messages.sonarrTags)}
                    </label>
                    <Select<TagOption, true>
                      isMulti
                      options={sonarrTagOptions}
                      value={selectedSonarrTagOptions}
                      onChange={(newValue: MultiValue<TagOption>) => {
                        setFieldValue?.(
                          'comingSoonSonarrTagIds',
                          newValue?.map((v) => v.value) || []
                        );
                      }}
                      placeholder={intl.formatMessage(messages.selectTags)}
                      noOptionsMessage={() =>
                        intl.formatMessage(messages.noTags)
                      }
                      className="react-select-container"
                      classNamePrefix="react-select"
                      closeMenuOnSelect={false}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
    </div>
  );
};

export default ComingSoonServerSection;
