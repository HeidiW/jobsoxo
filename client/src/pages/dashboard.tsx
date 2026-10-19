import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  FileText,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DashboardSitePanel from "./dashboard-site-panel";
import { DashboardPanelHeading as PanelHeading, DashboardSkeleton } from "./dashboard-primitives";
import JobForm from "@/components/job-form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  chooseFeaturedJob,
  countUnscheduledQuotedJobs,
  getBulkReminderFeedback,
  individualReminderPath,
  isReminderDispatchConfirmed,
  type BulkReminderResult,
} from "./dashboard-model";
import type { Client, Job } from "@shared/schema";

interface DashboardData {
  outstanding: { total: number; invoiceCount: number; clientCount: number; overdue: number; dueSoon: number; draft: number };
  collectedThisMonth: { amount: number; momDeltaPct: number };
  activeJobs: { count: number; crews: number; hoursToday: number };
  needsAttention: Array<{ invoiceId: string; invoiceNumber: string; client: string; project?: string; reason: "overdue" | "due-today" | "deposit-due"; detail: string; balance: number; daysOverdue: number }>;
  week: Array<{ date: string; weekday: string; dayNum: number; isToday: boolean; jobs: Array<{ jobId: string; label: string; crewSize: number; color: string }> }>;
  greeting: { firstName: string; timeOfDay: "morning" | "afternoon" | "evening" };
}

interface JobWithClient extends Job {
  client: Client | null;
}

const fmt = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const panelStyle = {
  background: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
};

