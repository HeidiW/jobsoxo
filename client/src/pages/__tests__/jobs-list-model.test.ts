import { describe, expect, it } from "vitest";
import {
  countJobsByStatus,
  filterJobs,
  formatJobDateRange,
  formatJobEstimate,
  getJobProgress,
  type JobListItem,
} from "../jobs-list-model";

const jobs: JobListItem[] = [
  {
    status: "quoted",
    title: "Rear deck rebuild",
    client: { name: "Mara Chen" },
    address: "12 Willow Street, Brooklyn",
    estimatedTotal: "18650.50",
  },
  {
    status: "in_progress",
    title: "Storefront repaint",
    client: { name: "Northline Market" },
    address: "Queens",
    estimatedTotal: null,
  },
  {
    status: "completed",
    title: "Tile repair",
    estimatedTotal: "0",
  },
];

describe("jobs list helpers", () => {
  it("counts every visible status, including quoted jobs", () => {
    expect(countJobsByStatus(jobs)).toEqual({
      all: 3,
      quoted: 1,
      scheduled: 0,
      in_progress: 1,
      completed: 1,
    });
  });

  it("filters by status and searches title, client, and address without case sensitivity", () => {
    expect(filterJobs(jobs, "quoted", "").map((job) => job.title)).toEqual(["Rear deck rebuild"]);
    expect(filterJobs(jobs, "all", "NORTHLINE").map((job) => job.title)).toEqual(["Storefront repaint"]);
    expect(filterJobs(jobs, "all", "willow").map((job) => job.title)).toEqual(["Rear deck rebuild"]);
    expect(filterJobs(jobs, "scheduled", "").map((job) => job.title)).toEqual([]);
  });

  it("never invents partial completion from a job status", () => {
    expect(getJobProgress("completed")).toBe(100);
    expect(getJobProgress("in_progress")).toBeNull();
    expect(getJobProgress("scheduled")).toBeNull();
    expect(getJobProgress("quoted")).toBeNull();
  });

  it("formats known estimates and leaves missing or invalid amounts blank", () => {
    expect(formatJobEstimate("18650.50")).toBe("$18,650.50");
    expect(formatJobEstimate("0")).toBe("$0.00");
    expect(formatJobEstimate(null)).toBe("—");
    expect(formatJobEstimate("unknown")).toBe("—");
  });

  it("formats complete and partial date ranges and handles absent or invalid dates", () => {
    expect(formatJobDateRange("2026-10-12T12:00:00.000Z", "2026-10-30T12:00:00.000Z")).toBe("Oct 12 – Oct 30");
    expect(formatJobDateRange("2026-10-12T12:00:00.000Z", null)).toBe("From Oct 12");
    expect(formatJobDateRange(null, null)).toBe("Dates not set");
    expect(formatJobDateRange("not-a-date", null)).toBe("Dates not set");
  });
});
