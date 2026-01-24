import type { CollectionFormConfig } from '@app/types/collections';
import { PlusIcon, MinusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { type FormikErrors, type FormikTouched } from 'formik';
import type React from 'react';
import { defineMessages, useIntl } from 'react-intl';
import useSWR from 'swr';
import { useState, useCallback, useEffect, useRef } from 'react';

interface TmdbGenre {
  id: number;
  name: string;
}

interface TmdbGenresResponse {
  genres: TmdbGenre[];
}

interface TmdbWatchProvider {
  provider_id: number;
  provider_name: string;
  display_priority?: number;
}

interface FilterGroup {
  id: string;
  operator?: 'and' | 'or'; // For backwards compatibility
  groupOperator?: 'and' | 'or'; // Operator between this group and the next
  filters: Filter[];
}

interface Filter {
  id: string;
  field: string;
  operator: 'and' | 'or';
  value: string | number | boolean;
}

const messages = defineMessages({
  advancedFilters: 'Advanced Filters',
  region: 'Region/Country',
  streamingProvider: 'Streaming Service',
  selectRegion: 'Select region...',
  selectProvider: 'Select streaming service...',
  loadingProviders: 'Loading streaming services...',
  matchAll: 'Match all',
  matchAny: 'Match any',
  addFilterGroup: 'Add Filter Group',
  matchAllFollowing: 'Match all of the following',
  matchAnyFollowing: 'Match any of the following',
  addFilter: 'Add Filter',
  removeFilter: 'Remove Filter',
  removeFilterGroup: 'Remove Filter Group',
  selectField: 'Select field...',
  enterValue: 'Enter value...',
  andOperator: 'AND',
  orOperator: 'OR',
});

const STREAMING_REGIONS = [
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'SE', label: 'Sweden' },
  { value: 'NO', label: 'Norway' },
  { value: 'DK', label: 'Denmark' },
  { value: 'FI', label: 'Finland' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
  { value: 'AR', label: 'Argentina' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'IN', label: 'India' },
];

const MULTIVALUE_SEPARATOR_FIELDS = new Set([
  'with_cast',
  'with_companies',
  'with_crew',
  'with_genres',
  'with_keywords',
  'with_people',
  'with_release_type',
  'with_watch_providers',
  'with_watch_monetization_types',
]);

type FilterScope = 'both' | 'movie' | 'tv';

// Available filter fields with their types and descriptions
const FILTER_FIELDS = {
  // Streaming (for advanced_custom_tmdb subtype)
  watch_region: { label: 'Region/Country', type: 'select', scope: 'both' as FilterScope },
  with_watch_providers: {
    label: 'Streaming Service',
    type: 'select',
    api: '/api/v1/discover/watch-providers/movie',
    scope: 'both' as FilterScope,
  },

  // Genres
  with_genres: {
    label: 'Include Genres',
    type: 'select',
    api: '/api/v1/discover/genres/movie',
    scope: 'both' as FilterScope,
  },
  without_genres: {
    label: 'Exclude Genres',
    type: 'select',
    api: '/api/v1/discover/genres/movie',
    scope: 'both' as FilterScope,
  },

  // People / Companies / Keywords (multi-value)
  with_cast: { label: 'Cast (TMDB person IDs)', type: 'select', scope: 'both' as FilterScope },
  with_crew: { label: 'Crew (TMDB person IDs)', type: 'select', scope: 'both' as FilterScope },
  with_people: { label: 'People (TMDB person IDs)', type: 'select', scope: 'both' as FilterScope },
  with_companies: {
    label: 'Companies (TMDB company IDs)',
    type: 'select',
    scope: 'both' as FilterScope,
  },
  with_keywords: { label: 'Keywords (TMDB keyword IDs)', type: 'select', scope: 'both' as FilterScope },
  // Common discover param (supported by both endpoints)
  without_keywords: {
    label: 'Exclude Keywords (TMDB keyword IDs)',
    type: 'select',
    scope: 'both' as FilterScope,
  },

  // TV-only params
  with_networks: {
    label: 'Networks (TMDB network IDs)',
    type: 'select',
    scope: 'tv' as FilterScope,
  },
  first_air_date_year: {
    label: 'First Air Year',
    type: 'number',
    min: 1900,
    max: new Date().getFullYear() + 5,
    scope: 'tv' as FilterScope,
  },
  'first_air_date.gte': {
    label: 'First Aired after',
    type: 'date',
    scope: 'tv' as FilterScope,
  },
  'first_air_date.lte': {
    label: 'First Aired before',
    type: 'date',
    scope: 'tv' as FilterScope,
  },
  'air_date.gte': {
    label: 'Aired after',
    type: 'date',
    scope: 'tv' as FilterScope,
  },
  'air_date.lte': {
    label: 'Aired before',
    type: 'date',
    scope: 'tv' as FilterScope,
  },
  include_null_first_air_dates: {
    label: 'Include shows with no air date',
    type: 'boolean',
    scope: 'tv' as FilterScope,
  },
  screened_theatrically: {
    label: 'Screened Theatrically',
    type: 'boolean',
    scope: 'tv' as FilterScope,
  },
  with_status: {
    label: 'Status',
    type: 'select',
    multiple: false,
    options: [
      { value: '0', label: 'Returning Series (0)' },
      { value: '1', label: 'Planned (1)' },
      { value: '2', label: 'In Production (2)' },
      { value: '3', label: 'Ended (3)' },
      { value: '4', label: 'Cancelled (4)' },
      { value: '5', label: 'Pilot (5)' },
    ],
    scope: 'tv' as FilterScope,
  },
  with_type: {
    label: 'Show Type',
    type: 'select',
    multiple: true,
    options: [
      { value: '0', label: 'Documentary (0)' },
      { value: '1', label: 'News (1)' },
      { value: '2', label: 'Miniseries (2)' },
      { value: '3', label: 'Reality (3)' },
      { value: '4', label: 'Scripted (4)' },
      { value: '5', label: 'Talk Show (5)' },
      { value: '6', label: 'War & Politics (6)' },
    ],
    scope: 'tv' as FilterScope,
  },
  timezone: {
    label: 'Timezone',
    type: 'text',
    scope: 'tv' as FilterScope,
  },

  // Release type (multi-value)
  with_release_type: {
    label: 'Release Type',
    type: 'select',
    scope: 'movie' as FilterScope,
    options: [
      { value: '1', label: 'Premiere (1)' },
      { value: '2', label: 'Theatrical (limited) (2)' },
      { value: '3', label: 'Theatrical (3)' },
      { value: '4', label: 'Digital (4)' },
      { value: '5', label: 'Physical (5)' },
      { value: '6', label: 'TV (6)' },
    ],
  },

  // Watch monetization types (multi-value)
  with_watch_monetization_types: {
    label: 'Watch Monetization Types',
    type: 'select',
    scope: 'both' as FilterScope,
    options: [
      { value: 'flatrate', label: 'Flatrate' },
      { value: 'free', label: 'Free' },
      { value: 'ads', label: 'Ads' },
      { value: 'rent', label: 'Rent' },
      { value: 'buy', label: 'Buy' },
    ],
  },

  // Ratings
  'vote_average.gte': { label: 'Rating at least', type: 'number', min: 0, max: 10, step: 0.1, scope: 'both' as FilterScope },
  'vote_average.lte': { label: 'Rating at most', type: 'number', min: 0, max: 10, step: 0.1, scope: 'both' as FilterScope },
  'vote_count.gte': { label: 'Vote count at least', type: 'number', min: 0, scope: 'both' as FilterScope },
  'vote_count.lte': { label: 'Vote count at most', type: 'number', min: 0, scope: 'both' as FilterScope },
  
  // Dates
  primary_release_year: { label: 'Release Year', type: 'number', min: 1900, max: new Date().getFullYear() + 5, scope: 'movie' as FilterScope },
  'primary_release_date.gte': { label: 'Released after', type: 'date', scope: 'movie' as FilterScope },
  'primary_release_date.lte': { label: 'Released before', type: 'date', scope: 'movie' as FilterScope },
  'release_date.gte': { label: 'Release Date after', type: 'date', scope: 'movie' as FilterScope },
  'release_date.lte': { label: 'Release Date before', type: 'date', scope: 'movie' as FilterScope },
  
  // Runtime
  'with_runtime.gte': { label: 'Runtime at least (minutes)', type: 'number', min: 0, scope: 'both' as FilterScope },
  'with_runtime.lte': { label: 'Runtime at most (minutes)', type: 'number', min: 0, scope: 'both' as FilterScope },
  
  // Language and Country
  with_original_language: { label: 'Original Language', type: 'select', scope: 'both' as FilterScope, options: [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'ja', label: 'Japanese' },
    { value: 'ko', label: 'Korean' },
    { value: 'zh', label: 'Chinese' },
    { value: 'hi', label: 'Hindi' },
  ] },
  with_origin_country: { label: 'Origin Country', type: 'select', scope: 'both' as FilterScope, options: [
    { value: 'US', label: 'United States' },
    { value: 'GB', label: 'United Kingdom' },
    { value: 'CA', label: 'Canada' },
    { value: 'AU', label: 'Australia' },
    { value: 'DE', label: 'Germany' },
    { value: 'FR', label: 'France' },
    { value: 'IT', label: 'Italy' },
    { value: 'ES', label: 'Spain' },
    { value: 'JP', label: 'Japan' },
    { value: 'KR', label: 'South Korea' },
  ] },
  
  // Certification
  certification_country: { label: 'Certification Country', type: 'select', scope: 'movie' as FilterScope, options: [
    { value: 'US', label: 'United States' },
    { value: 'GB', label: 'United Kingdom' },
    { value: 'CA', label: 'Canada' },
  ] },
  certification: { label: 'Certification', type: 'select', scope: 'movie' as FilterScope, options: [
    { value: 'G', label: 'G' },
    { value: 'PG', label: 'PG' },
    { value: 'PG-13', label: 'PG-13' },
    { value: 'R', label: 'R' },
    { value: 'NC-17', label: 'NC-17' },
  ] },
  'certification.gte': {
    label: 'Certification at least',
    type: 'select',
    scope: 'movie' as FilterScope,
    multiple: false,
    options: [
      { value: 'G', label: 'G' },
      { value: 'PG', label: 'PG' },
      { value: 'PG-13', label: 'PG-13' },
      { value: 'R', label: 'R' },
      { value: 'NC-17', label: 'NC-17' },
    ],
  },
  'certification.lte': {
    label: 'Certification at most',
    type: 'select',
    scope: 'movie' as FilterScope,
    multiple: false,
    options: [
      { value: 'G', label: 'G' },
      { value: 'PG', label: 'PG' },
      { value: 'PG-13', label: 'PG-13' },
      { value: 'R', label: 'R' },
      { value: 'NC-17', label: 'NC-17' },
    ],
  },
  
  // Content flags
  include_adult: { label: 'Include Adult Content', type: 'boolean', scope: 'both' as FilterScope },
  include_video: { label: 'Include Video Content', type: 'boolean', scope: 'movie' as FilterScope },
};

