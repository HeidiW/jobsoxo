import type { Job } from "@shared/schema";

export interface DashboardWeekJobRef {
  jobId: string;
}

export interface DashboardWeekDayRef {
  isToday: boolean;
  jobs: DashboardWeekJobRef[];
}

export interface DashboardJobRef extends Pick<Job, "id" | "status" | "startDate"> {}

export interface BulkReminderResult {
  processed: number;
  sent: number;
  errors: string[];
}

export interface ReminderFeedback {
  title: string;
  description: string;
  variant?: "destructive";
}

export function individualReminderPath(invoiceId: string): string {
  return `/api/invoices/${encodeURIComponent(invoiceId)}/remind`;
}

export function isReminderDispatchConfirmed(result: { success?: boolean }): boolean {
  return result.success === true;
}

export function getBulkReminderFeedback(result: BulkReminderResult): ReminderFeedback {
  // `processed` counts invoices examined, including those skipped because
  // their next scheduled stage is not due. It is not a delivery count.
  const issues = result.errors.length;
  if (result.sent === 0 && issues === 0) {
    return { title: "No reminders to send", description: "No reminders are due under your current reminder schedule." };
  }
  if (result.sent === 0) {
    return {
      title: "Reminders not sent",
      description: `${issues} delivery issue${issues === 1 ? "" : "s"} reported. Check the invoice reminder logs.`,
      variant: "destructive",
    };
  }
  if (issues > 0) {
    return {
      title: "Some reminders sent",
      description: `${result.sent} sent; ${issues} delivery issue${issues === 1 ? "" : "s"} reported.`,
    };
  }
  return {
    title: `${result.sent} reminder${result.sent === 1 ? "" : "s"} sent`,
    description: "Payment reminders were dispatched successfully.",
  };
}

export function countUnscheduledQuotedJobs(jobs: DashboardJobRef[]): number {
  return jobs.filter((job) => job.status === "quoted" && !job.startDate).length;
}

export function chooseFeaturedJob<T extends DashboardJobRef>(
  jobs: T[],
  week: DashboardWeekDayRef[],
): T | undefined {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const today = week.find((day) => day.isToday);
  const scheduledToday = today?.jobs
    .map((item) => byId.get(item.jobId))
    .find((job): job is T => !!job);
  if (scheduledToday) return scheduledToday;
  return jobs.find((job) => job.status === "in_progress")
    ?? jobs.find((job) => job.status === "scheduled")
    ?? jobs[0];
}
