import { describe, expect, it } from "vitest";
import {
  filterScheduleJobs, getBarPosition, getFortnightDays, getMonthDays,
  getScheduleRange, getStableJobColorIndex, getWeekendOnlyJobs,
  parseScheduleDate, type ScheduleJob,
} from "../scheduling-logic";

function job(startDate: string | null, endDate: string | null = null, status = "scheduled") {
  return { id: "job-a", status, startDate, endDate } as unknown as ScheduleJob;
}

describe("scheduling calendar logic", () => {
  it("preserves calendar dates, including API midnight timestamps", () => {
    for (const value of ["2026-10-19", "2026-10-19T00:00:00.000Z"]) {
      const result = parseScheduleDate(value)!;
      expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2026, 9, 19]);
      expect(result.getHours()).toBe(0);
    }
    expect(parseScheduleDate("not-a-date")).toBeNull();
    expect(parseScheduleDate(null)).toBeNull();
  });

  it("uses inclusive dates and treats missing ends as single-day jobs", () => {
    const anchor = new Date(2026, 9, 19);
    expect(getBarPosition(job("2026-10-19"), anchor)).toMatchObject({ left: 0, span: 1 });
    expect(getBarPosition(job("2026-10-19", "2026-10-21"), anchor)).toMatchObject({ left: 0, span: 3 });
    expect(getScheduleRange(job("2026-10-21", "2026-10-19"))?.end.getDate()).toBe(21);
    expect(getBarPosition(job(null), anchor)).toBeNull();
  });

  it("clips spanning jobs and omits jobs outside the visible fortnight", () => {
    const anchor = new Date(2026, 9, 19);
    expect(getBarPosition(job("2026-10-01", "2026-11-12"), anchor)).toMatchObject({ left: 0, span: 14, leftPercent: 0, widthPercent: 100 });
    expect(getBarPosition(job("2026-10-18", "2026-10-20"), anchor)).toMatchObject({ left: 0, span: 2 });
    expect(getBarPosition(job("2026-11-01", "2026-11-04"), anchor)).toMatchObject({ left: 13, span: 1 });
    expect(getBarPosition(job("2026-10-18"), anchor)).toBeNull();
    expect(getBarPosition(job("2026-11-02"), anchor)).toBeNull();
  });

  it("builds Monday-based fortnights across month and year boundaries", () => {
    const days = getFortnightDays(new Date(2026, 11, 30));
    expect(days).toHaveLength(14);
    expect(days[0].getDay()).toBe(1);
    expect([days[0].getMonth(), days[0].getDate()]).toEqual([11, 28]);
    expect([days[13].getFullYear(), days[13].getMonth(), days[13].getDate()]).toEqual([2027, 0, 10]);
    const month = getMonthDays(new Date(2027, 0, 15));
    expect(month[0].getDay()).toBe(0);
    expect(month.at(-1)!.getDay()).toBe(6);
    expect(month.some((day) => day.getMonth() === 11)).toBe(true);
  });

  it("keeps quoted and undated jobs in backlog, not completed jobs", () => {
    const active = job("2026-10-19");
    const quoted = { ...job("2026-10-19", null, "quoted"), id: "quoted" };
    const undated = { ...job(null), id: "undated" };
    const completed = { ...job(null, null, "completed"), id: "completed" };
    const result = filterScheduleJobs([active, quoted, undated, completed]);
    expect(result.active.map(({ id }) => id)).toEqual(["job-a"]);
    expect(result.backlog.map(({ id }) => id)).toEqual(["quoted", "undated"]);
  });

  it("finds weekend-only work without mislabeling weekday-spanning work", () => {
    const weekend = { ...job("2026-10-24", "2026-10-25"), id: "weekend" };
    const spanning = { ...job("2026-10-23", "2026-10-26"), id: "spanning" };
    expect(getWeekendOnlyJobs([weekend, spanning], getFortnightDays(new Date(2026, 9, 19))).map(({ id }) => id)).toEqual(["weekend"]);
  });

  it("keeps each job's color stable when lists are reordered or filtered", () => {
    const color = getStableJobColorIndex("hotel-restoration");
    expect(color).toBeGreaterThanOrEqual(0);
    expect(color).toBeLessThan(6);
    expect(["other", "hotel-restoration"].map(getStableJobColorIndex)[1]).toBe(color);
  });
});
