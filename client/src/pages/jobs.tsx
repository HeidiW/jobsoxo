import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import {
  Plus,
  Search,
  Briefcase,
  Calendar,
  MapPin,
  Edit,
  FileText,
  MoreHorizontal,
  Ruler,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import type { Job, Client } from "@shared/schema";

const jobFormSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(["quoted", "scheduled", "in_progress", "completed"]),
  squareFootage: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  estimatedTotal: z.string().optional(),
});

type JobFormValues = z.infer<typeof jobFormSchema>;

interface JobWithClient extends Job {
  client: Client;
}

function JobStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    quoted: { variant: "secondary", label: "Quoted" },
    scheduled: { variant: "outline", label: "Scheduled" },
    in_progress: { variant: "default", label: "In Progress" },
    completed: { variant: "default", label: "Completed" },
  };
  const config = variants[status] || { variant: "secondary", label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function JobForm({
  job,
  onSuccess,
  onClose,
}: {
  job?: Job;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!job;

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobFormSchema),
    defaultValues: {
      clientId: job?.clientId || "",
      title: job?.title || "",
      description: job?.description || "",
      address: job?.address || "",
      status: (job?.status as JobFormValues["status"]) || "quoted",
      squareFootage: job?.squareFootage?.toString() || "",
      startDate: job?.startDate ? format(new Date(job.startDate), "yyyy-MM-dd") : "",
      endDate: job?.endDate ? format(new Date(job.endDate), "yyyy-MM-dd") : "",
      estimatedTotal: job?.estimatedTotal?.toString() || "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: JobFormValues) => {
      const url = isEdit ? `/api/jobs/${job.id}` : "/api/jobs";
      const method = isEdit ? "PATCH" : "POST";
      const payload = {
        ...data,
        squareFootage: data.squareFootage ? parseFloat(data.squareFootage) : null,
        estimatedTotal: data.estimatedTotal ? parseFloat(data.estimatedTotal) : null,
        startDate: data.startDate ? new Date(data.startDate).toISOString() : null,
        endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
      };
      const res = await apiRequest(method, url, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: isEdit ? "Job updated" : "Job created",
        description: `${form.getValues("title")} has been ${isEdit ? "updated" : "added"} successfully.`,
      });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof JobFormValues, {
            type: "server",
            message: Array.isArray(messages) ? messages[0] : String(messages),
          });
        });
        toast({
          title: "Please fix the errors below",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });

  const onSubmit = (data: JobFormValues) => {
    mutation.mutate(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="clientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Client *</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-job-client">
                    <SelectValue placeholder="Select a client" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Title *</FormLabel>
              <FormControl>
                <Input placeholder="Interior painting - Living Room" {...field} data-testid="input-job-title" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea placeholder="Job details and requirements" {...field} data-testid="input-job-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Address</FormLabel>
              <FormControl>
                <Input placeholder="123 Main St, City, State" {...field} data-testid="input-job-address" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-job-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="quoted">Quoted</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="squareFootage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Square Footage</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="1500" {...field} data-testid="input-job-sqft" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-job-start-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-job-end-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="estimatedTotal"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Estimated Total ($)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="2500.00" {...field} data-testid="input-job-total" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-job">
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-job">
            {mutation.isPending ? "Saving..." : isEdit ? "Update Job" : "Create Job"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function JobsTableSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="h-10 w-10 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export default function Jobs() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);

  const { data: jobs, isLoading } = useQuery<JobWithClient[]>({
    queryKey: ["/api/jobs"],
  });

  const filteredJobs = jobs?.filter((job) => {
    const matchesSearch =
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.client?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.address?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || job.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const formatCurrency = (amount: string | number | null | undefined) => {
    if (!amount) return "$0";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(Number(amount));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Jobs</h1>
          <p className="text-muted-foreground mt-1">Manage painting and decorating projects</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setEditingJob(null);
        }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-job">
              <Plus className="h-4 w-4 mr-2" />
              Add Job
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingJob ? "Edit Job" : "Add New Job"}</DialogTitle>
            </DialogHeader>
            <JobForm
              job={editingJob || undefined}
              onSuccess={() => {}}
              onClose={() => {
                setIsDialogOpen(false);
                setEditingJob(null);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              All Jobs
              {jobs && (
                <Badge variant="secondary" className="ml-2">
                  {jobs.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search jobs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-jobs"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40" data-testid="select-filter-status">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="quoted">Quoted</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <JobsTableSkeleton />
          ) : !filteredJobs || filteredJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Briefcase className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium text-lg">No jobs found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                {searchQuery || statusFilter !== "all" ? "Try different filters" : "Create your first job to get started"}
              </p>
              {!searchQuery && statusFilter === "all" && (
                <Button onClick={() => setIsDialogOpen(true)} data-testid="button-add-first-job">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Job
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead className="hidden md:table-cell">Client</TableHead>
                    <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Estimate</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <TableRow key={job.id} className="hover-elevate">
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{job.title}</span>
                          {job.address && (
                            <span className="text-sm text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {job.address}
                            </span>
                          )}
                          {job.squareFootage && (
                            <span className="text-sm text-muted-foreground flex items-center gap-1">
                              <Ruler className="h-3 w-3" />
                              {Number(job.squareFootage).toLocaleString()} sq ft
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-sm">{job.client?.name || "—"}</span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-col gap-0.5 text-sm">
                          {job.startDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              {format(new Date(job.startDate), "MMM d, yyyy")}
                            </span>
                          )}
                          {job.endDate && (
                            <span className="text-muted-foreground">
                              to {format(new Date(job.endDate), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right">
                        <span className="font-mono text-sm">
                          {formatCurrency(job.estimatedTotal)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-job-actions-${job.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingJob(job);
                                setIsDialogOpen(true);
                              }}
                              data-testid={`button-edit-job-${job.id}`}
                            >
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/jobs/${job.id}/line-items`} data-testid={`button-line-items-${job.id}`}>
                                <Ruler className="h-4 w-4 mr-2" />
                                Line Items
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/invoices/new?jobId=${job.id}`} data-testid={`button-create-invoice-job-${job.id}`}>
                                <FileText className="h-4 w-4 mr-2" />
                                Create Invoice
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
