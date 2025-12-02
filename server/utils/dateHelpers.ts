/**
 * Date utility functions
 */

/**
 * Parse ISO date string and normalize to start of day (UTC)
 */
function parseDate(isoString: string): Date {
  const date = new Date(isoString);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Get current date normalized to start of day (UTC)
 */
function getNow(): Date {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

/**
 * Calculate days since a past date (UTC)
 * Returns positive number for dates in the past, negative for future dates
 */
export function calculateDaysSince(date: Date | string): number {
  const targetDate =
    typeof date === 'string' ? parseDate(date) : new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);

  const today = getNow();
  const diffTime = today.getTime() - targetDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Format a date string or Date object according to the specified format
 * @param date - ISO date string or Date object
 * @param format - Format string
 * @returns Formatted date string
 */
export function formatDate(date: Date | string, format: string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Month names for formatting
  const monthNames = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const monthNamesFull = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;
  const day = dateObj.getDate();
  const monthName = monthNames[dateObj.getMonth()];
  const monthNameFull = monthNamesFull[dateObj.getMonth()];

  // Pad with leading zeros
  const pad = (n: number) => String(n).padStart(2, '0');

  switch (format) {
    case 'YYYY-MM-DD':
      return `${year}-${pad(month)}-${pad(day)}`;
    case 'YYYY/MM/DD':
      return `${year}/${pad(month)}/${pad(day)}`;
    case 'DD-MM-YYYY':
      return `${pad(day)}-${pad(month)}-${year}`;
    case 'DD/MM/YYYY':
      return `${pad(day)}/${pad(month)}/${year}`;
    case 'MM/DD/YYYY':
      return `${pad(month)}/${pad(day)}/${year}`;
    case 'MMM DD':
      return `${monthName} ${pad(day)}`;
    case 'DD MMM':
      return `${pad(day)} ${monthName}`;
    case 'MMM DD, YYYY':
      return `${monthName} ${pad(day)}, ${year}`;
    case 'DD MMM YYYY':
      return `${pad(day)} ${monthName} ${year}`;
    case 'MMMM DD, YYYY':
      return `${monthNameFull} ${pad(day)}, ${year}`;
    case 'DD MMMM YYYY':
      return `${pad(day)} ${monthNameFull} ${year}`;
    default:
      // Default to MMM DD if unknown format
      return `${monthName} ${pad(day)}`;
  }
}

/**
 * Extract release dates from TMDB release_dates API response
 * Finds earliest digital (type 4), physical (type 5), and theatrical (type 3) releases across ALL countries
 *
 * @param releaseDatesResults - TMDB release_dates.results array
 * @returns Object with extracted earliest release dates
 */
export function extractReleaseDates(
  releaseDatesResults: {
    iso_3166_1: string;
    release_dates: { type: number; release_date?: string }[];
  }[]
): {
  digitalRelease?: string;
  physicalRelease?: string;
  inCinemas?: string;
  earliestReleaseDate?: Date;
} {
  let earliestDigital: Date | null = null;
  let earliestPhysical: Date | null = null;
  let earliestTheatrical: Date | null = null;
  let earliestOverall: Date | null = null;

  // Check all countries, not just US
  for (const country of releaseDatesResults) {
    if (!country.release_dates) continue;

    for (const rd of country.release_dates) {
      if (!rd.release_date) continue;

      const releaseDate = new Date(rd.release_date);

      // Type 4 = Digital
      if (rd.type === 4) {
        if (!earliestDigital || releaseDate < earliestDigital) {
          earliestDigital = releaseDate;
        }
      }

      // Type 5 = Physical
      if (rd.type === 5) {
        if (!earliestPhysical || releaseDate < earliestPhysical) {
          earliestPhysical = releaseDate;
        }
      }

      // Type 3 = Theatrical
      if (rd.type === 3) {
        if (!earliestTheatrical || releaseDate < earliestTheatrical) {
          earliestTheatrical = releaseDate;
        }
      }
    }
  }

  // Build result with earliest dates found
  const result: {
    digitalRelease?: string;
    physicalRelease?: string;
    inCinemas?: string;
    earliestReleaseDate?: Date;
  } = {};

  if (earliestDigital) {
    result.digitalRelease = earliestDigital.toISOString();
    if (!earliestOverall || earliestDigital < earliestOverall) {
      earliestOverall = earliestDigital;
    }
  }

  if (earliestPhysical) {
    result.physicalRelease = earliestPhysical.toISOString();
    if (!earliestOverall || earliestPhysical < earliestOverall) {
      earliestOverall = earliestPhysical;
    }
  }

  if (earliestTheatrical) {
    result.inCinemas = earliestTheatrical.toISOString();
  }

  if (earliestOverall) {
    result.earliestReleaseDate = earliestOverall;
  }

  return result;
}

/**
 * Determine the best release date using priority logic:
 * Digital > Physical > Theatrical (+90 days estimate)
 *
 * @param digitalRelease - Digital release date (ISO string)
 * @param physicalRelease - Physical release date (ISO string)
 * @param theatricalRelease - Theatrical release date (ISO string)
 * @returns Object with releaseDate and whether it's estimated
 */
export function determineReleaseDate(
  digitalRelease?: string,
  physicalRelease?: string,
  theatricalRelease?: string
): { releaseDate: string; isEstimated: boolean } | undefined {
  // Priority 1: Digital release
  if (digitalRelease) {
    return {
      releaseDate: digitalRelease.split('T')[0],
      isEstimated: false,
    };
  }

  // Priority 2: Physical release
  if (physicalRelease) {
    return {
      releaseDate: physicalRelease.split('T')[0],
      isEstimated: false,
    };
  }

  // Priority 3: Theatrical + 90 days estimate
  if (theatricalRelease) {
    const baseDate = new Date(theatricalRelease);
    baseDate.setDate(baseDate.getDate() + 90);
    return {
      releaseDate: baseDate.toISOString().split('T')[0],
      isEstimated: true,
    };
  }

  return undefined;
}
