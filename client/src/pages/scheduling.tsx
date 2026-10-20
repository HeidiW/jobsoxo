import { useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { addMonths, addWeeks, differenceInCalendarDays, format, isToday, startOfWeek, subMonths, subWeeks } from "date-fns";
import {
  AlertCircle, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3,
  RotateCw, Users,
} from "lucide-react";
import { ScheduleJobDialog } from "@/components/scheduling/schedule-job-dialog";
import { Button } from "@/components/ui/button";
import {
  filterScheduleJobs, formatScheduleDate, getBarPosition, getFortnightDays, getMonthDays,
  getStableJobColorIndex, getWeekendOnlyJobs, isSameCalendarMonth, parseScheduleDate,
  type ScheduleJob,
} from "./scheduling-logic";

const COLORS = [
  { bg: "var(--jx-green-tint)", ink: "var(--jx-green-ink)", edge: "var(--jx-green)" },
  { bg: "var(--jx-blue-tint)", ink: "var(--jx-blue-ink)", edge: "var(--jx-blue)" },
  { bg: "var(--jx-gold-tint)", ink: "var(--jx-gold-ink)", edge: "var(--jx-gold)" },
  { bg: "var(--pu-bg)", ink: "var(--pu-fg)", edge: "var(--pu-bd)" },
  { bg: "var(--jx-orange-tint)", ink: "var(--jx-orange-ink)", edge: "var(--jx-orange)" },
  { bg: "var(--jx-surface)", ink: "var(--jx-ink-2)", edge: "var(--jx-line)" },
];

function dateISO(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function JobLink({ job, children, ...props }: { job: ScheduleJob } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <Link href={`/jobs/${job.id}`} {...props}>{children as ReactNode}</Link>;
}

function stableIndex(job: ScheduleJob) {
  return getStableJobColorIndex(job.id);
}

export default function Scheduling() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<"week" | "month">("week");
  const [selectedJob, setSelectedJob] = useState<ScheduleJob | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const { data: jobs, isLoading, isError, isFetching, refetch } = useQuery<ScheduleJob[]>({ queryKey: ["/api/jobs"] });

  const safeJobs = jobs ?? [];
  const { active: scheduledJobs, backlog: backlogJobs } = useMemo(() => filterScheduleJobs(safeJobs), [safeJobs]);
  const days = useMemo(() => getFortnightDays(anchor), [anchor]);
  const weekdayDays = useMemo(() => days.filter((day) => day.getDay() !== 0 && day.getDay() !== 6), [days]);
  const monthDays = useMemo(() => getMonthDays(anchor), [anchor]);
  const thisWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
  const currentWindow = startOfWeek(anchor, { weekStartsOn: 1 }).getTime() === thisWeek.getTime();
  const periodLabel = view === "week"
    ? currentWindow ? "This week" : `${format(days[0], "MMM d")} – ${format(days[13], "MMM d, yyyy")}`
    : format(anchor, "MMM yyyy");
  const deployed = useMemo(() => {
    const ids = new Set<string>();
    scheduledJobs.forEach((job) => {
      const range = getBarPosition(job, days[0], 14);
      if (range) job.assignedEmployees?.forEach((person) => ids.add(person.id));
    });
    return ids.size;
  }, [scheduledJobs, days]);
  const sortedActive = useMemo(() => scheduledJobs
    .filter((job) => !!getBarPosition(job, days[0], 14))
    .sort((a, b) => (parseScheduleDate(a.startDate)?.getTime() ?? 0) - (parseScheduleDate(b.startDate)?.getTime() ?? 0)), [scheduledJobs, days]);
  const weekendOnlyJobs = useMemo(() => getWeekendOnlyJobs(sortedActive, days), [sortedActive, days]);

  function goPrevious() {
    setAnchor((date) => view === "week" ? subWeeks(date, 2) : subMonths(date, 1));
  }
  function goNext() {
    setAnchor((date) => view === "week" ? addWeeks(date, 2) : addMonths(date, 1));
  }
  function goToday() { setAnchor(new Date()); }
  function pickJob(job: ScheduleJob) {
    setSelectedJob(job);
    setChooserOpen(false);
  }
  function barColumns(job: ScheduleJob) {
    const position = getBarPosition(job, days[0], 14);
    if (!position) return null;
    const covered = weekdayDays.map((day, index) => {
      const offset = differenceInCalendarDays(day, days[0]);
      return offset >= position.left && offset < position.left + position.span ? index : -1;
    }).filter((index) => index >= 0);
    if (!covered.length) return null;
    return { start: covered[0] + 1, end: covered[covered.length - 1] + 2 };
  }

  return <main className="relative min-h-[100dvh] min-w-0 px-4 pb-12 pt-7 text-jx-ink sm:px-7 sm:pt-9 xl:px-10">
    <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col gap-6 sm:gap-7">
      <header className="flex min-w-0 flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-jx-green-ink">
            <span className="h-[2px] w-5 bg-jx-green" aria-hidden="true" /> Site plan
          </p>
          <h1 className="font-display text-[44px] !font-bold leading-[.94] tracking-[-.055em] sm:text-[62px]" data-testid="heading-scheduling">Scheduling</h1>
          <p className="mt-3 max-w-2xl text-[14px] text-jx-ink-2 sm:text-[16px]">
            {view === "week" ? `${format(days[0], "MMMM d")} – ${format(days[13], "MMMM d, yyyy")}${deployed ? ` · ${deployed} crew${deployed === 1 ? "" : "s"} on site` : ""}` : format(anchor, "MMMM yyyy")}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="flex h-11 items-center rounded-full border border-jx-line bg-card p-1">
            <Button type="button" variant="ghost" onClick={goPrevious} className="h-9 w-9 rounded-full p-0 text-jx-ink-2 hover:bg-jx-surface" aria-label="Previous period" data-testid="button-prev-period"><ChevronLeft className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" onClick={goToday} className="h-9 min-w-[96px] rounded-full px-3 text-xs font-bold text-jx-ink" data-testid="button-today">{periodLabel}</Button>
            <Button type="button" variant="ghost" onClick={goNext} className="h-9 w-9 rounded-full p-0 text-jx-ink-2 hover:bg-jx-surface" aria-label="Next period" data-testid="button-next-period"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <div className="flex h-11 items-center rounded-full border border-jx-line bg-jx-surface p-1">
            {(["week", "month"] as const).map((mode) => <Button key={mode} type="button" variant="ghost" onClick={() => setView(mode)}
              className={`h-9 rounded-full px-4 text-xs font-bold capitalize ${view === mode ? "bg-jx-green text-white hover:bg-jx-green-hover hover:text-white" : "text-jx-ink-2"}`}
              aria-pressed={view === mode} data-testid={`button-view-${mode}`}>{mode === "week" ? "2 weeks" : "Month"}</Button>)}
          </div>
          <Button type="button" onClick={() => setChooserOpen(true)} className="min-h-11 rounded-full bg-jx-green px-5 text-xs font-bold tracking-[.04em] text-white hover:bg-jx-green-hover" data-testid="button-assign-crew">
            <Users className="mr-2 h-4 w-4" aria-hidden="true" /> Assign crew
          </Button>
        </div>
      </header>

      {view === "week" ? <>
        <section className="min-w-0 overflow-hidden rounded-[24px] border border-jx-line bg-card" aria-label="Two week job schedule">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-jx-line bg-jx-surface/70 px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-display text-lg !font-bold tracking-[-.025em]">On the calendar</h2>
              <p className="mt-0.5 text-xs text-jx-ink-2">Two weeks · Monday to Friday · dates stay attached to each job</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-jx-green-tint px-3 py-1.5 text-[11px] font-bold text-jx-green-ink"><span className="h-2 w-2 rounded-full bg-jx-green" /> {sortedActive.length} active {sortedActive.length === 1 ? "job" : "jobs"}</span>
          </div>
          <div className="relative min-w-0 overflow-x-auto overscroll-x-contain" data-testid="scheduling-grid-scroll">
            <div className="min-w-[1080px]">
              <div className="grid border-b border-jx-line" style={{ gridTemplateColumns: "240px repeat(10, minmax(76px, 1fr))" }}>
                <div className="flex items-center px-5 text-[10px] font-bold uppercase tracking-[.12em] text-jx-ink-3">Job / site</div>
                {weekdayDays.map((day, index) => {
                  const today = isToday(day);
                  return <div key={dateISO(day)} data-testid={`scheduling-date-${dateISO(day)}`} aria-current={today ? "date" : undefined} className={`min-h-[72px] border-l border-jx-line px-2 py-3 ${today ? "bg-jx-green text-white" : index === 5 ? "border-l-2 border-l-jx-line" : ""}`}>
                    <p className={`text-[9px] font-bold uppercase tracking-[.1em] ${today ? "text-white" : "text-jx-ink-3"}`}>{format(day, "EEE")}{index === 5 && <span className="ml-1.5">· next week</span>}</p>
                    <p className={`mt-1 font-mono text-[18px] font-semibold tabular-nums ${today ? "text-white" : "text-jx-ink"}`}>{format(day, "d")}</p>
                    <p className={`text-[9px] ${today ? "text-white/80" : "text-jx-ink-3"}`}>{format(day, "MMM")}</p>
                  </div>;
                })}
              </div>
              {isLoading ? <div className="space-y-2 p-4" data-testid="scheduling-loading" aria-label="Loading schedule">
                {[0, 1, 2, 3].map((item) => <div key={item} className="grid h-[76px] animate-pulse rounded-xl bg-jx-surface" style={{ gridTemplateColumns: "240px 1fr" }}><div className="m-4 h-4 w-2/3 rounded bg-card" /><div className="m-4 h-8 rounded-lg bg-card" /></div>)}
              </div> : isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-4 px-6 py-12">
                <div className="flex items-start gap-3"><AlertCircle className="mt-1 h-5 w-5 text-jx-orange-ink" /><div><h3 className="font-display text-xl !font-bold">Schedule unavailable</h3><p className="mt-1 text-sm text-jx-ink-2">Job dates and crews didn’t load. Try again.</p></div></div>
                <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isFetching} className="min-h-11 rounded-full border-2 border-jx-line px-5" data-testid="button-retry-schedule"><RotateCw className="mr-2 h-4 w-4" />{isFetching ? "Retrying…" : "Retry"}</Button>
              </div> : sortedActive.length === 0 ? <div className="flex min-h-[250px] flex-col items-center justify-center px-5 text-center" data-testid="scheduling-empty">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink"><CalendarDays className="h-5 w-5" /></div>
                <h3 className="mt-4 font-display text-xl !font-bold">No active jobs in this window</h3>
                <p className="mt-1 max-w-sm text-sm text-jx-ink-2">Give a job dates and a scheduled status to place the crew on the calendar.</p>
              </div> : <div>
                {sortedActive.filter((job) => !weekendOnlyJobs.some((weekend) => weekend.id === job.id)).map((job) => {
                  const column = barColumns(job);
                  const color = COLORS[stableIndex(job)];
                  return <div key={job.id} className="grid min-h-[86px] border-b border-jx-line last:border-b-0" style={{ gridTemplateColumns: "240px repeat(10, minmax(76px, 1fr))" }} data-testid={`schedule-row-${job.id}`}>
                    <div className="flex min-w-0 flex-col justify-center px-5 py-3">
                      <JobLink job={job} className="group flex min-w-0 items-center gap-1 text-sm font-bold text-jx-ink hover:text-jx-green-ink" data-testid={`link-schedule-job-${job.id}`}>
                        <span className="truncate">{job.title}</span><ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      </JobLink>
                      <p className="mt-1 truncate text-[11px] text-jx-ink-2">{job.client?.name ?? "Client not set"}{job.address ? ` · ${job.address}` : ""}</p>
                    </div>
                    <div className="relative col-span-10 grid border-l border-jx-line" style={{ gridTemplateColumns: "repeat(10, minmax(76px, 1fr))" }}>
                      {weekdayDays.map((day, index) => <div key={dateISO(day)} className={`border-r border-jx-line/70 ${isToday(day) ? "bg-jx-green-tint/45" : ""} ${index === 5 ? "border-l-2 border-l-jx-line" : ""}`} />)}
                      {column && <JobLink job={job} data-testid={`job-block-${job.id}`} className="absolute top-1/2 z-10 flex min-h-[48px] -translate-y-1/2 flex-col justify-center overflow-hidden rounded-r-xl border border-l-[6px] px-3 py-1.5 transition-transform hover:-translate-y-[54%]"
                        style={{ left: `calc(${(column.start - 1) * 10}% + 4px)`, width: `calc(${(column.end - column.start) * 10}% - 8px)`, background: color.bg, color: color.ink, borderColor: color.edge, borderLeftColor: color.ink }}>
                        <span className="truncate text-[11px] font-bold">{job.title}</span>
                        <span className="truncate text-[10px] opacity-85">{job.assignedEmployees?.length ? job.assignedEmployees.map((person) => person.name).join(", ") : "Crew not assigned"} · {formatScheduleDate(job.startDate)}{job.endDate ? ` – ${formatScheduleDate(job.endDate)}` : ""}</span>
                      </JobLink>}
                    </div>
                  </div>;
                })}
              </div>}
            </div>
          </div>
          {!isLoading && !isError && weekendOnlyJobs.length > 0 && <div className="border-t border-jx-line bg-jx-surface/70 px-5 py-4 sm:px-6" data-testid="weekend-schedule-note">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.1em] text-jx-ink-2"><Clock3 className="h-4 w-4 text-jx-orange-ink" /> Weekend dates in this window</div>
            <p className="mt-1 text-xs text-jx-ink-2">Weekend-only work stays visible here; use Month view for the full seven-day calendar.</p>
            <div className="mt-3 flex flex-wrap gap-2">{weekendOnlyJobs.map((job) => {
              const color = COLORS[stableIndex(job)];
              return <JobLink key={job.id} job={job} data-testid={`weekend-job-${job.id}`} className="flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold" style={{ background: color.bg, color: color.ink, borderColor: color.edge }}>
                <span className="truncate">{job.title}</span><span className="shrink-0 font-normal">{formatScheduleDate(job.startDate)}{job.endDate ? ` – ${formatScheduleDate(job.endDate)}` : ""}</span>
              </JobLink>;
            })}</div>
          </div>}
        </section>

        <section aria-label="Jobs needing dates" className="overflow-hidden rounded-[24px] border border-jx-gold/30 bg-jx-gold-tint text-jx-gold-ink">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-jx-gold/30 px-5 py-4 sm:px-6">
            <div className="flex items-start gap-3">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-jx-gold" />
              <div><h2 className="font-display text-lg !font-bold tracking-[-.025em]">Needs a start date</h2><p className="mt-0.5 text-xs">Set dates and a scheduled status to place a job on the calendar.</p></div>
            </div>
            <span className="rounded-full bg-jx-gold/15 px-3 py-1 font-mono text-xs font-bold tabular-nums">{isLoading || isError ? "—" : backlogJobs.length}</span>
          </div>
          {isLoading ? <div className="flex gap-3 overflow-hidden p-5" aria-hidden="true">{[0, 1, 2].map((item) => <div key={item} className="h-[90px] w-56 shrink-0 animate-pulse rounded-2xl bg-jx-gold/15" />)}</div>
            : isError ? <p className="px-6 py-8 text-sm">Backlog is unavailable until jobs load successfully.</p>
              : backlogJobs.length === 0 ? <div className="px-6 py-8 text-center text-sm" data-testid="schedule-backlog-empty">Every active job has dates and a schedule status.</div>
                : <div className="relative flex gap-3 overflow-x-auto overscroll-x-contain p-4 sm:flex-wrap sm:px-5 sm:pb-5">{backlogJobs.map((job) => <article key={job.id} className="w-[245px] shrink-0 rounded-2xl border border-jx-gold/30 bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <JobLink job={job} data-testid={`backlog-job-${job.id}`} className="min-w-0 truncate text-sm font-bold text-jx-ink hover:text-jx-green-ink">{job.title}</JobLink>
                    {job.status === "quoted" && <span className="shrink-0 rounded-full bg-jx-surface px-2 py-1 text-[9px] font-bold uppercase tracking-[.08em] text-jx-ink-2">Quoted</span>}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-jx-ink-2">{job.client?.name ?? "Client not set"}{job.address ? ` · ${job.address}` : ""}</p>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-jx-gold-tint px-2.5 py-1 text-[10px] font-bold text-jx-gold-ink">{job.startDate ? "Needs scheduling" : "Needs a start date"}</span>
                    <Button type="button" onClick={() => pickJob(job)} className="h-8 shrink-0 rounded-full bg-jx-green px-3 text-[10px] font-bold text-white hover:bg-jx-green-hover" data-testid={`button-pick-dates-${job.id}`}>Pick dates</Button>
                  </div>
                </article>)}</div>}
        </section>
      </> : <section aria-label="Monthly schedule" className="overflow-hidden rounded-[24px] border border-jx-line bg-card">
        <div className="flex items-center justify-between border-b border-jx-line bg-jx-surface px-5 py-4">
          <div><h2 className="font-display text-lg !font-bold">{format(anchor, "MMMM yyyy")}</h2><p className="text-xs text-jx-ink-2">Full week calendar, Sunday through Saturday</p></div>
          <span className="rounded-full bg-card px-3 py-1 font-mono text-xs text-jx-ink-2">{scheduledJobs.length} active jobs</span>
        </div>
        {isLoading ? <p role="status" className="p-8 text-jx-ink-2">Loading schedule…</p> : isError ? <div role="alert" className="p-8">
          <p className="text-jx-orange-ink">Job dates and crews didn’t load.</p>
          <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isFetching} className="mt-3 rounded-full" data-testid="button-retry-schedule">Retry</Button>
        </div> : <div className="relative min-w-0 overflow-x-auto overscroll-x-contain" data-testid="scheduling-month-scroll">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-7 border-b border-jx-line bg-jx-surface/70">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="px-2 py-3 text-center text-[10px] font-bold uppercase tracking-[.1em] text-jx-ink-3">{day}</div>)}</div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const inMonth = isSameCalendarMonth(day, anchor);
                const blocks = scheduledJobs.filter((job) => {
                  const pos = getBarPosition(job, day, 1);
                  return !!pos;
                });
                return <div key={dateISO(day)} data-testid={`month-cell-${dateISO(day)}`} className={`min-h-[122px] border-b border-r border-jx-line p-2 ${isToday(day) ? "bg-jx-green-tint/60" : inMonth ? "bg-card" : "bg-jx-surface/50"}`}>
                  <p className={`mb-2 font-mono text-xs font-semibold tabular-nums ${isToday(day) ? "text-jx-green-ink" : inMonth ? "text-jx-ink" : "text-jx-ink-3"}`}>{format(day, "d")}</p>
                  <div className="flex flex-col gap-1">{blocks.slice(0, 3).map((job) => {
                    const color = COLORS[stableIndex(job)];
                    return <JobLink key={job.id} job={job} data-testid={`month-job-${job.id}`} title={job.title} className="truncate rounded-md border-l-[3px] px-1.5 py-1 text-[10px] font-semibold" style={{ background: color.bg, color: color.ink, borderColor: color.ink }}>{job.title}</JobLink>;
                  })}{blocks.length > 3 && <span className="px-1 text-[9px] text-jx-ink-3">+{blocks.length - 3} more</span>}</div>
                </div>;
              })}
            </div>
          </div>
        </div>}
      </section>}
    </div>
    <ScheduleJobDialog open={chooserOpen || !!selectedJob} job={selectedJob} jobs={safeJobs} isLoading={isLoading} isError={isError} onSelect={pickJob} onClose={() => { setSelectedJob(null); setChooserOpen(false); }} />
  </main>;
}