const formatFieldLabel = (field: string): string => {
  const cfg = (FILTER_FIELDS as any)[field];
  const label = cfg?.label ?? field;
  const scope: FilterScope | undefined = cfg?.scope;
  if (!scope || scope === 'both') return label;
  return `${label} (${scope === 'movie' ? 'Movie' : 'TV'})`;
};

// Multi-select component for genres with search functionality
interface GenreMultiSelectProps {
  genres: TmdbGenre[];
  value: string[];
  onChange: (selectedGenres: string[]) => void;
}

const GenreMultiSelect: React.FC<GenreMultiSelectProps> = ({ genres, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredGenres = genres.filter(genre =>
    genre.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedGenres = genres.filter(genre => value.includes(genre.id.toString()));

  const toggleGenre = (genreId: string) => {
    const newValue = value.includes(genreId)
      ? value.filter(id => id !== genreId)
      : [...value, genreId];
    onChange(newValue);
  };

  const removeGenre = (genreId: string) => {
    onChange(value.filter(id => id !== genreId));
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* Selected genres display */}
      <div 
        className="min-h-[42px] w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus-within:border-orange-500 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedGenres.length === 0 ? (
          <span className="text-gray-400">Select genres...</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectedGenres.map((genre) => (
              <span
                key={genre.id}
                className="inline-flex items-center gap-1 rounded bg-orange-600 px-2 py-1 text-xs text-white"
              >
                {genre.name}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeGenre(genre.id.toString());
                  }}
                  className="hover:text-red-200"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-stone-500 bg-stone-700 shadow-lg">
          {/* Search input */}
          <div className="p-2">
            <input
              type="text"
              placeholder="Search genres..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded border border-stone-600 bg-stone-800 px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          
          {/* Genre options */}
          <div className="max-h-48 overflow-y-auto">
            {filteredGenres.length === 0 ? (
              <div className="px-3 py-2 text-gray-400 text-sm">No genres found</div>
            ) : (
              filteredGenres.map((genre) => (
                <div
                  key={genre.id}
                  className={`flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-stone-600 ${
                    value.includes(genre.id.toString()) ? 'bg-orange-900 text-orange-200' : 'text-white'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGenre(genre.id.toString());
                  }}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(genre.id.toString())}
                    onChange={() => {}}
                    className="mr-2 rounded border-stone-500 bg-stone-700 text-orange-600 focus:ring-orange-500"
                  />
                  {genre.name}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Generic multi-select for option lists
interface OptionMultiSelectProps {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

const OptionMultiSelect: React.FC<OptionMultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select options...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedOptions = options.filter((opt) => value.includes(opt.value));

  const toggle = (optValue: string) => {
    const next = value.includes(optValue)
      ? value.filter((v) => v !== optValue)
      : [...value, optValue];
    onChange(next);
  };

  const remove = (optValue: string) => {
    onChange(value.filter((v) => v !== optValue));
  };

  return (
    <div className="relative" ref={containerRef}>
      <div
        className="min-h-[42px] w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus-within:border-orange-500 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedOptions.length === 0 ? (
          <span className="text-gray-400">{placeholder}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectedOptions.map((opt) => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 rounded bg-orange-600 px-2 py-1 text-xs text-white"
              >
                {opt.label}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(opt.value);
                  }}
                  className="hover:text-red-200"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-stone-500 bg-stone-700 shadow-lg">
          <div className="p-2">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded border border-stone-600 bg-stone-800 px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="max-h-48 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-gray-400 text-sm">No options found</div>
            ) : (
              filteredOptions.map((opt) => (
                <div
                  key={opt.value}
                  className={`flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-stone-600 ${
                    value.includes(opt.value)
                      ? 'bg-orange-900 text-orange-200'
                      : 'text-white'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(opt.value);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(opt.value)}
                    onChange={() => undefined}
                    className="mr-2 h-4 w-4 rounded border-stone-500 bg-stone-800 text-orange-600"
                  />
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Free-text multi-value chip input (Enter to add)
interface FreeTextChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  allowNonNumeric?: boolean;
}

const FreeTextChipInput: React.FC<FreeTextChipInputProps> = ({
  value,
  onChange,
  placeholder = 'Type and press Enter...',
  allowNonNumeric = false,
}) => {
  const [inputValue, setInputValue] = useState('');

  const normalizeToken = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (allowNonNumeric) return trimmed;

    // TMDB IDs are numeric, but users may paste/type extra text.
    // Extract the first numeric sequence to be forgiving.
    const match = trimmed.match(/(\d+)/);
    return match?.[1] ?? null;
  };

  const addTokensFromInput = () => {
    const raw = inputValue;
    const parts = raw.split(/[\s,|]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;

    const next = [...value];
    for (const part of parts) {
      const token = normalizeToken(part);
      if (!token) continue;
      if (!next.includes(token)) next.push(token);
    }

    onChange(next);
    setInputValue('');
  };

  const removeToken = (token: string) => {
    onChange(value.filter((v) => v !== token));
  };

  return (
    <div className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus-within:border-orange-500">
      <div className="border-b border-stone-600 pb-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTokensFromInput();
              } else if (e.key === 'Backspace' && inputValue.length === 0) {
                const last = value[value.length - 1];
                if (last) removeToken(last);
              }
            }}
            placeholder={placeholder}
            className="min-w-0 flex-1 rounded border border-stone-600 bg-stone-800 px-2 py-1 text-sm text-white placeholder:text-gray-400 focus:border-orange-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={addTokensFromInput}
            disabled={!inputValue.trim()}
            className="shrink-0 rounded bg-orange-600 px-3 py-1 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {value.map((token) => (
            <span
              key={token}
              className="inline-flex max-w-full items-center gap-1 rounded bg-orange-600 px-2 py-1 text-xs text-white whitespace-normal break-words"
            >
              {token}
              <button
                type="button"
                onClick={() => removeToken(token)}
                className="hover:text-red-200"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

interface TmdbAdvancedFiltersSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | undefined
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  touched: FormikTouched<CollectionFormConfig>;
  isVisible?: boolean;
}

const TmdbAdvancedFiltersSection = ({
  values,
  setFieldValue,
  isVisible = true,
}: TmdbAdvancedFiltersSectionProps) => {
  const intl = useIntl();

  // Hardcoded genres as fallback
  const fallbackGenres: TmdbGenre[] = [
    { id: 28, name: "Action" },
    { id: 12, name: "Adventure" },
    { id: 16, name: "Animation" },
    { id: 35, name: "Comedy" },
    { id: 80, name: "Crime" },
    { id: 99, name: "Documentary" },
    { id: 18, name: "Drama" },
    { id: 10751, name: "Family" },
    { id: 14, name: "Fantasy" },
    { id: 36, name: "History" },
    { id: 27, name: "Horror" },
    { id: 10402, name: "Music" },
    { id: 9648, name: "Mystery" },
    { id: 10749, name: "Romance" },
    { id: 878, name: "Science Fiction" },
    { id: 10770, name: "TV Movie" },
    { id: 53, name: "Thriller" },
    { id: 10752, name: "War" },
    { id: 37, name: "Western" }
  ];

  // Fetch genres for genre filters
  const { data: movieGenresData } = useSWR<TmdbGenresResponse>(
    '/api/v1/discover/genres/movie'
  );
  const { data: tvGenresData } = useSWR<TmdbGenresResponse>(
    '/api/v1/discover/genres/tv'
  );

  const region = (() => {
    const groups = values.tmdbAdvancedFilters?.filterGroups ?? [];
    for (const group of groups) {
      for (const filter of group.filters ?? []) {
        if (filter.field !== 'watch_region') continue;
        if (filter.value === undefined || filter.value === '') continue;
        const asString = String(filter.value).trim();
        if (!asString) continue;
        return asString.split(/[|,]/)[0]?.trim() || 'US';
      }
    }
    return 'US';
  })();
  const {
    data: movieWatchProvidersData,
    error: providersError,
  } = useSWR<TmdbWatchProvider[]>(
    `/api/v1/discover/watch-providers/movie?region=${encodeURIComponent(region)}`
  );

  const {
    data: tvWatchProvidersData,
    error: tvProvidersError,
  } = useSWR<TmdbWatchProvider[]>(
    `/api/v1/discover/watch-providers/tv?region=${encodeURIComponent(region)}`
  );

  const mergedProvidersMap = new Map<number, TmdbWatchProvider>();
  for (const p of movieWatchProvidersData || []) {
    mergedProvidersMap.set(p.provider_id, p);
  }
  for (const p of tvWatchProvidersData || []) {
    if (!mergedProvidersMap.has(p.provider_id)) {
      mergedProvidersMap.set(p.provider_id, p);
    }
  }

  const mergedProviders = Array.from(mergedProvidersMap.values());

  const isLoadingProviders =
    (!movieWatchProvidersData && !providersError) ||
    (!tvWatchProvidersData && !tvProvidersError);

  const sortedProviders = [...mergedProviders].sort((a, b) => {
    const priorityA = a.display_priority ?? 999;
    const priorityB = b.display_priority ?? 999;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.provider_name.localeCompare(b.provider_name);
  });

  const mergedGenresMap = new Map<number, TmdbGenre>();
  for (const g of movieGenresData?.genres || []) {
    mergedGenresMap.set(g.id, g);
  }
  for (const g of tvGenresData?.genres || []) {
    if (!mergedGenresMap.has(g.id)) {
      mergedGenresMap.set(g.id, g);
    }
  }
  const mergedGenres = Array.from(mergedGenresMap.values());
  const genres = mergedGenres.length ? mergedGenres : fallbackGenres;

  // Get current filter groups or initialize empty
  const filterGroups: FilterGroup[] = values.tmdbAdvancedFilters?.filterGroups ? 
    values.tmdbAdvancedFilters.filterGroups.map(g => ({
      id: g.id,
      operator: g.operator,
      groupOperator: (g as any).groupOperator || g.operator,
      filters: g.filters.map(f => ({
        id: f.id,
        field: f.field,
        operator: f.operator,
        value: f.value,
      }))
    })) : [];

  const updateFilterGroups = useCallback((newGroups: FilterGroup[]) => {
    setFieldValue('tmdbAdvancedFilters', {
      filterGroups: newGroups,
    });
  }, [setFieldValue]);

  const addFilterGroup = useCallback(() => {
    const newGroup: FilterGroup = {
      id: `group-${Date.now()}`,
      groupOperator: 'and',
      filters: [{
        id: `filter-${Date.now()}`,
        field: '',
        operator: 'and',
        value: '',
      }],
    };
    updateFilterGroups([...filterGroups, newGroup]);
  }, [filterGroups, updateFilterGroups]);

  const removeFilterGroup = useCallback((groupId: string) => {
    updateFilterGroups(filterGroups.filter(g => g.id !== groupId));
  }, [filterGroups, updateFilterGroups]);

  const updateFilterGroup = useCallback((groupId: string, updates: Partial<FilterGroup>) => {
    updateFilterGroups(filterGroups.map(g => 
      g.id === groupId ? { ...g, ...updates } : g
    ));
  }, [filterGroups, updateFilterGroups]);

  const addFilter = useCallback((groupId: string) => {
    const group = filterGroups.find((g) => g.id === groupId);
    if (!group) return;

    const totalFields = Object.keys(FILTER_FIELDS).length;
    if (group.filters.length >= totalFields) return;

    const usedFieldsInGroup = new Set(group.filters.map((f) => f.field).filter(Boolean));
    const hasRemainingField = Object.keys(FILTER_FIELDS).some(
      (field) => !usedFieldsInGroup.has(field)
    );
    if (!hasRemainingField) return;

    const newFilter: Filter = {
      id: `filter-${Date.now()}`,
      field: '',
      operator: 'and',
      value: '',
    };
    updateFilterGroups(filterGroups.map(g => 
      g.id === groupId 
        ? { ...g, filters: [...g.filters, newFilter] }
        : g
    ));
  }, [filterGroups, updateFilterGroups]);

  const removeFilter = useCallback((groupId: string, filterId: string) => {
    updateFilterGroups(filterGroups.map(g => 
      g.id === groupId 
        ? { ...g, filters: g.filters.filter(f => f.id !== filterId) }
        : g
    ));
  }, [filterGroups, updateFilterGroups]);

  const updateFilter = useCallback((groupId: string, filterId: string, updates: Partial<Filter>) => {
    updateFilterGroups(filterGroups.map(g => 
      g.id === groupId 
        ? { 
            ...g, 
            filters: g.filters.map(f => 
              f.id === filterId ? { ...f, ...updates } : f
            )
          }
        : g
    ));
  }, [filterGroups, updateFilterGroups]);

  const renderFilterInput = (groupId: string, filter: Filter) => {
    const fieldConfig = FILTER_FIELDS[filter.field as keyof typeof FILTER_FIELDS];
    if (!fieldConfig) return null;

    switch (fieldConfig.type) {
      case 'number':
        return (
          <input
            type="number"
            min={(fieldConfig as any).min}
            max={(fieldConfig as any).max}
            step={(fieldConfig as any).step || 1}
            value={filter.value as number || ''}
            onChange={(e) => updateFilter(groupId, filter.id, { 
              value: e.target.value ? Number(e.target.value) : '' 
            })}
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder={intl.formatMessage(messages.enterValue)}
          />
        );
      
      case 'date':
        return (
          <input
            type="date"
            value={filter.value as string || ''}
            onChange={(e) => updateFilter(groupId, filter.id, { value: e.target.value })}
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        );

      case 'boolean':
        return (
          <select
            value={filter.value === true ? 'true' : filter.value === false ? 'false' : ''}
            onChange={(e) => updateFilter(groupId, filter.id, { 
              value: e.target.value === 'true' ? true : e.target.value === 'false' ? false : '' 
            })}
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="">Select...</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );

      case 'select':
        if (filter.field === 'watch_region') {
          return (
            <select
              value={(filter.value as string) || ''}
              onChange={(e) =>
                updateFilter(groupId, filter.id, { value: e.target.value })
              }
              className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">{intl.formatMessage(messages.selectRegion)}</option>
              {STREAMING_REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          );
        }

        if (filter.field === 'with_watch_providers') {
          const providerOptions = sortedProviders.map((p) => ({
            value: String(p.provider_id),
            label: p.provider_name,
          }));

          return (
            <OptionMultiSelect
              options={providerOptions}
              value={
                filter.value
                  ? filter.value.toString().split(/[,|]/).filter(Boolean)
                  : []
              }
              onChange={(selected: string[]) => {
                const separator = filter.operator === 'or' ? '|' : ',';
                updateFilter(groupId, filter.id, {
                  value: selected.join(separator),
                });
              }}
              placeholder={
                isLoadingProviders
                  ? intl.formatMessage(messages.loadingProviders)
                  : intl.formatMessage(messages.selectProvider)
              }
            />
          );
        }

        if (filter.field.includes('genre')) {
          return (
            <GenreMultiSelect
              genres={genres}
              value={filter.value ? filter.value.toString().split(/[,|]/) : []}
              onChange={(selectedGenres: string[]) => {
                const separator = filter.operator === 'or' ? '|' : ',';
                updateFilter(groupId, filter.id, {
                  value: selectedGenres.join(separator),
                });
              }}
            />
          );
        }

        // Option-based multi-select (release type, monetization types)
        if ((fieldConfig as any).options && (fieldConfig as any).multiple === false) {
          return (
            <select
              value={(filter.value as string) || ''}
              onChange={(e) =>
                updateFilter(groupId, filter.id, { value: e.target.value })
              }
              className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Select...</option>
              {(fieldConfig as any).options.map((opt: any) => (
                <option key={String(opt.value)} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        }

        if ((fieldConfig as any).options) {
          return (
            <OptionMultiSelect
              options={(fieldConfig as any).options}
              value={filter.value ? filter.value.toString().split(/[,|]/) : []}
              onChange={(selected: string[]) => {
                const separator = filter.operator === 'or' ? '|' : ',';
                updateFilter(groupId, filter.id, {
                  value: selected.join(separator),
                });
              }}
            />
          );
        }

        // Free-text chip multi-select (IDs)
        {
          // Allow full TMDB slug tokens like "53714-rachel-mcadams" for display.
          // Will normalize these back to numeric IDs when calling TMDB.
          const allowNonNumeric = true;

          return (
            <FreeTextChipInput
              value={filter.value ? filter.value.toString().split(/[,|]/).filter(Boolean) : []}
              allowNonNumeric={allowNonNumeric}
              onChange={(selected: string[]) => {
                const separator = filter.operator === 'or' ? '|' : ',';
                updateFilter(groupId, filter.id, {
                  value: selected.join(separator),
                });
              }}
            />
          );
        }

      default:
        return (
          <input
            type="text"
            value={filter.value as string || ''}
            onChange={(e) => updateFilter(groupId, filter.id, { value: e.target.value })}
            className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder={intl.formatMessage(messages.enterValue)}
          />
        );
    }
  };

  if (!isVisible) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">
          {intl.formatMessage(messages.advancedFilters)}
        </h3>
        <button
          type="button"
          onClick={addFilterGroup}
          className="flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700"
        >
          <PlusIcon className="h-4 w-4" />
          {intl.formatMessage(messages.addFilterGroup)}
        </button>
      </div>

      <div className="space-y-4">
        {filterGroups.map((group, groupIndex) => {
          const usedFieldsInGroup = new Set(
            group.filters.map((f) => f.field).filter(Boolean)
          );
          const totalFields = Object.keys(FILTER_FIELDS).length;
          const hasRemainingField = Object.keys(FILTER_FIELDS).some(
            (field) => !usedFieldsInGroup.has(field)
          );
          const canAddFilter = group.filters.length < totalFields && hasRemainingField;

          return (
            <div
              key={group.id}
              className="rounded-lg border border-stone-600 bg-stone-800 p-4"
            >
            {/* Group header with operator selection */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {groupIndex > 0 && (
                  <select
                    value={group.groupOperator || group.operator || 'and'}
                    onChange={(e) => {
                      updateFilterGroup(group.id, { 
                        groupOperator: e.target.value as 'and' | 'or'
                      });
                    }}
                    className="rounded-md border border-stone-500 bg-stone-700 px-2 py-1 text-sm text-white focus:border-orange-500"
                  >
                    <option value="and">{intl.formatMessage(messages.andOperator)}</option>
                    <option value="or">{intl.formatMessage(messages.orOperator)}</option>
                  </select>
                )}
                <span className="text-sm text-gray-300">
                  {intl.formatMessage(messages.matchAllFollowing)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeFilterGroup(group.id)}
                className="flex items-center gap-1 text-sm text-red-400 hover:text-red-300"
              >
                <MinusIcon className="h-4 w-4" />
                {intl.formatMessage(messages.removeFilterGroup)}
              </button>
            </div>

            {/* Filters in this group */}
            <div className="space-y-3">
              {group.filters.map((filter, filterIndex) => (
                <div key={filter.id} className="grid grid-cols-12 gap-3 items-center">
                  {/* Field selection */}
                  <div className="col-span-4">
                    <select
                      value={filter.field}
                      onChange={(e) => updateFilter(group.id, filter.id, { 
                        field: e.target.value,
                        value: '' // Reset value when field changes
                      })}
                      className="w-full rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-sm text-white focus:border-orange-500"
                    >
                      <option value="">{intl.formatMessage(messages.selectField)}</option>
                      {Object.entries(FILTER_FIELDS)
                        .filter(([field]) => field === filter.field || !usedFieldsInGroup.has(field))
                        .map(([field]) => (
                          <option key={field} value={field}>
                            {formatFieldLabel(field)}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* AND/OR operator for multi-value fields */}
                  {filter.field && MULTIVALUE_SEPARATOR_FIELDS.has(filter.field) && (
                    <div className="col-span-2">
                      <select
                        value={filter.operator}
                        onChange={(e) => updateFilter(group.id, filter.id, { 
                          operator: e.target.value as 'and' | 'or',
                          // Update the value format when operator changes
                          value: filter.value ? 
                            filter.value.toString().replace(/[,|]/g, e.target.value === 'or' ? '|' : ',') :
                            filter.value
                        })}
                        className="w-full rounded-md border border-stone-500 bg-stone-700 px-2 py-2 text-sm text-white focus:border-orange-500"
                      >
                        <option value="and">{intl.formatMessage(messages.matchAll)}</option>
                        <option value="or">{intl.formatMessage(messages.matchAny)}</option>
                      </select>
                    </div>
                  )}

                  {/* Value input */}
                  <div className={`${
                    filter.field && MULTIVALUE_SEPARATOR_FIELDS.has(filter.field)
                      ? 'col-span-5' 
                      : 'col-span-7'
                  }`}>
                    {renderFilterInput(group.id, filter)}
                  </div>

                  {/* Remove filter button */}
                  <div className="col-span-1">
                    <button
                      type="button"
                      onClick={() => removeFilter(group.id, filter.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-red-400 hover:bg-red-900 hover:text-red-300"
                      disabled={group.filters.length === 1}
                    >
                      <MinusIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add filter button */}
            <div className="mt-3 pt-3 border-t border-stone-600">
              <button
                type="button"
                onClick={() => addFilter(group.id)}
                disabled={!canAddFilter}
                className={
                  canAddFilter
                    ? 'flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300'
                    : 'flex items-center gap-2 text-sm text-stone-500 cursor-not-allowed'
                }
              >
                <PlusIcon className="h-4 w-4" />
                {intl.formatMessage(messages.addFilter)}
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {/* Initial state - show add filter group button if no groups */}
      {filterGroups.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-stone-600 bg-stone-800/50 p-8 text-center">
          <p className="text-gray-400 mb-4">No advanced filters configured</p>
          <button
            type="button"
            onClick={addFilterGroup}
            className="flex items-center gap-2 rounded-md bg-orange-600 px-4 py-2 text-white hover:bg-orange-700 mx-auto"
          >
            <PlusIcon className="h-4 w-4" />
            {intl.formatMessage(messages.addFilterGroup)}
          </button>
        </div>
      )}
    </div>
  );
};

export default TmdbAdvancedFiltersSection;