import { XMarkIcon } from '@heroicons/react/24/outline';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchResultItem {
  id: number;
  name: string;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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

  const addRawId = () => {
    const raw = searchTerm.trim();
    if (!raw) return;

    // Split on commas, pipes, spaces
    const parts = raw.split(/[\s,|]+/).filter(Boolean);
    const next = [...value];
    for (const part of parts) {
      const match = part.match(/(\d+)/);
      const id = match?.[1];
      if (id && !next.includes(id)) {
        next.push(id);
      }
    }
    if (next.length !== value.length) {
      onChange(next);
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
            {results.map((result) => (
              <div
                key={result.id}
                className={`flex cursor-pointer items-center px-3 py-2 text-sm hover:bg-stone-600 ${
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
                {result.name}
                <span className="ml-auto text-xs text-gray-400">
                  ID: {result.id}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TmdbSearchSelect;
