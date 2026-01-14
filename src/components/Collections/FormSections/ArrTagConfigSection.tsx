import type { CollectionFormConfig } from '@app/types/collections';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import {
  ErrorMessage,
  Field,
  type FormikErrors,
  type FormikTouched,
} from 'formik';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

interface ArrTag {
  id: number;
  label: string;
}

const messages = defineMessages({
  radarrInstance: 'Radarr Instance',
  sonarrInstance: 'Sonarr Instance',
  selectInstance: 'Select instance...',
  loadingInstances: 'Loading instances...',
  radarrTag: 'Radarr Tag',
  sonarrTag: 'Sonarr Tag',
  selectTag: 'Select tag...',
  loadingTags: 'Loading tags...',
  selectInstanceFirst: 'Select an instance first',
  loadInstancesError: 'Failed to load instances. Please try again.',
  loadTagsError: 'Failed to load tags. Please try again.',
});

interface ArrTagConfigSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | undefined
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  touched: FormikTouched<CollectionFormConfig>;
  isVisible?: boolean;
  getTemplatePresets?: (
    values: CollectionFormConfig
  ) => { label: string; value: string }[];
}

const ArrTagConfigSection = ({
  values,
  setFieldValue,
  isVisible = true,
}: ArrTagConfigSectionProps) => {
  const intl = useIntl();

  const isRadarr = values.type === 'radarrtag';
  const isSonarr = values.type === 'sonarrtag';

  // Fetch Radarr instances
  const { data: radarrInstances, error: radarrError } = useSWR<
    RadarrSettings[]
  >(isRadarr ? '/api/v1/settings/radarr' : null, (url) =>
    fetch(url).then((res) => res.json())
  );

  // Fetch Sonarr instances
  const { data: sonarrInstances, error: sonarrError } = useSWR<
    SonarrSettings[]
  >(isSonarr ? '/api/v1/settings/sonarr' : null, (url) =>
    fetch(url).then((res) => res.json())
  );

  // Determine the instance ID field name and value based on source type
  const instanceIdField = isRadarr
    ? 'radarrInstanceId'
    : isSonarr
    ? 'sonarrInstanceId'
    : '';
  const instanceId = isRadarr
    ? values.radarrInstanceId
    : isSonarr
    ? values.sonarrInstanceId
    : undefined;

  // Fetch tags for selected Radarr instance
  const radarrTagsUrl =
    isRadarr && values.radarrInstanceId !== undefined
      ? `/api/v1/settings/radarr/${values.radarrInstanceId}/tags`
      : null;

  const { data: radarrTags, error: radarrTagsError } = useSWR<ArrTag[]>(
    radarrTagsUrl,
    (url) => fetch(url).then((res) => res.json())
  );

  // Fetch tags for selected Sonarr instance
  const sonarrTagsUrl =
    isSonarr && values.sonarrInstanceId !== undefined
      ? `/api/v1/settings/sonarr/${values.sonarrInstanceId}/tags`
      : null;

  const { data: sonarrTags, error: sonarrTagsError } = useSWR<ArrTag[]>(
    sonarrTagsUrl,
    (url) => fetch(url).then((res) => res.json())
  );

  const isLoadingInstances = isRadarr
    ? !radarrInstances && !radarrError
    : isSonarr
    ? !sonarrInstances && !sonarrError
    : false;

  const isLoadingTags = isRadarr
    ? instanceId !== undefined && !radarrTags && !radarrTagsError
    : isSonarr
    ? instanceId !== undefined && !sonarrTags && !sonarrTagsError
    : false;

  const instances = isRadarr
    ? radarrInstances
    : isSonarr
    ? sonarrInstances
    : [];
  const tags = isRadarr ? radarrTags : isSonarr ? sonarrTags : [];
  const instanceError = isRadarr ? radarrError : isSonarr ? sonarrError : null;
  const tagsError = isRadarr
    ? radarrTagsError
    : isSonarr
    ? sonarrTagsError
    : null;

  if (!isVisible || (!isRadarr && !isSonarr)) return null;

  return (
    <div className="space-y-4">
      {/* Instance Selection */}
      <div>
        <label
          htmlFor={instanceIdField}
          className="mb-2 block text-sm text-gray-300"
        >
          {isRadarr
            ? intl.formatMessage(messages.radarrInstance)
            : intl.formatMessage(messages.sonarrInstance)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id={instanceIdField}
          name={instanceIdField}
          className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const newInstanceId = e.target.value
              ? Number(e.target.value)
              : undefined;
            setFieldValue(instanceIdField, newInstanceId);

            // Reset tag selection when instance changes
            if (newInstanceId !== instanceId) {
              if (isRadarr) {
                setFieldValue('radarrTagId', undefined);
              } else if (isSonarr) {
                setFieldValue('sonarrTagId', undefined);
              }
            }
          }}
          disabled={isLoadingInstances}
        >
          <option value="">
            {isLoadingInstances
              ? intl.formatMessage(messages.loadingInstances)
              : intl.formatMessage(messages.selectInstance)}
          </option>
          {Array.isArray(instances) &&
            instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name || `${instance.hostname}:${instance.port}`}
                {instance.isDefault ? ' (Default)' : ''}
              </option>
            ))}
        </Field>
        <ErrorMessage
          name={instanceIdField}
          component="div"
          className="mt-1 text-xs text-red-400"
        />
        {instanceError && (
          <p className="mt-1 text-xs text-red-400">
            {intl.formatMessage(messages.loadInstancesError)}
          </p>
        )}
      </div>

      {/* Tag Selection - Only show if instance is selected */}
      {instanceId !== undefined && (
        <div>
          <label
            htmlFor={isRadarr ? 'radarrTagId' : 'sonarrTagId'}
            className="mb-2 block text-sm text-gray-300"
          >
            {isRadarr
              ? intl.formatMessage(messages.radarrTag)
              : intl.formatMessage(messages.sonarrTag)}{' '}
            <span className="text-red-500">*</span>
          </label>
          <select
            id={isRadarr ? 'radarrTagId' : 'sonarrTagId'}
            name={isRadarr ? 'radarrTagId' : 'sonarrTagId'}
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            disabled={isLoadingTags}
            value={(() => {
              if (isRadarr) {
                return values.radarrTagId !== undefined
                  ? String(values.radarrTagId)
                  : '';
              }
              if (isSonarr) {
                return values.sonarrTagId !== undefined
                  ? String(values.sonarrTagId)
                  : '';
              }
              return '';
            })()}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const newTagId = e.target.value
                ? Number.parseInt(e.target.value, 10)
                : undefined;

              if (isRadarr) {
                setFieldValue('radarrTagId', newTagId);
              } else if (isSonarr) {
                setFieldValue('sonarrTagId', newTagId);
              }
            }}
          >
            <option value="">
              {isLoadingTags
                ? intl.formatMessage(messages.loadingTags)
                : instanceId !== undefined
                ? intl.formatMessage(messages.selectTag)
                : intl.formatMessage(messages.selectInstanceFirst)}
            </option>
            {Array.isArray(tags) &&
              tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.label}
                </option>
              ))}
          </select>
          <ErrorMessage
            name={isRadarr ? 'radarrTagId' : 'sonarrTagId'}
            component="div"
            className="mt-1 text-xs text-red-400"
          />
          {tagsError && (
            <p className="mt-1 text-xs text-red-400">
              {intl.formatMessage(messages.loadTagsError)}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ArrTagConfigSection;
