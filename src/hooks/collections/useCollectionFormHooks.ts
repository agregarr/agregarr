import type { CollectionFormConfig, Library } from '@app/types/collections';
import { CollectionFormConfigUtils } from '@app/types/collections';
import { ValidationHelpers } from '@app/utils/collections/validation';
import { useCallback, useMemo, useState } from 'react';

/**
 * Custom hooks for CollectionFormConfigForm
 */

// Types for hook parameters and returns
interface UseCollectionValidationOptions {
  libraries?: Library[];
  realTimeValidation?: boolean;
}

interface UseCollectionValidationReturn {
  validateForm: (values: Record<string, unknown>) => Record<string, string>;
  validateField: (
    fieldName: string,
    value: unknown,
    allValues: Record<string, unknown>
  ) => string | null;
  isFieldValid: (
    fieldName: string,
    value: unknown,
    allValues: Record<string, unknown>
  ) => boolean;
  getFieldError: (
    fieldName: string,
    value: unknown,
    allValues: Record<string, unknown>
  ) => string | null;
}

interface UseLibrarySelectionOptions {
  libraries: Library[];
  mediaType?: 'movie' | 'tv' | 'both';
  detectedMediaType?: 'movie' | 'tv' | 'both' | null;
}

interface UseLibrarySelectionReturn {
  filteredLibraries: Library[];
  availableLibraries: Library[];
  isLibraryCompatible: (library: Library) => boolean;
  validateLibrarySelection: (selectedIds: string[]) => string | null;
  getLibrarySelectionWarning: (selectedIds: string[]) => string | null;
}

interface UseTitleFetchingOptions {
  onSuccess?: (title: string, mediaType?: 'movie' | 'tv' | 'both') => void;
  onError?: (error: string) => void;
}

interface UseTitleFetchingReturn {
  fetchTraktTitle: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchTmdbTitle: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchImdbTitle: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchLetterboxdTitle: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchMdblistTitle: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  isLoading: boolean;
  lastError: string | null;
}

/**
 * useCollectionValidation - Custom validation hook
 */
export const useCollectionValidation = ({
  libraries = [],
  realTimeValidation = true,
}: UseCollectionValidationOptions = {}): UseCollectionValidationReturn => {
  const validateForm = useCallback(
    (values: Partial<CollectionFormConfig>): Record<string, string> => {
      // Convert readonly properties to mutable for validation
      const mutableValues = JSON.parse(JSON.stringify(values));
      return ValidationHelpers.validateForm(mutableValues, libraries);
    },
    [libraries]
  );

  const validateField = useCallback(
    (
      fieldName: string,
      value: unknown,
      allValues: Partial<CollectionFormConfig>
    ): string | null => {
      // Convert readonly properties to mutable for validation
      const mutableValues = JSON.parse(JSON.stringify(allValues));

      switch (fieldName) {
        case 'template':
        case 'customMovieTemplate':
        case 'customTVTemplate':
          return ValidationHelpers.validateTemplates(mutableValues);

        case 'libraryIds':
          return ValidationHelpers.validateLibrarySelection(
            mutableValues,
            libraries
          );

        case 'traktCustomListUrl':
        case 'tmdbCustomCollectionUrl':
        case 'imdbCustomListUrl':
        case 'letterboxdCustomListUrl':
          return ValidationHelpers.validateCustomUrl(mutableValues);

        case 'visibilityConfig':
          return ValidationHelpers.validateVisibility(mutableValues);

        case 'searchMissingMovies':
        case 'autoApproveMovies':
        case 'searchMissingTV':
        case 'autoApproveTV':
        case 'maxSeasonsToRequest':
          return ValidationHelpers.validateAutoRequest(mutableValues);

        case 'timeRestriction':
          return ValidationHelpers.validateTimeRestrictions(mutableValues);

        default:
          return null;
      }
    },
    [libraries]
  );

  const isFieldValid = useCallback(
    (
      fieldName: string,
      value: unknown,
      allValues: Partial<CollectionFormConfig>
    ): boolean => {
      if (!realTimeValidation) return true;
      return validateField(fieldName, value, allValues) === null;
    },
    [validateField, realTimeValidation]
  );

  const getFieldError = useCallback(
    (
      fieldName: string,
      value: unknown,
      allValues: Partial<CollectionFormConfig>
    ): string | null => {
      if (!realTimeValidation) return null;
      return validateField(fieldName, value, allValues);
    },
    [validateField, realTimeValidation]
  );

  return {
    validateForm: validateForm as (
      values: Record<string, unknown>
    ) => Record<string, string>,
    validateField: validateField as (
      fieldName: string,
      value: unknown,
      allValues: Record<string, unknown>
    ) => string | null,
    isFieldValid: isFieldValid as (
      fieldName: string,
      value: unknown,
      allValues: Record<string, unknown>
    ) => boolean,
    getFieldError: getFieldError as (
      fieldName: string,
      value: unknown,
      allValues: Record<string, unknown>
    ) => string | null,
  };
};

