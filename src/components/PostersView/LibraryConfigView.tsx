import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/solid';
import type { OverlayTemplateType } from '@server/entity/OverlayTemplate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import LibraryDetailConfigView from './LibraryDetailConfigView';
import PosterResetModal from './PosterResetModal';

const messages = defineMessages({
  libraryConfig: 'Library Configuration',
  selectLibrary: 'Select a library to configure overlays',
  loading: 'Loading libraries...',
  noLibraries: 'No libraries found',
  configure: 'Configure',
  overlaysEnabled: '{count} overlays enabled',
  resetPosters: 'Reset All Posters',
});

interface PlexLibrary {
  key: string;
  name: string;
  type: 'movie' | 'show';
}

interface LibraryConfig {
  id: number;
  libraryId: string;
  libraryName: string;
  mediaType: 'movie' | 'show';
  enabledOverlays: EnabledOverlay[];
}

interface EnabledOverlay {
  templateId: number;
  enabled: boolean;
  layerOrder: number;
  config?: {
    daysThreshold?: number;
    timeWindowDays?: number;
    minimumRating?: number;
    [key: string]: unknown;
  };
}

interface Template {
  id: number;
  name: string;
  type: OverlayTemplateType;
}

// Component to show large preview for a library (grid layout)
const LibraryPreviewLarge: React.FC<{
  libraryId: string;
  enabledOverlays: EnabledOverlay[];
  templates: Template[];
  refreshTrigger?: number;
}> = ({ libraryId, enabledOverlays, templates, refreshTrigger = 0 }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchPreview = useCallback(async () => {
    // Filter out status overlays for the preview
    const nonStatusTemplateIds = enabledOverlays
      .filter((o) => {
        if (!o.enabled) return false;
        const template = templates.find((t) => t.id === o.templateId);
        return template && template.type !== 'status';
      })
      .sort((a, b) => a.layerOrder - b.layerOrder)
      .map((o) => o.templateId);

    if (nonStatusTemplateIds.length === 0) {
      setPreviewUrl(null);
      return;
    }

    // Cancel any in-flight preview request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    try {
      const response = await fetch(
        '/api/v1/overlay-templates/combined-preview',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateIds: nonStatusTemplateIds,
            contextId: `library-${libraryId}`, // Each library gets its own context
          }),
          signal: abortController.signal,
        }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          previewUrlRef.current = url;
          return url;
        });
      }
    } catch (error) {
      // Ignore abort errors and other preview errors
      if (error instanceof Error && error.name !== 'AbortError') {
        // Log non-abort errors if needed
      }
    } finally {
      // Only clear loading if this is still the active request
      if (abortControllerRef.current === abortController) {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  }, [enabledOverlays, templates, libraryId]);

  useEffect(() => {
    fetchPreview();
    return () => {
      // Cancel any in-flight request on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, [fetchPreview, refreshTrigger]);

  return (
    <>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black bg-opacity-50">
          <LoadingSpinner />
        </div>
      )}
      {previewUrl && (
        <img
          src={previewUrl}
          alt="Overlay preview"
          className="h-full w-full object-cover"
        />
      )}
    </>
  );
};

