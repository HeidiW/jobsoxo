import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import {
  Plus,
  Search,
  Users,
  Clock,
  DollarSign,
  Edit,
  MoreHorizontal,
  Calendar,
  Play,
  CheckCircle,
  Trash2,
  FileText,
  ChevronDown,
  AlertTriangle,
  PhoneOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { Employee, TimeEntry, PayrollRecord, Job } from "@shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmployeeWithStats extends Employee {
  hoursThisPeriod: number;
  totalPay: number;
}

interface TimeEntryWithRelations extends TimeEntry {
  employee: Employee;
  job?: Job;
}

interface PayrollRecordWithEmployee extends PayrollRecord {
  employee: Employee;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const employeeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  hourlyRate: z
    .string()
    .min(1, "Hourly rate is required")
    .refine((val) => !isNaN(parseFloat(val)) && isFinite(Number(val)), "Hourly rate must be a valid number")
    .refine((val) => parseFloat(val) > 0, "Hourly rate must be greater than zero"),
  position: z.string().optional(),
  status: z.enum(["active", "inactive"]),
});

const timeEntryFormSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  jobId: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  hoursWorked: z
    .string()
    .min(1, "Hours are required")
    .refine((val) => !isNaN(parseFloat(val)) && isFinite(Number(val)), "Hours must be a valid number")
    .refine((val) => parseFloat(val) > 0, "Hours must be greater than zero")
    .refine((val) => parseFloat(val) <= 24, "Hours cannot exceed 24 in a single entry"),
  description: z.string().optional(),
});

const runPayrollSchema = z.object({
  periodStart: z.string().min(1, "Start date is required").refine((val) => {
    if (!val) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(val) <= today;
  }, "Start date cannot be in the future"),
  periodEnd: z.string().min(1, "End date is required"),
  deductionRate: z.string().optional(),
}).refine((data) => {
  if (!data.periodStart || !data.periodEnd) return true;
  return new Date(data.periodStart) < new Date(data.periodEnd);
}, { message: "Start date must be before end date", path: ["periodEnd"] });

type EmployeeFormValues = z.infer<typeof employeeFormSchema>;
type TimeEntryFormValues = z.infer<typeof timeEntryFormSchema>;
type RunPayrollValues = z.infer<typeof runPayrollSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(n ?? 0));
}

