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

    // If "All Libraries" is selected, expand to all individual library IDs
    if (values.includes('all')) {
      values = allLibraries.map((lib) => lib.key);
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
      menuPlacement="auto"
      classNamePrefix="react-select"
      closeMenuOnSelect={false}
      hideSelectedOptions={false}
      styles={{
        menuPortal: (base) => ({ ...base, zIndex: 9999 }),
        control: (base, state) => ({
          ...base,
          backgroundColor: '#44403c',
          borderColor: error
            ? '#ef4444'
            : state.isFocused
            ? '#ea580c'
            : '#78716c',
          '&:hover': {
            borderColor: error ? '#ef4444' : '#ea580c',
          },
          boxShadow: state.isFocused
            ? error
              ? '0 0 0 1px #ef4444'
              : '0 0 0 1px #ea580c'
            : 'none',
        }),
        menu: (base) => ({
          ...base,
          backgroundColor: '#44403c',
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
  detectedMediaType?: 'movie' | 'tv' | 'both';
  isDetectingMediaType?: boolean;
}

const LibrarySelectionSection = ({
  values,
  libraries,
  setFieldValue,
  errors,
  isEnhancedForm = false,
  isVisible = true,
  filteredLibraries,
  detectedMediaType,
  isDetectingMediaType = false,
}: LibrarySelectionSectionProps) => {
  const intl = useIntl();

  if (!isVisible) return null;

  const librariesToUse = filteredLibraries || libraries;

  // Generate message based on detected media type or detection state
  const getMediaTypeMessage = (): {
    message: string;
    type: 'warning' | 'info' | 'success';
  } | null => {
    // Show loading state if currently detecting
    if (isDetectingMediaType) {
      return {
        message: 'Analyzing list content to detect media types...',
        type: 'info',
      };
    }

    // Show success message if both types detected
    if (detectedMediaType === 'both') {
      return {
        message: 'List contains both Movies and TV Shows.',
        type: 'success',
      };
    }

    // Show warning if specific media type detected
    if (detectedMediaType === 'movie' || detectedMediaType === 'tv') {
      const mediaTypeLabel =
        detectedMediaType === 'movie' ? 'Movies' : 'TV Shows';
      const oppositeTypeLabel =
        detectedMediaType === 'movie' ? 'TV Shows' : 'Movies';

      return {
        message: `Detected ${mediaTypeLabel} only. ${oppositeTypeLabel} collections will be empty until matching content is added.`,
        type: 'warning',
      };
    }

    return null;
  };

  const messageData = getMediaTypeMessage();

  // For custom lists, always show a message area to prevent layout jumping
  const shouldShowMessageArea = values.subtype === 'custom';

  if (isEnhancedForm) {
    // Enhanced form - read-only display
    return (
      <div>
        <label className="mb-2 block text-sm text-gray-300">
          {intl.formatMessage(messages.librarySelection)}
        </label>
        <div className="rounded-md border border-stone-500 bg-stone-800 p-3">
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
      <label className="mb-2 block text-sm text-gray-300">
        {intl.formatMessage(messages.librarySelection)}{' '}
        <span className="text-red-500">*</span>
      </label>

      {/* Media type detection feedback - always visible for custom lists to prevent layout jumping */}
      {shouldShowMessageArea && (
        <div className="mb-2 min-h-[1.25rem]">
          {messageData && (
            <p
              className={`text-xs ${
                messageData.type === 'info'
                  ? 'text-gray-400'
                  : messageData.type === 'success'
                  ? 'text-green-400'
                  : 'text-amber-400'
              }`}
            >
              {messageData.message}
            </p>
          )}
        </div>
      )}

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
        Select the libraries where collections should be created
      </p>

      {/* Note: Warning for "both" media type removed - no longer supported */}
    </div>
  );
};

export default LibrarySelectionSection;
export { LibraryCheckboxDropdown };
