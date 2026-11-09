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

const DAY_MS = 86_400_000;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A "YYYY-MM-DD" string that names a real calendar day, or null. */
export function parseCalendarDay(value: unknown): string | null {
  if (typeof value !== "string" || !CALENDAR_DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && calendarDay(date) === value ? value : null;
}

/** Calendar day arithmetic on "YYYY-MM-DD" strings (no time zones involved). */
export function addCalendarDays(day: string, days: number): string {
  return calendarDay(new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * DAY_MS));
}

/** Monday to Friday of the week containing `day` (a weekend day maps to the week just ended). */
export function workweekOf(day: string): string[] {
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  const monday = addCalendarDays(day, -(weekday === 0 ? 6 : weekday - 1));
  return [0, 1, 2, 3, 4].map((offset) => addCalendarDays(monday, offset));
}
