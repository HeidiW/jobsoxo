import { describe, expect, it } from "vitest";
import {
  chooseFeaturedJob,
  countUnscheduledQuotedJobs,
  getBulkReminderFeedback,
  individualReminderPath,
  isReminderDispatchConfirmed,
} from "../dashboard-model";

const jobs = [
  { id: "quote-unscheduled", status: "quoted", startDate: null },
  { id: "quote-dated", status: "quoted", startDate: "2025-01-01" },
  { id: "active", status: "in_progress", startDate: null },
  { id: "today", status: "scheduled", startDate: "2025-01-02" },
];

describe("dashboard job helpers", () => {
  it("counts only quoted jobs without a start date as unscheduled", () => {
    expect(countUnscheduledQuotedJobs(jobs)).toBe(1);
  });

  it("prefers an actual job scheduled for today as the featured job", () => {
    expect(chooseFeaturedJob(jobs, [
      { isToday: false, jobs: [] },
      { isToday: true, jobs: [{ jobId: "today" }] },
    ])?.id).toBe("today");
  });

  it("falls back to an active job, then a scheduled job, without inventing a selection", () => {
    expect(chooseFeaturedJob(jobs.slice(0, 3), [])?.id).toBe("active");
    expect(chooseFeaturedJob(jobs.slice(0, 2), [])?.id).toBe("quote-unscheduled");
    expect(chooseFeaturedJob([], [])).toBeUndefined();
  });
});

describe("dashboard reminder feedback", () => {
  it("confirms only a successful bulk payload with its sent count", () => {
    expect(getBulkReminderFeedback({ processed: 3, sent: 3, errors: [] })).toEqual({
      title: "3 reminders sent",
      description: "Payment reminders were dispatched successfully.",
    });
    expect(getBulkReminderFeedback({ processed: 0, sent: 0, errors: [] })).toEqual({
      title: "No reminders to send",
      description: "No reminders are due under your current reminder schedule.",
    });
  });

  it("reports partial and failed dispatches from the real result payload", () => {
    expect(getBulkReminderFeedback({ processed: 4, sent: 2, errors: ["one", "two"] })).toEqual({
      title: "Some reminders sent",
      description: "2 sent; 2 delivery issues reported.",
    });
    expect(getBulkReminderFeedback({ processed: 2, sent: 0, errors: ["one", "two"] })).toEqual({
      title: "Reminders not sent",
      description: "2 delivery issues reported. Check the invoice reminder logs.",
      variant: "destructive",
    });
  });

  it("does not mistake invoices skipped by the schedule for delivery failures", () => {
    expect(getBulkReminderFeedback({ processed: 4, sent: 0, errors: [] }).title).toBe("No reminders to send");
    expect(getBulkReminderFeedback({ processed: 4, sent: 1, errors: [] }).title).toBe("1 reminder sent");
  });

  it("targets the non-mutating reminder endpoint and safely encodes invoice ids", () => {
    expect(individualReminderPath("invoice/with space")).toBe("/api/invoices/invoice%2Fwith%20space/remind");
  });

  it("considers an individual reminder successful only when the endpoint confirms it", () => {
    expect(isReminderDispatchConfirmed({ success: true })).toBe(true);
    expect(isReminderDispatchConfirmed({ success: false })).toBe(false);
    expect(isReminderDispatchConfirmed({})).toBe(false);
  });
});
