import type {
  DateRange,
  TimeRestriction,
  TimeRestrictionResult,
  WeeklySchedule,
} from '@server/lib/collections/core/types';
import logger from '@server/logger';

/**
 * Utility class for handling collection time restrictions
 * Supports date ranges (DD-MM format) and weekly schedules
 */
export class TimeRestrictionUtils {
  /**
   * Evaluate if a collection should be active based on its time restrictions
   *
   * @param timeRestriction - Time restriction configuration
   * @param currentDate - Optional date to evaluate (defaults to current date)
   * @returns TimeRestrictionResult indicating if collection should be active
   */
  public static evaluateTimeRestriction(
    timeRestriction?: TimeRestriction,
    currentDate?: Date
  ): TimeRestrictionResult {
    const now = currentDate || new Date();

    // If no time restriction or always active, collection is active
    if (!timeRestriction || timeRestriction.alwaysActive) {
      return {
        isActive: true,
        reason: 'always_active',
      };
    }

    const { dateRanges, weeklySchedule } = timeRestriction;

    // Check if current date matches any date ranges
    const dateRangeMatch =
      dateRanges && dateRanges.length > 0
        ? this.isDateInRanges(now, dateRanges)
        : null;

    // Check if current day matches weekly schedule
    const weeklyScheduleMatch = weeklySchedule
      ? this.isDayInWeeklySchedule(now, weeklySchedule)
      : null;

    // Determine if collection should be active
    let isActive = false;
    let reason: TimeRestrictionResult['reason'] = 'no_match';

    if (dateRangeMatch !== null && weeklyScheduleMatch !== null) {
      // Both date ranges and weekly schedule are defined
      isActive = dateRangeMatch && weeklyScheduleMatch;
      reason = isActive ? 'both_match' : 'no_match';
    } else if (dateRangeMatch !== null) {
      // Only date ranges are defined
      isActive = dateRangeMatch;
      reason = isActive ? 'date_range_match' : 'no_match';
    } else if (weeklyScheduleMatch !== null) {
      // Only weekly schedule is defined
      isActive = weeklyScheduleMatch;
      reason = isActive ? 'weekly_schedule_match' : 'no_match';
    }

    const result: TimeRestrictionResult = {
      isActive,
      reason,
    };

    // Calculate next activation/deactivation times
    if (isActive) {
      result.nextDeactivation = this.calculateNextDeactivation(
        now,
        dateRanges,
        weeklySchedule
      );
    } else {
      result.nextActivation = this.calculateNextActivation(
        now,
        dateRanges,
        weeklySchedule
      );
    }

    return result;
  }