/**
 * useLibrarySelection - Library filtering and validation hook
 */
export const useLibrarySelection = ({
  libraries,
  mediaType,
  detectedMediaType,
}: UseLibrarySelectionOptions): UseLibrarySelectionReturn => {
  // Filter libraries based on media type compatibility
  const filteredLibraries = useMemo(() => {
    const effectiveMediaType = detectedMediaType || mediaType;

    if (!effectiveMediaType || effectiveMediaType === 'both') {
      return libraries;
    }

    return libraries.filter((lib) => {
      // Handle TV vs show type mapping
      const libraryType = lib.type === 'show' ? 'tv' : lib.type;
      return libraryType === effectiveMediaType;
    });
  }, [libraries, mediaType, detectedMediaType]);

  // Get all available libraries
  const availableLibraries = useMemo(() => {
    return libraries;
  }, [libraries]);

  // Check if a library is compatible with current media type
  const isLibraryCompatible = useCallback(
    (library: Library): boolean => {
      const effectiveMediaType = detectedMediaType || mediaType;

      if (!effectiveMediaType || effectiveMediaType === 'both') {
        return true;
      }

      const libraryType = library.type === 'show' ? 'tv' : library.type;
      return libraryType === effectiveMediaType;
    },
    [mediaType, detectedMediaType]
  );

  // Validate library selection
  const validateLibrarySelection = useCallback(
    (selectedIds: string[]): string | null => {
      return ValidationHelpers.validateLibrarySelection(
        { libraryIds: selectedIds, mediaType } as CollectionFormConfig,
        libraries
      );
    },
    [mediaType, libraries]
  );

  // Get warning message for library selection
  const getLibrarySelectionWarning = useCallback(
    (selectedIds: string[]): string | null => {
      // Note: No longer need warning about "both" media type since we removed it

      if (detectedMediaType && mediaType !== detectedMediaType) {
        return `Detected media type (${detectedMediaType}) differs from selected media type (${mediaType}). Some items may be filtered out.`;
      }

      const selectedLibraries = libraries.filter((lib) =>
        selectedIds.includes(lib.key)
      );
      const incompatibleLibraries = selectedLibraries.filter(
        (lib) => !isLibraryCompatible(lib)
      );

      if (incompatibleLibraries.length > 0) {
        return `Some selected libraries (${incompatibleLibraries
          .map((l) => l.name)
          .join(', ')}) may not be compatible with the selected media type.`;
      }

      return null;
    },
    [mediaType, detectedMediaType, libraries, isLibraryCompatible]
  );

  return {
    filteredLibraries,
    availableLibraries,
    isLibraryCompatible,
    validateLibrarySelection,
    getLibrarySelectionWarning,
  };
};

/**
 * useTitleFetching - Custom URL title fetching hook
 */
