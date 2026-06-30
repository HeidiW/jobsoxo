import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  MapPin,
  User,
  Briefcase,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isToday,
  parseISO,
} from "date-fns";
import type { Job, Client, Employee } from "@shared/schema";

interface JobWithRelations extends Job {
  client: Client;
  assignedEmployees?: Employee[];
}

function JobStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    quoted: { variant: "secondary", label: "Quoted" },
    scheduled: { variant: "outline", label: "Scheduled" },
    in_progress: { variant: "default", label: "In Progress" },
    completed: { variant: "default", label: "Completed" },
  };
  const config = variants[status] || { variant: "secondary", label: status };
  return <Badge variant={config.variant} className="text-xs">{config.label}</Badge>;
}

function CalendarSkeleton() {
  return (
    <div className="grid grid-cols-7 gap-1">
      {Array.from({ length: 35 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: JobWithRelations }) {
  return (
    <Link href={`/jobs`}>
      <div
        className="p-2 rounded-md bg-primary/10 border border-primary/20 text-xs hover-elevate cursor-pointer"
        data-testid={`job-card-${job.id}`}
      >
        <div className="font-medium truncate">{job.title}</div>
        <div className="text-muted-foreground truncate">{job.client?.name}</div>
      </div>
    </Link>
  );
}

export default function Scheduling() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: jobs, isLoading, error } = useQuery<JobWithRelations[]>({
    queryKey: ["/api/jobs"],
  });

  const filteredJobs = useMemo(() => {
    if (!jobs) return [];
    return jobs.filter((job) => {
      const matchesStatus = statusFilter === "all" || job.status === statusFilter;
      return matchesStatus && job.startDate;
    });
  }, [jobs, statusFilter]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getJobsForDay = (date: Date) => {
    return filteredJobs.filter((job) => {
      if (!job.startDate) return false;
      const jobStart = new Date(job.startDate);
      const jobEnd = job.endDate ? new Date(job.endDate) : jobStart;
      return date >= new Date(jobStart.setHours(0, 0, 0, 0)) && 
             date <= new Date(jobEnd.setHours(23, 59, 59, 999));
    });
  };

  const goToPrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const goToToday = () => setCurrentDate(new Date());

  const upcomingJobs = useMemo(() => {
    if (!jobs) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return jobs
      .filter((job) => {
        if (!job.startDate) return false;
        const startDate = new Date(job.startDate);
        return startDate >= today && job.status !== "completed";
      })
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime())
      .slice(0, 5);
  }, [jobs]);

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-semibold">Scheduling</h1>
          <p className="text-muted-foreground mt-1">View and manage job schedules</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load scheduling data</p>
          <p className="text-muted-foreground text-sm mt-1">Please refresh the page or try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Scheduling</h1>
          <p className="text-muted-foreground mt-1">View and manage job schedules</p>
        </div>
        <Button asChild data-testid="button-create-job">
          <Link href="/jobs">
            <Plus className="h-4 w-4 mr-2" />
            Schedule Job
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={goToPrevMonth} data-testid="button-prev-month">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" onClick={goToNextMonth} data-testid="button-next-month">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardTitle className="text-xl">
                    {format(currentDate, "MMMM yyyy")}
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={goToToday} data-testid="button-today">
                    Today
                  </Button>
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40" data-testid="select-status-filter">
                    <SelectValue placeholder="Filter status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="quoted">Quoted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <CalendarSkeleton />
              ) : (
                <div className="border rounded-md overflow-hidden">
                  <div className="grid grid-cols-7 bg-muted/50">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div
                        key={day}
                        className="p-2 text-center text-sm font-medium text-muted-foreground border-b"
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day, index) => {
                      const dayJobs = getJobsForDay(day);
                      const isCurrentMonth = isSameMonth(day, currentDate);
                      const isDayToday = isToday(day);

                      return (
                        <div
                          key={index}
                          className={`min-h-24 p-1 border-b border-r ${
                            !isCurrentMonth ? "bg-muted/30" : ""
                          } ${isDayToday ? "bg-primary/5" : ""}`}
                        >
                          <div
                            className={`text-sm p-1 ${
                              !isCurrentMonth ? "text-muted-foreground" : ""
                            } ${isDayToday ? "font-bold text-primary" : ""}`}
                          >
                            {format(day, "d")}
                          </div>
                          <div className="space-y-1">
                            {dayJobs.slice(0, 2).map((job) => (
                              <JobCard key={job.id} job={job} />
                            ))}
                            {dayJobs.length > 2 && (
                              <div className="text-xs text-muted-foreground text-center">
                                +{dayJobs.length - 2} more
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                Upcoming Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : upcomingJobs.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Briefcase className="h-8 w-8 mx-auto mb-2" />
                  <p className="text-sm">No upcoming jobs scheduled</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingJobs.map((job) => (
                    <div
                      key={job.id}
                      className="p-3 rounded-md border hover-elevate"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-medium text-sm">{job.title}</span>
                        <JobStatusBadge status={job.status} />
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {job.client?.name}
                        </div>
                        {job.startDate && (
                          <div className="flex items-center gap-1">
                            <CalendarIcon className="h-3 w-3" />
                            {format(new Date(job.startDate), "MMM d, yyyy")}
                          </div>
                        )}
                        {job.address && (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{job.address}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Jobs this month</span>
                  <span className="font-medium">
                    {filteredJobs.filter((job) => {
                      if (!job.startDate) return false;
                      const startDate = new Date(job.startDate);
                      return isSameMonth(startDate, currentDate);
                    }).length}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">In Progress</span>
                  <span className="font-medium">
                    {jobs?.filter((job) => job.status === "in_progress").length || 0}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Scheduled</span>
                  <span className="font-medium">
                    {jobs?.filter((job) => job.status === "scheduled").length || 0}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Quoted</span>
                  <span className="font-medium">
                    {jobs?.filter((job) => job.status === "quoted").length || 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