export default function Dashboard() {
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [sentInvoiceIds, setSentInvoiceIds] = useState<Set<string>>(() => new Set());
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
  });
  const jobsQuery = useQuery<JobWithClient[]>({ queryKey: ["/api/jobs"] });
  const jobs = jobsQuery.data ?? [];
  const featuredJob = data ? chooseFeaturedJob(jobs, data.week) : undefined;

  const remindAllMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/reminders/process")).json() as Promise<BulkReminderResult>,
    onSuccess: (result) => {
      const feedback = getBulkReminderFeedback(result);
      toast({
        title: feedback.title,
        description: feedback.description,
        ...(feedback.variant ? { variant: feedback.variant } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: () => toast({ title: "Could not send reminders", description: "Try again in a moment.", variant: "destructive" }),
  });
  const remindOneMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const response = await apiRequest("POST", individualReminderPath(invoiceId));
      const payload = await response.json() as { success?: boolean };
      if (!isReminderDispatchConfirmed(payload)) throw new Error("Reminder dispatch was not confirmed");
      return payload;
    },
    onSuccess: (_result, invoiceId) => {
      setSentInvoiceIds((old) => new Set(old).add(invoiceId));
      toast({ title: "Reminder sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: (error: Error) => toast({ title: "Could not send reminder", description: error.message, variant: "destructive" }),
  });

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data) {
    return (
      <main className="mx-auto max-w-[1280px] px-5 py-10 sm:px-8">
        <section className="rounded-[22px] border p-9 text-center" style={{ ...panelStyle, borderColor: "hsl(var(--destructive) / .35)" }}>
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
          <h1 className="font-display text-xl font-bold">Dashboard unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your work and invoice totals could not be loaded.</p>
          <Button onClick={() => refetch()} variant="outline" className="mt-5">Try again</Button>
        </section>
      </main>
    );
  }

  const { outstanding, collectedThisMonth, activeJobs, needsAttention, week, greeting } = data;
  const today = week.find((day) => day.isToday);
  const todayCount = today?.jobs.length ?? 0;
  const visibleAttention = needsAttention.slice(0, 3);
  const monthUp = collectedThisMonth.momDeltaPct >= 0;
  const unscheduledCount = jobsQuery.data ? countUnscheduledQuotedJobs(jobs) : null;
  return (
    <>
      <main className="mx-auto flex min-w-0 max-w-[1440px] flex-col gap-7 px-5 pb-12 pt-7 sm:gap-8 sm:px-8 sm:pt-9 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-x-7 gap-y-5">
          <div className="min-w-0 max-w-full">
            <h1 className="max-w-full break-words font-display text-[48px] !font-extrabold leading-[.92] tracking-[-.065em] sm:text-[64px] lg:text-[72px]">
              <span style={{ color: "var(--jx-green)" }}>Good {greeting.timeOfDay}, </span>{greeting.firstName}
            </h1>
            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] sm:text-[16px]" style={{ color: "var(--jx-ink-2)" }}>
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              <time dateTime={format(new Date(), "yyyy-MM-dd")}>{format(new Date(), "EEEE, MMMM d")}</time>
              <span aria-hidden="true">·</span>
              <span>{todayCount} job{todayCount === 1 ? "" : "s"} scheduled today</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="h-11 rounded-full border-2 px-5 font-semibold"
              onClick={() => setNewJobOpen(true)}
              data-testid="button-dashboard-new-job"
            >
              <BriefcaseBusiness className="mr-2 h-4 w-4" aria-hidden="true" />
              New job
            </Button>
            <Button
              asChild
              className="h-11 rounded-full border-jx-green bg-jx-green px-5 font-bold uppercase tracking-[.04em] text-white hover:bg-jx-green-hover active:bg-jx-green-hover"
              data-testid="button-dashboard-new-invoice"
            >
              <Link href="/invoices/new"><Plus className="mr-2 h-4 w-4" aria-hidden="true" />New invoice</Link>
            </Button>
          </div>
        </header>

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.14fr)_minmax(0,.86fr)]" aria-label="Today's work and invoices">
          <div className="min-w-0 rounded-[24px] p-5 sm:p-6" style={{ background: "var(--jx-surface)" }}>
            <PanelHeading
              eyebrow="Monday to Friday"
              title="This week on site"
              action={<Link href="/scheduling" className="inline-flex items-center gap-1 text-sm font-semibold no-underline" style={{ color: "var(--jx-green-ink)" }}>Scheduling <ArrowRight className="h-4 w-4" /></Link>}
            />
            {week.every((day) => day.jobs.length === 0) ? (
              <div className="flex min-h-[202px] flex-col items-center justify-center rounded-[17px] border border-dashed px-5 text-center" style={{ borderColor: "var(--jx-line)" }}>
                <CalendarDays className="mb-3 h-8 w-8" style={{ color: "var(--jx-ink-3)" }} aria-hidden="true" />
                <p className="font-display text-lg font-bold">Nothing scheduled this week</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">Jobs with dates will appear here. You can add dates from a job’s details.</p>
              </div>
            ) : (
              <div className="min-w-0 overflow-x-auto pb-1">
                <div className="grid min-w-[580px] grid-cols-5 gap-2 xl:min-w-0">
                {week.map((day) => (
                  <div
                    key={day.date}
                    className="min-h-[206px] min-w-0 rounded-[15px] border p-3 sm:p-3.5"
                    style={{ background: "hsl(var(--card))", borderColor: day.isToday ? "var(--jx-green)" : "var(--jx-line)", boxShadow: day.isToday ? "inset 0 3px 0 var(--jx-green)" : undefined }}
                  >
                    <div className="mb-3 flex items-baseline justify-between gap-1">
                      <span className="text-[10px] font-bold tracking-[.1em]" style={{ color: day.isToday ? "var(--jx-green-ink)" : "var(--jx-ink-3)" }}>{day.weekday}</span>
                      <span className="font-display text-xl font-bold">{day.dayNum}</span>
                    </div>
                    <div className="space-y-2">
                      {day.jobs.length === 0 ? (
                        <span className="block px-1 py-2 text-[11px]" style={{ color: "var(--jx-ink-3)" }}>No jobs</span>
                      ) : day.jobs.map((job) => (
                        <Link
                          key={job.jobId}
                          href={`/jobs/${job.jobId}`}
                          className="block rounded-[10px] px-2.5 py-2 text-[11px] font-semibold leading-snug no-underline transition-opacity hover:opacity-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          style={{ background: `${job.color}20`, color: "var(--jx-ink)" }}
                          data-testid={`link-week-job-${job.jobId}`}
                        >
                          {job.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>

          <div className="min-w-0 rounded-[24px] p-5 text-jx-orange-ink sm:p-6" style={{ background: "var(--jx-orange-tint)" }}>
            <PanelHeading
              eyebrow="Invoices to follow up"
              title="Needs attention"
              action={<Link href="/invoices" className="inline-flex items-center gap-1 text-sm font-semibold no-underline" style={{ color: "var(--jx-orange-ink)" }}>View all <ArrowRight className="h-4 w-4" /></Link>}
            />
            {visibleAttention.length === 0 ? (
              <div className="flex min-h-[202px] flex-col items-center justify-center rounded-[17px] px-4 text-center text-foreground" style={{ background: "var(--jx-green-tint)" }}>
                <CheckCircle2 className="mb-3 h-8 w-8" style={{ color: "var(--jx-green)" }} aria-hidden="true" />
                <p className="font-display text-lg font-bold">Nothing to chase</p>
                <p className="mt-1 text-sm text-muted-foreground">No overdue or due-today invoices.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {visibleAttention.map((item) => {
                  const sent = sentInvoiceIds.has(item.invoiceId);
                  const failed = remindOneMutation.isError && remindOneMutation.variables === item.invoiceId;
                  const pending = remindOneMutation.isPending && remindOneMutation.variables === item.invoiceId;
                  return (
                    <article key={item.invoiceId} className="rounded-[15px] p-3.5 text-foreground sm:p-4" style={{ background: "hsl(var(--card))" }}>
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/invoices/${item.invoiceId}`} className="min-w-0 flex-1 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                          <span className="block truncate font-display text-[15px] font-bold">{item.client}</span>
                          <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--jx-ink-2)" }}>
                            {item.project ? `${item.project} · ` : ""}<span className="font-mono">{item.invoiceNumber}</span>
                          </span>
                          <span className="mt-2 block text-[11px] font-semibold" style={{ color: item.reason === "overdue" ? "var(--jx-orange-ink)" : "var(--jx-gold-ink)" }}>
                            {item.detail}
                          </span>
                        </Link>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[15px] font-semibold">{fmt(item.balance)}</div>
                          <button
                            type="button"
                            onClick={() => remindOneMutation.mutate(item.invoiceId)}
                            disabled={remindOneMutation.isPending || sent}
                            className="mt-2 inline-flex min-h-8 items-center justify-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors hover:border-primary disabled:cursor-default disabled:opacity-100"
                            style={sent ? { color: "var(--jx-green-ink)", borderColor: "var(--jx-green)", background: "var(--jx-green-tint)" } : { color: "var(--jx-green-ink)", borderColor: "var(--jx-line)", background: "hsl(var(--card))" }}
                            aria-label={sent ? `Reminder sent to ${item.client}` : `${failed ? "Retry reminder for" : "Send reminder to"} ${item.client}`}
                            data-testid={`button-remind-${item.invoiceId}`}
                          >
                            {sent ? <><Check className="h-3 w-3" />Sent</> : pending ? "Sending…" : failed ? "Retry" : <><Bell className="h-3 w-3" />Remind</>}
                          </button>
                        </div>
                      </div>
                      {failed && <p role="alert" className="mt-2 text-[11px] text-destructive">Reminder wasn’t sent. Try again.</p>}
                    </article>
                  );
                })}
                {needsAttention.length > visibleAttention.length && (
                  <Link href="/invoices" className="block py-1 text-center text-xs font-semibold no-underline" style={{ color: "var(--jx-green-ink)" }}>
                    + {needsAttention.length - visibleAttention.length} more invoice{needsAttention.length - visibleAttention.length === 1 ? "" : "s"}
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(0,.88fr)]" aria-label="Outstanding balance and job photo">
          <div className="rounded-[24px] p-5 text-white sm:p-7 lg:p-8" style={{ background: "var(--jx-green)" }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.14em] text-white/75">Total outstanding</div>
                <div className="mt-2 whitespace-nowrap font-mono text-[clamp(46px,5.2vw,76px)] font-semibold leading-none tracking-[-.06em]" data-testid="text-outstanding-total">{fmt(outstanding.total)}</div>
                <p className="mt-2 text-[13px] text-white/80">Across {outstanding.invoiceCount} open invoice{outstanding.invoiceCount === 1 ? "" : "s"} · {outstanding.clientCount} client{outstanding.clientCount === 1 ? "" : "s"}</p>
              </div>
              <Wallet className="mt-1 h-8 w-8 text-white/65" aria-hidden="true" />
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2.5 sm:gap-3">
              {[
                ["Overdue", outstanding.overdue, "text-outstanding-overdue"],
                ["Due soon", outstanding.dueSoon, "text-outstanding-due-soon"],
                ["Draft", outstanding.draft, "text-outstanding-draft"],
              ].map(([label, amount, testId]) => (
                <div key={label} className="rounded-[13px] px-3 py-3 sm:px-4" style={{ background: "rgba(255,255,255,.15)" }}>
                  <div className="text-[10px] font-semibold text-white/75 sm:text-[11px]">{label}</div>
                  <div className="mt-1 font-mono text-[16px] font-semibold sm:text-[18px]" data-testid={testId}>{fmt(Number(amount))}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => remindAllMutation.mutate()}
                disabled={remindAllMutation.isPending}
                className="inline-flex h-11 items-center rounded-full px-5 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ color: "#365c24", background: "#fff" }}
                data-testid="button-send-reminders"
              >
                {remindAllMutation.isPending ? "Sending reminders…" : "Send reminders"}
              </button>
              <Link
                href="/invoices"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-white/45 px-5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                data-testid="link-view-invoices"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />View invoices
              </Link>
            </div>
            {remindAllMutation.isError && <p role="alert" className="mt-3 text-xs text-white">Reminders could not be sent. You can try again.</p>}
          </div>

          <DashboardSitePanel
            job={featuredJob}
            todayJobIds={today?.jobs.map((item) => item.jobId) ?? []}
            jobsLoading={jobsQuery.isLoading}
            jobsError={jobsQuery.isError}
            onRetryJobs={() => { void jobsQuery.refetch(); }}
          />
        </section>

        <section className="grid gap-4 md:grid-cols-3" aria-label="Business snapshot">
          <article className="rounded-[21px] p-5 sm:p-6" style={{ background: "var(--jx-blue-tint)" }}>
            <div className="flex items-start justify-between">
              <div className="grid h-11 w-11 place-items-center rounded-[14px]" style={{ color: "var(--jx-blue-ink)", background: "hsl(var(--card) / .75)" }}><Wallet className="h-5 w-5" /></div>
              {collectedThisMonth.momDeltaPct !== 0 && <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ color: "var(--jx-blue-ink)", background: "hsl(var(--card) / .72)" }}>{monthUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{monthUp ? "+" : ""}{collectedThisMonth.momDeltaPct}%</span>}
            </div>
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: "var(--jx-blue-ink)" }}>Collected this month</p>
            <div className="mt-1 font-mono text-[32px] font-semibold tracking-[-.05em] sm:text-[38px]" data-testid="text-collected-month">{fmt(collectedThisMonth.amount)}</div>
            <p className="mt-1 text-xs" style={{ color: "var(--jx-ink-2)" }}>Compared with last month</p>
          </article>
          <article className="rounded-[21px] p-5 sm:p-6" style={{ background: "var(--jx-green-tint)" }}>
            <div className="grid h-11 w-11 place-items-center rounded-[14px]" style={{ color: "var(--jx-green-ink)", background: "hsl(var(--card) / .75)" }}><BriefcaseBusiness className="h-5 w-5" /></div>
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: "var(--jx-green-ink)" }}>Active jobs</p>
            <div className="mt-1 font-mono text-[32px] font-semibold tracking-[-.05em] sm:text-[38px]" data-testid="text-active-jobs">{activeJobs.count}</div>
            <p className="mt-1 text-xs" style={{ color: "var(--jx-ink-2)" }}>In progress · {activeJobs.hoursToday} hours logged today</p>
          </article>
          <article className="rounded-[21px] p-5 sm:p-6" style={{ background: "var(--jx-gold-tint)" }}>
            <div className="grid h-11 w-11 place-items-center rounded-[14px]" style={{ color: "var(--jx-gold-ink)", background: "hsl(var(--card) / .75)" }}><CalendarDays className="h-5 w-5" /></div>
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[.1em]" style={{ color: "var(--jx-gold-ink)" }}>Quoted · needs dates</p>
            <div className="mt-1 font-mono text-[32px] font-semibold tracking-[-.05em] sm:text-[38px]" data-testid="text-unscheduled-jobs">
              {unscheduledCount === null ? "—" : unscheduledCount}
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--jx-ink-2)" }}>{jobsQuery.isError ? "Job count unavailable" : "Quoted jobs without a start date"}</p>
          </article>
        </section>
      </main>

      <Dialog open={newJobOpen} onOpenChange={setNewJobOpen}>
        <DialogContent className="!flex max-h-[90dvh] max-w-lg flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-display text-[19px] font-bold">New job</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <JobForm onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
            }} onClose={() => setNewJobOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
