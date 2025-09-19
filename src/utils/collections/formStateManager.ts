import type {
  CollectionFormConfig,
  CollectionFormConfigForEditing,
  Library,
  VisibilityCheckboxState,
} from '@app/types/collections';
import { CollectionFormConfigUtils } from '@app/types/collections';
import { useCallback, useState } from 'react';

export interface FormState {
  // Loading states
  isLoadingTitle: {
    trakt: boolean;
    tmdb: boolean;
    imdb: boolean;
    letterboxd: boolean;
  };

  // Poster upload state
  posterUploading: boolean;

  // Detected media types from custom URLs
  detectedMediaTypes: {
    trakt: 'movie' | 'tv' | 'both' | null;
    tmdb: 'movie' | 'tv' | 'both' | null;
    imdb: 'movie' | 'tv' | 'both' | null;
    letterboxd: 'movie' | 'tv' | 'both' | null;
  };

  // Form state flags
  showSeparateTemplates: boolean;

  // Collection linking states
  isLinked: boolean;
  canBeLinked: boolean;
}

export interface FormStateActions {
  // Loading state management
  setTitleLoading: (
    type: keyof FormState['isLoadingTitle'],
    loading: boolean
  ) => void;
  setPosterUploading: (loading: boolean) => void;

  // Media type detection
  setDetectedMediaType: (
    type: keyof FormState['detectedMediaTypes'],
    mediaType: 'movie' | 'tv' | 'both' | null
  ) => void;

  // Template management
  setShowSeparateTemplates: (show: boolean) => void;

  // Collection linking
  setLinkedState: (
    isLinked: boolean,
    linkedHub: boolean,
    canLink: boolean
  ) => void;

  // Reset functions
  resetLoadingStates: () => void;
  resetDetectedMediaTypes: () => void;
  resetAllState: () => void;
}

export interface FormStateManager extends FormState, FormStateActions {}

const initialFormState: FormState = {
  isLoadingTitle: {
    trakt: false,
    tmdb: false,
    imdb: false,
    letterboxd: false,
  },
  posterUploading: false,
  detectedMediaTypes: {
    trakt: null,
    tmdb: null,
    imdb: null,
    letterboxd: null,
  },
  showSeparateTemplates: false,
  isLinked: false,
  canBeLinked: false,
};

/**
 * FormStateManager - Centralized state management for CollectionFormConfigForm
 *
 * Manages complex form state that isn't directly related to the form values
 * but affects form behavior, UI state, and user interactions.
 */
export const useFormStateManager = (
  config?: CollectionFormConfig
): FormStateManager => {
  const [state, setState] = useState<FormState>(() => ({
    ...initialFormState,
    // Initialize state based on config
    isLinked: Boolean((config as CollectionFormConfigForEditing)?.isLinked),
    canBeLinked: config
      ? CollectionFormConfigUtils.canLinkCollection(
          config as CollectionFormConfigForEditing
        )
      : true,
    showSeparateTemplates: Boolean(
      config?.customMovieTemplate && config?.customTVTemplate
    ),
  }));

  // Loading state management
  const setTitleLoading = useCallback(
    (type: keyof FormState['isLoadingTitle'], loading: boolean) => {
      setState((prev) => ({
        ...prev,
        isLoadingTitle: {
          ...prev.isLoadingTitle,
          [type]: loading,
        },
      }));
    },
    []
  );

  const setPosterUploading = useCallback((loading: boolean) => {
    setState((prev) => ({
      ...prev,
      posterUploading: loading,
    }));
  }, []);

  // Media type detection
  const setDetectedMediaType = useCallback(
    (
      type: keyof FormState['detectedMediaTypes'],
      mediaType: 'movie' | 'tv' | 'both' | null
    ) => {
      setState((prev) => ({
        ...prev,
        detectedMediaTypes: {
          ...prev.detectedMediaTypes,
          [type]: mediaType,
        },
      }));
    },
    []
  );

  // Template management
  const setShowSeparateTemplates = useCallback((show: boolean) => {
    setState((prev) => ({
      ...prev,
      showSeparateTemplates: show,
    }));
  }, []);

  // Collection linking
  const setLinkedState = useCallback(
    (isLinked: boolean, linkedHub: boolean, canLink: boolean) => {
      setState((prev) => ({
        ...prev,
        isLinked: isLinked,
        canBeLinked: canLink,
      }));
    },
    []
  );

  // Reset functions
  const resetLoadingStates = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isLoadingTitle: {
        trakt: false,
        tmdb: false,
        imdb: false,
        letterboxd: false,
      },
      posterUploading: false,
    }));
  }, []);

  const resetDetectedMediaTypes = useCallback(() => {
    setState((prev) => ({
      ...prev,
      detectedMediaTypes: {
        trakt: null,
        tmdb: null,
        imdb: null,
        letterboxd: null,
      },
    }));
  }, []);

  const resetAllState = useCallback(() => {
    setState(initialFormState);
  }, []);

  return {
    ...state,
    setTitleLoading,
    setPosterUploading,
    setDetectedMediaType,
    setShowSeparateTemplates,
    setLinkedState,
    resetLoadingStates,
    resetDetectedMediaTypes,
    resetAllState,
  };
};

/**
 * Helper functions for working with form state
 */
