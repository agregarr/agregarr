import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';

interface UseTemplatePreviewOptions {
  template: string;
  mediaType: 'movie' | 'tv';
  type?: string;
  subtype?: string;
  customDays?: number;
}

interface PreviewResponse {
  status: string;
  preview: string;
}

export const useTemplatePreview = (options: UseTemplatePreviewOptions) => {
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRequestRef = useRef<string>('');

  // Memoize the template parameters and create a stable key for comparison
  const templateKey = useMemo(() => {
    const key = `${options.template}|${options.mediaType}|${options.type}|${
      options.subtype
    }|${options.customDays || ''}`;
    return key;
  }, [
    options.template,
    options.mediaType,
    options.type,
    options.subtype,
    options.customDays,
  ]);

  useEffect(() => {
    if (!options.template || !options.mediaType) {
      setPreview('Preview will appear here...');
      return;
    }

    // Handle special dynamic title templates
    if (options.template === 'DYNAMIC_RANDOM_TITLE') {
      setPreview('Title will be updated on Collection Sync');
      return;
    }

    if (options.template === 'DYNAMIC_CYCLE_TITLE') {
      setPreview('Title will be updated from Active Source on Collection Sync');
      return;
    }

    // Skip if this is the same request as last time
    if (lastRequestRef.current === templateKey) {
      return;
    }

    const fetchPreview = async () => {
      // Double-check we haven't been superseded by a newer request
      if (lastRequestRef.current !== templateKey) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await axios.post<PreviewResponse>(
          '/api/v1/collections/preview-template',
          {
            template: options.template,
            mediaType: options.mediaType,
            type: options.type,
            subtype: options.subtype,
            customDays: options.customDays,
          }
        );

        // Only update if this request is still current
        if (lastRequestRef.current === templateKey) {
          if (response.data.status === 'success') {
            setPreview(response.data.preview);
          } else {
            setPreview('Preview will appear here...');
          }
        }
      } catch (err) {
        // Only update if this request is still current
        if (lastRequestRef.current === templateKey) {
          setError(
            err instanceof Error ? err.message : 'Failed to generate preview'
          );
          setPreview('Preview will appear here...');
        }
      } finally {
        if (lastRequestRef.current === templateKey) {
          setLoading(false);
        }
      }
    };

    // Update the current request key
    lastRequestRef.current = templateKey;

    // Debounce the API call to avoid too many requests
    const timeoutId = setTimeout(fetchPreview, 500);

    return () => clearTimeout(timeoutId);
  }, [
    templateKey,
    options.template,
    options.mediaType,
    options.type,
    options.subtype,
    options.customDays,
  ]);

  return { preview, loading, error };
};
