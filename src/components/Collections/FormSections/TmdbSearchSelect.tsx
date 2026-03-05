import { XMarkIcon } from '@heroicons/react/24/outline';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchResultItem {
  id: number;
  name: string;
  profile_path?: string; // For person search
  logo_path?: string; // For company search
  known_for_department?: string; // For person search
  origin_country?: string; // For company search
}

interface SearchResponse {
  page: number;
  results: SearchResultItem[];
  total_pages: number;
  total_results: number;
}

interface TmdbSearchSelectProps {
  searchEndpoint: string;
  value: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

const TmdbSearchSelect: React.FC<TmdbSearchSelectProps> = ({
  searchEndpoint,
  value,
  onChange,
  placeholder = 'Search or enter ID...',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const nameMapRef = useRef<Map<string, string>>(nameMap);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inflightHydrationRef = useRef<Set<string>>(new Set());
  const hydrationRunIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    nameMapRef.current = nameMap;
  }, [nameMap]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const doSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      // If purely numeric, don't search - user is entering an ID directly
      if (/^\d+$/.test(query.trim())) {
        setResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(
          `${searchEndpoint}?query=${encodeURIComponent(query.trim())}`
        );
        if (response.ok) {
          const data: SearchResponse = await response.json();
          const items: SearchResultItem[] = (data.results || []).map(
            (r: SearchResultItem) => ({
              id: r.id,
              name: r.name,
              profile_path: r.profile_path,
              logo_path: r.logo_path,
              known_for_department: r.known_for_department,
              origin_country: r.origin_country,
            })
          );
          setResults(items);
          setIsOpen(items.length > 0);
        }
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    },
    [searchEndpoint]
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      doSearch(newValue);
    }, 300);
  };

  const selectResult = (result: SearchResultItem) => {
    const idStr = String(result.id);
    if (!value.includes(idStr)) {
      onChange([...value, idStr]);
      setNameMap((prev) => new Map(prev).set(idStr, result.name));
    }
    setSearchTerm('');
    setResults([]);
    setIsOpen(false);
  };

  const getDetailsEndpointBase = useCallback((): string | null => {
    // Keep saving IDs only; hydrate names for display when editing.
    if (searchEndpoint.includes('/search/person')) return '/api/v1/person';
    if (searchEndpoint.includes('/search/company')) return '/api/v1/studio';
    if (searchEndpoint.includes('/search/keyword')) return '/api/v1/keyword';
    return null;
  }, [searchEndpoint]);

  const hydrateIds = useCallback(async (ids: string[], base: string) => {
    const runId = ++hydrationRunIdRef.current;

    const uniqueIds = Array.from(new Set(ids))
      .map((v) => v.trim())
      .filter((v) => /^\d+$/.test(v))
      .filter((id) => !nameMapRef.current.has(id))
      .filter((id) => !inflightHydrationRef.current.has(id));

    if (uniqueIds.length === 0) return;

    await Promise.all(
      uniqueIds.map(async (id) => {
        if (!isMountedRef.current) return;
        if (hydrationRunIdRef.current !== runId) return;
        if (!id) return;

        if (nameMapRef.current.has(id)) return;
        if (inflightHydrationRef.current.has(id)) return;

        inflightHydrationRef.current.add(id);
        try {
          const resp = await fetch(`${base}/${encodeURIComponent(id)}`);
          if (!resp.ok) return;
          const data = (await resp.json()) as { name?: string; title?: string };
          const label = data?.name ?? data?.title;
          if (!label || !isMountedRef.current) return;
          if (hydrationRunIdRef.current !== runId) return;

          setNameMap((prev) => {
            if (prev.get(id) === label) return prev;
            const next = new Map(prev);
            next.set(id, label);
            return next;
          });
        } catch {
          // ignore
        } finally {
          inflightHydrationRef.current.delete(id);
        }
      })
    );
  }, []);

  const addRawId = () => {
    const raw = searchTerm.trim();
    if (!raw) return;

    // Split on commas, pipes, spaces
    const parts = raw.split(/[\s,|]+/).filter(Boolean);
    const next = [...value];
    const addedIds: string[] = [];
    for (const part of parts) {
      const match = part.match(/(\d+)/);
      const id = match?.[1];
      if (id && !next.includes(id)) {
        next.push(id);
        addedIds.push(id);
      }
    }
    if (next.length !== value.length) {
      onChange(next);
    }
    if (addedIds.length > 0) {
      const base = getDetailsEndpointBase();
      if (base) {
        void hydrateIds(addedIds, base);
      }
    }
    setSearchTerm('');
    setResults([]);
    setIsOpen(false);
  };

  const removeItem = (id: string) => {
    onChange(value.filter((v) => v !== id));
  };

  const getDisplayLabel = (id: string): string => {
    const name = nameMap.get(id);
    if (name) {
      return `${name} (ID: ${id})`;
    }
    return id;
  };

  useEffect(() => {
    const base = getDetailsEndpointBase();
    if (!base) return;

    const idsToHydrate = Array.from(new Set(value))
      .map((v) => v.trim())
      .filter((v) => /^\d+$/.test(v))
      .filter((id) => !nameMapRef.current.has(id))
      .filter((id) => !inflightHydrationRef.current.has(id));

    if (idsToHydrate.length > 0) {
      void hydrateIds(idsToHydrate, base);
    }
  }, [value, getDetailsEndpointBase, hydrateIds]);

  // Get thumbnail URL for a search result
  const getThumbnailUrl = (result: SearchResultItem): string | undefined => {
    const imagePath = result.profile_path || result.logo_path;
    if (!imagePath) return undefined;
    return `https://image.tmdb.org/t/p/w45${imagePath}`;
  };

  // Get subtitle text for a search result
  const getSubtitle = (result: SearchResultItem): string | undefined => {
    if (result.known_for_department) {
      return result.known_for_department;
    }
    if (result.origin_country) {
      return result.origin_country;
    }
    return undefined;
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus-within:border-orange-500">
        <div className="border-b border-stone-600 pb-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchTerm}
              onChange={handleSearchChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (results.length > 0 && isOpen) {
                    selectResult(results[0]);
                  } else {
                    addRawId();
                  }
                } else if (e.key === 'Backspace' && searchTerm.length === 0) {
                  const last = value[value.length - 1];
                  if (last) removeItem(last);
                }
              }}
              onFocus={() => {
                if (results.length > 0) setIsOpen(true);
              }}
              placeholder={placeholder}
              className="min-w-0 flex-1 rounded border border-stone-600 bg-stone-800 px-2 py-1 text-sm text-white placeholder:text-gray-400 focus:border-orange-500 focus:outline-none"
            />
            {isLoading && (
              <span className="shrink-0 text-xs text-gray-400">
                Searching...
              </span>
            )}
            <button
              type="button"
              onClick={addRawId}
              disabled={!searchTerm.trim()}
              className="shrink-0 rounded bg-orange-600 px-3 py-1 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>

        {/* Selected items */}
        {value.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {value.map((id) => (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 whitespace-normal break-words rounded bg-orange-600 px-2 py-1 text-xs text-white"
              >
                {getDisplayLabel(id)}
                <button
                  type="button"
                  onClick={() => removeItem(id)}
                  className="hover:text-red-200"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Search results dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-stone-500 bg-stone-700 shadow-lg">
          <div className="max-h-48 overflow-y-auto">
            {results.map((result) => {
              const thumbnailUrl = getThumbnailUrl(result);
              const subtitle = getSubtitle(result);
              return (
                <div
                  key={result.id}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-stone-600 ${
                    value.includes(String(result.id))
                      ? 'bg-orange-900 text-orange-200'
                      : 'text-white'
                  }`}
                  role="option"
                  tabIndex={0}
                  aria-selected={value.includes(String(result.id))}
                  onClick={() => selectResult(result)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectResult(result);
                    }
                  }}
                >
                  {/* Thumbnail - 2:3 aspect ratio for profile images, flexible for logos */}
                  <div
                    className={`flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded ${
                      thumbnailUrl ? '' : 'bg-stone-800'
                    }`}
                  >
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </div>
                  {/* Name and subtitle */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{result.name}</div>
                    {subtitle && (
                      <div className="truncate text-xs text-gray-400">
                        {subtitle}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">
                    ID: {result.id}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default TmdbSearchSelect;
