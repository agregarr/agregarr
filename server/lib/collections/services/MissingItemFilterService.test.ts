import { describe, expect, it, vi } from 'vitest';

// Mock the modules that trigger TypeORM entity loading
vi.mock('@server/api/imdbRatings', () => ({ default: vi.fn() }));
vi.mock('@server/api/rottentomatoes', () => ({ default: vi.fn() }));
vi.mock('@server/api/themoviedb', () => ({ default: vi.fn() }));
vi.mock('@server/logger', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import type { CollectionConfig } from '@server/lib/settings';
import { buildPlaceholderFilterConfig } from './MissingItemFilterService';

// Minimal CollectionConfig factory for tests
function makeConfig(
  overrides: Partial<CollectionConfig> = {}
): CollectionConfig {
  return {
    id: 'test-collection',
    name: 'Test Collection',
    type: 'tmdb',
    subtype: 'popular',
    libraryId: '1',
    libraryName: 'Movies',
    ...overrides,
  } as CollectionConfig;
}

describe('buildPlaceholderFilterConfig', () => {
  it('returns all filter values as 0/undefined when no placeholder filters are set', () => {
    const config = makeConfig({
      minimumYear: 2020,
      minimumImdbRating: 7.0,
      minimumRottenTomatoesRating: 80,
      minimumRottenTomatoesAudienceRating: 75,
      filterSettings: {
        genres: { mode: 'exclude', values: [28] },
      },
    });

    const result = buildPlaceholderFilterConfig(config);

    expect(result.minimumYear).toBe(0);
    expect(result.minimumImdbRating).toBe(0);
    expect(result.minimumRottenTomatoesRating).toBe(0);
    expect(result.minimumRottenTomatoesAudienceRating).toBe(0);
    expect(result.filterSettings).toBeUndefined();
  });

  it('swaps placeholder filter values into standard filter fields', () => {
    const config = makeConfig({
      minimumYear: 2020,
      minimumImdbRating: 7.0,
      placeholderMinimumYear: 2024,
      placeholderMinimumImdbRating: 6.5,
      placeholderMinimumRottenTomatoesRating: 60,
      placeholderMinimumRottenTomatoesAudienceRating: 50,
    });

    const result = buildPlaceholderFilterConfig(config);

    expect(result.minimumYear).toBe(2024);
    expect(result.minimumImdbRating).toBe(6.5);
    expect(result.minimumRottenTomatoesRating).toBe(60);
    expect(result.minimumRottenTomatoesAudienceRating).toBe(50);
  });

  it('preserves non-filter config fields unchanged', () => {
    const config = makeConfig({
      createPlaceholdersForMissing: true,
      placeholderDaysAhead: 90,
      placeholderReleasedDays: 14,
      maxItems: 25,
    });

    const result = buildPlaceholderFilterConfig(config);

    expect(result.name).toBe('Test Collection');
    expect(result.id).toBe('test-collection');
    expect(result.libraryId).toBe('1');
    expect(result.createPlaceholdersForMissing).toBe(true);
    expect(result.placeholderDaysAhead).toBe(90);
    expect(result.maxItems).toBe(25);
  });

  it('replaces filterSettings entirely with placeholderFilterSettings', () => {
    const config = makeConfig({
      filterSettings: {
        genres: { mode: 'exclude', values: [28] },
        countries: { mode: 'include', values: ['US'] },
      },
      placeholderFilterSettings: {
        genres: { mode: 'include', values: [35] },
      },
    });

    const result = buildPlaceholderFilterConfig(config);

    expect(result.filterSettings).toEqual({
      genres: { mode: 'include', values: [35] },
    });
    // Should NOT have countries from auto-request filterSettings
    expect(result.filterSettings?.countries).toBeUndefined();
  });

  it('does not leak auto-request filter values into placeholder config', () => {
    const config = makeConfig({
      minimumYear: 2020,
      minimumImdbRating: 7.0,
      minimumRottenTomatoesRating: 80,
      minimumRottenTomatoesAudienceRating: 75,
      // No placeholder filters set
    });

    const result = buildPlaceholderFilterConfig(config);

    expect(result.minimumYear).toBe(0);
    expect(result.minimumImdbRating).toBe(0);
    expect(result.minimumRottenTomatoesRating).toBe(0);
    expect(result.minimumRottenTomatoesAudienceRating).toBe(0);
  });

  it('handles placeholder filters set to 0 explicitly', () => {
    const config = makeConfig({
      placeholderMinimumYear: 0,
      placeholderMinimumImdbRating: 0,
    });

    const result = buildPlaceholderFilterConfig(config);

    expect(result.minimumYear).toBe(0);
    expect(result.minimumImdbRating).toBe(0);
  });

  it('handles partial placeholderFilterSettings', () => {
    const config = makeConfig({
      placeholderFilterSettings: {
        genres: { mode: 'exclude', values: [27, 53] },
        // No countries, languages, or keywords
      },
    });

    const result = buildPlaceholderFilterConfig(config);

    expect(result.filterSettings).toEqual({
      genres: { mode: 'exclude', values: [27, 53] },
    });
    expect(result.filterSettings?.countries).toBeUndefined();
    expect(result.filterSettings?.languages).toBeUndefined();
    expect(result.filterSettings?.keywords).toBeUndefined();
  });
});