function periodPresets() {
  const now = new Date();
  return [
    { label: "This Month", start: format(startOfMonth(now), "yyyy-MM-dd"), end: format(endOfMonth(now), "yyyy-MM-dd") },
    { label: "Last Month", start: format(startOfMonth(subMonths(now, 1)), "yyyy-MM-dd"), end: format(endOfMonth(subMonths(now, 1)), "yyyy-MM-dd") },
    { label: "Last 2 Weeks", start: format(new Date(now.getTime() - 14 * 864e5), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") },
    { label: "Last Week", start: format(new Date(now.getTime() - 7 * 864e5), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") },
  ];
}

// ─── Employee Form ─────────────────────────────────────────────────────────────

function EmployeeForm({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const { toast } = useToast();
  const isEdit = !!employee;

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      name: employee?.name || "",
      email: employee?.email || "",
      phone: employee?.phone || "",
      hourlyRate: employee?.hourlyRate?.toString() || "",
      position: employee?.position || "",
      status: (employee?.status as EmployeeFormValues["status"]) || "active",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: EmployeeFormValues) => {
      const url = isEdit ? `/api/employees/${employee.id}` : "/api/employees";
      const method = isEdit ? "PATCH" : "POST";
      const res = await apiRequest(method, url, { ...data, hourlyRate: parseFloat(data.hourlyRate) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: isEdit ? "Employee updated" : "Employee added" });
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof EmployeeFormValues, { type: "server", message: Array.isArray(messages) ? messages[0] : String(messages) });
        });
        toast({ title: "Please fix the errors below", variant: "destructive" });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Name *</FormLabel><FormControl>
            <Input placeholder="Employee name" {...field} data-testid="input-employee-name" />
          </FormControl><FormMessage /></FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><FormLabel>Email</FormLabel><FormControl>
              <Input type="email" placeholder="email@example.com" {...field} data-testid="input-employee-email" />
            </FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem><FormLabel>Phone</FormLabel><FormControl>
              <Input placeholder="(555) 123-4567" {...field} data-testid="input-employee-phone" />
            </FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="hourlyRate" render={({ field }) => (
            <FormItem><FormLabel>Hourly Rate ($) *</FormLabel><FormControl>
              <Input type="number" step="0.01" placeholder="25.00" {...field} data-testid="input-employee-rate" />
            </FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="position" render={({ field }) => (
            <FormItem><FormLabel>Position</FormLabel><FormControl>
              <Input placeholder="Painter, Foreman…" {...field} data-testid="input-employee-position" />
            </FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="status" render={({ field }) => (
          <FormItem><FormLabel>Status</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl><SelectTrigger data-testid="select-employee-status"><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          <FormMessage /></FormItem>
        )} />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-employee">Cancel</Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-employee">
            {mutation.isPending ? "Saving…" : isEdit ? "Update Employee" : "Add Employee"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ─── Time Entry Form ───────────────────────────────────────────────────────────

function TimeEntryForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: employees } = useQuery<Employee[]>({ queryKey: ["/api/employees"] });
  const { data: jobs } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const form = useForm<TimeEntryFormValues>({
    resolver: zodResolver(timeEntryFormSchema),
    defaultValues: { employeeId: "", jobId: "", date: format(new Date(), "yyyy-MM-dd"), hoursWorked: "", description: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: TimeEntryFormValues) => {
      const res = await apiRequest("POST", "/api/time-entries", {
        ...data,
        hoursWorked: parseFloat(data.hoursWorked),
        date: new Date(data.date).toISOString(),
        jobId: data.jobId || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Time entry added" });
      onClose();
    },
    onError: (error: Error) => {
      const message = error.message.replace(/^\d+:\s*/, "");
      form.setError("hoursWorked", { message });
      toast({ title: "Error", description: message, variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FormField control={form.control} name="employeeId" render={({ field }) => (
          <FormItem><FormLabel>Employee *</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl><SelectTrigger data-testid="select-time-entry-employee"><SelectValue placeholder="Select employee" /></SelectTrigger></FormControl>
              <SelectContent>
                {employees?.filter((e) => e.status === "active").map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          <FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="jobId" render={({ field }) => (
          <FormItem><FormLabel>Job (Optional)</FormLabel>
            <Select onValueChange={(v) => field.onChange(v === "none" ? "" : v)} value={field.value || "none"}>
              <FormControl><SelectTrigger data-testid="select-time-entry-job"><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="none">No job</SelectItem>
                {jobs?.filter((j) => j.status !== "completed").map((j) => (
                  <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          <FormMessage /></FormItem>
        )} />
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="date" render={({ field }) => (
            <FormItem><FormLabel>Date *</FormLabel><FormControl>
              <Input type="date" {...field} data-testid="input-time-entry-date" />
            </FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="hoursWorked" render={({ field }) => (
            <FormItem><FormLabel>Hours Worked *</FormLabel><FormControl>
              <Input type="number" step="0.25" placeholder="8" {...field} data-testid="input-time-entry-hours" />
            </FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem><FormLabel>Description</FormLabel><FormControl>
            <Input placeholder="Work performed" {...field} data-testid="input-time-entry-description" />
          </FormControl><FormMessage /></FormItem>
        )} />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-time-entry">Cancel</Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-time-entry">
            {mutation.isPending ? "Saving…" : "Add Entry"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ─── Run Payroll Form ──────────────────────────────────────────────────────────

function RunPayrollForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: employees } = useQuery<EmployeeWithStats[]>({ queryKey: ["/api/employees"] });
  const { data: payrollRecords } = useQuery<PayrollRecordWithEmployee[]>({ queryKey: ["/api/payroll-records"] });
  const activeCount = employees?.filter((e) => e.status === "active").length ?? 0;
  const presets = periodPresets();

  const form = useForm<RunPayrollValues>({
    resolver: zodResolver(runPayrollSchema),
    defaultValues: {
      periodStart: presets[0].start,
      periodEnd: presets[0].end,
      deductionRate: "0",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: RunPayrollValues) => {
      const res = await apiRequest("POST", "/api/payroll-records/run", {
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        deductionRate: parseFloat(data.deductionRate || "0"),
      });
      return res.json();
    },
    onSuccess: (records) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-records"] });
      toast({
        title: "Payroll run complete",
        description: `Created ${records.length} payroll record${records.length !== 1 ? "s" : ""}.`,
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const watchStart = form.watch("periodStart");
  const watchEnd = form.watch("periodEnd");
  const watchDeduction = form.watch("deductionRate");

  const overlappingPeriods = (payrollRecords && watchStart && watchEnd)
    ? payrollRecords.filter((r) => {
        const selStart = new Date(watchStart);
        const selEnd = new Date(watchEnd);
        const rStart = new Date(r.periodStart);
        const rEnd = new Date(r.periodEnd);
        return rStart < selEnd && rEnd > selStart;
      }).reduce<{ periodStart: string; periodEnd: string }[]>((acc, r) => {
        if (!acc.some((x) => x.periodStart === r.periodStart && x.periodEnd === r.periodEnd)) {
          acc.push({ periodStart: r.periodStart, periodEnd: r.periodEnd });
        }
        return acc;
      }, [])
    : [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-5">
        {/* Quick presets */}
        <div>
          <p className="text-sm font-medium mb-2">Quick Period</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { form.setValue("periodStart", p.start); form.setValue("periodEnd", p.end); }}
                data-testid={`preset-${p.label.toLowerCase().replace(/ /g, "-")}`}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="periodStart" render={({ field }) => (
            <FormItem><FormLabel>Period Start *</FormLabel><FormControl>
              <Input type="date" {...field} data-testid="input-payroll-start" />
            </FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="periodEnd" render={({ field }) => (
            <FormItem><FormLabel>Period End *</FormLabel><FormControl>
              <Input type="date" {...field} data-testid="input-payroll-end" />
            </FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <FormField control={form.control} name="deductionRate" render={({ field }) => (
          <FormItem>
            <FormLabel>Deduction Rate (% — optional)</FormLabel>
            <FormControl>
              <Input type="number" step="0.1" min="0" max="100" placeholder="0" {...field} data-testid="input-deduction-rate" />
            </FormControl>
            <p className="text-xs text-muted-foreground">Applied uniformly to all employees as a percentage of gross pay.</p>
            <FormMessage />
          </FormItem>
        )} />

        {/* Overlap warning */}
        {overlappingPeriods.length > 0 && (
          <div
            className="flex gap-3 rounded-md border border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/40 p-3 text-sm"
            data-testid="warning-payroll-overlap"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <div className="text-yellow-800 dark:text-yellow-300">
              <p className="font-medium">This period overlaps an existing payroll run</p>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-yellow-700 dark:text-yellow-400">
                {overlappingPeriods.map((p) => (
                  <li key={`${p.periodStart}-${p.periodEnd}`}>
                    {p.periodStart} → {p.periodEnd}
                  </li>
                ))}
              </ul>
              <p className="mt-1">Fix the dates above to enable submission.</p>
            </div>
          </div>
        )}

        {/* Preview */}
        {watchStart && watchEnd && (
          <div className="rounded-md bg-muted/50 border p-4 text-sm space-y-1">
            <p className="font-medium">Preview</p>
            <p className="text-muted-foreground">
              Period: {watchStart} → {watchEnd}
            </p>
            <p className="text-muted-foreground">
              {activeCount} active employee{activeCount !== 1 ? "s" : ""} will get a payroll record.
            </p>
            {Number(watchDeduction) > 0 && (
              <p className="text-muted-foreground">
                Deduction: {watchDeduction}% of gross pay.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Tooltip open={mutation.isPending ? undefined : false}>
            <TooltipTrigger asChild>
              <span tabIndex={mutation.isPending ? 0 : undefined}>
                <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending} data-testid="button-cancel-run-payroll">Cancel</Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Payroll run in progress — please wait</TooltipContent>
          </Tooltip>
          <Tooltip open={overlappingPeriods.length > 0 && !mutation.isPending ? undefined : false}>
            <TooltipTrigger asChild>
              <span tabIndex={overlappingPeriods.length > 0 && !mutation.isPending ? 0 : undefined}>
                <Button type="submit" disabled={mutation.isPending || overlappingPeriods.length > 0} data-testid="button-run-payroll-submit">
                  <Play className="h-4 w-4 mr-2" />
                  {mutation.isPending ? "Running…" : "Run Payroll"}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Date overlap detected — adjust the dates above</TooltipContent>
          </Tooltip>
        </div>
      </form>
    </Form>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function TableSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Payroll() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [isTimeEntryDialogOpen, setIsTimeEntryDialogOpen] = useState(false);
  const [isRunPayrollOpen, setIsRunPayrollOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [deleteTimeEntryId, setDeleteTimeEntryId] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState("all");

  const { data: employees, isLoading: employeesLoading } = useQuery<EmployeeWithStats[]>({ queryKey: ["/api/employees"] });
  const { data: timeEntries, isLoading: timeEntriesLoading } = useQuery<TimeEntryWithRelations[]>({ queryKey: ["/api/time-entries"] });
  const { data: payrollRecords, isLoading: payrollLoading } = useQuery<PayrollRecordWithEmployee[]>({ queryKey: ["/api/payroll-records"] });

  const deleteTimeEntryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/time-entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setDeleteTimeEntryId(null);
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/payroll-records/${id}`, { status: "paid" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-records"] });
    },
  });

  const filteredEmployees = employees?.filter((e) =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.position?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const now = new Date();
  const filteredTimeEntries = timeEntries?.filter((entry) => {
    if (timeFilter === "all") return true;
    const d = new Date(entry.date);
    if (timeFilter === "this_month") return d >= startOfMonth(now) && d <= endOfMonth(now);
    if (timeFilter === "last_month") return d >= startOfMonth(subMonths(now, 1)) && d <= endOfMonth(subMonths(now, 1));
    if (timeFilter === "last_7") return d >= new Date(now.getTime() - 7 * 864e5);
    return true;
  });

  const totalPayroll = employees?.reduce((s, e) => s + (e.totalPay || 0), 0) || 0;
  const totalHours = employees?.reduce((s, e) => s + (e.hoursThisPeriod || 0), 0) || 0;
  const activeEmployees = employees?.filter((e) => e.status === "active").length || 0;
  const pendingPayroll = payrollRecords?.filter((r) => r.status === "pending").reduce((s, r) => s + Number(r.netPay), 0) || 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Delete time entry confirmation */}
      <AlertDialog open={!!deleteTimeEntryId} onOpenChange={(o) => !o && setDeleteTimeEntryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete time entry?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTimeEntryId && deleteTimeEntryMutation.mutate(deleteTimeEntryId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Payroll</h1>
          <p className="text-muted-foreground mt-1">Employees, time tracking, and pay runs</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Dialog open={isTimeEntryDialogOpen} onOpenChange={setIsTimeEntryDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-log-hours">
                <Clock className="h-4 w-4 mr-2" />Log Hours
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Log Time Entry</DialogTitle></DialogHeader>
              <TimeEntryForm onClose={() => setIsTimeEntryDialogOpen(false)} />
            </DialogContent>
          </Dialog>

          <Dialog open={isRunPayrollOpen} onOpenChange={setIsRunPayrollOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-run-payroll">
                <Play className="h-4 w-4 mr-2" />Run Payroll
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
              <RunPayrollForm onClose={() => setIsRunPayrollOpen(false)} />
            </DialogContent>
          </Dialog>

          <Dialog open={isEmployeeDialogOpen} onOpenChange={(o) => { setIsEmployeeDialogOpen(o); if (!o) setEditingEmployee(null); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-employee">
                <Plus className="h-4 w-4 mr-2" />Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{editingEmployee ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
              <EmployeeForm employee={editingEmployee || undefined} onClose={() => { setIsEmployeeDialogOpen(false); setEditingEmployee(null); }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Active Employees</p>
                <p className="text-2xl font-bold">{activeEmployees}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hours This Month</p>
                <p className="text-2xl font-bold">{totalHours.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payroll This Month</p>
                <p className="text-2xl font-bold font-mono">{fmt(totalPayroll)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Payment</p>
                <p className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-400">{fmt(pendingPayroll)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="employees" className="space-y-4">
        <TabsList>
          <TabsTrigger value="employees" data-testid="tab-employees">Employees</TabsTrigger>
          <TabsTrigger value="time-entries" data-testid="tab-time-entries">Time Entries</TabsTrigger>
          <TabsTrigger value="payroll-records" data-testid="tab-payroll-records">
            Payroll Records
            {payrollRecords?.filter((r) => r.status === "pending").length ? (
              <Badge className="ml-2 bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 text-xs">
                {payrollRecords.filter((r) => r.status === "pending").length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ── Employees Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="employees">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  All Employees
                  {employees && <Badge variant="secondary" className="ml-1">{employees.length}</Badge>}
                </CardTitle>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search employees…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-employees" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {employeesLoading ? (
                <Table><TableBody><TableSkeleton cols={6} /></TableBody></Table>
              ) : !filteredEmployees?.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-lg">No employees found</h3>
                  <p className="text-muted-foreground mt-1 mb-4">{searchQuery ? "Try a different search" : "Add your first employee to get started"}</p>
                  {!searchQuery && (
                    <Button onClick={() => setIsEmployeeDialogOpen(true)} data-testid="button-add-first-employee">
                      <Plus className="h-4 w-4 mr-2" />Add Employee
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="hidden md:table-cell">Position</TableHead>
                        <TableHead className="text-right">Hourly Rate</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Hours (Month)</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Month Pay</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEmployees.map((emp) => (
                        <TableRow key={emp.id} className="hover-elevate">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                <span className="text-xs font-semibold text-primary">
                                  {emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium">{emp.name}</span>
                                {emp.email && <span className="text-xs text-muted-foreground">{emp.email}</span>}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm">{emp.position || "—"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{fmt(emp.hourlyRate)}/hr</TableCell>
                          <TableCell className="text-right hidden lg:table-cell font-mono text-sm">{(emp.hoursThisPeriod || 0).toFixed(1)} hrs</TableCell>
                          <TableCell className="text-right hidden lg:table-cell font-mono font-medium">{fmt(emp.totalPay || 0)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant={emp.status === "active" ? "default" : "secondary"}>{emp.status}</Badge>
                              {!emp.phone && emp.status === "active" && (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
                                  title="No phone number — employee cannot log hours by text message"
                                  data-testid={`badge-no-phone-${emp.id}`}
                                >
                                  <PhoneOff className="h-3 w-3" />
                                  No phone
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-employee-actions-${emp.id}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => { setEditingEmployee(emp); setIsEmployeeDialogOpen(true); }} data-testid={`button-edit-employee-${emp.id}`}>
                                  <Edit className="h-4 w-4 mr-2" />Edit
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
        </TabsContent>

        {/* ── Time Entries Tab ───────────────────────────────────────────────── */}
        <TabsContent value="time-entries">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Time Entries
                  {filteredTimeEntries && <Badge variant="secondary" className="ml-1">{filteredTimeEntries.length}</Badge>}
                </CardTitle>
                <div className="flex gap-2 items-center">
                  <Select value={timeFilter} onValueChange={setTimeFilter}>
                    <SelectTrigger className="w-40" data-testid="select-time-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="this_month">This Month</SelectItem>
                      <SelectItem value="last_month">Last Month</SelectItem>
                      <SelectItem value="last_7">Last 7 Days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={() => setIsTimeEntryDialogOpen(true)} data-testid="button-log-hours-tab">
                    <Plus className="h-4 w-4 mr-1" />Log Hours
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {timeEntriesLoading ? (
                <Table><TableBody><TableSkeleton cols={5} /></TableBody></Table>
              ) : !filteredTimeEntries?.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-lg">No time entries</h3>
                  <p className="text-muted-foreground mt-1 mb-4">Start logging hours to track employee work</p>
                  <Button onClick={() => setIsTimeEntryDialogOpen(true)} data-testid="button-log-first-hours">
                    <Clock className="h-4 w-4 mr-2" />Log Hours
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Employee</TableHead>
                        <TableHead className="hidden md:table-cell">Job</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Pay</TableHead>
                        <TableHead className="hidden lg:table-cell">Description</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTimeEntries.map((entry) => (
                        <TableRow key={entry.id} className="hover-elevate">
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-sm">
                              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                              {format(new Date(entry.date), "MMM d, yyyy")}
                            </span>
                          </TableCell>
                          <TableCell className="font-medium text-sm">{entry.employee?.name || "—"}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{entry.job?.title || "—"}</TableCell>
                          <TableCell className="text-right font-mono font-medium text-sm">{Number(entry.hoursWorked).toFixed(1)} hrs</TableCell>
                          <TableCell className="text-right hidden lg:table-cell font-mono text-sm">
                            {entry.employee?.hourlyRate ? fmt(Number(entry.hoursWorked) * Number(entry.employee.hourlyRate)) : "—"}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-[200px] truncate">{entry.description || "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => setDeleteTimeEntryId(entry.id)}
                              data-testid={`button-delete-entry-${entry.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {filteredTimeEntries && filteredTimeEntries.length > 0 && (
                <div className="mt-3 flex justify-end text-sm text-muted-foreground">
                  Total hours: <span className="font-mono font-medium ml-1">
                    {filteredTimeEntries.reduce((s, e) => s + Number(e.hoursWorked), 0).toFixed(1)} hrs
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payroll Records Tab ────────────────────────────────────────────── */}
        <TabsContent value="payroll-records">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Payroll Records
                  {payrollRecords && <Badge variant="secondary" className="ml-1">{payrollRecords.length}</Badge>}
                </CardTitle>
                <Button onClick={() => setIsRunPayrollOpen(true)} data-testid="button-run-payroll-tab">
                  <Play className="h-4 w-4 mr-2" />Run Payroll
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {payrollLoading ? (
                <Table><TableBody><TableSkeleton cols={7} /></TableBody></Table>
              ) : !payrollRecords?.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-lg">No payroll runs yet</h3>
                  <p className="text-muted-foreground mt-1 mb-4">Run payroll to generate payment records for your employees</p>
                  <Button onClick={() => setIsRunPayrollOpen(true)} data-testid="button-run-first-payroll">
                    <Play className="h-4 w-4 mr-2" />Run Payroll
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead className="hidden md:table-cell">Period</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Hours</TableHead>
                        <TableHead className="text-right hidden lg:table-cell">Rate</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right hidden md:table-cell">Net Pay</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollRecords.map((record) => (
                        <TableRow key={record.id} className="hover-elevate" data-testid={`row-payroll-${record.id}`}>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-sm">{record.employee?.name || "—"}</span>
                              {record.employee?.position && (
                                <span className="text-xs text-muted-foreground">{record.employee.position}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm">
                            <div className="flex flex-col gap-0.5">
                              <span>{format(new Date(record.periodStart), "MMM d")} – {format(new Date(record.periodEnd), "MMM d, yyyy")}</span>
                              {record.paidDate && (
                                <span className="text-xs text-muted-foreground">Paid {format(new Date(record.paidDate), "MMM d, yyyy")}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right hidden lg:table-cell font-mono text-sm">{Number(record.totalHours).toFixed(1)} hrs</TableCell>
                          <TableCell className="text-right hidden lg:table-cell font-mono text-sm">{fmt(record.hourlyRate)}/hr</TableCell>
                          <TableCell className="text-right font-mono font-medium text-sm">{fmt(record.grossPay)}</TableCell>
                          <TableCell className="text-right hidden md:table-cell font-mono font-semibold text-sm text-green-700 dark:text-green-400">{fmt(record.netPay)}</TableCell>
                          <TableCell>
                            {record.status === "paid" ? (
                              <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400">
                                <CheckCircle className="h-3 w-3 mr-1" />Paid
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => markPaidMutation.mutate(record.id)}
                                disabled={markPaidMutation.isPending}
                                data-testid={`button-mark-paid-${record.id}`}
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />Mark Paid
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {payrollRecords && payrollRecords.length > 0 && (
                <div className="mt-3 flex justify-between text-sm text-muted-foreground">
                  <span>
                    {payrollRecords.filter((r) => r.status === "pending").length} pending ·{" "}
                    {payrollRecords.filter((r) => r.status === "paid").length} paid
                  </span>
                  <span>
                    Total net:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {fmt(payrollRecords.reduce((s, r) => s + Number(r.netPay), 0))}
                    </span>
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
