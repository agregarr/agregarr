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
  global: 'Global',
  loadCountriesError: 'Failed to load countries. Please try again.',
  loadPlatformsError: 'Failed to load platforms. Please try again.',
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
  getTemplatePresets?: (
    values: CollectionFormConfig
  ) => { label: string; value: string }[];
}

const NetworksConfigSection = ({
  values,
  setFieldValue,
  isVisible = true,
  getTemplatePresets,
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
          className="mb-2 block text-sm text-gray-300"
        >
          {intl.formatMessage(messages.networksCountry)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id="networksCountry"
          name="networksCountry"
          className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const newCountry = e.target.value;
            setFieldValue('networksCountry', newCountry);

            // Also update sources[0].networksCountry if sources exist (for existing collections)
            if (values.sources && values.sources.length > 0) {
              setFieldValue('sources[0].networksCountry', newCountry);
            }

            // Reset platform selection when country changes
            if (newCountry !== values.networksCountry) {
              setFieldValue('subtype', '');
              // Also reset sources[0].subtype if sources exist
              if (values.sources && values.sources.length > 0) {
                setFieldValue('sources[0].subtype', '');
              }
            }
          }}
          disabled={false}
        >
          <option value="">{intl.formatMessage(messages.selectCountry)}</option>

          {/* Global option - always available */}
          <option value="global">{intl.formatMessage(messages.global)}</option>

          {/* Separator */}
          <option disabled style={{ borderTop: '1px solid #4a5568' }}>
            ────────────────
          </option>

          {/* Loading state or countries */}
          {isLoadingCountries ? (
            <option disabled>
              {intl.formatMessage(messages.loadingCountries)}
            </option>
          ) : (
            Array.isArray(countries) &&
            countries
              .filter((country) => country.value !== 'global') // Exclude global since it's shown above
              .map((country) => (
                <option key={country.value} value={country.value}>
                  {country.label}
                </option>
              ))
          )}
        </Field>
        {countriesError && (
          <p className="mt-1 text-xs text-red-400">
            {intl.formatMessage(messages.loadCountriesError)}
          </p>
        )}
      </div>

      {/* Platform Selection - Only show if country is selected */}
      {values.networksCountry && (
        <div>
          <label htmlFor="subtype" className="mb-2 block text-sm text-gray-300">
            {intl.formatMessage(messages.networksPlatform)}{' '}
            <span className="text-red-500">*</span>
          </label>
          <Field
            as="select"
            id="subtype"
            name="subtype"
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            disabled={isLoadingPlatforms}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              const newPlatform = e.target.value;
              setFieldValue('subtype', newPlatform);

              // Auto-select first template option when platform is selected (same as other collection types)
              if (newPlatform && getTemplatePresets) {
                setTimeout(() => {
                  const tempValues = { ...values, subtype: newPlatform };
                  const presets = getTemplatePresets(tempValues);
                  if (presets.length > 0) {
                    setFieldValue('template', presets[0].value);
                  }
                }, 100); // Same delay as other collection types
              }
            }}
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
              {intl.formatMessage(messages.loadPlatformsError)}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default NetworksConfigSection;
