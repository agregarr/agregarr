import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';
import useSWR from 'swr';

const messages = defineMessages({
  // Genre messages
  genreFilterLabel: 'Genre Filter',
  genreFilterHelp:
    'EXCLUDE mode: Skip items with ANY selected genre. INCLUDE mode: Only grab items with ANY selected genre.',
  selectGenres: 'Select genres...',

  // Country messages
  countryFilterLabel: 'Country Filter',
  countryFilterHelp:
    'EXCLUDE mode: Skip items from ANY selected country. INCLUDE mode: Only grab items from ANY selected country.',
  selectCountries: 'Select countries...',

  // Language messages
  languageFilterLabel: 'Language Filter',
  languageFilterHelp:
    'EXCLUDE mode: Skip items with ANY selected language. INCLUDE mode: Only grab items with ANY selected language.',
  selectLanguages: 'Select languages...',

  // Mode toggle
  modeExclude: 'Exclude',
  modeInclude: 'Include',
});

interface FilterOption {
  value: string | number;
  label: string;
}

interface FilterWithModeProps {
  filterType: 'genres' | 'countries' | 'languages';
  mode: 'exclude' | 'include';
  selectedValues: (string | number)[];
  onModeChange: (mode: 'exclude' | 'include') => void;
  onValuesChange: (values: (string | number)[]) => void;
  disabled?: boolean;
}

const FilterWithMode = ({
  filterType,
  mode,
  selectedValues,
  onModeChange,
  onValuesChange,
  disabled = false,
}: FilterWithModeProps) => {
  const intl = useIntl();

  // Fetch appropriate data based on filter type
  const endpoint =
    filterType === 'genres'
      ? '/api/v1/genres/combined'
      : filterType === 'countries'
      ? '/api/v1/countries/combined'
      : '/api/v1/languages/combined';

  const { data } =
    useSWR<{ id?: number; code?: string; name: string }[]>(endpoint);

  // Map data to select options
  const options: FilterOption[] = (data || []).map((item) => ({
    value: (item.id ?? item.code) as string | number,
    label: item.name,
  }));

  const selectedOptions = options.filter((option) =>
    selectedValues.includes(option.value)
  );

  const handleChange = (newSelectedOptions: MultiValue<FilterOption>) => {
    const values = newSelectedOptions
      ? newSelectedOptions.map((option) => option.value)
      : [];
    onValuesChange(values);
  };

  // Get localized messages based on filter type
  const labelMessage =
    filterType === 'genres'
      ? messages.genreFilterLabel
      : filterType === 'countries'
      ? messages.countryFilterLabel
      : messages.languageFilterLabel;

  const helpMessage =
    filterType === 'genres'
      ? messages.genreFilterHelp
      : filterType === 'countries'
      ? messages.countryFilterHelp
      : messages.languageFilterHelp;

  const placeholderMessage =
    filterType === 'genres'
      ? messages.selectGenres
      : filterType === 'countries'
      ? messages.selectCountries
      : messages.selectLanguages;

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-sm text-gray-300">
          {intl.formatMessage(labelMessage)}
        </label>

        {/* Mode Toggle Button */}
        <div className="flex rounded-md bg-gray-700 p-1">
          <button
            type="button"
            onClick={() => onModeChange('exclude')}
            disabled={disabled}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'exclude'
                ? 'bg-orange-600 text-white'
                : 'text-gray-300 hover:text-white'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            {intl.formatMessage(messages.modeExclude)}
          </button>
          <button
            type="button"
            onClick={() => onModeChange('include')}
            disabled={disabled}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'include'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            {intl.formatMessage(messages.modeInclude)}
          </button>
        </div>
      </div>

      <Select
        isMulti
        options={options}
        value={selectedOptions}
        onChange={handleChange}
        isDisabled={disabled || !data || data.length === 0}
        placeholder={intl.formatMessage(placeholderMessage)}
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
        {intl.formatMessage(helpMessage)}
      </p>
    </div>
  );
};

export default FilterWithMode;
