// The business's local time zone. Servers run in UTC, so "today" for crews
// must be computed here rather than with server-local Date methods.
export const BUSINESS_TIME_ZONE = "America/New_York";

/** The business-local calendar day of an instant, as "YYYY-MM-DD". */
export function businessDay(instant: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The business-local calendar day of an instant, encoded like other calendar
 * dates (UTC midnight), e.g. 9:30pm New York on Mar 9 → 2026-03-09T00:00:00Z.
 */
export function businessCalendarDate(instant: Date = new Date()): Date {
  return new Date(`${businessDay(instant)}T00:00:00.000Z`);
}

/** The calendar day a stored date-only value encodes, as "YYYY-MM-DD". */
export function calendarDay(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}
