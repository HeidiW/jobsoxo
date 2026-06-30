import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  DollarSign,
  FileText,
  Briefcase,
  Clock,
  ArrowRight,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import type { Invoice, Job, Client } from "@shared/schema";
import { InvoiceStatusBadge, JobStatusBadge } from "@/components/status-badge";

interface DashboardStats {
  outstandingAmount: number;
  monthRevenue: number;
  activeJobs: number;
  overdueInvoices: number;
}

interface DashboardData {
  stats: DashboardStats;
  recentInvoices: (Invoice & { client: Client })[];
  upcomingJobs: (Job & { client: Client })[];
}

function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  trend?: { value: number; positive: boolean };
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold font-mono">{value}</div>
        {trend && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
            <TrendingUp className={`h-3 w-3 ${trend.positive ? "text-green-500" : "text-red-500"}`} />
            <span className={trend.positive ? "text-green-500" : "text-red-500"}>
              {trend.positive ? "+" : "-"}{trend.value}%
            </span>
            {description && <span className="ml-1">{description}</span>}
          </p>
        )}
        {!trend && description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3 w-20 mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((j) => (
                  <Skeleton key={j} className="h-12 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
  });

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold">Dashboard</h1>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load dashboard data</p>
          <p className="text-muted-foreground text-sm mt-1">Please refresh the page or try again later.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your business</p>
        </div>
        <DashboardSkeleton />
      </div>
    );
  }

  const stats = data?.stats || {
    outstandingAmount: 0,
    monthRevenue: 0,
    activeJobs: 0,
    overdueInvoices: 0,
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your business</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard
          title="Outstanding Invoices"
          value={formatCurrency(stats.outstandingAmount)}
          icon={DollarSign}
          description="Total unpaid"
        />
        <StatCard
          title="This Month Revenue"
          value={formatCurrency(stats.monthRevenue)}
          icon={TrendingUp}
          description="Collected this month"
        />
        <StatCard
          title="Active Jobs"
          value={stats.activeJobs.toString()}
          icon={Briefcase}
          description="In progress"
        />
        <StatCard
          title="Overdue Invoices"
          value={stats.overdueInvoices.toString()}
          icon={Clock}
          description={stats.overdueInvoices > 0 ? "Need attention" : "All good"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-lg font-medium">Recent Invoices</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/invoices" data-testid="link-view-all-invoices">
                View All <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {(!data?.recentInvoices || data.recentInvoices.length === 0) ? (
              <EmptyState
                title="No invoices yet"
                description="Create your first invoice to get started"
                action={
                  <Button size="sm" asChild>
                    <Link href="/invoices/new" data-testid="link-create-invoice-empty">Create Invoice</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {data.recentInvoices.slice(0, 5).map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between py-2 hover-elevate rounded-md px-2 -mx-2"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">
                          {invoice.invoiceNumber}
                        </span>
                        <InvoiceStatusBadge status={invoice.status} />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {invoice.client?.name || "Unknown Client"}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-medium">
                        {formatCurrency(Number(invoice.total))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(invoice.issueDate), "MMM d, yyyy")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-lg font-medium">Upcoming Jobs</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/jobs" data-testid="link-view-all-jobs">
                View All <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {(!data?.upcomingJobs || data.upcomingJobs.length === 0) ? (
              <EmptyState
                title="No upcoming jobs"
                description="Schedule jobs to see them here"
                action={
                  <Button size="sm" asChild>
                    <Link href="/jobs/new" data-testid="link-create-job-empty">Create Job</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {data.upcomingJobs.slice(0, 5).map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between py-2 hover-elevate rounded-md px-2 -mx-2"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{job.title}</span>
                        <JobStatusBadge status={job.status} />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {job.client?.name || "Unknown Client"}
                      </span>
                    </div>
                    <div className="text-right">
                      {job.startDate && (
                        <div className="text-sm">
                          {format(new Date(job.startDate), "MMM d")}
                        </div>
                      )}
                      {job.estimatedTotal && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {formatCurrency(Number(job.estimatedTotal))}
                        </div>
                      )}
                    </div>
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
