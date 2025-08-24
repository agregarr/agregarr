import type { CollectionFormConfig } from '@app/types/collections';
import { defineMessages, useIntl } from 'react-intl';
import VisibilitySection from './VisibilitySection';

type VisibilityConfig = {
  usersHome: boolean;
  serverOwnerHome: boolean;
  libraryRecommended: boolean;
};

const messages = defineMessages({
  timeRestrictions: 'Time Restrictions',
  alwaysActive: 'Always Active (no time restrictions)',
  removeFromPlex: 'Remove from Plex when inactive',
  dateRangesTitle: 'Date Ranges for Collection to be active',
  weeklyScheduleTitle: 'Days of the Week for Collection to be active',
  addDateRange: '+ Add Date Range',
  remove: 'Remove',
  timeRestrictionsHelp:
    'Time restrictions allow you to control when and how collections appear in Plex based on date ranges and weekly schedules. You can choose to either remove collections completely when inactive, or change their visibility settings.',
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
    value: TimeRestriction | VisibilityConfig | boolean
  ) => void;
  isEnhancedForm?: boolean;
  isDefaultPlexHub?: boolean;
}

const TimeRestrictionsSection = ({
  values,
  setFieldValue,
  isEnhancedForm = false,
  isDefaultPlexHub = false,
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
          monday: false,
          tuesday: false,
          wednesday: false,
          thursday: false,
          friday: false,
          saturday: false,
          sunday: false,
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
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
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

      {/* Remove from Plex option - only show when not always active */}
      {!timeRestriction.alwaysActive && (
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
            <span className="ml-2 text-sm text-gray-400">
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
              Control where this collection appears when inactive (outside time
              restrictions)
            </p>
          </div>
        )}

      {/* Time restriction options - only show when not always active */}
      {!timeRestriction.alwaysActive && (
        <div className="mt-4 space-y-4">
          {/* Date Ranges */}
          <div>
            <div className="mb-2 block text-sm font-medium text-gray-300">
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
          </div>

          {/* Weekly Schedule */}
          <div>
            <div className="mb-2 block text-sm font-medium text-gray-300">
              {intl.formatMessage(messages.weeklyScheduleTitle)}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {weekDays.map((day) => (
                <label key={day.key} className="inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={timeRestriction.weeklySchedule?.[day.key] ?? false}
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
          </div>
        </div>
      )}

      <div className="label-tip">
        {intl.formatMessage(messages.timeRestrictionsHelp)}
      </div>
    </>
  );
};

export default TimeRestrictionsSection;
