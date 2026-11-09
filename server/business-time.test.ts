import { describe, it, expect } from "vitest";
import { addCalendarDays, businessCalendarDate, businessDay, calendarDay, parseCalendarDay, workweekOf } from "./business-time";

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

describe("calendar day helpers", () => {
  it("accepts only real YYYY-MM-DD days", () => {
    expect(parseCalendarDay("2026-11-09")).toBe("2026-11-09");
    expect(parseCalendarDay("2026-02-30")).toBeNull();
    expect(parseCalendarDay("11/09/2026")).toBeNull();
    expect(parseCalendarDay(undefined)).toBeNull();
    expect(parseCalendarDay(["2026-11-09"])).toBeNull();
  });

  it("adds days across months, years and daylight-saving changes", () => {
    expect(addCalendarDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addCalendarDays("2026-11-01", 1)).toBe("2026-11-02"); // US clocks go back
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds Monday to Friday of the week, with weekends mapping to the week just ended", () => {
    const week = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
    expect(workweekOf("2026-11-09")).toEqual(week);
    expect(workweekOf("2026-11-13")).toEqual(week);
    expect(workweekOf("2026-11-14")).toEqual(week);
    expect(workweekOf("2026-11-15")).toEqual(week);
    expect(workweekOf("2026-11-16")[0]).toBe("2026-11-16");
  });
});
