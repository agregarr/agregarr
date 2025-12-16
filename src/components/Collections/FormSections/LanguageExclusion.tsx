import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';
import useSWR from 'swr';

const messages = defineMessages({
  excludedLanguages: 'Excluded Languages',
  excludedLanguagesHelp:
    'Exclude items with these spoken languages from being grabbed. Items matching ANY selected language will be skipped.',
  selectLanguages: 'Select languages to exclude...',
});

interface Language {
  code: string;
  name: string;
}

interface LanguageExclusionProps {
  selectedLanguages: string[];
  onSelectionChange: (selectedCodes: string[]) => void;
  disabled?: boolean;
}

const LanguageExclusion = ({
  selectedLanguages,
  onSelectionChange,
  disabled = false,
}: LanguageExclusionProps) => {
  const intl = useIntl();

  // Fetch combined languages (curated list of common languages)
  const { data: languages } = useSWR<Language[]>('/api/v1/languages/combined');

  const options = (languages || []).map((language) => ({
    value: language.code,
    label: language.name,
  }));

  const selectedOptions = options.filter((option) =>
    selectedLanguages.includes(option.value)
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
        {intl.formatMessage(messages.excludedLanguages)}
      </label>
      <Select
        isMulti
        options={options}
        value={selectedOptions}
        onChange={handleChange}
        isDisabled={disabled || !languages || languages.length === 0}
        placeholder={intl.formatMessage(messages.selectLanguages)}
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
        {intl.formatMessage(messages.excludedLanguagesHelp)}
      </p>
    </div>
  );
};

export default LanguageExclusion;
