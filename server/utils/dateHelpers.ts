/**
 * Date utility functions
 * Respects TZ environment variable for calculating release dates relative to server timezone
 * Release dates from TMDB are UTC midnight - we convert them to server timezone for comparison
 */

/**
 * Get the server timezone from TZ environment variable
 */
function getServerTimezone(): string {
  return process.env.TZ || 'UTC';
}

/**
 * Get calendar date components for a given Date in the server timezone
 * Returns normalized Date object at midnight for comparison
 */
function getCalendarDateInTimezone(date: Date): Date {
  const tz = getServerTimezone();

  // Get the calendar date as it appears in the server timezone
  const tzDateString = date.toLocaleString('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // Parse MM/DD/YYYY format
  const [m, d, y] = tzDateString.split('/');

  // Return a Date representing midnight on this calendar date
  // Using local Date constructor for consistent comparison
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 0, 0, 0, 0);
}

/**
 * Parse ISO date string (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:MM:SSZ) as UTC midnight, then convert to server timezone
 * Example: "2025-12-03" = Dec 3 midnight UTC = Dec 3 1PM in NZ = Dec 2 4PM in LA
 * Example: "2025-12-03T15:30:00Z" = Dec 3 midnight UTC (time component stripped)
 */
function parseDate(isoString: string): Date {
  // Extract just the date part (YYYY-MM-DD) if a datetime string is provided
  const dateOnly = isoString.split('T')[0];
  // Parse as UTC midnight
  const utcDate = new Date(dateOnly + 'T00:00:00.000Z');
  // Convert to calendar date in server timezone
  return getCalendarDateInTimezone(utcDate);
}

/**
 * Get current calendar date in server timezone
 * EXPORTED as getToday() for public use
 */
function getNow(): Date {
  return getCalendarDateInTimezone(new Date());
}

/**
 * Get today's date in server timezone (normalized to midnight)
 * @returns Date object representing today at midnight in server timezone
 */
export function getToday(): Date {
  return getNow();
}

/**
 * Check if a date is in the future (compared to today in server timezone)
 * @param date - ISO date string (YYYY-MM-DD) or Date object
 * @returns true if the date is after today
 */
export function isDateInFuture(date: string | Date): boolean {
  const targetDate =
    typeof date === 'string'
      ? parseDate(date)
      : getCalendarDateInTimezone(date);
  const today = getNow();
  return targetDate > today;
}

/**
 * Check if a date is within a specified number of days from today
 * @param date - ISO date string (YYYY-MM-DD) or Date object
 * @param maxDays - Maximum number of days in the future
 * @returns true if date is between today and maxDays from now
 */
export function isDateWithinDays(
  date: string | Date,
  maxDays: number
): boolean {
  const targetDate =
    typeof date === 'string'
      ? parseDate(date)
      : getCalendarDateInTimezone(date);
  const today = getNow();
  const maxDate = new Date(today.getTime() + maxDays * 24 * 60 * 60 * 1000);

  return targetDate >= today && targetDate <= maxDate;
}

/**
 * Get a date X days from today in server timezone
 * @param days - Number of days to add (can be negative for past dates)
 * @returns Date object representing the future/past date
 */
export function getFutureDateFromToday(days: number): Date {
  const today = getNow();
  return new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Calculate days since a past date (in server timezone)
 * Returns positive number for dates in the past, negative for future dates
 *
 * Example: Movie releases "2025-12-03" (UTC midnight)
 * - In LA (UTC-8): That's Dec 2 at 4 PM - shows as "released today" if it's Dec 2 in LA
 * - In NZ (UTC+13): That's Dec 3 at 1 PM - shows as "released today" if it's Dec 3 in NZ
 */
export function calculateDaysSince(date: Date | string): number {
  const targetDate =
    typeof date === 'string'
      ? parseDate(date)
      : getCalendarDateInTimezone(date);

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
