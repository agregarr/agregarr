import type { CollectionFormConfig } from '@app/types/collections';
import { Field, type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

interface NetworksCountryOption {
  value: string;
  label: string;
}

interface NetworksPlatformOption {
  value: string;
  label: string;
}

const messages = defineMessages({
  networksCountry: 'Country/Region',
  networksPlatform: 'Streaming Platform',
  selectCountry: 'Select country...',
  selectPlatform: 'Select platform...',
  loadingCountries: 'Loading countries...',
  loadingPlatforms: 'Loading platforms...',
});

interface NetworksConfigSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | undefined
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  touched: FormikTouched<CollectionFormConfig>;
  isVisible?: boolean;
}

const NetworksConfigSection = ({
  values,
  setFieldValue,
  isVisible = true,
}: NetworksConfigSectionProps) => {
  const intl = useIntl();

  // Fetch available countries
  const { data: countries, error: countriesError } = useSWR<
    NetworksCountryOption[]
  >('/api/v1/collections/networks/countries', (url) =>
    fetch(url).then((res) => res.json())
  );

  // Fetch available platforms for selected country
  const platformsUrl = values.networksCountry
    ? `/api/v1/collections/networks/platforms?country=${encodeURIComponent(
        values.networksCountry
      )}`
    : null;

  const { data: platforms, error: platformsError } = useSWR<
    NetworksPlatformOption[]
  >(platformsUrl, (url) => fetch(url).then((res) => res.json()));

  const isLoadingCountries = !countries && !countriesError;
  const isLoadingPlatforms =
    values.networksCountry && !platforms && !platformsError;

  if (!isVisible) return null;

  return (
    <div className="space-y-4">
      {/* Country Selection */}
      <div>
        <label
          htmlFor="networksCountry"
          className="mb-2 block text-sm font-medium text-gray-300"
        >
          {intl.formatMessage(messages.networksCountry)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id="networksCountry"
          name="networksCountry"
          className="w-full rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const newCountry = e.target.value;
            setFieldValue('networksCountry', newCountry);

            // Reset platform selection when country changes
            if (newCountry !== values.networksCountry) {
              setFieldValue('subtype', '');
            }
          }}
          disabled={isLoadingCountries}
        >
          <option value="">
            {isLoadingCountries
              ? intl.formatMessage(messages.loadingCountries)
              : intl.formatMessage(messages.selectCountry)}
          </option>
          {Array.isArray(countries) &&
            countries.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
        </Field>
        {countriesError && (
          <p className="mt-1 text-xs text-red-400">
            Failed to load countries. Please try again.
          </p>
        )}
      </div>

      {/* Platform Selection - Only show if country is selected */}
      {values.networksCountry && (
        <div>
          <label
            htmlFor="subtype"
            className="mb-2 block text-sm font-medium text-gray-300"
          >
            {intl.formatMessage(messages.networksPlatform)}{' '}
            <span className="text-red-500">*</span>
          </label>
          <Field
            as="select"
            id="subtype"
            name="subtype"
            className="w-full rounded-md border border-gray-600 bg-gray-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            disabled={isLoadingPlatforms}
          >
            <option value="">
              {isLoadingPlatforms
                ? intl.formatMessage(messages.loadingPlatforms)
                : intl.formatMessage(messages.selectPlatform)}
            </option>
            {Array.isArray(platforms) &&
              platforms.map((platform) => (
                <option key={platform.value} value={platform.value}>
                  {platform.label}
                </option>
              ))}
          </Field>
          {platformsError && (
            <p className="mt-1 text-xs text-red-400">
              Failed to load platforms. Please try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default NetworksConfigSection;
