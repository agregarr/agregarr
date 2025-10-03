import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';
import useSWR from 'swr';

const messages = defineMessages({
  excludedCountries: 'Excluded Countries',
  excludedCountriesHelp:
    'Exclude items from these countries from being grabbed. Items matching ANY selected country will be skipped.',
  selectCountries: 'Select countries to exclude...',
});

interface Country {
  code: string;
  name: string;
}

interface CountryExclusionProps {
  selectedCountries: string[];
  onSelectionChange: (selectedCodes: string[]) => void;
  disabled?: boolean;
}

const CountryExclusion = ({
  selectedCountries,
  onSelectionChange,
  disabled = false,
}: CountryExclusionProps) => {
  const intl = useIntl();

  // Fetch combined countries (includes both movie and TV origin countries, deduplicated)
  const { data: countries } = useSWR<Country[]>('/api/v1/countries/combined');

  const options = (countries || []).map((country) => ({
    value: country.code,
    label: country.name,
  }));

  const selectedOptions = options.filter((option) =>
    selectedCountries.includes(option.value)
  );

  const handleChange = (
    newSelectedOptions: MultiValue<{ value: string; label: string }>
  ) => {
    const values = newSelectedOptions
      ? newSelectedOptions.map((option) => option.value)
      : [];
    onSelectionChange(values);
  };

  return (
    <div className="mb-6">
      <label className="mb-2 block text-sm text-gray-300">
        {intl.formatMessage(messages.excludedCountries)}
      </label>
      <Select
        isMulti
        options={options}
        value={selectedOptions}
        onChange={handleChange}
        isDisabled={disabled || !countries || countries.length === 0}
        placeholder={intl.formatMessage(messages.selectCountries)}
        menuPlacement="auto"
        classNamePrefix="react-select"
        closeMenuOnSelect={false}
        hideSelectedOptions={false}
        styles={{
          menuPortal: (base) => ({ ...base, zIndex: 9999 }),
          control: (base, state) => ({
            ...base,
            backgroundColor: '#44403c',
            borderColor: state.isFocused ? '#ea580c' : '#78716c',
            '&:hover': {
              borderColor: '#ea580c',
            },
            boxShadow: state.isFocused ? '0 0 0 1px #ea580c' : 'none',
          }),
          menu: (base) => ({
            ...base,
            backgroundColor: '#44403c',
            border: '1px solid #4b5563',
          }),
          option: (base, state) => ({
            ...base,
            backgroundColor: state.isFocused ? '#4b5563' : '#374151',
            color: 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: '16px',
            '&:before': state.isSelected
              ? {
                  content: '"✓"',
                  marginRight: '8px',
                  color: '#6366f1',
                  fontWeight: 'bold',
                }
              : {
                  content: '""',
                  marginRight: '20px',
                },
          }),
          multiValue: (base) => ({
            ...base,
            backgroundColor: '#57534e',
            color: 'white',
          }),
          multiValueLabel: (base) => ({
            ...base,
            color: 'white',
          }),
          multiValueRemove: (base) => ({
            ...base,
            color: '#a8a29e',
            '&:hover': {
              backgroundColor: '#ef4444',
              color: 'white',
            },
          }),
        }}
      />
      <p className="mt-2 text-xs text-gray-400">
        {intl.formatMessage(messages.excludedCountriesHelp)}
      </p>
    </div>
  );
};

export default CountryExclusion;
