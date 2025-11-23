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
