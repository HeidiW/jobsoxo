import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch, Link } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import JobForm from "@/components/job-form";
import JobsListThumbnail from "@/components/jobs-list-thumbnail";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import {
  BriefcaseBusiness,
  CalendarDays,
  CircleAlert,
  Ellipsis,
  Eye,
  FileText,
  MapPin,
  Plus,
  Ruler,
  Search,
  Trash2,
  X,
  Pencil,
} from "lucide-react";
import type { Job, Client } from "@shared/schema";
import {
  countJobsByStatus,
  filterJobs,
  formatJobDateRange,
  formatJobEstimate,
  getJobProgress,
  type JobFilter,
} from "./jobs-list-model";

interface JobWithClient extends Job {
  client: Client | null;
}

const FILTERS: { key: JobFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "quoted", label: "Quoted" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
];

const STATUS_STYLE: Record<string, string> = {
  quoted: "bg-jx-blue-tint text-jx-blue-ink",
  scheduled: "bg-jx-gold-tint text-jx-gold-ink",
  in_progress: "bg-jx-green-tint text-jx-green-ink",
  completed: "bg-jx-surface text-jx-ink-2",
};

function RowActions({
  job,
  onEdit,
  onDelete,
}: {
  job: JobWithClient;
  onEdit: (job: Job) => void;
  onDelete: (job: JobWithClient) => void;
}) {
  return (
    <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${job.title}`}
            className="h-10 w-10 rounded-full text-jx-ink-3 hover:bg-jx-green-tint hover:text-jx-green-ink"
            data-testid={`button-job-actions-${job.id}`}
          >
            <Ellipsis className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-48 rounded-2xl p-1.5">
          <DropdownMenuItem asChild data-testid={`button-view-job-${job.id}`}>
            <Link href={`/jobs/${job.id}`} className="cursor-pointer rounded-xl">
              <Eye className="mr-2 h-4 w-4" /> View details
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit(job)} data-testid={`button-edit-job-${job.id}`} className="rounded-xl">
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem asChild data-testid={`button-line-items-${job.id}`}>
            <Link href={`/jobs/${job.id}/line-items`} className="cursor-pointer rounded-xl">
              <Ruler className="mr-2 h-4 w-4" /> Line items
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild data-testid={`button-create-invoice-job-${job.id}`}>
            <Link href={`/invoices/new?jobId=${encodeURIComponent(job.id)}`} className="cursor-pointer rounded-xl">
              <FileText className="mr-2 h-4 w-4" /> New invoice
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            onSelect={() => onDelete(job)}
            className="rounded-xl text-destructive focus:text-destructive"
            data-testid={`button-delete-job-${job.id}`}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function Jobs() {
  const clientId = new URLSearchParams(useSearch()).get("clientId");
  const [activeFilter, setActiveFilter] = useState<JobFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [deletingJob, setDeletingJob] = useState<JobWithClient | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const {
    data: jobs,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<JobWithClient[]>({ queryKey: ["/api/jobs"] });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/jobs/${jobId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      trackEvent("job_deleted");
      toast({ title: "Job deleted", description: `"${deletingJob?.title}" and its related records have been deleted.` });
      setDeletingJob(null);
    },
    onError: () => toast({ title: "Failed to delete job", variant: "destructive" }),
  });

  const allJobs = useMemo(
    () => (jobs ?? []).filter((job) => !clientId || job.clientId === clientId),
    [jobs, clientId],
  );
  const counts = useMemo(() => countJobsByStatus(allJobs), [allJobs]);
  const visibleJobs = useMemo(
    () => filterJobs(allJobs, activeFilter, searchQuery),
    [allJobs, activeFilter, searchQuery],
  );
  const quotedTotal = allJobs
    .filter((job) => job.status === "quoted")
    .reduce((sum, job) => sum + (Number(job.estimatedTotal) || 0), 0);
  const subtitle = isLoading
    ? "Loading your jobs"
    : isError
      ? "Your job list is unavailable"
      : <>{allJobs.length} {allJobs.length === 1 ? "job" : "jobs"} · <span className="font-mono">{formatJobEstimate(quotedTotal)}</span> quoted in total</>;

  function openNew() {
    setEditingJob(null);
    setIsDialogOpen(true);
  }

  function openEdit(job: Job) {
    setEditingJob(job);
    setIsDialogOpen(true);
  }

  function closeDialog() {
    setIsDialogOpen(false);
    setEditingJob(null);
  }

  function openJob(job: JobWithClient) {
    setLocation(`/jobs/${job.id}`);
  }

  const filtersAreActive = activeFilter !== "all" || searchQuery.trim().length > 0 || !!clientId;

  return (
    <>
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-xl !flex max-h-[90dvh] flex-col overflow-hidden rounded-3xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-display text-2xl !font-bold text-jx-ink">
              {editingJob ? "Edit job" : "New job"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <JobForm job={editingJob || undefined} onSuccess={() => {}} onClose={closeDialog} />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingJob} onOpenChange={(open) => { if (!open) setDeletingJob(null); }}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl !font-bold">Delete this job?</AlertDialogTitle>
            <AlertDialogDescription className="text-base leading-relaxed">
              This permanently deletes <strong className="text-jx-ink">“{deletingJob?.title}”</strong> and all
              associated invoices, line items, and documents. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep job</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingJob && deleteJobMutation.mutate(deletingJob.id)}
              disabled={deleteJobMutation.isPending}
              data-testid="button-confirm-delete-job"
            >
              {deleteJobMutation.isPending ? "Deleting…" : "Delete job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="min-h-[100dvh] px-4 pb-12 pt-7 sm:px-7 sm:pt-9 xl:px-10">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-7">
          <header className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="font-display text-[54px] !font-bold leading-[.95] tracking-[-.055em] text-jx-ink sm:text-[64px]">
                Jobs
              </h1>
              <p className="mt-3 text-[15px] text-jx-ink-2 sm:text-[17px]" data-testid="text-jobs-subtitle">
                {subtitle}
              </p>
            </div>
            <Button
              onClick={openNew}
              className="min-h-12 rounded-full bg-jx-green px-6 text-xs font-bold tracking-[.08em] text-white hover:bg-jx-green-hover sm:text-sm"
              data-testid="button-add-job"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              NEW JOB
            </Button>
          </header>

          {clientId && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-jx-green-tint px-4 py-3 text-sm text-jx-green-ink" data-testid="job-client-filter">
              <span className="min-w-0 break-words">Jobs for <strong>{allJobs[0]?.client?.name || "the selected client"}</strong></span>
              <Button variant="outline" className="min-h-11 rounded-full border-jx-green text-jx-green-ink" onClick={() => setLocation("/jobs")} data-testid="button-clear-client-filter">
                View all clients’ jobs
              </Button>
            </div>
          )}
          <section aria-label="Filter jobs" className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Job status">
              {FILTERS.map(({ key, label }) => {
                const active = activeFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveFilter(key)}
                    aria-pressed={active}
                    className={[
                      "inline-flex min-h-11 items-center gap-2.5 rounded-full border-2 px-[18px] py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jx-green focus-visible:ring-offset-2",
                      active
                        ? "border-jx-green bg-jx-green text-white"
                        : "border-jx-ink-3 bg-card text-jx-ink hover:border-jx-green",
                    ].join(" ")}
                    data-testid={`filter-tab-${key}`}
                  >
                    {label}
                    <span
                      className={[
                        "font-mono text-xs font-medium tabular-nums",
                        active ? "text-white/80" : "text-jx-ink-3",
                      ].join(" ")}
                    >
                      {counts[key]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex h-11 min-w-0 items-center gap-2.5 rounded-full border-2 border-transparent bg-jx-surface px-4 focus-within:border-jx-green xl:ml-auto xl:w-[300px]">
              <Search className="h-4 w-4 shrink-0 text-jx-ink-3" aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search jobs, clients, addresses"
                aria-label="Search jobs"
                className="min-w-0 flex-1 bg-transparent text-sm text-jx-ink outline-none placeholder:text-jx-ink-3"
                data-testid="input-search-jobs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-jx-ink-3 hover:bg-card hover:text-jx-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </section>

          <section
            className="overflow-hidden rounded-3xl bg-jx-surface p-2.5 sm:p-3"
            aria-label="Jobs table"
            data-testid="jobs-table"
          >
            <div className="relative min-w-0 overflow-x-auto" data-testid="jobs-table-scroll">
              <div className={isError || (!isLoading && visibleJobs.length === 0) ? "min-w-0" : "min-w-[1000px]"}>
                {!isError && (isLoading || visibleJobs.length > 0) && (
                <div
                  className="grid h-[52px] grid-cols-[64px_minmax(280px,1fr)_140px_130px_120px_110px_44px] items-center gap-3 border-2 border-transparent px-[18px] text-xs font-semibold uppercase tracking-[.06em] text-jx-ink-3"
                >
                  <span><span className="sr-only">Document</span></span>
                  <span>Job</span>
                  <span>Dates</span>
                  <span>Status</span>
                  <span className="text-right">Estimate</span>
                  <span>Progress</span>
                  <span><span className="sr-only">Actions</span></span>
                </div>
                )}

                {isLoading && (
                  <div className="space-y-2" aria-label="Loading jobs" data-testid="jobs-loading">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="grid h-[82px] grid-cols-[64px_minmax(280px,1fr)_140px_130px_120px_110px_44px] items-center gap-3 rounded-2xl bg-card px-[18px]">
                        <div className="h-12 w-16 animate-pulse rounded-xl bg-jx-surface" />
                        <div className="space-y-2">
                          <div className="h-4 w-44 animate-pulse rounded bg-jx-surface" />
                          <div className="h-3 w-56 animate-pulse rounded bg-jx-surface" />
                        </div>
                        <div className="h-4 w-24 animate-pulse rounded bg-jx-surface" />
                        <div className="h-7 w-20 animate-pulse rounded-full bg-jx-surface" />
                        <div className="ml-auto h-4 w-20 animate-pulse rounded bg-jx-surface" />
                        <div className="h-4 w-20 animate-pulse rounded bg-jx-surface" />
                        <div />
                      </div>
                    ))}
                  </div>
                )}

                {isError && (
                  <div className="my-2 flex min-h-64 flex-col items-center justify-center rounded-2xl bg-card px-6 text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-jx-gold-tint text-jx-gold-ink">
                      <CircleAlert className="h-6 w-6" />
                    </div>
                    <h2 className="font-display text-xl !font-bold text-jx-ink">Jobs didn’t load</h2>
                    <p className="mt-1 max-w-sm text-sm text-jx-ink-2">Check your connection, then try loading your jobs again.</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { void refetch(); }}
                      disabled={isFetching}
                      className="mt-5 min-h-11 rounded-full border-2 border-jx-ink px-5 font-semibold"
                      data-testid="button-retry-jobs"
                    >
                      {isFetching ? "Trying again…" : "Retry"}
                    </Button>
                  </div>
                )}

                {!isLoading && !isError && visibleJobs.length === 0 && (
                  <div className="my-2 flex min-h-[300px] flex-col items-center justify-center rounded-2xl bg-card px-6 py-10 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink">
                      {filtersAreActive ? <Search className="h-6 w-6" /> : <BriefcaseBusiness className="h-6 w-6" />}
                    </div>
                    <h2 className="font-display text-2xl !font-bold text-jx-ink">
                      {allJobs.length === 0 ? "No jobs yet" : filtersAreActive ? "No matching jobs" : "No jobs to show"}
                    </h2>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-jx-ink-2">
                      {allJobs.length === 0
                        ? "Add the work you’ve quoted or booked to keep every job and estimate together."
                        : searchQuery.trim()
                          ? `Nothing matches “${searchQuery.trim()}”. Try a different job, client, or address.`
                          : "There aren’t any jobs in this status. Choose another filter to see the rest."}
                    </p>
                    {allJobs.length === 0 ? (
                      <Button
                        onClick={openNew}
                        className="mt-5 min-h-12 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover"
                        data-testid="button-add-first-job"
                      >
                        <Plus className="h-4 w-4" /> New job
                      </Button>
                    ) : filtersAreActive ? (
                      <Button
                        variant="outline"
                        onClick={() => { setActiveFilter("all"); setSearchQuery(""); if (clientId) setLocation("/jobs"); }}
                        className="mt-5 min-h-11 rounded-full border-2 border-jx-ink px-5 font-semibold"
                        data-testid="button-clear-job-filters"
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                )}

                {!isLoading && !isError && visibleJobs.map((job) => {
                  const progress = getJobProgress(job.status);
                  const statusStyle = STATUS_STYLE[job.status] ?? "bg-jx-surface text-jx-ink-2";
                  const client = job.client?.name || "Client not assigned";
                  const address = job.address?.trim();
                  return (
                    <div
                      key={job.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open ${job.title}`}
                      onClick={() => openJob(job)}
                      onKeyDown={(event) => {
                        if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                          event.preventDefault();
                          openJob(job);
                        }
                      }}
                      className="group mb-2 grid min-h-[82px] cursor-pointer grid-cols-[64px_minmax(280px,1fr)_140px_130px_120px_110px_44px] items-center gap-3 rounded-2xl border-2 border-transparent bg-card px-[18px] py-3 transition-colors hover:border-jx-green focus-visible:border-jx-green focus-visible:outline-none"
                      data-testid={`row-job-${job.id}`}
                    >
                      <JobsListThumbnail jobId={job.id} title={job.title} />
                      <div className="min-w-0 pr-3">
                        <div className="truncate font-display text-[17px] !font-bold leading-snug text-jx-ink">
                          {job.title}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-jx-ink-2">
                          <span className="shrink-0 max-w-[155px] truncate">{client}</span>
                          {address && (
                            <>
                              <span aria-hidden="true" className="text-jx-ink-3">·</span>
                              <span className="flex min-w-0 items-center gap-1 truncate">
                                <MapPin className="h-3 w-3 shrink-0 text-jx-ink-3" aria-hidden="true" />
                                <span className="truncate">{address}</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[13px] text-jx-ink-2">
                        <CalendarDays className="h-4 w-4 shrink-0 text-jx-ink-3" aria-hidden="true" />
                        <span className="whitespace-nowrap">{formatJobDateRange(job.startDate, job.endDate)}</span>
                      </div>
                      <div>
                        <span className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-semibold ${statusStyle}`}>
                          {job.status === "in_progress"
                            ? "In progress"
                            : job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                        </span>
                      </div>
                      <div className="text-right font-mono text-[15px] font-medium tabular-nums text-jx-ink" data-testid={`value-job-${job.id}`}>
                        {formatJobEstimate(job.estimatedTotal)}
                      </div>
                      <div className="min-w-0">
                        {progress === 100 ? (
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-jx-surface">
                              <div className="h-full w-full rounded-full bg-jx-green" />
                            </div>
                            <span className="font-mono text-xs font-medium tabular-nums text-jx-green-ink">100%</span>
                          </div>
                        ) : (
                          <span className="whitespace-nowrap text-xs text-jx-ink-3">Not tracked</span>
                        )}
                      </div>
                      <RowActions
                        job={job}
                        onEdit={openEdit}
                        onDelete={setDeletingJob}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {!isLoading && !isError && visibleJobs.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-3 text-sm text-jx-ink-2">
                <span data-testid="text-visible-job-count">
                  Showing <span className="font-semibold text-jx-ink">{visibleJobs.length}</span> of {allJobs.length} jobs
                  {activeFilter !== "all" ? ` · ${FILTERS.find((filter) => filter.key === activeFilter)?.label}` : ""}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={openNew}
                  className="min-h-10 rounded-full border border-jx-line px-4 font-semibold text-jx-green-ink"
                  data-testid="button-new-job-footer"
                >
                  <Plus className="h-4 w-4" /> New job
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
