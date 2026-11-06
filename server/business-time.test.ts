import { describe, it, expect } from "vitest";
import { businessCalendarDate, businessDay, calendarDay } from "./business-time";

describe("businessDay", () => {
  it("uses the New York calendar day, not UTC", () => {
    expect(businessDay(new Date("2026-03-10T01:30:00Z"))).toBe("2026-03-09"); // 9:30pm EDT Mar 9
    expect(businessDay(new Date("2026-03-10T05:00:00Z"))).toBe("2026-03-10"); // 1:00am EDT Mar 10
  });

  it("handles both standard and daylight time", () => {
    // EST (UTC-5): 11:59pm Jan 15 New York is 04:59 Jan 16 UTC.
    expect(businessDay(new Date("2026-01-16T04:59:00Z"))).toBe("2026-01-15");
    expect(businessDay(new Date("2026-01-16T05:00:00Z"))).toBe("2026-01-16");
    // EDT (UTC-4): 11:59pm Jul 4 New York is 03:59 Jul 5 UTC.
    expect(businessDay(new Date("2026-07-05T03:59:00Z"))).toBe("2026-07-04");
    expect(businessDay(new Date("2026-07-05T04:00:00Z"))).toBe("2026-07-05");
  });
});

describe("businessCalendarDate", () => {
  it("encodes the business day as UTC midnight", () => {
    expect(businessCalendarDate(new Date("2026-03-10T01:30:00Z")).toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});

describe("calendarDay", () => {
  it("reads the encoded day of a stored date", () => {
    expect(calendarDay("2026-03-09T00:00:00.000Z")).toBe("2026-03-09");
    expect(calendarDay(new Date("2026-03-09T00:00:00Z"))).toBe("2026-03-09");
  });
});
