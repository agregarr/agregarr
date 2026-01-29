import Modal from '@app/components/Common/Modal';
import SensitiveInput from '@app/components/Common/SensitiveInput';
import globalMessages from '@app/i18n/globalMessages';
import { Transition } from '@headlessui/react';
import type { SonarrSettings } from '@server/lib/settings';
import axios from 'axios';
import { Field, Formik } from 'formik';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import type { OnChangeValue } from 'react-select';
import Select from 'react-select';
import { useToasts } from 'react-toast-notifications';
import * as Yup from 'yup';

type OptionType = {
  value: number;
  label: string;
};

const messages = defineMessages({
  createsonarr: 'Add New Sonarr Server',
  editsonarr: 'Edit Sonarr Server',
  validationNameRequired: 'You must provide a server name',
  validationHostnameRequired: 'You must provide a valid hostname or IP address',
  validationPortRequired: 'You must provide a valid port number',
  validationApiKeyRequired: 'You must provide an API key',
  validationRootFolderRequired: 'You must select a root folder',
  validationProfileRequired: 'You must select a quality profile',
  toastSonarrTestSuccess: 'Sonarr connection established successfully!',
  toastSonarrTestFailure: 'Failed to connect to Sonarr.',
  add: 'Add Server',
  defaultserver: 'Default Server',
  servername: 'Server Name',
  hostname: 'Hostname or IP Address',
  port: 'Port',
  ssl: 'Use SSL',
  apiKey: 'API Key',
  baseUrl: 'URL Base',
  qualityprofile: 'Quality Profile',
  rootfolder: 'Root Folder',
  seriesType: 'Series Type',
  seasonfolders: 'Season Folders',
  monitorByDefault: 'Monitor by Default',
  searchOnAdd: 'Search on Add',
  selectQualityProfile: 'Select quality profile',
  selectRootFolder: 'Select root folder',
  loadingprofiles: 'Loading quality profiles…',
  testFirstQualityProfiles: 'Test connection to load quality profiles',
  loadingrootfolders: 'Loading root folders…',
  testFirstRootFolders: 'Test connection to load root folders',
  loadingTags: 'Loading tags…',
  testFirstTags: 'Test connection to load tags',
  externalUrl: 'External URL',
  tagRequests: 'Automatic Tag Mode',
  tagRequestsInfo:
    'Choose how Agregarr tags Sonarr downloads (tags are created if they do not exist).',
  tagModeOff: 'Do not add automatic tags',
  tagModeSingle: 'Single tag (agregarr)',
  tagModePerService: 'Per service tags (trakt-agregarr, tmdb-agregarr)',
  tagModeGranular: 'Per collection tags (trakt-trending-agregarr)',
  validationApplicationUrl: 'You must provide a valid URL',
  validationApplicationUrlTrailingSlash: 'URL must not end in a trailing slash',
  validationBaseUrlLeadingSlash: 'Base URL must have a leading slash',
  validationBaseUrlTrailingSlash: 'Base URL must not end in a trailing slash',
  tags: 'Tags',
  notagoptions: 'No tags.',
  selecttags: 'Select tags',
  seriesTypeStandard: 'Standard',
  seriesTypeDaily: 'Daily',
  seriesTypeAnime: 'Anime',
  monitorType: 'Monitor Type',
  monitorTypeAll: 'All Episodes (except specials)',
  monitorTypeFuture: 'Future Episodes (not yet aired)',
  monitorTypeMissing: 'Missing Episodes (no files or not aired)',
  monitorTypeExisting: 'Existing Episodes (have files or not aired)',
  monitorTypeRecent: 'Recent Episodes (last 90 days + future)',
  monitorTypePilot: 'Pilot Episode (first episode only)',
  monitorTypeFirstSeason: 'First Season (all episodes)',
  monitorTypeLastSeason: 'Last Season (all episodes)',
  monitorTypeNone: 'None (no episodes monitored)',
  tagExistingItems: 'Tag Existing Items',
  tagExistingItemsInfo:
    'Apply collection tags to items that already exist in Sonarr during collection sync.',
});

interface TestResponse {
  profiles: {
    id: number;
    name: string;
  }[];
  rootFolders: {
    id: number;
    path: string;
  }[];
  languageProfiles: {
    id: number;
    name: string;
  }[];
  tags: {
    id: number;
    label: string;
  }[];
  urlBase?: string;
}

interface SonarrModalProps {
  sonarr: SonarrSettings | null;
  onClose: () => void;
  onSave: () => void;
}

