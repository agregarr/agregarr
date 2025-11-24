import type {
  CollectionFormConfig,
  TemplatePreset,
} from '@app/types/collections';

/**
 * Template Presets Generator
 *
 * This module contains all the logic for generating template preset options
 * based on collection type, subtype, and other configuration parameters.
 *
 */

export const getTemplatePresets = (
  values?: CollectionFormConfig,
  fetchedTitles?: {
    trakt?: string;
    tmdb?: string;
    imdb?: string;
    letterboxd?: string;
    mdblist?: string;
    anilist?: string;
  },
  detectedMediaTypes?: {
    trakt?: 'movie' | 'tv' | 'both';
    tmdb?: 'movie' | 'tv' | 'both';
    imdb?: 'movie' | 'tv' | 'both';
    letterboxd?: 'movie' | 'tv' | 'both';
    mdblist?: 'movie' | 'tv' | 'both';
    anilist?: 'movie' | 'tv' | 'both';
  }
): TemplatePreset[] => {
  if (!values) {
    return [{ label: 'Custom', value: 'custom' }];
  }

  if (values.type === 'multi-source') {
    // Check if all sources are Coming Soon
    const allSourcesComingSoon = values.sources?.every(
      (source) => source.type === 'comingsoon'
    );

    if (values.combineMode === 'cycle_lists') {
      return [
        {
          label: 'Dynamic Title from Active Source',
          value: 'DYNAMIC_CYCLE_TITLE',
        },
        { label: 'Custom', value: 'custom' },
      ];
    }

    // For all Coming Soon sources (sorted by release date when not cycle_lists)
    if (allSourcesComingSoon) {
      return [
        {
          label: 'Coming Soon',
          value: 'Coming Soon',
        },
        { label: 'Custom', value: 'custom' },
      ];
    }

    return [{ label: 'Custom', value: 'custom' }];
  }

  if (!values.subtype) {
    return [{ label: 'Custom', value: 'custom' }];
  }

  // For Trakt time-based collections, combine subtype and timePeriod when both exist
  let effectiveSubtype = values.subtype;
  if (
    values.type === 'trakt' &&
    values.timePeriod &&
    ['played', 'watched', 'collected', 'favorited'].includes(
      values.subtype || ''
    )
  ) {
    effectiveSubtype = `${values.subtype}_${values.timePeriod}`;
  }

  // Helper function to generate preset options for custom URLs
  const getCustomUrlPresets = (
    title: string,
    serviceType:
      | 'trakt'
      | 'tmdb'
      | 'imdb'
      | 'letterboxd'
      | 'mdblist'
      | 'anilist'
  ): TemplatePreset[] => {
    if (!title) {
      return [
        {
          label: 'Validate URL',
          value: 'fetch-title',
        },
        { label: 'Custom', value: 'custom' },
      ];
    }

    const detectedType = detectedMediaTypes?.[serviceType];

    if (detectedType === 'both') {
      // For mixed content, offer template with original title first (for cross-library linking)
      return [
        {
          label: title, // Original title without suffix - enables cross-library linking
          value: title,
        },
        {
          label: `${title} - {mediaType}s`,
          value: `${title} - {mediaType}s`,
        },
        { label: 'Custom', value: 'custom' },
      ];
    } else {
      // For single media type, just use the original title
      return [
        {
          label: title,
          value: title,
        },
        { label: 'Custom', value: 'custom' },
      ];
    }
  };

  // Overseerr collection presets
  if (values.type === 'overseerr') {
    switch (values.subtype) {
      case 'users':
        return [
          {
            label: '{domain} requests by {nickname}',
            value: '{domain} requests by {nickname}',
          },
          {
            label: "{nickname}'s {domain} {mediaType} requests",
            value: "{nickname}'s {domain} {mediaType} requests",
          },
          {
            label: "{nickname}'s {mediaType} requests",
            value: "{nickname}'s {mediaType} requests",
          },
          {
            label: '{appTitle} requests by {nickname}',
            value: '{appTitle} requests by {nickname}',
          },
          {
            label: 'Requested by {username}',
            value: 'Requested by {username}',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'global':
        return [
          {
            label: '{appTitle} requests by Everyone',
            value: '{appTitle} requests by Everyone',
          },
          {
            label: '{domain} requests by Everyone - {mediaType}s',
            value: '{domain} requests by Everyone - {mediaType}s',
          },
          {
            label: '{domain} - All {mediaType} Requests',
            value: '{domain} - All {mediaType} Requests',
          },
          {
            label: '{appTitle} - All Requests',
            value: '{appTitle} - All Requests',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'server_owner':
        return [
          {
            label: 'My Requests',
            value: 'My Requests',
          },
          {
            label: 'My {mediaType} Requests',
            value: 'My {mediaType} Requests',
          },
          {
            label: "{nickname}'s {domain} {mediaType} requests",
            value: "{nickname}'s {domain} {mediaType} requests",
          },
          {
            label: '{domain} requests by {nickname} - {mediaType}s',
            value: '{domain} requests by {nickname} - {mediaType}s',
          },
          {
            label: "{nickname}'s {mediaType} requests",
            value: "{nickname}'s {mediaType} requests",
          },
          {
            label: '{appTitle} {mediaType} requests by {nickname}',
            value: '{appTitle} {mediaType} requests by {nickname}',
          },
          {
            label: 'Requested by {username} - {mediaType}s',
            value: 'Requested by {username} - {mediaType}s',
          },
          { label: 'Custom', value: 'custom' },
        ];
      default:
        return [
          {
            label: 'Overseerr Collection',
            value: 'Overseerr Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // Tautulli collection presets
  if (values.type === 'tautulli') {
    switch (values.subtype) {
      case 'most_popular_plays': {
        const mostPopularPlaysPresets = [
          {
            label: 'Most Popular on {servername} in the last {customdays} Days',
            value: 'Most Popular on {servername} in the last {customdays} Days',
          },
          {
            label:
              'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
            value:
              'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
          },
          {
            label: 'Top Played {mediaType}s on {servername}',
            value: 'Top Played {mediaType}s on {servername}',
          },
        ];

        // Add "A Year In Review" preset if customDays is 365
        if (
          values.customDays &&
          parseInt(values.customDays.toString(), 10) === 365
        ) {
          mostPopularPlaysPresets.unshift(
            {
              label:
                'A Year In Review - Most Watched on {servername} this Year',
              value:
                'A Year In Review - Most Watched on {servername} this Year',
            },
            {
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            }
          );
        }

        mostPopularPlaysPresets.push({ label: 'Custom', value: 'custom' });
        return mostPopularPlaysPresets;
      }
      case 'most_popular_duration': {
        const mostPopularDurationPresets = [
          {
            label: 'Most Popular on {servername} in the last {customdays} Days',
            value: 'Most Popular on {servername} in the last {customdays} Days',
          },
          {
            label:
              'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
            value:
              'Most Popular {mediaType}s on {servername} in the last {customdays} Days',
          },
          {
            label: 'Top Played {mediaType}s on {servername}',
            value: 'Top Played {mediaType}s on {servername}',
          },
        ];

        // Add "A Year In Review" preset if customDays is 365
        if (
          values.customDays &&
          parseInt(values.customDays.toString(), 10) === 365
        ) {
          mostPopularDurationPresets.unshift(
            {
              label:
                'A Year In Review - Most Watched on {servername} this Year',
              value:
                'A Year In Review - Most Watched on {servername} this Year',
            },
            {
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            }
          );
        }

        mostPopularDurationPresets.push({ label: 'Custom', value: 'custom' });
        return mostPopularDurationPresets;
      }
      case 'most_watched_plays': {
        const mostWatchedPlaysPresets = [
          {
            label: 'Most Watched on {servername} in the last {customdays} Days',
            value: 'Most Watched on {servername} in the last {customdays} Days',
          },
          {
            label:
              'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
            value:
              'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
          },
          {
            label: 'Frequently Watched {mediaType}s on {servername}',
            value: 'Frequently Watched {mediaType}s on {servername}',
          },
        ];

        // Add "A Year In Review" preset if customDays is 365
        if (
          values.customDays &&
          parseInt(values.customDays.toString(), 10) === 365
        ) {
          mostWatchedPlaysPresets.unshift(
            {
              label:
                'A Year In Review - Most Watched on {servername} this Year',
              value:
                'A Year In Review - Most Watched on {servername} this Year',
            },
            {
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            }
          );
        }

        mostWatchedPlaysPresets.push({ label: 'Custom', value: 'custom' });
        return mostWatchedPlaysPresets;
      }
      case 'most_watched_duration': {
        const mostWatchedDurationPresets = [
          {
            label: 'Most Watched on {servername} in the last {customdays} Days',
            value: 'Most Watched on {servername} in the last {customdays} Days',
          },
          {
            label:
              'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
            value:
              'Most Watched {mediaType}s on {servername} in the last {customdays} Days',
          },
          {
            label: 'Frequently Watched {mediaType}s on {servername}',
            value: 'Frequently Watched {mediaType}s on {servername}',
          },
        ];

        // Add "A Year In Review" preset if customDays is 365
        if (
          values.customDays &&
          parseInt(values.customDays.toString(), 10) === 365
        ) {
          mostWatchedDurationPresets.unshift(
            {
              label:
                'A Year In Review - Most Watched on {servername} this Year',
              value:
                'A Year In Review - Most Watched on {servername} this Year',
            },
            {
              label:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
              value:
                'A Year In Review - Most Watched {mediaType}s on {servername} this Year',
            }
          );
        }

        mostWatchedDurationPresets.push({ label: 'Custom', value: 'custom' });
        return mostWatchedDurationPresets;
      }
      default:
        return [
          {
            label: 'Overseerr Collection',
            value: 'Overseerr Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // Trakt collection presets
  if (values.type === 'trakt') {
    switch (effectiveSubtype) {
      case 'trending':
        return [
          {
            label: "What's Trending Now",
            value: "What's Trending Now",
          },
          {
            label: 'Trending {mediaType}s Today',
            value: 'Trending {mediaType}s Today',
          },
          {
            label: '🔥 Trending {mediaType}s Now',
            value: '🔥 Trending {mediaType}s Now',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'popular':
        return [
          {
            label: 'Most Popular from Trakt',
            value: 'Most Popular from Trakt',
          },
          {
            label: 'Popular {mediaType}s from Trakt',
            value: 'Popular {mediaType}s from Trakt',
          },
          {
            label: '⭐ Popular {mediaType}s',
            value: '⭐ Popular {mediaType}s',
          },
          {
            label: 'Most Popular {mediaType}s',
            value: 'Most Popular {mediaType}s',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'boxoffice':
        return [
          {
            label: 'Box Office Top 10',
            value: 'Box Office Top 10',
          },
          {
            label: '💰 Box Office Winners',
            value: '💰 Box Office Winners',
          },
          {
            label: 'Top Grossing Movies',
            value: 'Top Grossing Movies',
          },
          { label: 'Custom', value: 'custom' },
        ];
      // Handle all time period variants dynamically with period info
      case 'played_daily':
        return [
          {
            label: 'Most Played Today',
            value: 'Most Played Today',
          },
          {
            label: 'Most Played {mediaType}s Today',
            value: 'Most Played {mediaType}s Today',
          },
          {
            label: '▶️ Most Played {mediaType}s - Daily',
            value: '▶️ Most Played {mediaType}s - Daily',
          },
          {
            label: 'Top Played {mediaType}s Today',
            value: 'Top Played {mediaType}s Today',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'played_weekly':
        return [
          {
            label: 'Most Played This Week',
            value: 'Most Played This Week',
          },
          {
            label: 'Most Played {mediaType}s This Week',
            value: 'Most Played {mediaType}s This Week',
          },
          {
            label: '▶️ Most Played {mediaType}s - Weekly',
            value: '▶️ Most Played {mediaType}s - Weekly',
          },
          {
            label: 'Top Played {mediaType}s This Week',
            value: 'Top Played {mediaType}s This Week',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'played_monthly':
        return [
          {
            label: 'Most Played This Month',
            value: 'Most Played This Month',
          },
          {
            label: 'Most Played {mediaType}s This Month',
            value: 'Most Played {mediaType}s This Month',
          },
          {
            label: '▶️ Most Played {mediaType}s - Monthly',
            value: '▶️ Most Played {mediaType}s - Monthly',
          },
          {
            label: 'Top Played {mediaType}s This Month',
            value: 'Top Played {mediaType}s This Month',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'played_all':
        return [
          {
            label: 'Most Played of All Time',
            value: 'Most Played of All Time',
          },
          {
            label: 'Most Played {mediaType}s of All Time',
            value: 'Most Played {mediaType}s of All Time',
          },
          {
            label: '▶️ Most Played {mediaType}s - All Time',
            value: '▶️ Most Played {mediaType}s - All Time',
          },
          {
            label: 'Top Played {mediaType}s Ever',
            value: 'Top Played {mediaType}s Ever',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'watched_daily':
        return [
          {
            label: 'Most Watched Today',
            value: 'Most Watched Today',
          },
          {
            label: 'Most Watched {mediaType}s Today',
            value: 'Most Watched {mediaType}s Today',
          },
          {
            label: '📺 Most Watched {mediaType}s - Daily',
            value: '📺 Most Watched {mediaType}s - Daily',
          },
          {
            label: 'Top Watched {mediaType}s Today',
            value: 'Top Watched {mediaType}s Today',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'watched_weekly':
        return [
          {
            label: 'Most Watched This Week',
            value: 'Most Watched This Week',
          },
          {
            label: 'Most Watched {mediaType}s This Week',
            value: 'Most Watched {mediaType}s This Week',
          },
          {
            label: '📺 Most Watched {mediaType}s - Weekly',
            value: '📺 Most Watched {mediaType}s - Weekly',
          },
          {
            label: 'Top Watched {mediaType}s This Week',
            value: 'Top Watched {mediaType}s This Week',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'watched_monthly':
        return [
          {
            label: 'Most Watched This Month',
            value: 'Most Watched This Month',
          },
          {
            label: 'Most Watched {mediaType}s This Month',
            value: 'Most Watched {mediaType}s This Month',
          },
          {
            label: '📺 Most Watched {mediaType}s - Monthly',
            value: '📺 Most Watched {mediaType}s - Monthly',
          },
          {
            label: 'Top Watched {mediaType}s This Month',
            value: 'Top Watched {mediaType}s This Month',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'watched_all':
        return [
          {
            label: 'Most Watched of All Time',
            value: 'Most Watched of All Time',
          },
          {
            label: 'Most Watched {mediaType}s of All Time',
            value: 'Most Watched {mediaType}s of All Time',
          },
          {
            label: '📺 Most Watched {mediaType}s - All Time',
            value: '📺 Most Watched {mediaType}s - All Time',
          },
          {
            label: 'Top Watched {mediaType}s Ever',
            value: 'Top Watched {mediaType}s Ever',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'collected_daily':
        return [
          {
            label: 'Most Collected Today',
            value: 'Most Collected Today',
          },
          {
            label: 'Most Collected {mediaType}s Today',
            value: 'Most Collected {mediaType}s Today',
          },
          {
            label: '📚 Most Collected {mediaType}s - Daily',
            value: '📚 Most Collected {mediaType}s - Daily',
          },
          {
            label: 'Top Collected {mediaType}s Today',
            value: 'Top Collected {mediaType}s Today',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'collected_weekly':
        return [
          {
            label: 'Most Collected This Week',
            value: 'Most Collected This Week',
          },
          {
            label: 'Most Collected {mediaType}s This Week',
            value: 'Most Collected {mediaType}s This Week',
          },
          {
            label: '📚 Most Collected {mediaType}s - Weekly',
            value: '📚 Most Collected {mediaType}s - Weekly',
          },
          {
            label: 'Top Collected {mediaType}s This Week',
            value: 'Top Collected {mediaType}s This Week',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'collected_monthly':
        return [
          {
            label: 'Most Collected This Month',
            value: 'Most Collected This Month',
          },
          {
            label: 'Most Collected {mediaType}s This Month',
            value: 'Most Collected {mediaType}s This Month',
          },
          {
            label: '📚 Most Collected {mediaType}s - Monthly',
            value: '📚 Most Collected {mediaType}s - Monthly',
          },
          {
            label: 'Top Collected {mediaType}s This Month',
            value: 'Top Collected {mediaType}s This Month',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'collected_all':
        return [
          {
            label: 'Most Collected of All Time',
            value: 'Most Collected of All Time',
          },
          {
            label: 'Most Collected {mediaType}s of All Time',
            value: 'Most Collected {mediaType}s of All Time',
          },
          {
            label: '📚 Most Collected {mediaType}s - All Time',
            value: '📚 Most Collected {mediaType}s - All Time',
          },
          {
            label: 'Top Collected {mediaType}s Ever',
            value: 'Top Collected {mediaType}s Ever',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'favorited_daily':
        return [
          {
            label: 'Most Favorited Today',
            value: 'Most Favorited Today',
          },
          {
            label: 'Most Favorited {mediaType}s Today',
            value: 'Most Favorited {mediaType}s Today',
          },
          {
            label: '⭐ Most Favorited {mediaType}s - Daily',
            value: '⭐ Most Favorited {mediaType}s - Daily',
          },
          {
            label: 'Top Favorited {mediaType}s Today',
            value: 'Top Favorited {mediaType}s Today',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'favorited_weekly':
        return [
          {
            label: 'Most Favorited This Week',
            value: 'Most Favorited This Week',
          },
          {
            label: 'Most Favorited {mediaType}s This Week',
            value: 'Most Favorited {mediaType}s This Week',
          },
          {
            label: '⭐ Most Favorited {mediaType}s - Weekly',
            value: '⭐ Most Favorited {mediaType}s - Weekly',
          },
          {
            label: 'Top Favorited {mediaType}s This Week',
            value: 'Top Favorited {mediaType}s This Week',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'favorited_monthly':
        return [
          {
            label: 'Most Favorited This Month',
            value: 'Most Favorited This Month',
          },
          {
            label: 'Most Favorited {mediaType}s This Month',
            value: 'Most Favorited {mediaType}s This Month',
          },
          {
            label: '⭐ Most Favorited {mediaType}s - Monthly',
            value: '⭐ Most Favorited {mediaType}s - Monthly',
          },
          {
            label: 'Top Favorited {mediaType}s This Month',
            value: 'Top Favorited {mediaType}s This Month',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'favorited_all':
        return [
          {
            label: 'Most Favorited of All Time',
            value: 'Most Favorited of All Time',
          },
          {
            label: 'Most Favorited {mediaType}s of All Time',
            value: 'Most Favorited {mediaType}s of All Time',
          },
          {
            label: '⭐ Most Favorited {mediaType}s - All Time',
            value: '⭐ Most Favorited {mediaType}s - All Time',
          },
          {
            label: 'Top Favorited {mediaType}s Ever',
            value: 'Top Favorited {mediaType}s Ever',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'custom':
        return getCustomUrlPresets(fetchedTitles?.trakt || '', 'trakt');
      case 'random':
        return [
          {
            label: 'Dynamic Title from Random List',
            value: 'DYNAMIC_RANDOM_TITLE',
          },
          {
            label: 'Random Trakt Collection',
            value: 'Random Trakt Collection',
          },
          {
            label: 'Random Trakt {mediaType}s',
            value: 'Random Trakt {mediaType}s',
          },
          {
            label: 'Curated {mediaType}s from Trakt',
            value: 'Curated {mediaType}s from Trakt',
          },
          { label: 'Custom', value: 'custom' },
        ];
      default:
        return [
          {
            label: 'Trakt Collection',
            value: 'Trakt Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // MDBList collection presets
  if (values.type === 'mdblist') {
    switch (values.subtype) {
      case 'user_lists':
        return [
          {
            label: 'My Personal List',
            value: 'My Personal List',
          },
          {
            label: 'My {mediaType}s List',
            value: 'My {mediaType}s List',
          },
          {
            label: "{username}'s {mediaType}s",
            value: "{username}'s {mediaType}s",
          },
          {
            label: 'Personal {mediaType}s Collection',
            value: 'Personal {mediaType}s Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'top_lists':
        return [
          {
            label: 'Top Lists Collection',
            value: 'Top Lists Collection',
          },
          {
            label: 'Top {mediaType}s',
            value: 'Top {mediaType}s',
          },
          {
            label: '⭐ Popular {mediaType}s Lists',
            value: '⭐ Popular {mediaType}s Lists',
          },
          {
            label: 'Most Liked {mediaType}s',
            value: 'Most Liked {mediaType}s',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'custom':
        return getCustomUrlPresets(fetchedTitles?.mdblist || '', 'mdblist');
      default:
        return [{ label: 'Custom', value: 'custom' }];
    }
  }

  // TMDB collection presets
  if (values.type === 'tmdb') {
    switch (values.subtype) {
      case 'trending_day':
        return [
          {
            label: 'Trending Today',
            value: 'Trending Today',
          },
          {
            label: 'Trending {mediaType}s Today',
            value: 'Trending {mediaType}s Today',
          },
          {
            label: 'Daily Trending {mediaType}s',
            value: 'Daily Trending {mediaType}s',
          },
          {
            label: 'Hot {mediaType}s Today',
            value: 'Hot {mediaType}s Today',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'trending_week':
        return [
          {
            label: 'Trending This Week',
            value: 'Trending This Week',
          },
          {
            label: 'Trending {mediaType}s This Week',
            value: 'Trending {mediaType}s This Week',
          },
          {
            label: 'Weekly Trending {mediaType}s',
            value: 'Weekly Trending {mediaType}s',
          },
          {
            label: 'Trending {mediaType}s Last 7 Days',
            value: 'Trending {mediaType}s Last 7 Days',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'popular':
        return [
          {
            label: 'Most Popular',
            value: 'Most Popular',
          },
          {
            label: 'Popular {mediaType}s',
            value: 'Popular {mediaType}s',
          },
          {
            label: 'Most Popular {mediaType}s',
            value: 'Most Popular {mediaType}s',
          },
          {
            label: 'Popular {mediaType}s Right Now',
            value: 'Popular {mediaType}s Right Now',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'top_rated':
        return [
          {
            label: 'Top Rated',
            value: 'Top Rated',
          },
          {
            label: 'Top Rated {mediaType}s',
            value: 'Top Rated {mediaType}s',
          },
          {
            label: 'Highest Rated {mediaType}s',
            value: 'Highest Rated {mediaType}s',
          },
          {
            label: 'Best {mediaType}s',
            value: 'Best {mediaType}s',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'custom':
        return getCustomUrlPresets(fetchedTitles?.tmdb || '', 'tmdb');
      case 'random':
        return [
          {
            label: 'Dynamic Title from Random List',
            value: 'DYNAMIC_RANDOM_TITLE',
          },
          {
            label: 'Random TMDB Collection',
            value: 'Random TMDB Collection',
          },
          {
            label: 'Random TMDB {mediaType}s',
            value: 'Random TMDB {mediaType}s',
          },
          {
            label: 'Curated {mediaType}s from TMDB',
            value: 'Curated {mediaType}s from TMDB',
          },
          { label: 'Custom', value: 'custom' },
        ];
      default:
        return [
          {
            label: 'TMDB Collection',
            value: 'TMDB Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // IMDb collection presets
  if (values.type === 'imdb') {
    switch (values.subtype) {
      case 'top_250':
        return [
          {
            label: 'IMDb Top 250',
            value: 'IMDb Top 250',
          },
          {
            label: 'IMDb Top 250 {mediaType}s',
            value: 'IMDb Top 250 {mediaType}s',
          },
          {
            label: 'Best {mediaType}s of All Time',
            value: 'Best {mediaType}s of All Time',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'popular':
        return [
          {
            label: 'Popular from IMDb',
            value: 'Popular from IMDb',
          },
          {
            label: 'Popular {mediaType}s',
            value: 'Popular {mediaType}s',
          },
          {
            label: 'IMDb Popular {mediaType}s',
            value: 'IMDb Popular {mediaType}s',
          },
          {
            label: 'Currently Popular {mediaType}s',
            value: 'Currently Popular {mediaType}s',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'most_popular':
        return [
          {
            label: 'Most Popular from IMDb',
            value: 'Most Popular from IMDb',
          },
          {
            label: 'Most Popular {mediaType}s',
            value: 'Most Popular {mediaType}s',
          },
          {
            label: 'IMDb Most Popular {mediaType}s',
            value: 'IMDb Most Popular {mediaType}s',
          },
          {
            label: 'Hottest {mediaType}s Right Now',
            value: 'Hottest {mediaType}s Right Now',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'custom':
        return getCustomUrlPresets(fetchedTitles?.imdb || '', 'imdb');
      case 'random':
        return [
          {
            label: 'Dynamic Title from Random List',
            value: 'DYNAMIC_RANDOM_TITLE',
          },
          {
            label: 'Random IMDb Collection',
            value: 'Random IMDb Collection',
          },
          {
            label: 'Random IMDb {mediaType}s',
            value: 'Random IMDb {mediaType}s',
          },
          {
            label: 'Curated {mediaType}s from IMDb',
            value: 'Curated {mediaType}s from IMDb',
          },
          { label: 'Custom', value: 'custom' },
        ];
      default:
        return [
          {
            label: 'IMDb Collection',
            value: 'IMDb Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // Networks collection presets
  if (values.type === 'networks') {
    if (values.subtype) {
      // Get platform name from subtype for display
      // Handle cases like "netflix_top_10" -> "Netflix"
      // and "disney-plus" -> "Disney Plus"
      const platformName = values.subtype
        .split('_')[0] // Take first part before underscore (removes "_top_10" etc)
        .split('-') // Split on dashes
        .map((word) => {
          // Special case for TV to maintain proper capitalization
          if (word.toLowerCase() === 'tv') {
            return 'TV';
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');

      return [
        {
          label: `Popular on ${platformName}`,
          value: `Popular on ${platformName}`,
        },
        {
          label: `Top 10 {mediaType}s on ${platformName}`,
          value: `Top 10 {mediaType}s on ${platformName}`,
        },
        {
          label: `${platformName} Top 10 {mediaType}s`,
          value: `${platformName} Top 10 {mediaType}s`,
        },
        {
          label: `${platformName} Top {mediaType}s`,
          value: `${platformName} Top {mediaType}s`,
        },
        {
          label: `Top {mediaType}s on ${platformName}`,
          value: `Top {mediaType}s on ${platformName}`,
        },
        {
          label: `${platformName} Trending {mediaType}s`,
          value: `${platformName} Trending {mediaType}s`,
        },
        {
          label: `Best of ${platformName}`,
          value: `Best of ${platformName}`,
        },
        { label: 'Custom', value: 'custom' },
      ];
    } else {
      // No platform selected yet
      return [
        {
          label: 'Select a Platform First',
          value: 'select-platform',
        },
        { label: 'Custom', value: 'custom' },
      ];
    }
  }

  // Originals collection presets
  if (values.type === 'originals') {
    if (values.subtype) {
      // Get platform name from subtype for display
      // Handle cases like "netflix_originals" -> "Netflix"
      // and "disney_originals" -> "Disney"
      const platformName = values.subtype
        .replace('_originals', '') // Remove "_originals" suffix
        .split('_')[0] // Take first part before underscore
        .split('-') // Split on dashes
        .map((word) => {
          // Special case for TV to maintain proper capitalization
          if (word.toLowerCase() === 'tv') {
            return 'TV';
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');

      return [
        {
          label: `${platformName} Originals`,
          value: `${platformName} Originals`,
        },
        {
          label: `${platformName} Original {mediaType}s`,
          value: `${platformName} Original {mediaType}s`,
        },
        {
          label: `Original {mediaType}s on ${platformName}`,
          value: `Original {mediaType}s on ${platformName}`,
        },
        {
          label: `${platformName} Exclusive {mediaType}s`,
          value: `${platformName} Exclusive {mediaType}s`,
        },
        {
          label: `Best ${platformName} Originals`,
          value: `Best ${platformName} Originals`,
        },
        {
          label: `${platformName} Originals Collection`,
          value: `${platformName} Originals Collection`,
        },
        { label: 'Custom', value: 'custom' },
      ];
    } else {
      // No provider selected yet
      return [
        {
          label: 'Select a Streaming Service First',
          value: 'select-provider',
        },
        { label: 'Custom', value: 'custom' },
      ];
    }
  }

  // Letterboxd collection presets
  if (values.type === 'letterboxd') {
    switch (values.subtype) {
      case 'custom':
        return getCustomUrlPresets(
          fetchedTitles?.letterboxd || '',
          'letterboxd'
        );
      case 'random':
        return [
          {
            label: 'Dynamic Title from Random List',
            value: 'DYNAMIC_RANDOM_TITLE',
          },
          {
            label: 'Random Letterboxd Collection',
            value: 'Random Letterboxd Collection',
          },
          {
            label: 'Random Letterboxd {mediaType}s',
            value: 'Random Letterboxd {mediaType}s',
          },
          {
            label: 'Curated {mediaType}s from Letterboxd',
            value: 'Curated {mediaType}s from Letterboxd',
          },
          { label: 'Custom', value: 'custom' },
        ];
      default:
        return [
          {
            label: 'Letterboxd Collection',
            value: 'Letterboxd Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // AniList collection presets
  if (values.type === 'anilist') {
    switch (values.subtype) {
      case 'trending':
        return [
          {
            label: 'Trending Anime',
            value: 'Trending Anime',
          },
          {
            label: 'Trending Now on AniList',
            value: 'Trending Now on AniList',
          },
          {
            label: '🔥 Trending Anime',
            value: '🔥 Trending Anime',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'popular':
        return [
          {
            label: 'Popular Anime',
            value: 'Popular Anime',
          },
          {
            label: 'Popular on AniList',
            value: 'Popular on AniList',
          },
          {
            label: 'Popular Anime',
            value: 'Popular Anime',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'top_rated':
        return [
          {
            label: 'Top Rated Anime',
            value: 'Top Rated Anime',
          },
          {
            label: 'Highest Rated on AniList',
            value: 'Highest Rated on AniList',
          },
          {
            label: 'Top Rated Anime',
            value: 'Top Rated Anime',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'custom':
        return getCustomUrlPresets(fetchedTitles?.anilist || '', 'anilist');
      default:
        return [
          {
            label: 'AniList Collection',
            value: 'AniList Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // MyAnimeList collection presets
  if (values.type === 'myanimelist') {
    switch (values.subtype) {
      case 'all':
        return [
          {
            label: 'Top Anime Series',
            value: 'Top Anime Series',
          },
          {
            label: 'Top Anime on MyAnimeList',
            value: 'Top Anime on MyAnimeList',
          },
          {
            label: 'Highest Rated Anime',
            value: 'Highest Rated Anime',
          },
          {
            label: 'Top Anime',
            value: 'Top Anime',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'airing':
        return [
          {
            label: 'Top Airing Anime',
            value: 'Top Airing Anime',
          },
          {
            label: 'Currently Airing - Top Rated',
            value: 'Currently Airing - Top Rated',
          },
          {
            label: 'Best Airing Shows',
            value: 'Best Airing Shows',
          },
          {
            label: 'Top Airing Anime',
            value: 'Top Airing Anime',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'tv':
        return [
          {
            label: 'Top TV Series',
            value: 'Top TV Series',
          },
          {
            label: 'Top Anime TV Shows',
            value: 'Top Anime TV Shows',
          },
          {
            label: 'Best TV Anime',
            value: 'Best TV Anime',
          },
          {
            label: 'Top Anime Series',
            value: 'Top Anime Series',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'movie':
        return [
          {
            label: 'Top Anime Movies',
            value: 'Top Anime Movies',
          },
          {
            label: 'Best Anime Films',
            value: 'Best Anime Films',
          },
          {
            label: 'Highest Rated Anime Movies',
            value: 'Highest Rated Anime Movies',
          },
          {
            label: 'Top Anime Movies',
            value: 'Top Anime Movies',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'ova':
        return [
          {
            label: 'Top OVA Series',
            value: 'Top OVA Series',
          },
          {
            label: 'Best Anime OVAs',
            value: 'Best Anime OVAs',
          },
          {
            label: 'Highest Rated OVAs',
            value: 'Highest Rated OVAs',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'special':
        return [
          {
            label: 'Top Anime Specials',
            value: 'Top Anime Specials',
          },
          {
            label: 'Best Anime Specials',
            value: 'Best Anime Specials',
          },
          {
            label: 'Highest Rated Specials',
            value: 'Highest Rated Specials',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'bypopularity':
        return [
          {
            label: 'Most Popular Anime',
            value: 'Most Popular Anime',
          },
          {
            label: 'Popular on MyAnimeList',
            value: 'Popular on MyAnimeList',
          },
          {
            label: 'Fan Favorites',
            value: 'Fan Favorites',
          },
          {
            label: 'Most Popular Anime',
            value: 'Most Popular Anime',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'favorite':
        return [
          {
            label: 'Most Favorited Anime',
            value: 'Most Favorited Anime',
          },
          {
            label: 'Top Favorited on MyAnimeList',
            value: 'Top Favorited on MyAnimeList',
          },
          {
            label: 'Community Favorites',
            value: 'Community Favorites',
          },
          {
            label: 'Most Favorited Anime',
            value: 'Most Favorited Anime',
          },
          { label: 'Custom', value: 'custom' },
        ];
      default:
        return [
          {
            label: 'MyAnimeList Collection',
            value: 'MyAnimeList Collection',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // Radarr Tag collection presets
  if (values.type === 'radarrtag') {
    return [
      {
        label: '{tagLabel} Movies',
        value: '{tagLabel} Movies',
      },
      {
        label: 'Radarr: {tagLabel}',
        value: 'Radarr: {tagLabel}',
      },
      {
        label: '{tagLabel} Collection',
        value: '{tagLabel} Collection',
      },
      {
        label: 'Movies Tagged: {tagLabel}',
        value: 'Movies Tagged: {tagLabel}',
      },
      { label: 'Custom', value: 'custom' },
    ];
  }

  // Sonarr Tag collection presets
  if (values.type === 'sonarrtag') {
    return [
      {
        label: '{tagLabel} TV Shows',
        value: '{tagLabel} TV Shows',
      },
      {
        label: 'Sonarr: {tagLabel}',
        value: 'Sonarr: {tagLabel}',
      },
      {
        label: '{tagLabel} Collection',
        value: '{tagLabel} Collection',
      },
      {
        label: 'Shows Tagged: {tagLabel}',
        value: 'Shows Tagged: {tagLabel}',
      },
      { label: 'Custom', value: 'custom' },
    ];
  }

  // Coming Soon collection presets
  if (values.type === 'comingsoon') {
    switch (values.subtype) {
      case 'monitored':
        return [
          {
            label: 'Coming Soon',
            value: 'Coming Soon',
          },
          {
            label: 'Coming Soon - Monitored',
            value: 'Coming Soon - Monitored',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'trakt_anticipated':
        return [
          {
            label: 'Coming Soon',
            value: 'Coming Soon',
          },
          {
            label: 'Coming Soon - Trakt Anticipated',
            value: 'Coming Soon - Trakt Anticipated',
          },
          { label: 'Custom', value: 'custom' },
        ];
      case 'tmdb_anticipated':
        return [
          {
            label: 'Coming Soon',
            value: 'Coming Soon',
          },
          {
            label: 'Coming Soon - TMDB',
            value: 'Coming Soon - TMDB',
          },
          { label: 'Custom', value: 'custom' },
        ];
      default:
        return [
          {
            label: 'Coming Soon',
            value: 'Coming Soon',
          },
          { label: 'Custom', value: 'custom' },
        ];
    }
  }

  // Recently Added (filtered) collection presets
  if (values.type === 'recently_added') {
    return [
      {
        label: 'Recently Added',
        value: 'Recently Added',
      },
      {
        label: 'Recently Added (Filtered)',
        value: 'Recently Added (Filtered)',
      },
      {
        label: 'New Arrivals',
        value: 'New Arrivals',
      },
      { label: 'Custom', value: 'custom' },
    ];
  }

  // Fallback for unknown types
  return [
    {
      label: 'Collection',
      value: 'Collection',
    },
    { label: 'Custom', value: 'custom' },
  ];
};
