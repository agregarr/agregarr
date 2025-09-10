import { useTemplatePreview } from '@app/hooks/useTemplatePreview';
import type {
  CollectionFormConfig,
  Library,
  TemplatePreset,
} from '@app/types/collections';
import { Field, type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { memo, useMemo } from 'react';

interface FetchedTitles {
  [key: string]: string;
}

interface DetectedMediaTypes {
  [key: string]: 'movie' | 'tv' | 'both' | null;
}

interface TemplateSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | null
  ) => void;
  handleChange: (
    e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  touched: FormikTouched<CollectionFormConfig>;
  fetchedTitles: FetchedTitles;
  detectedMediaTypes: DetectedMediaTypes;
  getTemplatePresets: (
    values: CollectionFormConfig,
    fetchedTitles: FetchedTitles,
    detectedMediaTypes: DetectedMediaTypes
  ) => TemplatePreset[];
  isVisible?: boolean;
  currentUser?: {
    id: number;
    displayName: string;
    email: string;
    plexUsername: string;
  };
  libraries?: Library[];
}

// Memoized template preview component to prevent unnecessary re-renders
const TemplatePreviewItem = memo(function TemplatePreviewItem({
  template,
  mediaType,
  type,
  subtype,
  customDays,
}: {
  template: string;
  mediaType: 'movie' | 'tv';
  type?: string;
  subtype?: string;
  customDays?: number;
}) {
  const { preview, loading, error } = useTemplatePreview({
    template,
    mediaType,
    type,
    subtype,
    customDays,
  });

  if (loading) return <span className="text-gray-400">Loading...</span>;
  if (error) return <span className="text-gray-500">Preview unavailable</span>;

  return (
    <span className="text-gray-300">
      {preview || 'Preview will appear here...'}
    </span>
  );
});