  /**
   * Check if current date falls within any of the specified date ranges
   *
   * @param currentDate - Date to check
   * @param dateRanges - Array of date ranges in DD-MM format
   * @returns True if date falls within any range
   */
  private static isDateInRanges(
    currentDate: Date,
    dateRanges: readonly DateRange[]
  ): boolean {
    const currentDay = currentDate.getDate();
    const currentMonth = currentDate.getMonth() + 1; // getMonth() is 0-based

    return dateRanges.some((range) => {
      try {
        const startParts = range.startDate.split('-');
        const endParts = range.endDate.split('-');

        if (startParts.length !== 2 || endParts.length !== 2) {
          logger.warn(
            `Invalid date range format: ${range.startDate} - ${range.endDate}`,
            {
              label: 'Time Restriction Utils',
            }
          );
          return false;
        }

        const startDay = parseInt(startParts[0], 10);
        const startMonth = parseInt(startParts[1], 10);
        const endDay = parseInt(endParts[0], 10);
        const endMonth = parseInt(endParts[1], 10);

        // Validate date parts
        if (
          isNaN(startDay) ||
          isNaN(startMonth) ||
          isNaN(endDay) ||
          isNaN(endMonth) ||
          startDay < 1 ||
          startDay > 31 ||
          endDay < 1 ||
          endDay > 31 ||
          startMonth < 1 ||
          startMonth > 12 ||
          endMonth < 1 ||
          endMonth > 12
        ) {
          logger.warn(
            `Invalid date values in range: ${range.startDate} - ${range.endDate}`,
            {
              label: 'Time Restriction Utils',
            }
          );
          return false;
        }

        return this.isDateInRange(
          currentDay,
          currentMonth,
          startDay,
          startMonth,
          endDay,
          endMonth
        );
      } catch (error) {
        logger.warn(
          `Error parsing date range: ${range.startDate} - ${range.endDate}`,
          {
            label: 'Time Restriction Utils',
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
        return false;
      }
    });
  }

  /**
   * Check if a specific date falls within a date range (handles year boundaries)
   *
   * @param currentDay - Current day (1-31)
   * @param currentMonth - Current month (1-12)
   * @param startDay - Range start day (1-31)
   * @param startMonth - Range start month (1-12)
   * @param endDay - Range end day (1-31)
   * @param endMonth - Range end month (1-12)
   * @returns True if date falls within range
   */
  private static isDateInRange(
    currentDay: number,
    currentMonth: number,
    startDay: number,
    startMonth: number,
    endDay: number,
    endMonth: number
  ): boolean {
    // Create comparable date values (month * 100 + day for easy comparison)
    const currentDate = currentMonth * 100 + currentDay;
    const startDate = startMonth * 100 + startDay;
    const endDate = endMonth * 100 + endDay;

    if (startDate <= endDate) {
      // Range doesn't cross year boundary (e.g., 05-06 to 15-08)
      return currentDate >= startDate && currentDate <= endDate;
    } else {
      // Range crosses year boundary (e.g., 05-12 to 26-01)
      return currentDate >= startDate || currentDate <= endDate;
    }
  }

  /**
   * Check if current day of week matches weekly schedule
   *
   * @param currentDate - Date to check
   * @param weeklySchedule - Weekly schedule configuration
   * @returns True if current day is enabled in schedule
   */
  private static isDayInWeeklySchedule(
    currentDate: Date,
    weeklySchedule: WeeklySchedule
  ): boolean {
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.

    switch (dayOfWeek) {
      case 0:
        return weeklySchedule.sunday;
      case 1:
        return weeklySchedule.monday;
      case 2:
        return weeklySchedule.tuesday;
      case 3:
        return weeklySchedule.wednesday;
      case 4:
        return weeklySchedule.thursday;
      case 5:
        return weeklySchedule.friday;
      case 6:
        return weeklySchedule.saturday;
      default:
        return false;
    }
  }

  /**
   * Calculate the next time the collection should be deactivated
   *
   * @param currentDate - Current date
   * @param dateRanges - Date ranges configuration
   * @param weeklySchedule - Weekly schedule configuration
   * @returns Next deactivation date or undefined if not determinable
   */
  private static calculateNextDeactivation(
    currentDate: Date,
    dateRanges?: readonly DateRange[],
    weeklySchedule?: WeeklySchedule
  ): Date | undefined {
    // This is a simplified implementation
    // In a more complex scenario, you'd need to calculate the exact next deactivation
    // based on both date ranges and weekly schedule

    if (weeklySchedule && !dateRanges) {
      // If only weekly schedule, find next day that's not enabled
      return this.findNextWeeklyDeactivation(currentDate, weeklySchedule);
    }

    if (dateRanges && !weeklySchedule) {
      // If only date ranges, find end of current active range
      return this.findNextDateRangeDeactivation(currentDate, dateRanges);
    }

    // For combined restrictions, more complex logic would be needed
    return undefined;
  }

  /**
   * Calculate the next time the collection should be activated
   *
   * @param currentDate - Current date
   * @param dateRanges - Date ranges configuration
   * @param weeklySchedule - Weekly schedule configuration
   * @returns Next activation date or undefined if not determinable
   */
  private static calculateNextActivation(
    currentDate: Date,
    dateRanges?: readonly DateRange[],
    weeklySchedule?: WeeklySchedule
  ): Date | undefined {
    // This is a simplified implementation
    // In a more complex scenario, you'd need to calculate the exact next activation
    // based on both date ranges and weekly schedule

    if (weeklySchedule && !dateRanges) {
      // If only weekly schedule, find next enabled day
      return this.findNextWeeklyActivation(currentDate, weeklySchedule);
    }

    if (dateRanges && !weeklySchedule) {
      // If only date ranges, find start of next active range
      return this.findNextDateRangeActivation(currentDate, dateRanges);
    }

    // For combined restrictions, more complex logic would be needed
    return undefined;
  }

  /**
   * Find next weekly deactivation (next day that's disabled)
   */
  private static findNextWeeklyDeactivation(
    currentDate: Date,
    weeklySchedule: WeeklySchedule
  ): Date | undefined {
    const daysOfWeek = [
      weeklySchedule.sunday,
      weeklySchedule.monday,
      weeklySchedule.tuesday,
      weeklySchedule.wednesday,
      weeklySchedule.thursday,
      weeklySchedule.friday,
      weeklySchedule.saturday,
    ];

    // Find next day that's disabled
    for (let i = 1; i <= 7; i++) {
      const nextDate = new Date(currentDate);
      nextDate.setDate(currentDate.getDate() + i);
      const dayOfWeek = nextDate.getDay();

      if (!daysOfWeek[dayOfWeek]) {
        return nextDate;
      }
    }

    return undefined;
  }

  /**
   * Find next weekly activation (next day that's enabled)
   */
  private static findNextWeeklyActivation(
    currentDate: Date,
    weeklySchedule: WeeklySchedule
  ): Date | undefined {
    const daysOfWeek = [
      weeklySchedule.sunday,
      weeklySchedule.monday,
      weeklySchedule.tuesday,
      weeklySchedule.wednesday,
      weeklySchedule.thursday,
      weeklySchedule.friday,
      weeklySchedule.saturday,
    ];

    // Find next day that's enabled
    for (let i = 1; i <= 7; i++) {
      const nextDate = new Date(currentDate);
      nextDate.setDate(currentDate.getDate() + i);
      const dayOfWeek = nextDate.getDay();

      if (daysOfWeek[dayOfWeek]) {
        return nextDate;
      }
    }

    return undefined;
  }

  /**
   * Find next date range deactivation (end of current active range)
   */
  private static findNextDateRangeDeactivation(
    currentDate: Date,
    dateRanges: readonly DateRange[]
  ): Date | undefined {
    const currentYear = currentDate.getFullYear();

    for (const range of dateRanges) {
      try {
        const endParts = range.endDate.split('-');
        const endDay = parseInt(endParts[0], 10);
        const endMonth = parseInt(endParts[1], 10);

        // Check if we're currently in this range
        if (this.isDateInRanges(currentDate, [range])) {
          const endDate = new Date(currentYear, endMonth - 1, endDay);

          // If end date is in the past this year, it means the range crosses year boundary
          if (endDate < currentDate) {
            endDate.setFullYear(currentYear + 1);
          }

          return endDate;
        }
      } catch (error) {
        logger.warn(
          `Error calculating deactivation for range: ${range.endDate}`,
          {
            label: 'Time Restriction Utils',
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
    }

    return undefined;
  }

  /**
   * Find next date range activation (start of next active range)
   */
  private static findNextDateRangeActivation(
    currentDate: Date,
    dateRanges: readonly DateRange[]
  ): Date | undefined {
    const currentYear = currentDate.getFullYear();
    let nextActivation: Date | undefined;

    for (const range of dateRanges) {
      try {
        const startParts = range.startDate.split('-');
        const startDay = parseInt(startParts[0], 10);
        const startMonth = parseInt(startParts[1], 10);

        const startDate = new Date(currentYear, startMonth - 1, startDay);

        // If start date is in the past this year, try next year
        if (startDate <= currentDate) {
          startDate.setFullYear(currentYear + 1);
        }

        // Keep track of the earliest next activation
        if (!nextActivation || startDate < nextActivation) {
          nextActivation = startDate;
        }
      } catch (error) {
        logger.warn(
          `Error calculating activation for range: ${range.startDate}`,
          {
            label: 'Time Restriction Utils',
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
    }

    return nextActivation;
  }

  /**
   * Validate a time restriction configuration
   *
   * @param timeRestriction - Time restriction to validate
   * @returns Array of validation error messages (empty if valid)
   */
  public static validateTimeRestriction(
    timeRestriction: TimeRestriction
  ): string[] {
    const errors: string[] = [];

    if (timeRestriction.alwaysActive) {
      // If always active, other settings should be ignored but we won't error
      return errors;
    }

    // Validate date ranges if present
    if (timeRestriction.dateRanges && timeRestriction.dateRanges.length > 0) {
      timeRestriction.dateRanges.forEach((range, index) => {
        const dateErrors = this.validateDateRange(range);
        dateErrors.forEach((error) => {
          errors.push(`Date range ${index + 1}: ${error}`);
        });
      });
    }

    // Validate weekly schedule if present
    if (timeRestriction.weeklySchedule) {
      const hasEnabledDay = Object.values(timeRestriction.weeklySchedule).some(
        (day) => day
      );
      if (!hasEnabledDay) {
        errors.push('Weekly schedule must have at least one day enabled');
      }
    }

    // Check if at least one restriction type is defined
    if (
      !timeRestriction.dateRanges?.length &&
      !timeRestriction.weeklySchedule
    ) {
      errors.push(
        'At least one restriction type (date ranges or weekly schedule) must be defined when not always active'
      );
    }

    return errors;
  }

  /**
   * Validate a single date range
   *
   * @param dateRange - Date range to validate
   * @returns Array of validation error messages (empty if valid)
   */
  private static validateDateRange(dateRange: DateRange): string[] {
    const errors: string[] = [];

    // Validate start date format
    if (!this.isValidDateFormat(dateRange.startDate)) {
      errors.push(
        `Invalid start date format: ${dateRange.startDate}. Expected DD-MM format.`
      );
    }

    // Validate end date format
    if (!this.isValidDateFormat(dateRange.endDate)) {
      errors.push(
        `Invalid end date format: ${dateRange.endDate}. Expected DD-MM format.`
      );
    }

    return errors;
  }

  /**
   * Check if a date string is in valid DD-MM format
   *
   * @param dateString - Date string to validate
   * @returns True if valid DD-MM format
   */
  private static isValidDateFormat(dateString: string): boolean {
    const pattern = /^\d{2}-\d{2}$/;
    if (!pattern.test(dateString)) {
      return false;
    }

    const parts = dateString.split('-');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);

    return day >= 1 && day <= 31 && month >= 1 && month <= 12;
  }
}

export default TimeRestrictionUtils;