export const useTitleFetching = ({
  onSuccess,
  onError,
}: UseTitleFetchingOptions = {}): UseTitleFetchingReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const fetchTitle = useCallback(
    async (
      url: string,
      type: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd' | 'mdblist',
      setFieldValue?: (field: string, value: string) => void
    ) => {
      if (!url.trim()) {
        const error = `${type.toUpperCase()} URL is required`;
        setLastError(error);
        onError?.(error);
        return;
      }

      setIsLoading(true);
      setLastError(null);

      try {
        const response = await fetch('/api/v1/collections/fetch-title', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, type }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `Failed to fetch ${type} title`);
        }

        const data = await response.json();

        if (data.title) {
          // Update form field if setFieldValue is provided
          if (setFieldValue) {
            setFieldValue('template', data.title);

            // Set detected media type if available
            if (data.mediaType) {
              setFieldValue('mediaType', data.mediaType);
            }
          }

          onSuccess?.(data.title, data.mediaType);
        } else {
          throw new Error(`No title found for ${type} URL`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : `Failed to fetch ${type} title`;
        setLastError(errorMessage);
        onError?.(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess, onError]
  );

  const fetchTraktTitle = useCallback(
    (url: string, setFieldValue?: (field: string, value: string) => void) => {
      return fetchTitle(url, 'trakt', setFieldValue);
    },
    [fetchTitle]
  );

  const fetchTmdbTitle = useCallback(
    (url: string, setFieldValue?: (field: string, value: string) => void) => {
      return fetchTitle(url, 'tmdb', setFieldValue);
    },
    [fetchTitle]
  );

  const fetchImdbTitle = useCallback(
    (url: string, setFieldValue?: (field: string, value: string) => void) => {
      return fetchTitle(url, 'imdb', setFieldValue);
    },
    [fetchTitle]
  );

  const fetchLetterboxdTitle = useCallback(
    (url: string, setFieldValue?: (field: string, value: string) => void) => {
      return fetchTitle(url, 'letterboxd', setFieldValue);
    },
    [fetchTitle]
  );

  const fetchMdblistTitle = useCallback(
    (url: string, setFieldValue?: (field: string, value: string) => void) => {
      return fetchTitle(url, 'mdblist', setFieldValue);
    },
    [fetchTitle]
  );

  return {
    fetchTraktTitle,
    fetchTmdbTitle,
    fetchImdbTitle,
    fetchLetterboxdTitle,
    fetchMdblistTitle,
    isLoading,
    lastError,
  };
};

/**
 * useFormBehavior - Complex form behavior management
 */
interface UseFormBehaviorOptions {
  config?: CollectionFormConfig;
  libraries?: Library[];
}

interface UseFormBehaviorReturn {
  // Form type detection
  isEnhancedForm: boolean;
  isRegularForm: boolean;
  isDefaultPlexHub: boolean;
  isPreExistingCollection: boolean;
  isLinked: boolean;

  // Conditional field visibility
  shouldShowField: (
    fieldName: string,
    values: Partial<CollectionFormConfig>
  ) => boolean;
  shouldShowSection: (
    sectionName: string,
    values: Partial<CollectionFormConfig>
  ) => boolean;

  // Form state helpers
  getFormTitle: (values: Partial<CollectionFormConfig>) => string;
  getFormDescription: () => string;

  // Field behavior
  isFieldReadOnly: (fieldName: string) => boolean;
  isFieldRequired: (
    fieldName: string,
    values: Partial<CollectionFormConfig>
  ) => boolean;
}

export const useFormBehavior = ({
  config,
  libraries,
}: UseFormBehaviorOptions = {}): UseFormBehaviorReturn => {
  // Form type detection
  const isEnhancedForm = useMemo(() => {
    const isPreExistingCollection = config
      ? CollectionFormConfigUtils.isPreExisting(config)
      : false;
    const isDefaultPlexHub = config
      ? CollectionFormConfigUtils.isDefaultPlexHub(config)
      : false;
    const isLinked = config ? Boolean(config.isLinked) : false;

    return isPreExistingCollection || isDefaultPlexHub || isLinked;
  }, [config]);

  const isRegularForm = !isEnhancedForm;
  const isDefaultPlexHub = config
    ? CollectionFormConfigUtils.isDefaultPlexHub(config)
    : false;
  const isPreExistingCollection = config
    ? CollectionFormConfigUtils.isPreExisting(config) &&
      config.configType !== 'hub'
    : false;
  const isLinked = config ? Boolean(config.isLinked) : false;

  // Conditional field visibility
  const shouldShowField = useCallback(
    (fieldName: string, values: Partial<CollectionFormConfig>): boolean => {
      switch (fieldName) {
        case 'type':
        case 'subtype':
          return isRegularForm;

        case 'customDays':
          return values.type === 'tautulli';

        case 'traktCustomListUrl':
          return values.type === 'trakt' && values.subtype === 'custom';

        case 'tmdbCustomCollectionUrl':
          return values.type === 'tmdb' && values.subtype === 'custom';

        case 'imdbCustomListUrl':
          return values.type === 'imdb' && values.subtype === 'custom';

        case 'letterboxdCustomListUrl':
          return values.type === 'letterboxd' && values.subtype === 'custom';

        case 'template':
          return isRegularForm;

        case 'customMovieTemplate':
        case 'customTVTemplate': {
          // Show custom templates when user has selected both movie AND TV libraries
          if (
            !isRegularForm ||
            !values.libraryIds ||
            !Array.isArray(values.libraryIds)
          ) {
            return false;
          }
          const selectedLibraries = (libraries || []).filter(
            (lib: Library) => values.libraryIds?.includes(lib.key) ?? false
          );
          const hasMovieLib = selectedLibraries.some(
            (lib: Library) => lib.type === 'movie'
          );
          const hasTVLib = selectedLibraries.some(
            (lib: Library) => lib.type === 'show'
          );
          return hasMovieLib && hasTVLib;
        }

        case 'libraryIds':
          return true; // Always show library selection

        case 'maxItems':
          return isRegularForm;

        case 'customPoster':
          return !isDefaultPlexHub; // Hide for default Plex hubs

        case 'searchMissingMovies':
        case 'autoApproveMovies':
        case 'searchMissingTV':
        case 'autoApproveTV':
        case 'maxSeasonsToRequest':
          return Boolean(
            isRegularForm &&
              values.type &&
              ['trakt', 'tmdb', 'imdb', 'letterboxd'].includes(values.type)
          );

        default:
          return true;
      }
    },
    [isRegularForm, isDefaultPlexHub, libraries]
  );

  const shouldShowSection = useCallback(
    (sectionName: string, values: Partial<CollectionFormConfig>): boolean => {
      switch (sectionName) {
        case 'collectionType':
          return isRegularForm;

        case 'customUrls':
          return Boolean(
            isRegularForm && values.type && values.subtype === 'custom'
          );

        case 'librarySelection':
          return Boolean(values.type && values.subtype);

        case 'template':
          return Boolean(isRegularForm && values.type && values.subtype);

        case 'visibility':
          return true; // Always show visibility

        case 'timeRestrictions':
          return true; // Always show time restrictions

        case 'autoRequest':
          return Boolean(
            isRegularForm &&
              values.type &&
              ['trakt', 'tmdb', 'imdb', 'letterboxd'].includes(values.type)
          );

        default:
          return true;
      }
    },
    [isRegularForm]
  );

  const getFormTitle = useCallback(
    (values: Partial<CollectionFormConfig>): string => {
      if (config?.name) {
        return values.name || 'Edit Collection';
      }
      return 'Add New Collection';
    },
    [config]
  );

  const getFormDescription = useCallback((): string => {
    if (isPreExistingCollection) {
      return 'Pre-existing collection with limited configuration options';
    }
    if (isDefaultPlexHub) {
      return 'Built-in Plex hub with limited configuration options';
    }
    if (isLinked) {
      return 'Linked hub - changes will apply to all linked libraries';
    }
    return 'Configure collection settings';
  }, [isPreExistingCollection, isDefaultPlexHub, isLinked]);

  const isFieldReadOnly = useCallback(
    (fieldName: string): boolean => {
      if (isEnhancedForm) {
        switch (fieldName) {
          case 'type':
          case 'subtype':
          case 'template':
          case 'libraryIds':
            return true;
          default:
            return false;
        }
      }
      return false;
    },
    [isEnhancedForm]
  );

  const isFieldRequired = useCallback(
    (fieldName: string, values: Partial<CollectionFormConfig>): boolean => {
      switch (fieldName) {
        case 'type':
        case 'subtype':
        case 'template':
        case 'libraryIds':
        case 'mediaType':
          return !isEnhancedForm;

        case 'customDays':
          return values.type === 'tautulli';

        case 'traktCustomListUrl':
          return values.type === 'trakt' && values.subtype === 'custom';

        case 'tmdbCustomCollectionUrl':
          return values.type === 'tmdb' && values.subtype === 'custom';

        case 'imdbCustomListUrl':
          return values.type === 'imdb' && values.subtype === 'custom';

        case 'letterboxdCustomListUrl':
          return values.type === 'letterboxd' && values.subtype === 'custom';

        default:
          return false;
      }
    },
    [isEnhancedForm]
  );

  return {
    isEnhancedForm,
    isRegularForm,
    isDefaultPlexHub,
    isPreExistingCollection,
    isLinked,
    shouldShowField,
    shouldShowSection,
    getFormTitle,
    getFormDescription,
    isFieldReadOnly,
    isFieldRequired,
  };
};
