import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import {
  DollarSign,
  Briefcase,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  ArrowRight,
  Bell,
  Plus,
  CheckCircle,
  CalendarDays,
} from "lucide-react";
import { format } from "date-fns";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

interface Outstanding {
  total: number; invoiceCount: number; clientCount: number;
  overdue: number; dueSoon: number; draft: number;
}
interface DashboardData {
  outstanding: Outstanding;
  collectedThisMonth: { amount: number; momDeltaPct: number };
  activeJobs: { count: number; crews: number; hoursToday: number };
  needsAttention: Array<{
    invoiceId: string; invoiceNumber: string;
    client: string; project?: string;
    reason: "overdue" | "due-today" | "deposit-due";
    detail: string; balance: number; daysOverdue: number;
  }>;
  week: Array<{
    date: string; weekday: string; dayNum: number; isToday: boolean;
    jobs: Array<{ jobId: string; label: string; crewSize: number; color: string }>;
  }>;
  greeting: { firstName: string; timeOfDay: "morning" | "afternoon" | "evening" };
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
  });

  const remindMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/reminders/process"),
    onSuccess: () => {
      toast({ title: "Reminders sent", description: "Payment reminders have been dispatched." });
    },
    onError: () => {
      toast({ title: "Failed to send reminders", variant: "destructive" });
    },
  });

  const remindOneMutation = useMutation({
    mutationFn: (invoiceId: string) => apiRequest("POST", `/api/invoices/${invoiceId}/send-email`),
    onSuccess: () => {
      toast({ title: "Reminder sent" });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    },
    onError: () => {
      toast({ title: "Failed to send reminder", variant: "destructive" });
    },
  });

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
          <p className="text-destructive font-medium">Failed to load dashboard</p>
          <p className="text-muted-foreground text-sm mt-1">Please try again.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <DashboardSkeleton />
      </div>
    );
  }

  const { outstanding, collectedThisMonth, activeJobs, needsAttention, week, greeting } = data!;
  const momPositive = collectedThisMonth.momDeltaPct >= 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Good {greeting.timeOfDay}, {greeting.firstName}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {format(new Date(), "EEEE, MMMM d")}
        </p>
      </div>

      {/* Top row: Hero + KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Hero — Total Outstanding */}
        <Card className="lg:col-span-2 bg-primary text-primary-foreground border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-primary-foreground/70 text-sm font-medium uppercase tracking-wide">
                  Total Outstanding
                </p>
                <div className="font-mono text-5xl font-bold mt-1 tracking-tight" data-testid="text-outstanding-total">
                  {fmt(outstanding.total)}
                </div>
                <p className="text-primary-foreground/70 text-sm mt-1 font-mono">
                  across {outstanding.invoiceCount} open invoice{outstanding.invoiceCount !== 1 ? "s" : ""} · {outstanding.clientCount} client{outstanding.clientCount !== 1 ? "s" : ""}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-primary-foreground/40 mt-1 shrink-0" />
            </div>

            {/* Breakdown row */}
            <div className="grid grid-cols-3 gap-3 mt-4 mb-6">
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-primary-foreground/60 text-xs font-medium mb-0.5">Overdue</p>
                <p className="font-mono font-semibold text-lg" data-testid="text-outstanding-overdue">{fmt(outstanding.overdue)}</p>
              </div>
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-primary-foreground/60 text-xs font-medium mb-0.5">Due soon</p>
                <p className="font-mono font-semibold text-lg" data-testid="text-outstanding-due-soon">{fmt(outstanding.dueSoon)}</p>
              </div>
              <div className="bg-white/10 rounded-lg p-3">
                <p className="text-primary-foreground/60 text-xs font-medium mb-0.5">Draft</p>
                <p className="font-mono font-semibold text-lg" data-testid="text-outstanding-draft">{fmt(outstanding.draft)}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/20 hover:bg-white/30 text-primary-foreground border-0"
                onClick={() => remindMutation.mutate()}
                disabled={remindMutation.isPending}
                data-testid="button-send-reminders"
              >
                <Bell className="h-4 w-4 mr-2" />
                {remindMutation.isPending ? "Sending…" : "Send reminders"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="bg-white/20 hover:bg-white/30 text-primary-foreground border-0"
                onClick={() => setLocation("/invoices/new")}
                data-testid="button-new-invoice"
              >
                <Plus className="h-4 w-4 mr-2" />
                New invoice
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right column — KPI cards */}
        <div className="flex flex-col gap-4">
          {/* Collected this month */}
          <Card className="flex-1">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Collected this month</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl font-bold" data-testid="text-collected-month">
                {fmt(collectedThisMonth.amount)}
              </div>
              {collectedThisMonth.momDeltaPct !== 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1.5">
                  {momPositive
                    ? <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                    : <TrendingDown className="h-3.5 w-3.5 text-destructive" />}
                  <span className={momPositive ? "text-green-600 dark:text-green-400 font-mono" : "text-destructive font-mono"}>
                    {momPositive ? "▲" : "▼"} {Math.abs(collectedThisMonth.momDeltaPct)}%
                  </span>
                  <span>vs last month</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Active jobs */}
          <Card className="flex-1">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active jobs</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl font-bold" data-testid="text-active-jobs">
                {activeJobs.count}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 font-mono">
                {activeJobs.crews > 0 || activeJobs.hoursToday > 0
                  ? `${activeJobs.crews} crew${activeJobs.crews !== 1 ? "s" : ""} · ${activeJobs.hoursToday} hrs logged today`
                  : "in progress"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom row: Needs attention + This week */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Needs attention */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">Needs attention</CardTitle>
                {needsAttention.length > 0 && (
                  <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {needsAttention.length > 0
                  ? `${needsAttention.length} invoice${needsAttention.length !== 1 ? "s" : ""} past due or due today`
                  : "Nothing to chase"}
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild className="shrink-0 -mt-1">
              <Link href="/invoices" data-testid="link-needs-attention-all">
                View all <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {needsAttention.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                <p className="font-medium text-sm">You're all caught up</p>
                <p className="text-sm text-muted-foreground mt-1">No overdue or due-today invoices.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {needsAttention.map((item) => (
                  <div
                    key={item.invoiceId}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50 transition-colors group"
                  >
                    <Link
                      href={`/invoices/${item.invoiceId}`}
                      className="flex-1 min-w-0 cursor-pointer"
                      data-testid={`link-needs-attention-${item.invoiceId}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">
                          {item.client}{item.project ? ` — ${item.project}` : ""}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground shrink-0">
                          {item.invoiceNumber}
                        </span>
                      </div>
                      <p className={`text-xs mt-0.5 font-medium ${
                        item.reason === "overdue"
                          ? "text-destructive"
                          : item.reason === "due-today" && item.balance > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                      }`}>
                        {item.detail}
                      </p>
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-semibold text-sm" data-testid={`text-balance-${item.invoiceId}`}>
                        {fmt(item.balance)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 px-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.preventDefault(); remindOneMutation.mutate(item.invoiceId); }}
                      disabled={remindOneMutation.isPending}
                      data-testid={`button-remind-${item.invoiceId}`}
                    >
                      <Bell className="h-3 w-3 mr-1" />
                      Remind
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* This week on site */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
            <div>
              <CardTitle className="text-base font-semibold">This week on site</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">Scheduled jobs Mon – Fri</p>
            </div>
            <Button variant="ghost" size="sm" asChild className="shrink-0 -mt-1">
              <Link href="/scheduling" data-testid="link-scheduling">
                Scheduling <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {week.every(d => d.jobs.length === 0) ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CalendarDays className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="font-medium text-sm">Nothing scheduled this week</p>
                <p className="text-sm text-muted-foreground mt-1">Add start dates to jobs to see them here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {week.map((day) => (
                  <div key={day.date} className="flex flex-col gap-1.5">
                    <div className={`text-center pb-1.5 border-b ${day.isToday ? "border-primary" : "border-border"}`}>
                      <p className={`text-xs font-semibold tracking-wide ${day.isToday ? "text-primary" : "text-muted-foreground"}`}>
                        {day.weekday}
                      </p>
                      <p className={`font-mono text-sm font-medium ${day.isToday ? "text-primary" : "text-foreground"}`}>
                        {day.dayNum}
                      </p>
                    </div>
                    {day.jobs.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-1">No jobs</p>
                    ) : (
                      day.jobs.map((job) => (
                        <Link
                          key={job.jobId}
                          href={`/jobs/${job.jobId}`}
                          data-testid={`link-week-job-${job.jobId}`}
                        >
                          <div
                            className="rounded-md px-2 py-1.5 cursor-pointer hover:opacity-90 transition-opacity"
                            style={{ backgroundColor: job.color + "22", borderLeft: `3px solid ${job.color}` }}
                          >
                            <p className="text-xs font-medium truncate leading-tight" style={{ color: job.color }}>
                              {job.label}
                            </p>
                            {job.crewSize > 0 && (
                              <p className="text-xs opacity-70" style={{ color: job.color }}>
                                Crew of {job.crewSize}
                              </p>
                            )}
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