const TemplateSection = ({
  values,
  setFieldValue,
  handleChange,
  errors,
  touched,
  fetchedTitles,
  detectedMediaTypes,
  getTemplatePresets,
  isVisible = true,
  libraries = [],
}: TemplateSectionProps) => {
  // Memoize the template-relevant values to prevent unnecessary API calls
  const templateRelevantValues = useMemo(() => {
    const effectiveSubtype =
      values.type === 'trakt' &&
      values.timePeriod &&
      ['played', 'watched', 'collected', 'favorited'].includes(
        values.subtype || ''
      )
        ? `${values.subtype}_${values.timePeriod}`
        : values.subtype;

    return {
      type: values.type,
      subtype: effectiveSubtype,
      customDays: values.customDays
        ? parseInt(values.customDays.toString(), 10)
        : undefined,
    };
  }, [values.type, values.subtype, values.timePeriod, values.customDays]);

  if (!isVisible) return null;

  return (
    <>
      <div className="form-input-field">
        <Field
          as="select"
          id="collectionTemplate"
          name="template"
          value={values.template}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            handleChange(e);
            if (e.target.value !== 'custom') {
              // Clear custom templates when selecting a preset
              setFieldValue('customMovieTemplate', '');
              setFieldValue('customTVTemplate', '');
            }
          }}
        >
          {(() => {
            const templatePresets = getTemplatePresets(
              values,
              fetchedTitles,
              detectedMediaTypes
            );

            // Auto-select the only available option if template is empty
            if (templatePresets.length === 1 && !values.template) {
              setTimeout(
                () => setFieldValue('template', templatePresets[0].value),
                0
              );
            }

            return templatePresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ));
          })()}
        </Field>
      </div>

      {/* Custom template input */}
      {values.template === 'custom' && (
        <div className="mt-2 space-y-3">
          {(() => {
            // Check if user has selected both movie AND TV libraries
            if (!values.libraryIds || !Array.isArray(values.libraryIds)) {
              return null;
            }
            const selectedLibraries = libraries.filter(
              (lib) => values.libraryIds?.includes(lib.key) ?? false
            );
            const hasMovieLib = selectedLibraries.some(
              (lib) => lib.type === 'movie'
            );
            const hasTVLib = selectedLibraries.some(
              (lib) => lib.type === 'show'
            );

            if (hasMovieLib && hasTVLib) {
              // Both movie and TV libraries selected - show separate templates
              return (
                <>
                  {/* Separate movie template */}
                  <div className="form-input-field">
                    <Field
                      type="text"
                      name="customMovieTemplate"
                      placeholder="Movie collection template"
                      onChange={handleChange}
                    />
                    {errors.customMovieTemplate &&
                      touched.customMovieTemplate && (
                        <div className="error">
                          {errors.customMovieTemplate}
                        </div>
                      )}
                  </div>
                  {/* Separate TV template */}
                  <div className="form-input-field">
                    <Field
                      type="text"
                      name="customTVTemplate"
                      placeholder="TV show collection template"
                      onChange={handleChange}
                    />
                    {errors.customTVTemplate && touched.customTVTemplate && (
                      <div className="error">{errors.customTVTemplate}</div>
                    )}
                  </div>
                </>
              );
            } else if (hasMovieLib) {
              // Only movie libraries selected - show movie template
              return (
                <div className="form-input-field">
                  <Field
                    type="text"
                    name="customMovieTemplate"
                    placeholder="Movie collection template"
                    onChange={handleChange}
                  />
                  {errors.customMovieTemplate &&
                    touched.customMovieTemplate && (
                      <div className="error">{errors.customMovieTemplate}</div>
                    )}
                </div>
              );
            } else if (hasTVLib) {
              // Only TV libraries selected - show TV template
              return (
                <div className="form-input-field">
                  <Field
                    type="text"
                    name="customTVTemplate"
                    placeholder="TV show collection template"
                    onChange={handleChange}
                  />
                  {errors.customTVTemplate && touched.customTVTemplate && (
                    <div className="error">{errors.customTVTemplate}</div>
                  )}
                </div>
              );
            }

            return null; // No libraries selected or compatible
          })()}
        </div>
      )}

      {/* Template preview */}
      <div className="mt-3 rounded-md bg-gray-700 p-3">
        <h5 className="mb-2 text-sm font-medium text-white">Preview:</h5>
        <div className="text-sm text-gray-300">
          {(() => {
            // Get the actual template being used (same logic as dropdown)
            const templatePresets = getTemplatePresets(
              values,
              fetchedTitles,
              detectedMediaTypes
            );
            const currentTemplate =
              values.template || templatePresets[0]?.value || '';

            const selectedLibraryIds =
              values.libraryIds ||
              (values.libraryId
                ? Array.isArray(values.libraryId)
                  ? values.libraryId
                  : [values.libraryId]
                : []);
            const hasAllLibraries =
              selectedLibraryIds.includes('all') || values.libraryId === 'all';
            const specificLibraryIds = selectedLibraryIds.filter(
              (id: string) => id !== 'all'
            );
            const hasMultipleSpecificLibraries = specificLibraryIds.length > 1;

            if (hasAllLibraries) {
              return (
                // Show preview for each library when "All Libraries" is selected
                <div className="space-y-2">
                  {libraries.map((library) => {
                    const libraryMediaType =
                      library.type === 'show' ? 'tv' : 'movie';
                    const templateToUse = (() => {
                      if (values.template === 'custom') {
                        if (libraryMediaType === 'movie') {
                          return values.customMovieTemplate || '';
                        } else {
                          return values.customTVTemplate || '';
                        }
                      }
                      return currentTemplate;
                    })();

                    return (
                      <div
                        key={library.key}
                        className="flex items-start space-x-2"
                      >
                        <span className="flex-shrink-0 font-medium text-orange-400">
                          {library.name}:
                        </span>
                        <TemplatePreviewItem
                          template={templateToUse}
                          mediaType={libraryMediaType}
                          type={templateRelevantValues.type}
                          subtype={templateRelevantValues.subtype}
                          customDays={templateRelevantValues.customDays}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            } else if (hasMultipleSpecificLibraries) {
              return (
                // Show preview for each selected specific library
                <div className="space-y-2">
                  {selectedLibraryIds
                    .filter((id) => id !== 'all')
                    .map((libraryId) => {
                      const library = libraries.find(
                        (lib) => lib.key === libraryId
                      );
                      if (!library) return null;

                      const libraryMediaType =
                        library.type === 'show' ? 'tv' : 'movie';
                      const templateToUse = (() => {
                        if (values.template === 'custom') {
                          if (libraryMediaType === 'movie') {
                            return values.customMovieTemplate || '';
                          } else {
                            return values.customTVTemplate || '';
                          }
                        }
                        return currentTemplate;
                      })();

                      return (
                        <div
                          key={library.key}
                          className="flex items-start space-x-2"
                        >
                          <span className="flex-shrink-0 font-medium text-orange-400">
                            {library.name}:
                          </span>
                          <TemplatePreviewItem
                            template={templateToUse}
                            mediaType={libraryMediaType}
                            type={templateRelevantValues.type}
                            subtype={templateRelevantValues.subtype}
                            customDays={templateRelevantValues.customDays}
                          />
                        </div>
                      );
                    })}
                </div>
              );
            } else {
              // Single library or no library selected - show simple preview
              const templateToUse = (() => {
                if (values.template === 'custom') {
                  if (values.mediaType === 'movie') {
                    return values.customMovieTemplate || '';
                  } else if (values.mediaType === 'tv') {
                    return values.customTVTemplate || '';
                  } else {
                    return (
                      values.customMovieTemplate ||
                      values.customTVTemplate ||
                      ''
                    );
                  }
                }
                return currentTemplate;
              })();

              // For single library, determine media type from the actual selected library
              const selectedLibraryId =
                selectedLibraryIds[0] || values.libraryId;
              const selectedLibrary = libraries.find(
                (lib) => lib.key === selectedLibraryId
              );
              const singleLibraryMediaType =
                selectedLibrary?.type === 'show' ? 'tv' : 'movie';

              return (
                <div>
                  <TemplatePreviewItem
                    template={templateToUse}
                    mediaType={singleLibraryMediaType}
                    type={templateRelevantValues.type}
                    subtype={templateRelevantValues.subtype}
                    customDays={templateRelevantValues.customDays}
                  />
                </div>
              );
            }
          })()}
        </div>
      </div>

      {errors.template && touched.template && (
        <div className="error">{errors.template}</div>
      )}
      <div className="label-tip">
        Available variables: Plex Username - {`{username}`} , Plex Nickname -{' '}
        {`{nickname}`} , Plex Server Name - {`{servername}`} , Overseerr Domain
        - {`{domain}`} , Overseerr App Title - {`{appTitle}`} .
      </div>
    </>
  );
};

export default TemplateSection;