const SonarrModal = ({ onClose, sonarr, onSave }: SonarrModalProps) => {
  const intl = useIntl();
  const initialLoad = useRef(false);
  const { addToast } = useToasts();
  const [isValidated, setIsValidated] = useState(sonarr ? true : false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResponse, setTestResponse] = useState<TestResponse>({
    profiles: [],
    rootFolders: [],
    languageProfiles: [],
    tags: [],
  });
  const SonarrSettingsSchema = Yup.object().shape({
    name: Yup.string().required(
      intl.formatMessage(messages.validationNameRequired)
    ),
    hostname: Yup.string()
      .required(intl.formatMessage(messages.validationHostnameRequired))
      .matches(
        /^(((([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])):((([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))@)?(([a-z]|\d|_|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*)?([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])$/i,
        intl.formatMessage(messages.validationHostnameRequired)
      ),
    port: Yup.number()
      .nullable()
      .required(intl.formatMessage(messages.validationPortRequired)),
    apiKey: Yup.string().required(
      intl.formatMessage(messages.validationApiKeyRequired)
    ),
    rootFolder: Yup.string().required(
      intl.formatMessage(messages.validationRootFolderRequired)
    ),
    activeProfileId: Yup.string().required(
      intl.formatMessage(messages.validationProfileRequired)
    ),
    externalUrl: Yup.string()
      .url(intl.formatMessage(messages.validationApplicationUrl))
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationApplicationUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
    baseUrl: Yup.string()
      .test(
        'leading-slash',
        intl.formatMessage(messages.validationBaseUrlLeadingSlash),
        (value) => !value || value.startsWith('/')
      )
      .test(
        'no-trailing-slash',
        intl.formatMessage(messages.validationBaseUrlTrailingSlash),
        (value) => !value || !value.endsWith('/')
      ),
  });

  const testConnection = useCallback(
    async ({
      hostname,
      port,
      apiKey,
      baseUrl,
      useSsl = false,
    }: {
      hostname: string;
      port: number;
      apiKey: string;
      baseUrl?: string;
      useSsl?: boolean;
    }) => {
      setIsTesting(true);
      try {
        const response = await axios.post<TestResponse>(
          '/api/v1/settings/sonarr/test',
          {
            hostname,
            apiKey,
            port: Number(port),
            baseUrl,
            useSsl,
          }
        );

        setIsValidated(true);
        setTestResponse(response.data);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastSonarrTestSuccess), {
            appearance: 'success',
            autoDismiss: true,
          });
        }
      } catch (e) {
        setIsValidated(false);
        if (initialLoad.current) {
          addToast(intl.formatMessage(messages.toastSonarrTestFailure), {
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
    if (sonarr) {
      testConnection({
        apiKey: sonarr.apiKey,
        hostname: sonarr.hostname,
        port: sonarr.port,
        baseUrl: sonarr.baseUrl,
        useSsl: sonarr.useSsl,
      });
    }
  }, [sonarr, testConnection]);

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
          name: sonarr?.name,
          hostname: sonarr?.hostname,
          port: sonarr?.port ?? 8989,
          ssl: sonarr?.useSsl ?? false,
          apiKey: sonarr?.apiKey,
          baseUrl: sonarr?.baseUrl,
          activeProfileId: sonarr?.activeProfileId,
          rootFolder: sonarr?.activeDirectory,
          seriesType: sonarr?.seriesType,
          tags: sonarr?.tags ?? [],
          isDefault: sonarr?.isDefault ?? false,
          externalUrl: sonarr?.externalUrl,
          // syncEnabled: sonarr?.syncEnabled ?? false, // Removed field
          // enableSearch: !sonarr?.preventSearch, // Removed field
          tagRequestsMode:
            sonarr?.tagRequestsMode ??
            (sonarr?.tagRequests ? 'per-service' : 'off'),
          enableSeasonFolders: sonarr?.enableSeasonFolders ?? true, // Default to true (Sonarr's default behavior)
          monitorByDefault: sonarr?.monitorByDefault ?? true, // Default to true (monitor items when added)
          monitorType: sonarr?.monitorType ?? 'all', // Default to 'all' (monitor all episodes)
          searchOnAdd: sonarr?.searchOnAdd ?? true, // Default to true (search immediately when added)
          tagExistingItems: sonarr?.tagExistingItems ?? false, // Default to false
        }}
        validationSchema={SonarrSettingsSchema}
        onSubmit={async (values) => {
          try {
            const profileName = testResponse.profiles.find(
              (profile) => profile.id === Number(values.activeProfileId)
            )?.name;

            const submission = {
              name: values.name,
              hostname: values.hostname,
              port: Number(values.port),
              apiKey: values.apiKey,
              useSsl: values.ssl,
              baseUrl: values.baseUrl,
              activeProfileId: Number(values.activeProfileId),
              activeProfileName: profileName,
              activeDirectory: values.rootFolder,
              seriesType: values.seriesType,
              tags: values.tags,
              isDefault: values.isDefault,
              is4k: false,
              externalUrl: values.externalUrl,
              // syncEnabled: values.syncEnabled, // Removed field
              // preventSearch: !values.enableSearch, // Removed field
              tagRequests: values.tagRequestsMode !== 'off',
              tagRequestsMode: values.tagRequestsMode,
              enableSeasonFolders: values.enableSeasonFolders,
              monitorByDefault: values.monitorByDefault,
              monitorType: values.monitorType,
              searchOnAdd: values.searchOnAdd,
              tagExistingItems: values.tagExistingItems,
            };
            if (!sonarr) {
              await axios.post('/api/v1/settings/sonarr', submission);
            } else {
              await axios.put(
                `/api/v1/settings/sonarr/${sonarr.id}`,
                submission
              );
            }

            onSave();
          } catch (e) {
            // set error here
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
                  : sonarr
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
                    baseUrl: values.baseUrl,
                    hostname: values.hostname,
                    port: values.port,
                    useSsl: values.ssl,
                  });
                  if (!values.baseUrl || values.baseUrl === '/') {
                    setFieldValue('baseUrl', testResponse.urlBase);
                  }
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
                !sonarr
                  ? intl.formatMessage(messages.createsonarr)
                  : intl.formatMessage(messages.editsonarr)
              }
            >
              <div className="mb-6">
                <div className="form-row">
                  <label htmlFor="isDefault" className="checkbox-label">
                    {intl.formatMessage(messages.defaultserver)}
                  </label>
                  <div className="form-input-area">
                    <Field type="checkbox" id="isDefault" name="isDefault" />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="name" className="text-label">
                    {intl.formatMessage(messages.servername)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field id="name" name="name" type="text" />
                    </div>
                    {errors.name &&
                      touched.name &&
                      typeof errors.name === 'string' && (
                        <div className="error">{errors.name}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="hostname" className="text-label">
                    {intl.formatMessage(messages.hostname)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <span className="protocol">
                        {values.ssl ? 'https://' : 'http://'}
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
                  <label htmlFor="ssl" className="checkbox-label">
                    {intl.formatMessage(messages.ssl)}
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="ssl"
                      name="ssl"
                      onChange={() => {
                        setIsValidated(false);
                        setFieldValue('ssl', !values.ssl);
                      }}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="apiKey" className="text-label">
                    {intl.formatMessage(messages.apiKey)}
                    <span className="label-required">*</span>
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
                  <label htmlFor="baseUrl" className="text-label">
                    {intl.formatMessage(messages.baseUrl)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        id="baseUrl"
                        name="baseUrl"
                        type="text"
                        inputMode="url"
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setIsValidated(false);
                          setFieldValue('baseUrl', e.target.value);
                        }}
                      />
                    </div>
                    {errors.baseUrl &&
                      touched.baseUrl &&
                      typeof errors.baseUrl === 'string' && (
                        <div className="error">{errors.baseUrl}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="seriesType" className="text-label">
                    {intl.formatMessage(messages.seriesType)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="seriesType"
                        name="seriesType"
                        disabled={!isValidated || isTesting}
                      >
                        <option value="standard">
                          {intl.formatMessage(messages.seriesTypeStandard)}
                        </option>
                        <option value="daily">
                          {intl.formatMessage(messages.seriesTypeDaily)}
                        </option>
                        <option value="anime">
                          {intl.formatMessage(messages.seriesTypeAnime)}
                        </option>
                      </Field>
                    </div>
                  </div>
                  {errors.seriesType && touched.seriesType && (
                    <div className="error">{errors.seriesType}</div>
                  )}
                </div>
                <div className="form-row">
                  <label htmlFor="activeProfileId" className="text-label">
                    {intl.formatMessage(messages.qualityprofile)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="activeProfileId"
                        name="activeProfileId"
                        disabled={!isValidated || isTesting}
                      >
                        <option value="">
                          {isTesting
                            ? intl.formatMessage(messages.loadingprofiles)
                            : !isValidated
                            ? intl.formatMessage(
                                messages.testFirstQualityProfiles
                              )
                            : intl.formatMessage(messages.selectQualityProfile)}
                        </option>
                        {testResponse.profiles.length > 0 &&
                          testResponse.profiles.map((profile) => (
                            <option
                              key={`loaded-profile-${profile.id}`}
                              value={profile.id}
                            >
                              {profile.name}
                            </option>
                          ))}
                      </Field>
                    </div>
                    {errors.activeProfileId &&
                      touched.activeProfileId &&
                      typeof errors.activeProfileId === 'string' && (
                        <div className="error">{errors.activeProfileId}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="rootFolder" className="text-label">
                    {intl.formatMessage(messages.rootfolder)}
                    <span className="label-required">*</span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="rootFolder"
                        name="rootFolder"
                        disabled={!isValidated || isTesting}
                      >
                        <option value="">
                          {isTesting
                            ? intl.formatMessage(messages.loadingrootfolders)
                            : !isValidated
                            ? intl.formatMessage(messages.testFirstRootFolders)
                            : intl.formatMessage(messages.selectRootFolder)}
                        </option>
                        {testResponse.rootFolders.length > 0 &&
                          testResponse.rootFolders.map((folder) => (
                            <option
                              key={`loaded-profile-${folder.id}`}
                              value={folder.path}
                            >
                              {folder.path}
                            </option>
                          ))}
                      </Field>
                    </div>
                    {errors.rootFolder &&
                      touched.rootFolder &&
                      typeof errors.rootFolder === 'string' && (
                        <div className="error">{errors.rootFolder}</div>
                      )}
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="tags" className="text-label">
                    {intl.formatMessage(messages.tags)}
                  </label>
                  <div className="form-input-area">
                    <Select<OptionType, true>
                      options={
                        isValidated
                          ? testResponse.tags.map((tag) => ({
                              label: tag.label,
                              value: tag.id,
                            }))
                          : []
                      }
                      isMulti
                      isDisabled={!isValidated || isTesting}
                      placeholder={
                        !isValidated
                          ? intl.formatMessage(messages.testFirstTags)
                          : isTesting
                          ? intl.formatMessage(messages.loadingTags)
                          : intl.formatMessage(messages.selecttags)
                      }
                      isLoading={isTesting}
                      className="react-select-container"
                      classNamePrefix="react-select"
                      value={
                        isTesting
                          ? []
                          : (values.tags
                              .map((tagId) => {
                                const foundTag = testResponse.tags.find(
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
                              ) as OptionType[])
                      }
                      onChange={(value: OnChangeValue<OptionType, true>) => {
                        setFieldValue(
                          'tags',
                          value.map((option) => option.value)
                        );
                      }}
                      noOptionsMessage={() =>
                        intl.formatMessage(messages.notagoptions)
                      }
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label
                    htmlFor="enableSeasonFolders"
                    className="checkbox-label"
                  >
                    {intl.formatMessage(messages.seasonfolders)}
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="enableSeasonFolders"
                      name="enableSeasonFolders"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="monitorType" className="text-label">
                    {intl.formatMessage(messages.monitorType)}
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field as="select" id="monitorType" name="monitorType">
                        <option value="all">
                          {intl.formatMessage(messages.monitorTypeAll)}
                        </option>
                        <option value="future">
                          {intl.formatMessage(messages.monitorTypeFuture)}
                        </option>
                        <option value="missing">
                          {intl.formatMessage(messages.monitorTypeMissing)}
                        </option>
                        <option value="existing">
                          {intl.formatMessage(messages.monitorTypeExisting)}
                        </option>
                        <option value="recent">
                          {intl.formatMessage(messages.monitorTypeRecent)}
                        </option>
                        <option value="pilot">
                          {intl.formatMessage(messages.monitorTypePilot)}
                        </option>
                        <option value="firstSeason">
                          {intl.formatMessage(messages.monitorTypeFirstSeason)}
                        </option>
                        <option value="lastSeason">
                          {intl.formatMessage(messages.monitorTypeLastSeason)}
                        </option>
                        <option value="none">
                          {intl.formatMessage(messages.monitorTypeNone)}
                        </option>
                      </Field>
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="searchOnAdd" className="checkbox-label">
                    {intl.formatMessage(messages.searchOnAdd)}
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="searchOnAdd"
                      name="searchOnAdd"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="tagExistingItems" className="checkbox-label">
                    {intl.formatMessage(messages.tagExistingItems)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.tagExistingItemsInfo)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <Field
                      type="checkbox"
                      id="tagExistingItems"
                      name="tagExistingItems"
                    />
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
                {/* syncEnabled and enableSearch fields removed */}
                <div className="form-row">
                  <label htmlFor="tagRequestsMode" className="text-label">
                    {intl.formatMessage(messages.tagRequests)}
                    <span className="label-tip">
                      {intl.formatMessage(messages.tagRequestsInfo)}
                    </span>
                  </label>
                  <div className="form-input-area">
                    <div className="form-input-field">
                      <Field
                        as="select"
                        id="tagRequestsMode"
                        name="tagRequestsMode"
                      >
                        <option value="off">
                          {intl.formatMessage(messages.tagModeOff)}
                        </option>
                        <option value="single">
                          {intl.formatMessage(messages.tagModeSingle)}
                        </option>
                        <option value="per-service">
                          {intl.formatMessage(messages.tagModePerService)}
                        </option>
                        <option value="granular">
                          {intl.formatMessage(messages.tagModeGranular)}
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

export default SonarrModal;
