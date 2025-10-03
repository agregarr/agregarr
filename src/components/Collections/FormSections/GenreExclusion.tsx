import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';
import useSWR from 'swr';

const messages = defineMessages({
  excludedGenres: 'Excluded Genres',
  excludedGenresHelp:
    'Exclude items with these genres from being grabbed. Items matching ANY selected genre will be skipped.',
  selectGenres: 'Select genres to exclude...',
});

interface Genre {
  id: number;
  name: string;
}

interface GenreExclusionProps {
  selectedGenres: number[];
  onSelectionChange: (selectedIds: number[]) => void;
  disabled?: boolean;
}

const GenreExclusion = ({
  selectedGenres,
  onSelectionChange,
  disabled = false,
}: GenreExclusionProps) => {
  const intl = useIntl();

  // Fetch combined genres (includes both movie and TV genres, deduplicated)
  const { data: genres } = useSWR<Genre[]>('/api/v1/genres/combined');

  const options = (genres || []).map((genre) => ({
    value: genre.id,
    label: genre.name,
  }));

  const selectedOptions = options.filter((option) =>
    selectedGenres.includes(option.value)
  );

  const handleChange = (
    newSelectedOptions: MultiValue<{ value: number; label: string }>
  ) => {
    const values = newSelectedOptions
      ? newSelectedOptions.map((option) => option.value)
      : [];
    onSelectionChange(values);
  };

  return (
    <div className="mb-6">
      <label className="mb-2 block text-sm text-gray-300">
        {intl.formatMessage(messages.excludedGenres)}
      </label>
      <Select
        isMulti
        options={options}
        value={selectedOptions}
        onChange={handleChange}
        isDisabled={disabled || !genres || genres.length === 0}
        placeholder={intl.formatMessage(messages.selectGenres)}
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
        {intl.formatMessage(messages.excludedGenresHelp)}
      </p>
    </div>
  );
};

export default GenreExclusion;
