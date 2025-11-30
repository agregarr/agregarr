import type {
  CollectionFormConfig,
  CustomSyncSchedule,
} from '@app/types/collections';
import { SYNC_SCHEDULE_PRESETS } from '@app/types/collections';
import { Field } from 'formik';
import { defineMessages, useIntl } from 'react-intl';
import VisibilitySection from './VisibilitySection';

type VisibilityConfig = {
  usersHome: boolean;
  serverOwnerHome: boolean;
  libraryRecommended: boolean;
};

const messages = defineMessages({
  timeRestrictions: 'Time Restrictions',
  alwaysActive: 'Always Active',
  removeFromPlex: 'Remove from Plex when inactive',
  dateRangesTitle: 'Date Ranges',
  weeklyScheduleTitle: 'Days of the Week',
  addDateRange: '+ Add Date Range',
  remove: 'Remove',
  timeRestrictionsHelp:
    'Control when this collection is active in Plex. By default, collections are always active.',
  dateRangesHelp:
    "Specify date ranges when the collection should be active (format: DD-MM). If you want the collection to be active year round but only on certain days of the week, don't add a date range",
  weeklyScheduleHelp:
    'Choose which days of the week the collection should be active. All days are selected by default.',
  inactiveVisibilityHelp:
    'When the collection is inactive (outside time restrictions), control where it appears in Plex.',
  customSyncSchedule: 'Custom Sync Schedule',
  customSyncEnabled: 'Enable custom sync timing',
  customSyncInterval: 'Sync every (hours)',
  customSyncHelp:
    'Override the default sync schedule for this collection. This will also cycle the list for Random Lists and Multi-Source Collections in "Cycle Lists" mode. Note: Manual sync always works regardless of schedule timing.',
  customSyncPreset: 'Schedule',
  customSyncCustomCron: 'Custom cron expression',
  customSyncCustomCronHelp:
    'Specify a custom cron expression (e.g., "0 9 * * MON" for every Monday at 9 AM). Use standard cron format.',
  customSyncPresetHelp:
    'Choose from predefined sync intervals, or select "Custom" to specify a cron expression.',
  customSyncStartNow: 'Start on next sync',
  customSyncStartNowHelp:
    'Uncheck to set a specific date/time for the sync cycle to be based off (e.g. "Best Movies This Year" collection that should be updated on January 1st). You can still use Manual Sync to populate the collection before the scheduled time.',
  customSyncStartDate: 'Start date',
  customSyncStartTime: 'Start time',
});

interface DateRange {
  startDate: string;
  endDate: string;
}

interface WeeklySchedule {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

interface TimeRestriction {
  alwaysActive?: boolean;
  removeFromPlexWhenInactive?: boolean;
  dateRanges?: DateRange[];
  weeklySchedule?: WeeklySchedule;
  inactiveVisibilityConfig?: VisibilityConfig;
}

interface TimeRestrictionsSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value:
      | TimeRestriction
      | VisibilityConfig
      | boolean
      | string
      | number
      | undefined
  ) => void;
  isEnhancedForm?: boolean;
  isDefaultPlexHub?: boolean;
  isPreExisting?: boolean;
}

