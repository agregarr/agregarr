import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';
import useSWR from 'swr';
import IncludeExcludeToggle from '@app/components/Common/IncludeExcludeToggle';

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

  // Select all/none
  selectAll: 'Select All',
  deselectAll: 'Deselect All',
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

  const handleSelectAll = () => {
    const allValues = options.map((option) => option.value);
    onValuesChange(allValues);
  };

  const handleDeselectAll = () => {
    onValuesChange([]);
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

        <IncludeExcludeToggle
          mode={mode}
          onModeChange={onModeChange}
          disabled={disabled}
        />
      </div>

      {/* Select All / Deselect All buttons */}
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={handleSelectAll}
          disabled={disabled || !data || data.length === 0}
          className="text-xs text-gray-400 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {intl.formatMessage(messages.selectAll)}
        </button>
        <span className="text-xs text-gray-600">|</span>
        <button
          type="button"
          onClick={handleDeselectAll}
          disabled={disabled || selectedValues.length === 0}
          className="text-xs text-gray-400 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {intl.formatMessage(messages.deselectAll)}
        </button>
      </div>

      <Select
        isMulti
        options={options}
        value={selectedOptions}
        onChange={handleChange}
        isDisabled={disabled || !data || data.length === 0}
        placeholder={intl.formatMessage(placeholderMessage)}
        menuPlacement="auto"
        className="react-select-container"
        classNamePrefix="react-select"
        closeMenuOnSelect={false}
        hideSelectedOptions={false}
      />
      <p className="mt-2 text-xs text-gray-400">
        {intl.formatMessage(helpMessage)}
      </p>
    </div>
  );
};

export default FilterWithMode;