const LibraryConfigView: React.FC = () => {
  const intl = useIntl();
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(
    null
  );
  const [selectedLibraryName, setSelectedLibraryName] = useState<string>('');
  const [selectedLibraryType, setSelectedLibraryType] = useState<
    'movie' | 'show'
  >('movie');
  const [refreshTriggers, setRefreshTriggers] = useState<
    Record<string, number>
  >({});
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetLibraryId, setResetLibraryId] = useState<string>('');
  const [resetLibraryName, setResetLibraryName] = useState<string>('');

  const handleCyclePoster = (libraryId: string) => {
    setRefreshTriggers((prev) => ({
      ...prev,
      [libraryId]: (prev[libraryId] || 0) + 1,
    }));
  };

  const handleOpenResetModal = (libraryId: string, libraryName: string) => {
    setResetLibraryId(libraryId);
    setResetLibraryName(libraryName);
    setResetModalOpen(true);
  };

  const handleResetComplete = () => {
    // Refresh the library configs after reset
    setResetModalOpen(false);
  };

  // Fetch Plex libraries - backend returns array directly
  const { data: librariesData, error: librariesError } = useSWR<PlexLibrary[]>(
    '/api/v1/settings/plex/libraries'
  );

  // Fetch library configs
  const { data: configsData } = useSWR<{ configs: LibraryConfig[] }>(
    '/api/v1/overlay-library-configs'
  );

  // Fetch templates for filtering status overlays in preview
  const { data: templatesData } = useSWR<{ templates: Template[] }>(
    '/api/v1/overlay-templates'
  );

  // Fetch overlay settings to get poster source
  const { data: overlaySettings } = useSWR<{
    defaultPosterSource: 'tmdb' | 'plex';
    initialSetupComplete: boolean;
  }>('/api/v1/overlay-settings');

  const templates = templatesData?.templates || [];
  const posterSource = overlaySettings?.defaultPosterSource || 'tmdb';

  if (librariesError) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-red-400">Failed to load libraries</div>
      </div>
    );
  }

  if (!librariesData) {
    return (
      <div className="flex h-96 items-center justify-center">
        <LoadingSpinner />
        <span className="ml-3 text-stone-400">
          {intl.formatMessage(messages.loading)}
        </span>
      </div>
    );
  }

  const libraries = librariesData || [];

  if (libraries.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-stone-400">
          {intl.formatMessage(messages.noLibraries)}
        </div>
      </div>
    );
  }

  const getLibraryConfig = (libraryId: string): LibraryConfig | undefined => {
    return configsData?.configs.find((c) => c.libraryId === libraryId);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {libraries.map((library) => {
          const config = getLibraryConfig(library.key);
          const overlayCount =
            config?.enabledOverlays.filter((o) => o.enabled).length || 0;
          const hasOverlays =
            config &&
            config.enabledOverlays.some((o) => o.enabled) &&
            templates.length > 0;

          return (
            <div
              key={library.key}
              className="hover:bg-stone-750 group relative overflow-hidden rounded-lg bg-stone-800 transition-colors"
            >
              {/* Poster Preview */}
              <div className="relative aspect-[2/3] overflow-hidden bg-gradient-to-br from-stone-700 to-stone-900">
                {hasOverlays ? (
                  <LibraryPreviewLarge
                    libraryId={library.key}
                    enabledOverlays={config.enabledOverlays}
                    templates={templates}
                    refreshTrigger={refreshTriggers[library.key] || 0}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center text-stone-500">
                      <svg
                        className="mx-auto h-16 w-16"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p className="mt-2 text-xs">No overlays configured</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Library Info */}
              <div className="p-4">
                <h4 className="truncate text-sm font-medium text-white">
                  {library.name}
                </h4>
                <p className="mt-1 text-xs text-stone-400">
                  {library.type === 'movie' ? 'Movies' : 'TV Shows'} •{' '}
                  {intl.formatMessage(messages.overlaysEnabled, {
                    count: overlayCount,
                  })}
                </p>

                <div className="mt-3 flex gap-2">
                  {hasOverlays && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCyclePoster(library.key);
                      }}
                      className="flex items-center justify-center rounded-md bg-stone-700 p-2 text-stone-300 transition-colors hover:bg-stone-600"
                      title="Cycle poster"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                    </button>
                  )}
                  {hasOverlays && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenResetModal(library.key, library.name);
                      }}
                      className="flex items-center justify-center rounded-md bg-stone-700 p-2 text-stone-300 transition-colors hover:bg-stone-600"
                      title={intl.formatMessage(messages.resetPosters)}
                    >
                      <ArrowUturnLeftIcon className="h-4 w-4" />
                    </button>
                  )}
                  <Button
                    buttonType="primary"
                    buttonSize="sm"
                    className="flex-1"
                    onClick={() => {
                      setSelectedLibraryId(library.key);
                      setSelectedLibraryName(library.name);
                      setSelectedLibraryType(library.type);
                    }}
                  >
                    {intl.formatMessage(messages.configure)}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedLibraryId && (
        <LibraryDetailConfigView
          isOpen={!!selectedLibraryId}
          onClose={() => {
            setSelectedLibraryId(null);
            setSelectedLibraryName('');
          }}
          libraryId={selectedLibraryId}
          libraryName={selectedLibraryName}
          libraryType={selectedLibraryType}
        />
      )}

      {resetModalOpen && (
        <PosterResetModal
          isOpen={resetModalOpen}
          onClose={() => setResetModalOpen(false)}
          onComplete={handleResetComplete}
          libraryId={resetLibraryId}
          libraryName={resetLibraryName}
          posterSource={posterSource}
        />
      )}
    </div>
  );
};

export default LibraryConfigView;