export const FormStateHelpers = {
  /**
   * Check if any title is currently being loaded
   */
  isAnyTitleLoading: (state: FormState): boolean => {
    return Object.values(state.isLoadingTitle).some((loading) => loading);
  },

  /**
   * Check if any media type has been detected
   */
  hasDetectedMediaTypes: (state: FormState): boolean => {
    return Object.values(state.detectedMediaTypes).some(
      (type) => type !== null
    );
  },

  /**
   * Get the detected media type for a specific collection type
   */
  getDetectedMediaType: (
    state: FormState,
    collectionType: string
  ): 'movie' | 'tv' | 'both' | null => {
    switch (collectionType) {
      case 'trakt':
        return state.detectedMediaTypes.trakt;
      case 'tmdb':
        return state.detectedMediaTypes.tmdb;
      case 'imdb':
        return state.detectedMediaTypes.imdb;
      case 'letterboxd':
        return state.detectedMediaTypes.letterboxd;
      default:
        return null;
    }
  },

  /**
   * Check if form is in a loading state that should disable submission
   */
  isFormBusy: (state: FormState): boolean => {
    return FormStateHelpers.isAnyTitleLoading(state) || state.posterUploading;
  },

  /**
   * Get appropriate loading message for current state
   */
  getLoadingMessage: (state: FormState): string | null => {
    if (state.posterUploading) return 'Uploading poster...';
    if (state.isLoadingTitle.trakt) return 'Fetching Trakt list...';
    if (state.isLoadingTitle.tmdb) return 'Fetching TMDb collection...';
    if (state.isLoadingTitle.imdb) return 'Fetching IMDb list...';
    if (state.isLoadingTitle.letterboxd) return 'Fetching Letterboxd list...';
    return null;
  },

  /**
   * Determine if enhanced form should be shown
   */
  isEnhancedForm: (config: CollectionFormConfigForEditing): boolean => {
    return CollectionFormConfigUtils.shouldShowEnhancedForm(config);
  },

  /**
   * Check if collection can be linked to other libraries
   */
  canLinkCollection: (
    config: CollectionFormConfigForEditing,
    state: FormState
  ): boolean => {
    if (state.isLinked) return false;
    if (config.configType !== 'hub') return false;
    return CollectionFormConfigUtils.canLinkCollection(config);
  },

  /**
   * Filter libraries based on detected media type
   */
  getFilteredLibraries: (
    libraries: Library[],
    values: CollectionFormConfig,
    state: FormState
  ): Library[] => {
    const detectedType = FormStateHelpers.getDetectedMediaType(
      state,
      values.type || ''
    );
    if (!detectedType || detectedType === 'both') {
      return libraries;
    }

    // Filter libraries by media type
    return libraries.filter((lib) => {
      // Map library types to our media types
      const isMovieLibrary = lib.type === 'movie';
      const isTvLibrary = lib.type === 'show';

      if (detectedType === 'movie') {
        return isMovieLibrary;
      } else if (detectedType === 'tv') {
        return isTvLibrary;
      }

      return true;
    });
  },

  /**
   * Get visibility checkbox states based on collection type
   */
  getVisibilityCheckboxStates: (
    values: CollectionFormConfig,
    data: { hasUsersHomeUnlock?: boolean }
  ): Record<string, VisibilityCheckboxState> => {
    if (!values.type)
      return {
        usersHome: { enabled: false, label: 'Users Home' },
        serverOwnerHome: { enabled: false, label: 'Server Owner Home' },
        libraryRecommended: { enabled: false, label: 'Library Recommended' },
      };

    // For User Requests (overseerr + users), check if Users Home is unlocked
    if (values.type === 'overseerr' && values.subtype === 'users') {
      const isUsersHomeUnlocked = data?.hasUsersHomeUnlock || false;
      return {
        usersHome: { enabled: isUsersHomeUnlocked, label: 'Users Home' },
        serverOwnerHome: { enabled: false, label: 'Server Owner Home' }, // Users collections shouldn't be on server owner home
        libraryRecommended: { enabled: true, label: 'Library Recommended' },
      };
    }

    // For Server Owner requests (overseerr + server_owner), only "Server Owner Home" should be available
    if (values.type === 'overseerr' && values.subtype === 'server_owner') {
      return {
        usersHome: { enabled: false, label: 'Users Home' }, // Server owner collections shouldn't be on users' home
        serverOwnerHome: { enabled: true, label: 'Server Owner Home' },
        libraryRecommended: { enabled: true, label: 'Library Recommended' },
      };
    }

    // For Hub configs, all options should be available
    if (values.configType === 'hub') {
      return {
        usersHome: { enabled: true, label: 'Users Home' },
        serverOwnerHome: { enabled: true, label: 'Server Owner Home' },
        libraryRecommended: { enabled: true, label: 'Library Recommended' },
      };
    }

    // For Source collections (Tautulli/Trakt/etc), all options should be available
    if (
      values.type === 'tautulli' ||
      values.type === 'trakt' ||
      values.type === 'tmdb' ||
      values.type === 'imdb' ||
      values.type === 'letterboxd' ||
      values.type === 'multi-source'
    ) {
      return {
        usersHome: { enabled: true, label: 'Users Home' },
        serverOwnerHome: { enabled: true, label: 'Server Owner Home' },
        libraryRecommended: { enabled: true, label: 'Library Recommended' },
      };
    }

    // For overseerr global collections, all options should be available
    return {
      usersHome: { enabled: true, label: 'Users Home' },
      serverOwnerHome: { enabled: true, label: 'Server Owner Home' },
      libraryRecommended: { enabled: true, label: 'Library Recommended' },
    };
  },
};

export default useFormStateManager;