const TimeRestrictionsSection = ({
  values,
  setFieldValue,
  isEnhancedForm = false,
  isDefaultPlexHub = false,
  isPreExisting = false,
}: TimeRestrictionsSectionProps) => {
  const intl = useIntl();

  const timeRestriction: TimeRestriction = values.timeRestriction
    ? {
        alwaysActive: values.timeRestriction.alwaysActive ?? true,
        removeFromPlexWhenInactive:
          values.timeRestriction.removeFromPlexWhenInactive ?? false,
        dateRanges: values.timeRestriction.dateRanges
          ? [...values.timeRestriction.dateRanges]
          : [],
        weeklySchedule: values.timeRestriction.weeklySchedule
          ? { ...values.timeRestriction.weeklySchedule }
          : undefined,
        inactiveVisibilityConfig: values.timeRestriction
          .inactiveVisibilityConfig
          ? { ...values.timeRestriction.inactiveVisibilityConfig }
          : undefined,
      }
    : {
        alwaysActive: true,
        removeFromPlexWhenInactive: false,
        dateRanges: [],
        weeklySchedule: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
      };

  const updateTimeRestriction = (updates: Partial<TimeRestriction>) => {
    setFieldValue('timeRestriction', {
      ...timeRestriction,
      ...updates,
    });
  };

  const addDateRange = () => {
    const currentRanges = timeRestriction.dateRanges || [];
    updateTimeRestriction({
      alwaysActive: false,
      dateRanges: [...currentRanges, { startDate: '', endDate: '' }],
    });
  };

  const updateDateRange = (
    index: number,
    field: 'startDate' | 'endDate',
    value: string
  ) => {
    const newRanges = [...(timeRestriction.dateRanges || [])];
    newRanges[index] = { ...newRanges[index], [field]: value };
    updateTimeRestriction({
      alwaysActive: false,
      dateRanges: newRanges,
    });
  };

  const removeDateRange = (index: number) => {
    const newRanges =
      timeRestriction.dateRanges?.filter(
        (_: DateRange, i: number) => i !== index
      ) || [];
    updateTimeRestriction({
      alwaysActive: false,
      dateRanges: newRanges,
    });
  };

  const updateWeeklySchedule = (
    day: keyof WeeklySchedule,
    checked: boolean
  ) => {
    const currentSchedule = timeRestriction.weeklySchedule || {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
    };
    updateTimeRestriction({
      alwaysActive: false,
      weeklySchedule: {
        ...currentSchedule,
        [day]: checked,
      },
    });
  };

  const weekDays = [
    { key: 'monday' as keyof WeeklySchedule, label: 'Mon' },
    { key: 'tuesday' as keyof WeeklySchedule, label: 'Tue' },
    { key: 'wednesday' as keyof WeeklySchedule, label: 'Wed' },
    { key: 'thursday' as keyof WeeklySchedule, label: 'Thu' },
    { key: 'friday' as keyof WeeklySchedule, label: 'Fri' },
    { key: 'saturday' as keyof WeeklySchedule, label: 'Sat' },
    { key: 'sunday' as keyof WeeklySchedule, label: 'Sun' },
  ];

  return (
    <>
      <div className="label-tip">
        {intl.formatMessage(messages.timeRestrictionsHelp)}
      </div>

      <div className="form-input-field">
        <label className="inline-flex items-center">
          <input
            id="timeRestrictions"
            type="checkbox"
            checked={timeRestriction.alwaysActive ?? true}
            onChange={(e) => {
              updateTimeRestriction({
                alwaysActive: e.target.checked,
              });
            }}
            className="form-checkbox"
          />
          <span className="ml-2 text-sm text-gray-300">
            {intl.formatMessage(messages.alwaysActive)}
          </span>
        </label>
      </div>

      {/* Remove from Plex option - only show when not always active AND not a hub/pre-existing collection */}
      {!timeRestriction.alwaysActive && !isDefaultPlexHub && !isPreExisting && (
        <div className="form-input-field mt-2">
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              checked={timeRestriction.removeFromPlexWhenInactive ?? false}
              onChange={(e) => {
                updateTimeRestriction({
                  alwaysActive: false,
                  removeFromPlexWhenInactive: e.target.checked,
                });
              }}
              className="form-checkbox"
            />
            <span className="ml-2 text-sm text-gray-300">
              {intl.formatMessage(messages.removeFromPlex)}
            </span>
          </label>
        </div>
      )}

      {/* Inactive Visibility Settings - only show when not always active AND not removing from Plex */}
      {!timeRestriction.alwaysActive &&
        !timeRestriction.removeFromPlexWhenInactive && (
          <div className="mt-4 rounded-md bg-stone-800 p-4">
            <VisibilitySection
              values={values}
              setFieldValue={setFieldValue}
              isEnhancedForm={isEnhancedForm}
              isDefaultPlexHub={isDefaultPlexHub}
              fieldPrefix="timeRestriction.inactiveVisibilityConfig"
              titleKey="inactiveVisibility"
              descriptionKey="inactiveVisibilityDescription"
            />
            <p className="mt-2 text-xs text-gray-400">
              {intl.formatMessage(messages.inactiveVisibilityHelp)}
            </p>
          </div>
        )}

      {/* Time restriction options - only show when not always active */}
      {!timeRestriction.alwaysActive && (
        <div className="mt-4 space-y-4">
          {/* Date Ranges */}
          <div>
            <div className="mb-2 block text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.dateRangesTitle)}
            </div>

            {timeRestriction.dateRanges?.map(
              (range: DateRange, index: number) => (
                <div key={index} className="mb-2 flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="DD-MM"
                    value={range.startDate}
                    onChange={(e) =>
                      updateDateRange(index, 'startDate', e.target.value)
                    }
                    className="w-20 text-sm"
                    maxLength={5}
                  />
                  <span className="text-gray-400">to</span>
                  <input
                    type="text"
                    placeholder="DD-MM"
                    value={range.endDate}
                    onChange={(e) =>
                      updateDateRange(index, 'endDate', e.target.value)
                    }
                    className="w-20 text-sm"
                    maxLength={5}
                  />
                  <button
                    type="button"
                    onClick={() => removeDateRange(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    {intl.formatMessage(messages.remove)}
                  </button>
                </div>
              )
            )}

            <button
              type="button"
              onClick={addDateRange}
              className="text-sm text-orange-400 hover:text-orange-300"
            >
              {intl.formatMessage(messages.addDateRange)}
            </button>
            <p className="mt-2 text-xs text-gray-400">
              {intl.formatMessage(messages.dateRangesHelp)}
            </p>
          </div>

          {/* Weekly Schedule */}
          <div>
            <div className="mb-2 block text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.weeklyScheduleTitle)}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {weekDays.map((day) => (
                <label key={day.key} className="inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={timeRestriction.weeklySchedule?.[day.key] ?? true}
                    onChange={(e) =>
                      updateWeeklySchedule(day.key, e.target.checked)
                    }
                    className="form-checkbox"
                  />
                  <span className="ml-1 text-sm text-gray-300">
                    {day.label}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {intl.formatMessage(messages.weeklyScheduleHelp)}
            </p>
          </div>
        </div>
      )}

      {/* Custom Sync Schedule Section - Only for Agregarr collections (not hubs, pre-existing, or filtered_hub) */}
      {!isDefaultPlexHub &&
        !isPreExisting &&
        values.type !== 'filtered_hub' && (
          <div className="mt-6">
            <label className="mb-4 block text-sm font-medium text-gray-200">
              {intl.formatMessage(messages.customSyncSchedule)}
            </label>

            <div className="space-y-4">
              <div className="form-input-field">
                <label className="inline-flex items-center">
                  <Field
                    type="checkbox"
                    name="customSyncSchedule.enabled"
                    className="form-checkbox"
                  />
                  <span className="ml-2 text-sm text-gray-300">
                    {intl.formatMessage(messages.customSyncEnabled)}
                  </span>
                </label>
              </div>

              {(
                values as CollectionFormConfig & {
                  customSyncSchedule?: CustomSyncSchedule;
                }
              ).customSyncSchedule?.enabled && (
                <div className="space-y-4">
                  {/* Single Schedule Dropdown */}
                  <div>
                    <label className="mb-2 block text-sm text-gray-300">
                      {intl.formatMessage(messages.customSyncPreset)}
                    </label>
                    <Field
                      as="select"
                      name="customSyncSchedule.preset"
                      value={
                        (values.customSyncSchedule as CustomSyncSchedule)
                          ?.scheduleType === 'custom'
                          ? 'custom'
                          : (values.customSyncSchedule as CustomSyncSchedule)
                              ?.preset || '1d'
                      }
                      className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                        const selectedValue = e.target.value;

                        if (selectedValue === 'custom') {
                          // Switch to custom cron mode
                          setFieldValue(
                            'customSyncSchedule.scheduleType',
                            'custom'
                          );
                          setFieldValue('customSyncSchedule.preset', '');
                          setFieldValue(
                            'customSyncSchedule.intervalHours',
                            undefined
                          );
                          setFieldValue('customSyncSchedule.customCron', '');
                        } else {
                          // Switch to preset mode
                          setFieldValue(
                            'customSyncSchedule.scheduleType',
                            'preset'
                          );
                          setFieldValue(
                            'customSyncSchedule.preset',
                            selectedValue
                          );
                          setFieldValue('customSyncSchedule.customCron', '');

                          const preset = SYNC_SCHEDULE_PRESETS.find(
                            (p) => p.key === selectedValue
                          );
                          if (preset) {
                            setFieldValue(
                              'customSyncSchedule.intervalHours',
                              preset.intervalHours
                            );
                          }
                        }
                      }}
                    >
                      {SYNC_SCHEDULE_PRESETS.map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.label}
                        </option>
                      ))}
                      <option value="custom">Custom Cron Expression</option>
                    </Field>
                    <p className="mt-2 text-xs text-gray-400">
                      {intl.formatMessage(messages.customSyncPresetHelp)}
                    </p>
                  </div>

                  {/* Custom Cron Input */}
                  {(values.customSyncSchedule as CustomSyncSchedule)
                    ?.scheduleType === 'custom' && (
                    <div>
                      <label className="mb-2 block text-sm text-gray-300">
                        {intl.formatMessage(messages.customSyncCustomCron)}
                      </label>
                      <Field
                        type="text"
                        name="customSyncSchedule.customCron"
                        placeholder="0 9 * * MON"
                        className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <p className="mt-2 text-xs text-gray-400">
                        {intl.formatMessage(messages.customSyncCustomCronHelp)}
                      </p>
                    </div>
                  )}

                  {/* Start Date/Time Selection - Show for all preset schedules */}
                  {(values.customSyncSchedule as CustomSyncSchedule)
                    ?.scheduleType !== 'custom' &&
                    (values.customSyncSchedule as CustomSyncSchedule)
                      ?.preset && (
                      <div className="space-y-4">
                        <div className="form-input-field">
                          <label className="inline-flex items-center">
                            <Field
                              type="checkbox"
                              name="customSyncSchedule.startNow"
                              className="form-checkbox"
                            />
                            <span className="ml-2 text-sm text-gray-300">
                              {intl.formatMessage(messages.customSyncStartNow)}
                            </span>
                          </label>
                        </div>
                        <p className="text-xs text-gray-400">
                          {intl.formatMessage(messages.customSyncStartNowHelp)}
                        </p>

                        {!(values.customSyncSchedule as CustomSyncSchedule)
                          ?.startNow && (
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="mb-2 block text-sm text-gray-300">
                                {intl.formatMessage(
                                  messages.customSyncStartDate
                                )}
                              </label>
                              <Field
                                type="text"
                                name="customSyncSchedule.startDate"
                                placeholder="01-01"
                                className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                              />
                              <p className="mt-1 text-xs text-gray-400">
                                DD-MM format
                              </p>
                            </div>
                            <div>
                              <label className="mb-2 block text-sm text-gray-300">
                                {intl.formatMessage(
                                  messages.customSyncStartTime
                                )}
                              </label>
                              <Field
                                type="text"
                                name="customSyncSchedule.startTime"
                                placeholder="09:00"
                                className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                              />
                              <p className="mt-1 text-xs text-gray-400">
                                HH:MM format (e.g., 09:00, 23:30)
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        )}
    </>
  );
};

export default TimeRestrictionsSection;
