import type { CollectionFormConfig } from '@app/types/collections';
import { Field, type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';

interface OriginalsProviderOption {
  value: string;
  label: string;
}

const messages = defineMessages({
  originalsProvider: 'Streaming Service',
  selectProvider: 'Select streaming service...',
  loadingProviders: 'Loading streaming services...',
});

interface OriginalsConfigSectionProps {
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

const OriginalsConfigSection = ({
  setFieldValue,
  isVisible = true,
}: OriginalsConfigSectionProps) => {
  const intl = useIntl();

  // Fetch available streaming providers for originals
  const { data: providers, error: providersError } = useSWR<
    OriginalsProviderOption[]
  >('/api/v1/collections/originals/providers', (url) =>
    fetch(url).then((res) => {
      if (!res.ok) {
        throw new Error('Failed to fetch providers');
      }
      return res.json();
    })
  );

  const isLoadingProviders = !providers && !providersError;

  if (!isVisible) return null;

  return (
    <div className="space-y-4">
      {/* Provider Selection */}
      <div>
        <label htmlFor="subtype" className="mb-2 block text-sm text-gray-300">
          {intl.formatMessage(messages.originalsProvider)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <Field
          as="select"
          id="subtype"
          name="subtype"
          className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            const newProvider = e.target.value;
            setFieldValue('subtype', newProvider);
          }}
          disabled={isLoadingProviders}
        >
          <option value="">
            {isLoadingProviders
              ? intl.formatMessage(messages.loadingProviders)
              : intl.formatMessage(messages.selectProvider)}
          </option>

          {providers &&
            Array.isArray(providers) &&
            providers.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
        </Field>
      </div>
    </div>
  );
};

export default OriginalsConfigSection;
