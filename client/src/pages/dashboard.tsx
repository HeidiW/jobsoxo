import { useQuery, useMutation } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { AlertCircle, Bell, Plus, CheckCircle, CalendarDays, TrendingUp, TrendingDown } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);

interface DashboardData {
  outstanding: { total: number; invoiceCount: number; clientCount: number; overdue: number; dueSoon: number; draft: number };
  collectedThisMonth: { amount: number; momDeltaPct: number };
  activeJobs: { count: number; crews: number; hoursToday: number };
  needsAttention: Array<{ invoiceId: string; invoiceNumber: string; client: string; project?: string; reason: "overdue" | "due-today" | "deposit-due"; detail: string; balance: number; daysOverdue: number }>;
  week: Array<{ date: string; weekday: string; dayNum: number; isToday: boolean; jobs: Array<{ jobId: string; label: string; crewSize: number; color: string }> }>;
  greeting: { firstName: string; timeOfDay: "morning" | "afternoon" | "evening" };
}

function DashboardSkeleton() {
  return (
    <div className="space-y-[18px]">
      <Skeleton className="h-8 w-56" />
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 16 }}>
        <Skeleton className="h-52 rounded-[13px]" />
        <div className="flex flex-col gap-4">
          <Skeleton className="flex-1 rounded-[11px]" style={{ minHeight: 88 }} />
          <Skeleton className="flex-1 rounded-[11px]" style={{ minHeight: 88 }} />
        </div>
      </div>
      <Skeleton className="h-48 rounded-[11px]" />
      <Skeleton className="h-40 rounded-[11px]" />
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
  });

  const remindAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/reminders/process"),
    onSuccess: () => toast({ title: "Reminders sent", description: "Payment reminders dispatched." }),
    onError: () => toast({ title: "Failed to send reminders", variant: "destructive" }),
  });

  const remindOneMutation = useMutation({
    mutationFn: (invoiceId: string) => apiRequest("POST", `/api/invoices/${invoiceId}/send-email`),
    onSuccess: () => { toast({ title: "Reminder sent" }); queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }); },
    onError: () => toast({ title: "Failed to send reminder", variant: "destructive" }),
  });

  if (error) {
    return (
      <div className="p-6 max-w-[1280px] mx-auto">
        <div className="rounded-[11px] border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="text-destructive font-semibold">Failed to load dashboard</p>
          <p className="text-muted-foreground text-sm mt-1">Please try again.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 rounded-[9px] border border-border text-sm font-semibold text-foreground bg-panel hover:bg-muted transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-[1280px] mx-auto">
        <DashboardSkeleton />
      </div>
    );
  }

  const { outstanding, collectedThisMonth, activeJobs, needsAttention, week, greeting } = data!;
  const momPositive = collectedThisMonth.momDeltaPct >= 0;

  return (
    <div className="px-[26px] py-6 pb-10 max-w-[1280px] mx-auto">

      {/* Greeting */}
      <h2 className="text-[26px] font-bold tracking-[-0.02em] mb-[18px]">
        Good {greeting.timeOfDay}, {greeting.firstName}
      </h2>

      {/* Hero + KPIs — 1.55fr / 1fr */}
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 16, marginBottom: 18 }}>

        {/* Hero — Total Outstanding */}
        <div className="rounded-[13px] p-[22px_24px] text-white" style={{ background: "hsl(var(--primary))" }}>
          <div className="text-[12px] font-bold tracking-[.06em] uppercase" style={{ color: "#cfddfb" }}>
            Total outstanding
          </div>
          <div className="font-mono text-[42px] font-semibold tracking-[-0.03em] mt-[6px] mb-[2px]" data-testid="text-outstanding-total">
            {fmt(outstanding.total)}
          </div>
          <div className="text-[13px] mb-[18px]" style={{ color: "#cfddfb" }}>
            across {outstanding.invoiceCount} open invoice{outstanding.invoiceCount !== 1 ? "s" : ""} · {outstanding.clientCount} client{outstanding.clientCount !== 1 ? "s" : ""}
          </div>

          {/* Breakdown */}
          <div className="flex gap-[9px] flex-wrap mb-5">
            {[
              { label: "Overdue", value: outstanding.overdue, testid: "text-outstanding-overdue" },
              { label: "Due soon", value: outstanding.dueSoon, testid: "text-outstanding-due-soon" },
              { label: "Draft", value: outstanding.draft, testid: "text-outstanding-draft" },
            ].map(({ label, value, testid }) => (
              <div key={label} className="rounded-[9px] px-[13px] py-[9px] flex-1 min-w-[108px]" style={{ background: "rgba(255,255,255,.14)" }}>
                <div className="text-[11px] mb-[3px]" style={{ color: "#cfddfb" }}>{label}</div>
                <div className="font-mono text-[16px] font-semibold" data-testid={testid}>{fmt(value)}</div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-[10px]">
            <button
              onClick={() => remindAllMutation.mutate()}
              disabled={remindAllMutation.isPending}
              data-testid="button-send-reminders"
              className="rounded-[9px] px-4 py-[10px] text-[13px] font-bold border-0 cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: "#fff", color: "hsl(var(--primary))", fontFamily: "inherit" }}
            >
              {remindAllMutation.isPending ? "Sending…" : "Send reminders"}
            </button>
            <button
              onClick={() => setLocation("/invoices/new")}
              data-testid="button-new-invoice"
              className="rounded-[9px] px-4 py-[10px] text-[13px] font-semibold text-white border-0 cursor-pointer transition-opacity hover:opacity-90 inline-flex items-center gap-2"
              style={{ background: "rgba(255,255,255,.16)", fontFamily: "inherit" }}
            >
              <Plus className="h-4 w-4" />
              New invoice
            </button>
          </div>
        </div>

        {/* KPI column */}
        <div className="flex flex-col gap-4">
          {/* Collected this month */}
          <div
            className="rounded-[11px] px-[17px] py-[15px] flex-1 flex flex-col justify-center border"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[.05em] uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>
                Collected this month
              </span>
              {collectedThisMonth.momDeltaPct !== 0 && (
                <span className="text-[12px] font-bold flex items-center gap-0.5" style={{ color: momPositive ? "#15a35a" : "#d23b1f" }}>
                  {momPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {momPositive ? "▲" : "▼"}{Math.abs(collectedThisMonth.momDeltaPct)}%
                </span>
              )}
            </div>
            <div className="font-mono text-[24px] font-semibold mt-2" data-testid="text-collected-month">
              {fmt(collectedThisMonth.amount)}
            </div>
          </div>

          {/* Active jobs */}
          <div
            className="rounded-[11px] px-[17px] py-[15px] flex-1 flex flex-col justify-center border"
            style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
          >
            <span className="text-[11px] font-bold tracking-[.05em] uppercase" style={{ color: "hsl(var(--muted-foreground))" }}>
              Active jobs
            </span>
            <div className="flex items-baseline gap-[10px] mt-2">
              <span className="font-mono text-[24px] font-semibold" data-testid="text-active-jobs">{activeJobs.count}</span>
              <span className="text-[12px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                {activeJobs.crews > 0 || activeJobs.hoursToday > 0
                  ? `· ${activeJobs.crews} crew${activeJobs.crews !== 1 ? "s" : ""} · ${activeJobs.hoursToday} hrs logged today`
                  : "· in progress"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Needs attention */}
      <div
        className="rounded-[11px] overflow-hidden mb-[18px] border"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
      >
        {/* Card header */}
        <div className="flex items-center gap-[9px] px-[18px] py-[14px] border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: "#d23b1f" }} />
          <span className="text-[14.5px] font-semibold">Needs attention</span>
          <span className="text-[12px]" style={{ color: "hsl(var(--muted-foreground))" }}>
            {needsAttention.length > 0
              ? `${needsAttention.length} invoice${needsAttention.length !== 1 ? "s" : ""} past due or due today`
              : "Nothing to chase"}
          </span>
          <Link
            href="/invoices"
            data-testid="link-needs-attention-all"
            className="ml-auto text-[12.5px] font-semibold no-underline"
            style={{ color: "hsl(var(--primary))" }}
          >
            View all →
          </Link>
        </div>

        {needsAttention.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <CheckCircle className="h-8 w-8 mb-2" style={{ color: "#15a35a" }} />
            <p className="font-semibold text-sm">You're all caught up</p>
            <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>No overdue or due-today invoices.</p>
          </div>
        ) : (
          needsAttention.map((item, i) => (
            <div
              key={item.invoiceId}
              className="flex items-center gap-[14px] px-[18px] py-[12px] transition-colors group"
              style={{
                borderBottom: i < needsAttention.length - 1 ? "1px solid hsl(var(--border))" : undefined,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--row-hover)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}
            >
              <Link
                href={`/invoices/${item.invoiceId}`}
                data-testid={`link-needs-attention-${item.invoiceId}`}
                className="flex-1 min-w-0 no-underline"
                style={{ color: "inherit" }}
              >
                <div className="text-[13px] font-semibold">
                  {item.client}{item.project ? ` — ${item.project}` : " "}
                  {" "}<span className="font-mono font-normal" style={{ color: "hsl(var(--muted-foreground))" }}>· {item.invoiceNumber}</span>
                </div>
                <div
                  className="text-[11.5px] font-semibold mt-0.5"
                  style={{
                    color: item.reason === "overdue" ? "#d23b1f"
                      : item.reason === "due-today" ? "#b6731a"
                      : "hsl(var(--muted-foreground))",
                  }}
                >
                  {item.detail}
                </div>
              </Link>
              <span className="font-mono text-[13.5px] font-semibold shrink-0" data-testid={`text-balance-${item.invoiceId}`}>
                {fmt(item.balance)}
              </span>
              <button
                onClick={() => remindOneMutation.mutate(item.invoiceId)}
                disabled={remindOneMutation.isPending}
                data-testid={`button-remind-${item.invoiceId}`}
                className="rounded-[8px] px-[13px] py-[7px] text-[12px] font-semibold border cursor-pointer shrink-0 transition-colors"
                style={{
                  background: "hsl(var(--card))",
                  borderColor: "hsl(var(--border))",
                  color: "hsl(var(--primary))",
                  fontFamily: "inherit",
                }}
              >
                <Bell className="h-3 w-3 inline mr-1" />
                Remind
              </button>
            </div>
          ))
        )}
      </div>

      {/* This week on site */}
      <div
        className="rounded-[11px] p-[16px_18px] border"
        style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
      >
        <div className="flex items-center justify-between mb-[14px]">
          <span className="text-[14.5px] font-semibold">This week on site</span>
          <Link
            href="/scheduling"
            data-testid="link-scheduling"
            className="text-[12.5px] font-semibold no-underline"
            style={{ color: "hsl(var(--primary))" }}
          >
            Scheduling →
          </Link>
        </div>

        {week.every(d => d.jobs.length === 0) ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CalendarDays className="h-8 w-8 mb-2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <p className="font-semibold text-sm">Nothing scheduled this week</p>
            <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>Add start/end dates to jobs to see them here.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
            {week.map((day) => (
              <div
                key={day.date}
                className="rounded-[9px] p-[10px] border"
                style={{ background: "var(--track)", borderColor: "hsl(var(--border))" }}
              >
                <div
                  className="text-[11px] font-bold mb-2"
                  style={{ color: day.isToday ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
                >
                  {day.weekday} {day.dayNum}
                </div>
                {day.jobs.length === 0 ? (
                  <div className="text-[10.5px] opacity-70 px-[2px] py-[6px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                    No jobs
                  </div>
                ) : (
                  day.jobs.map((job) => (
                    <Link
                      key={job.jobId}
                      href={`/jobs/${job.jobId}`}
                      data-testid={`link-week-job-${job.jobId}`}
                      className="block rounded-[6px] px-2 py-[6px] text-[11px] font-semibold mb-[5px] no-underline last:mb-0 transition-opacity hover:opacity-80"
                      style={{ background: job.color + "2e", color: job.color }}
                    >
                      {job.label}
                      {job.crewSize > 0 && (
                        <div className="text-[10.5px] font-normal mt-0.5 opacity-80">Crew of {job.crewSize}</div>
                      )}
                    </Link>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
