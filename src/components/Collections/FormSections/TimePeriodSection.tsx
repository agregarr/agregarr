import type { CollectionFormConfig } from '@app/types/collections';
import { Field, type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';

interface TemplatePreset {
  value: string;
  label: string;
  description?: string;
}

const messages = defineMessages({
  timePeriod: 'Time Period',
  selectTimePeriod: 'Select time period...',
});

interface TimePeriodOption {
  value: string;
  label: string;
  description?: string;
}

interface TimePeriodSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | undefined
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  touched: FormikTouched<CollectionFormConfig>;
  baseSubtype: 'played' | 'watched' | 'collected' | 'favorited';
  isVisible?: boolean;
  getTemplatePresets?: (values?: CollectionFormConfig) => TemplatePreset[];
}

const TimePeriodSection = ({
  values,
  setFieldValue,
  baseSubtype,
  isVisible = true,
  getTemplatePresets,
}: TimePeriodSectionProps) => {
  const intl = useIntl();

  if (!isVisible) return null;

  const getTimePeriodOptions = (baseType: string): TimePeriodOption[] => {
    return [
      {
        value: 'daily',
        label: 'Daily',
        description: `Most ${baseType} content in the last day`,
      },
      {
        value: 'weekly',
        label: 'Weekly',
        description: `Most ${baseType} content in the last week`,
      },
      {
        value: 'monthly',
        label: 'Monthly',
        description: `Most ${baseType} content in the last month`,
      },
      {
        value: 'all',
        label: 'All Time',
        description: `Most ${baseType} content of all time`,
      },
    ];
  };

  const timePeriodOptions = getTimePeriodOptions(baseSubtype);

  return (
    <div>
      <label
        htmlFor="timePeriod"
        className="mb-2 block text-sm font-medium text-gray-300"
      >
        {intl.formatMessage(messages.timePeriod)}{' '}
        <span className="text-red-500">*</span>
      </label>
      <Field
        as="select"
        id="timePeriod"
        name="timePeriod"
        className="w-full rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          const newTimePeriod = e.target.value;
          setFieldValue('timePeriod', newTimePeriod);

          // Auto-select template when timePeriod is selected (for Trakt subtypes that require it)
          if (newTimePeriod && values.subtype && getTemplatePresets) {
            const templatePresets = getTemplatePresets({
              ...values,
              timePeriod: newTimePeriod,
            } as CollectionFormConfig);
            if (
              templatePresets.length > 0 &&
              templatePresets[0].value !== 'custom' &&
              !values.template // Only auto-select if no template is currently selected
            ) {
              // Auto-select the first non-custom template
              setFieldValue('template', templatePresets[0].value);
            }
          }
        }}
      >
        <option value="">
          {intl.formatMessage(messages.selectTimePeriod)}
        </option>
        {timePeriodOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Field>

      {/* Show description if available */}
      {values.timePeriod &&
        (() => {
          const selectedOption = timePeriodOptions.find(
            (opt) => opt.value === values.timePeriod
          );
          return selectedOption?.description ? (
            <p className="mt-1 text-xs text-gray-400">
              {selectedOption.description}
            </p>
          ) : null;
        })()}
    </div>
  );
};

export default TimePeriodSection;
