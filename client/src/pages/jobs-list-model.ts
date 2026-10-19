export type JobFilter = "all" | "quoted" | "scheduled" | "in_progress" | "completed";

export interface JobListItem {
  status: string;
  title: string;
  address?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  estimatedTotal?: string | number | null;
  client?: { name?: string | null } | null;
}

export function getJobProgress(status: string): 100 | null {
  return status === "completed" ? 100 : null;
}

export function countJobsByStatus<T extends { status: string }>(jobs: T[]) {
  return {
    all: jobs.length,
    quoted: jobs.filter((job) => job.status === "quoted").length,
    scheduled: jobs.filter((job) => job.status === "scheduled").length,
    in_progress: jobs.filter((job) => job.status === "in_progress").length,
    completed: jobs.filter((job) => job.status === "completed").length,
  };
}

export function filterJobs<T extends JobListItem>(jobs: T[], filter: JobFilter, query: string): T[] {
  const search = query.trim().toLocaleLowerCase();
  return jobs.filter((job) => {
    if (filter !== "all" && job.status !== filter) return false;
    if (!search) return true;
    return [job.title, job.client?.name ?? "", job.address ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(search));
  });
}

export function formatJobEstimate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
}

export function formatJobDateRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (startDate && endDate) return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  if (startDate) return `From ${formatDate(startDate)}`;
  if (endDate) return `Until ${formatDate(endDate)}`;
  return "Dates not set";
}
