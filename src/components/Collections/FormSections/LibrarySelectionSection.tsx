import type { CollectionFormConfig, Library } from '@app/types/collections';
import { ErrorMessage, type FormikErrors } from 'formik';
import { defineMessages, useIntl } from 'react-intl';
import Select, { type MultiValue } from 'react-select';

const messages = defineMessages({
  librarySelection: 'Library Selection',
  selectLibraries: 'Select Libraries',
  allLibraries: 'All Libraries',
});

interface LibraryCheckboxDropdownProps {
  selectedLibraries: string[];
  allLibraries: Library[];
  onSelectionChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  error?: string;
  showAllLibrariesOption?: boolean;
}

const LibraryCheckboxDropdown = ({
  selectedLibraries,
  allLibraries,
  onSelectionChange,
  disabled = false,
  error,
  showAllLibrariesOption = true,
}: LibraryCheckboxDropdownProps) => {
  const intl = useIntl();
  const options = [
    ...(showAllLibrariesOption
      ? [{ value: 'all', label: intl.formatMessage(messages.allLibraries) }]
      : []),
    ...allLibraries.map((lib) => ({ value: lib.key, label: lib.name })),
  ];

  const selectedOptions = options.filter((option) =>
    selectedLibraries.includes(option.value)
  );

  const handleChange = (
    newSelectedOptions: MultiValue<{ value: string; label: string }>
  ) => {
    let values = newSelectedOptions
      ? newSelectedOptions.map((option) => option.value)
      : [];

    // If "All Libraries" is selected, only keep that selection
    if (values.includes('all')) {
      values = ['all'];
    }

    onSelectionChange(values);
  };

  return (
    <Select
      isMulti
      options={options}
      value={selectedOptions}
      onChange={handleChange}
      isDisabled={disabled}
      placeholder={intl.formatMessage(messages.selectLibraries)}
      menuPortalTarget={document.body}
      classNamePrefix="react-select"
      closeMenuOnSelect={false}
      hideSelectedOptions={false}
      styles={{
        menuPortal: (base) => ({ ...base, zIndex: 9999 }),
        control: (base, state) => ({
          ...base,
          backgroundColor: '#374151',
          borderColor: error
            ? '#ef4444'
            : state.isFocused
            ? '#6366f1'
            : '#4b5563',
          '&:hover': {
            borderColor: error ? '#ef4444' : '#6366f1',
          },
          boxShadow: state.isFocused
            ? error
              ? '0 0 0 1px #ef4444'
              : '0 0 0 1px #6366f1'
            : 'none',
        }),
        menu: (base) => ({
          ...base,
          backgroundColor: '#374151',
          border: '1px solid #4b5563',
        }),
        option: (base, state) => {
          const isDisabled =
            selectedLibraries.includes('all') && state.data.value !== 'all';
          return {
            ...base,
            backgroundColor: isDisabled
              ? '#374151'
              : state.isFocused
              ? '#4b5563'
              : '#374151',
            color: isDisabled ? '#6b7280' : 'white',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
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
          };
        },
        multiValue: (base) => ({
          ...base,
          backgroundColor: '#4b5563',
          color: 'white',
        }),
        multiValueLabel: (base) => ({
          ...base,
          color: 'white',
        }),
        multiValueRemove: (base) => ({
          ...base,
          color: '#9ca3af',
          '&:hover': {
            backgroundColor: '#ef4444',
            color: 'white',
          },
        }),
      }}
    />
  );
};

interface LibrarySelectionSectionProps {
  values: CollectionFormConfig;
  libraries: Library[];
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | null
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  isEnhancedForm?: boolean;
  isVisible?: boolean;
  filteredLibraries?: Library[];
}

const LibrarySelectionSection = ({
  values,
  libraries,
  setFieldValue,
  errors,
  isEnhancedForm = false,
  isVisible = true,
  filteredLibraries,
}: LibrarySelectionSectionProps) => {
  const intl = useIntl();

  if (!isVisible) return null;

  const librariesToUse = filteredLibraries || libraries;

  if (isEnhancedForm) {
    // Enhanced form - read-only display
    return (
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          {intl.formatMessage(messages.librarySelection)}
        </label>
        <div className="rounded-md border border-gray-600 bg-gray-700 p-3">
          <div className="text-sm text-gray-300">
            {values.libraryIds && Array.isArray(values.libraryIds) ? (
              values.libraryIds.includes('all') ? (
                <span className="font-medium text-orange-300">
                  All Libraries
                </span>
              ) : (
                values.libraryIds.map((id: string, index: number) => {
                  const library = librariesToUse.find((lib) => lib.key === id);
                  return (
                    <span key={id}>
                      {library?.name || `Library ${id}`}
                      {index < (values.libraryIds?.length || 0) - 1 && ', '}
                    </span>
                  );
                })
              )
            ) : values.libraryId ? (
              (() => {
                const library = librariesToUse.find(
                  (lib) => lib.key === values.libraryId
                );
                return library?.name || `Library ${values.libraryId}`;
              })()
            ) : (
              <span className="italic text-gray-500">
                No libraries selected
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Regular form - editable
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-300">
        {intl.formatMessage(messages.librarySelection)}{' '}
        <span className="text-red-500">*</span>
      </label>

      <LibraryCheckboxDropdown
        selectedLibraries={values.libraryIds || []}
        allLibraries={librariesToUse}
        onSelectionChange={(selectedIds) => {
          setFieldValue('libraryIds', selectedIds);
        }}
        error={
          typeof errors.libraryIds === 'string' ? errors.libraryIds : undefined
        }
        showAllLibrariesOption={true}
      />

      <ErrorMessage
        name="libraryIds"
        component="div"
        className="mt-1 text-sm text-red-500"
      />

      {/* Helper text */}
      <p className="mt-2 text-xs text-gray-400">
        Select the libraries where this collection should appear. Choose
        &quot;All Libraries&quot; to automatically include all libraries of the
        appropriate type.
      </p>

      {/* Note: Warning for "both" media type removed - no longer supported */}
    </div>
  );
};

export default LibrarySelectionSection;
export { LibraryCheckboxDropdown };
