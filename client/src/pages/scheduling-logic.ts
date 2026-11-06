import {
  addDays, differenceInCalendarDays, endOfMonth, endOfWeek, eachDayOfInterval,
  format, isSameMonth, startOfMonth, startOfWeek,
} from "date-fns";
import type { Job } from "@shared/schema";

export interface ScheduleJob extends Job {
  client?: { name: string } | null;
  assignedEmployees?: { id: string; name: string }[];
}

/** Job dates are calendar dates, including when the API serializes them as ISO timestamps. */
export function parseScheduleDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (dateOnly && (
    parsed.getFullYear() !== Number(dateOnly[1]) ||
    parsed.getMonth() !== Number(dateOnly[2]) - 1 ||
    parsed.getDate() !== Number(dateOnly[3]) ||
    (value.length > 10 && Number.isNaN(new Date(value).getTime()))
  )) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function formatScheduleDate(value: string | Date | null | undefined): string {
  const date = parseScheduleDate(value);
  return date ? format(date, "MMM d, yyyy") : "Date not set";
}

export function getScheduleRange(job: Pick<Job, "startDate" | "endDate">) {
  const start = parseScheduleDate(job.startDate);
  if (!start) return null;
  const end = parseScheduleDate(job.endDate) ?? start;
  return { start, end: end < start ? start : end };
}

export function filterScheduleJobs(jobs: ScheduleJob[]) {
  const eligible = jobs.filter((job) => job.status !== "completed");
  return {
    active: eligible.filter((job) => !!getScheduleRange(job) && job.status !== "quoted"),
    backlog: eligible.filter((job) => !getScheduleRange(job) || job.status === "quoted"),
  };
}

export function getFortnightDays(anchor: Date) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 14 }, (_, index) => addDays(start, index));
}

export function getMonthDays(anchor: Date) {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 0 });
  return eachDayOfInterval({ start, end });
}

/** Inclusive overlap, clipped to the visible 14-day window, in percentage units. */
export function getBarPosition(job: Pick<Job, "startDate" | "endDate">, windowStart: Date, dayCount = 14) {
  const range = getScheduleRange(job);
  if (!range || dayCount < 1) return null;
  const windowEnd = addDays(windowStart, dayCount - 1);
  if (range.end < windowStart || range.start > windowEnd) return null;
  const clippedStart = range.start < windowStart ? windowStart : range.start;
  const clippedEnd = range.end > windowEnd ? windowEnd : range.end;
  const left = differenceInCalendarDays(clippedStart, windowStart);
  const span = differenceInCalendarDays(clippedEnd, clippedStart) + 1;
  return { left, span, leftPercent: (left / dayCount) * 100, widthPercent: (span / dayCount) * 100 };
}

export function getWeekendOnlyJobs(jobs: ScheduleJob[], days: Date[]) {
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];
  if (!rangeStart || !rangeEnd) return [];
  return jobs.filter((job) => {
    const range = getScheduleRange(job);
    if (!range || range.end < rangeStart || range.start > rangeEnd) return false;
    const first = range.start < rangeStart ? rangeStart : range.start;
    const last = range.end > rangeEnd ? rangeEnd : range.end;
    return Array.from({ length: differenceInCalendarDays(last, first) + 1 }, (_, index) => addDays(first, index))
      .every((day) => day.getDay() === 0 || day.getDay() === 6);
  });
}

export function getStableJobColorIndex(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 6;
}

export function isSameCalendarMonth(a: Date, b: Date) {
  return isSameMonth(a, b);
}
