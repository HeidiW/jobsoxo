import { useState, useMemo } from "react";
import { formatPhone } from "@/lib/formatPhone";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { Plus, Play, AlertTriangle, PhoneOff, Edit, Trash2, CheckCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { Employee, TimeEntry, PayrollRecord, Job } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface EmployeeWithStats extends Employee { hoursThisPeriod: number; totalPay: number; }
interface TimeEntryWithRelations extends TimeEntry { employee: Employee; job?: Job; }
interface PayrollRecordWithEmployee extends PayrollRecord { employee: Employee; }

// ── Design helpers ─────────────────────────────────────────────────────────────
const AV_BG = ["--av1","--av2","--av3","--av4","--av5","--av6"];
const AV_FG = ["--av1f","--av2f","--av3f","--av4f","--av5f","--av6f"];
const OT_COLOR = "#e0a020";

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  paid:     { bg: "var(--b-green-bg)", fg: "var(--b-green-fg)", label: "Paid" },
  approved: { bg: "var(--b-amber-bg)", fg: "var(--b-amber-fg)", label: "Approved" },
  pending:  { bg: "var(--b-gray-bg)",  fg: "var(--b-gray-fg)",  label: "Pending" },
};

function fmt(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(Number(n ?? 0));
}
function fmtFull(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(n ?? 0));
}
function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}
function periodLabel(start: string, end: string) {
  try {
    const s = new Date(start + "T12:00:00");
    const e = new Date(end + "T12:00:00");
    return format(s, "MMM d") + " – " + format(e, "MMM d, yyyy");
  } catch { return `${start} – ${end}`; }
}

// ── Shared input style ────────────────────────────────────────────────────────
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: "8px",
  fontSize: "13.5px", color: "#0f172a", background: "#fff", fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b",
  textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "5px",
};

// ── Schemas ───────────────────────────────────────────────────────────────────
const employeeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  hourlyRate: z.string().min(1, "Hourly rate is required")
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Must be a positive number"),
  position: z.string().optional(),
  status: z.enum(["active", "inactive"]),
});
const timeEntryFormSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  jobId: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  hoursWorked: z.string().min(1, "Hours are required")
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Must be > 0")
    .refine(v => parseFloat(v) <= 24, "Cannot exceed 24"),
  description: z.string().optional(),
});
const runPayrollSchema = z.object({
  periodStart: z.string().min(1, "Start date required"),
  periodEnd: z.string().min(1, "End date required"),
  deductionRate: z.string().optional(),
}).refine(d => !d.periodStart || !d.periodEnd || new Date(d.periodStart) < new Date(d.periodEnd), {
  message: "Start must be before end", path: ["periodEnd"],
});
type EmployeeFormValues = z.infer<typeof employeeFormSchema>;
type TimeEntryFormValues = z.infer<typeof timeEntryFormSchema>;
type RunPayrollValues = z.infer<typeof runPayrollSchema>;

function periodPresets() {
  const now = new Date();
  return [
    { label: "This Month",   start: format(startOfMonth(now), "yyyy-MM-dd"), end: format(endOfMonth(now), "yyyy-MM-dd") },
    { label: "Last Month",   start: format(startOfMonth(subMonths(now,1)), "yyyy-MM-dd"), end: format(endOfMonth(subMonths(now,1)), "yyyy-MM-dd") },
    { label: "Last 2 Weeks", start: format(new Date(now.getTime()-14*864e5), "yyyy-MM-dd"), end: format(now, "yyyy-MM-dd") },
    { label: "Last Week",    start: format(new Date(now.getTime()-7*864e5), "yyyy-MM-dd"),  end: format(now, "yyyy-MM-dd") },
  ];
}

// ── Employee Form ─────────────────────────────────────────────────────────────
function EmployeeForm({ employee, onClose }: { employee?: Employee; onClose: () => void }) {
  const { toast } = useToast();
  const isEdit = !!employee;
  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      name: employee?.name || "", email: employee?.email || "", phone: employee?.phone || "",
      hourlyRate: employee?.hourlyRate?.toString() || "", position: employee?.position || "",
      status: (employee?.status as EmployeeFormValues["status"]) || "active",
    },
  });
  const mutation = useMutation({
    mutationFn: async (data: EmployeeFormValues) => {
      const res = await apiRequest(isEdit ? "PATCH" : "POST", isEdit ? `/api/employees/${employee.id}` : "/api/employees", data);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/employees"] }); toast({ title: isEdit ? "Employee updated" : "Employee added" }); onClose(); },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([f, msgs]) => form.setError(f as keyof EmployeeFormValues, { message: Array.isArray(msgs) ? msgs[0] : String(msgs) }));
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><label style={lbl}>Name *</label><FormControl><input {...field} style={inp} placeholder="Full name" data-testid="input-employee-name" /></FormControl><FormMessage /></FormItem>
        )} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem><label style={lbl}>Email</label><FormControl><input {...field} type="email" style={inp} placeholder="email@example.com" data-testid="input-employee-email" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="phone" render={({ field }) => (
            <FormItem><label style={lbl}>Phone</label><FormControl><input {...field} style={inp} placeholder="(555) 123-4567" onChange={e => field.onChange(formatPhone(e.target.value))} data-testid="input-employee-phone" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="hourlyRate" render={({ field }) => (
            <FormItem><label style={lbl}>Hourly rate ($) *</label><FormControl><input {...field} type="text" inputMode="decimal" style={inp} placeholder="38.00" data-testid="input-employee-rate" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="position" render={({ field }) => (
            <FormItem><label style={lbl}>Position</label><FormControl><input {...field} style={inp} placeholder="Painter, Foreman…" data-testid="input-employee-position" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="status" render={({ field }) => (
          <FormItem><label style={lbl}>Status</label>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-employee-status"><SelectValue /></SelectTrigger></FormControl>
              <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
            </Select>
          <FormMessage /></FormItem>
        )} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
          <button type="button" onClick={onClose} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-cancel-employee">Cancel</button>
          <button type="submit" disabled={mutation.isPending} style={{ padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: mutation.isPending ? 0.7 : 1 }} data-testid="button-save-employee">
            {mutation.isPending ? "Saving…" : isEdit ? "Update employee" : "Add employee"}
          </button>
        </div>
      </form>
    </Form>
  );
}

// ── Time Entry Form ───────────────────────────────────────────────────────────
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
      const res = await apiRequest("POST", "/api/time-entries", { ...data, hoursWorked: parseFloat(data.hoursWorked), date: new Date(data.date).toISOString(), jobId: data.jobId || null });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] }); queryClient.invalidateQueries({ queryKey: ["/api/employees"] }); toast({ title: "Time entry added" }); onClose(); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message.replace(/^\d+:\s*/,""), variant: "destructive" }); },
  });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <FormField control={form.control} name="employeeId" render={({ field }) => (
          <FormItem><label style={lbl}>Employee *</label>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl><SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-time-entry-employee"><SelectValue placeholder="Select employee" /></SelectTrigger></FormControl>
              <SelectContent>{employees?.filter(e => e.status === "active").map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
            </Select>
          <FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="jobId" render={({ field }) => (
          <FormItem><label style={lbl}>Job <span style={{ textTransform: "none", fontWeight: 400, color: "#94a3b8" }}>(optional)</span></label>
            <Select value={field.value || "none"} onValueChange={v => field.onChange(v === "none" ? "" : v)}>
              <FormControl><SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-time-entry-job"><SelectValue /></SelectTrigger></FormControl>
              <SelectContent><SelectItem value="none">No job</SelectItem>{jobs?.filter(j => j.status !== "completed").map(j => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}</SelectContent>
            </Select>
          <FormMessage /></FormItem>
        )} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="date" render={({ field }) => (
            <FormItem><label style={lbl}>Date *</label><FormControl><input {...field} type="date" style={inp} data-testid="input-time-entry-date" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="hoursWorked" render={({ field }) => (
            <FormItem><label style={lbl}>Hours worked *</label><FormControl><input {...field} type="number" step="0.25" placeholder="8" style={inp} data-testid="input-time-entry-hours" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem><label style={lbl}>Description</label><FormControl><input {...field} style={inp} placeholder="Work performed" data-testid="input-time-entry-description" /></FormControl></FormItem>
        )} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
          <button type="button" onClick={onClose} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-cancel-time-entry">Cancel</button>
          <button type="submit" disabled={mutation.isPending} style={{ padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: mutation.isPending ? 0.7 : 1 }} data-testid="button-save-time-entry">
            {mutation.isPending ? "Saving…" : "Log hours"}
          </button>
        </div>
      </form>
    </Form>
  );
}

// ── Run Payroll Form ──────────────────────────────────────────────────────────
function RunPayrollForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: employees } = useQuery<EmployeeWithStats[]>({ queryKey: ["/api/employees"] });
  const { data: payrollRecords } = useQuery<PayrollRecordWithEmployee[]>({ queryKey: ["/api/payroll-records"] });
  const activeCount = employees?.filter(e => e.status === "active").length ?? 0;
  const presets = periodPresets();
  const form = useForm<RunPayrollValues>({
    resolver: zodResolver(runPayrollSchema),
    defaultValues: { periodStart: presets[0].start, periodEnd: presets[0].end, deductionRate: "0" },
  });
  const mutation = useMutation({
    mutationFn: async (data: RunPayrollValues) => {
      const res = await apiRequest("POST", "/api/payroll-records/run", { periodStart: data.periodStart, periodEnd: data.periodEnd, deductionRate: parseFloat(data.deductionRate || "0") });
      return res.json();
    },
    onSuccess: (records) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-records"] });
      toast({ title: "Payroll run complete", description: `${records.length} record${records.length !== 1 ? "s" : ""} created.` });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });
  const watchStart = form.watch("periodStart");
  const watchEnd = form.watch("periodEnd");
  const watchDeduction = form.watch("deductionRate");
  const overlapping = (payrollRecords && watchStart && watchEnd)
    ? payrollRecords.filter(r => new Date(r.periodStart) < new Date(watchEnd) && new Date(r.periodEnd) > new Date(watchStart))
      .reduce<{ periodStart: string; periodEnd: string }[]>((acc, r) => {
        if (!acc.some(x => x.periodStart === r.periodStart && x.periodEnd === r.periodEnd)) acc.push({ periodStart: r.periodStart, periodEnd: r.periodEnd });
        return acc;
      }, [])
    : [];
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <label style={{ ...lbl, marginBottom: "8px" }}>Quick period</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {presets.map(p => (
              <button key={p.label} type="button" onClick={() => { form.setValue("periodStart", p.start); form.setValue("periodEnd", p.end); }}
                style={{ padding: "6px 12px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "7px", fontSize: "12.5px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}
                data-testid={`preset-${p.label.toLowerCase().replace(/ /g,"-")}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="periodStart" render={({ field }) => (
            <FormItem><label style={lbl}>Period start *</label><FormControl><input {...field} type="date" style={inp} data-testid="input-payroll-start" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="periodEnd" render={({ field }) => (
            <FormItem><label style={lbl}>Period end *</label><FormControl><input {...field} type="date" style={inp} data-testid="input-payroll-end" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="deductionRate" render={({ field }) => (
          <FormItem>
            <label style={lbl}>Deduction rate <span style={{ textTransform: "none", fontWeight: 400, color: "#94a3b8" }}>% (optional)</span></label>
            <FormControl><input {...field} type="number" step="0.1" min="0" max="100" placeholder="0" style={inp} data-testid="input-deduction-rate" /></FormControl>
            <p style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "4px" }}>Applied uniformly as % of gross pay.</p>
            <FormMessage />
          </FormItem>
        )} />
        {overlapping.length > 0 && (
          <div style={{ display: "flex", gap: "10px", background: "#fefce8", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px" }} data-testid="warning-payroll-overlap">
            <AlertTriangle style={{ width: "16px", height: "16px", flexShrink: 0, color: "#b45309", marginTop: "1px" }} />
            <div style={{ fontSize: "13px", color: "#92400e" }}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Period overlaps an existing run</div>
              {overlapping.map(p => <div key={`${p.periodStart}-${p.periodEnd}`} style={{ fontSize: "12px" }}>{p.periodStart} → {p.periodEnd}</div>)}
              <div style={{ marginTop: "4px", fontSize: "12px" }}>Adjust dates above to enable submission.</div>
            </div>
          </div>
        )}
        {watchStart && watchEnd && (
          <div style={{ background: "var(--track)", borderRadius: "8px", padding: "12px 14px", fontSize: "13px", color: "var(--muted)" }}>
            <div style={{ fontWeight: 600, marginBottom: "4px", color: "var(--fg)" }}>Preview</div>
            <div>{watchStart} → {watchEnd}</div>
            <div>{activeCount} active employee{activeCount !== 1 ? "s" : ""} will get a payroll record.</div>
            {Number(watchDeduction) > 0 && <div>Deduction: {watchDeduction}% of gross.</div>}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <Tooltip open={mutation.isPending ? undefined : false}>
            <TooltipTrigger asChild>
              <span><button type="button" onClick={onClose} disabled={mutation.isPending} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-cancel-run-payroll">Cancel</button></span>
            </TooltipTrigger>
            <TooltipContent>Payroll run in progress — please wait</TooltipContent>
          </Tooltip>
          <Tooltip open={overlapping.length > 0 && !mutation.isPending ? undefined : false}>
            <TooltipTrigger asChild>
              <span>
                <button type="submit" disabled={mutation.isPending || overlapping.length > 0} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: (mutation.isPending || overlapping.length > 0) ? 0.6 : 1 }} data-testid="button-run-payroll-submit">
                  <Play style={{ width: "14px", height: "14px" }} />
                  {mutation.isPending ? "Running…" : "Run payroll"}
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Date overlap detected — adjust dates above</TooltipContent>
          </Tooltip>
        </div>
      </form>
    </Form>
  );
}

// ── Section tab types ─────────────────────────────────────────────────────────
type Section = "payroll" | "employees" | "time";

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Payroll() {
  const [activeSection, setActiveSection] = useState<Section>("payroll");
  const [periodIdx, setPeriodIdx] = useState(0);
  const [isRunPayrollOpen, setIsRunPayrollOpen] = useState(false);
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isTimeEntryDialogOpen, setIsTimeEntryDialogOpen] = useState(false);
  const [deleteTimeEntryId, setDeleteTimeEntryId] = useState<string | null>(null);
  const [empSearch, setEmpSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const { toast } = useToast();

  const { data: employees, isLoading: empLoading } = useQuery<EmployeeWithStats[]>({ queryKey: ["/api/employees"] });
  const { data: timeEntries, isLoading: timeLoading } = useQuery<TimeEntryWithRelations[]>({ queryKey: ["/api/time-entries"] });
  const { data: payrollRecords, isLoading: payrollLoading } = useQuery<PayrollRecordWithEmployee[]>({ queryKey: ["/api/payroll-records"] });

  // ── Period grouping ────────────────────────────────────────────────────────
  const periods = useMemo(() => {
    if (!payrollRecords) return [];
    const seen = new Set<string>();
    const result: { start: string; end: string }[] = [];
    for (const r of payrollRecords) {
      const key = `${r.periodStart}|${r.periodEnd}`;
      if (!seen.has(key)) { seen.add(key); result.push({ start: r.periodStart, end: r.periodEnd }); }
    }
    return result.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }, [payrollRecords]);

  const currentPeriod = periods[periodIdx] ?? null;
  const currentRecords = useMemo(() => {
    if (!currentPeriod || !payrollRecords) return [];
    return payrollRecords.filter(r => r.periodStart === currentPeriod.start && r.periodEnd === currentPeriod.end);
  }, [currentPeriod, payrollRecords]);

  // ── Stats for current period ───────────────────────────────────────────────
  const gross = currentRecords.reduce((s, r) => s + Number(r.grossPay), 0);
  const totalHrs = currentRecords.reduce((s, r) => s + Number(r.hoursWorked), 0);
  const otHrs = currentRecords.reduce((s, r) => s + Math.max(0, Number(r.hoursWorked) - 40), 0);
  const crewCount = currentRecords.length;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/payroll-records/${id}`, { status: "paid" });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payroll-records"] }); toast({ title: "Marked as paid" }); },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteTimeEntryMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/time-entries/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] }); queryClient.invalidateQueries({ queryKey: ["/api/employees"] }); setDeleteTimeEntryId(null); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  // ── Filtered employees ─────────────────────────────────────────────────────
  const filteredEmployees = (employees ?? []).filter(e =>
    e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
    e.email?.toLowerCase().includes(empSearch.toLowerCase()) ||
    e.position?.toLowerCase().includes(empSearch.toLowerCase())
  );

  // ── Filtered time entries ──────────────────────────────────────────────────
  const now = new Date();
  const filteredTimeEntries = (timeEntries ?? []).filter(entry => {
    if (timeFilter === "all") return true;
    const d = new Date(entry.date);
    if (timeFilter === "this_month") return d >= startOfMonth(now) && d <= endOfMonth(now);
    if (timeFilter === "last_month") return d >= startOfMonth(subMonths(now,1)) && d <= endOfMonth(subMonths(now,1));
    if (timeFilter === "last_7") return d >= new Date(now.getTime() - 7*864e5);
    return true;
  });

  // ── Per-row payroll data ───────────────────────────────────────────────────
  const crewRows = currentRecords.map((r, i) => {
    const hrs = Number(r.hoursWorked);
    const reg = Math.min(hrs, 40);
    const ot = Math.max(0, hrs - 40);
    const badge = STATUS_BADGE[r.status ?? "pending"] ?? STATUS_BADGE.pending;
    return {
      ...r,
      reg, ot,
      hoursLabel: ot > 0 ? `${reg} + ${ot} OT` : `${hrs} hrs`,
      barReg: Math.round(reg / 48 * 100),
      barOt: Math.round(ot / 48 * 100),
      badge,
      avBg: `var(${AV_BG[i % 6]})`,
      avFg: `var(${AV_FG[i % 6]})`,
    };
  });

  const SECTION_TABS: { key: Section; label: string }[] = [
    { key: "payroll",   label: "Pay run" },
    { key: "employees", label: "Employees" },
    { key: "time",      label: "Time entries" },
  ];

  const TH: React.CSSProperties = {
    fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em",
    textTransform: "uppercase", color: "var(--faint)",
    padding: "11px 18px", background: "var(--track)",
    borderBottom: "1px solid var(--panel-bd)",
    display: "flex", alignItems: "center",
  };

  return (
    <>
      {/* ── Dialogs ── */}
      <Dialog open={isRunPayrollOpen} onOpenChange={o => { if (!o) setIsRunPayrollOpen(false); }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Run payroll</DialogTitle></DialogHeader>
          <RunPayrollForm onClose={() => setIsRunPayrollOpen(false)} /></DialogContent>
      </Dialog>

      <Dialog open={isEmployeeDialogOpen} onOpenChange={o => { if (!o) { setIsEmployeeDialogOpen(false); setEditingEmployee(null); } }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>{editingEmployee ? "Edit employee" : "Add employee"}</DialogTitle></DialogHeader>
          <EmployeeForm employee={editingEmployee || undefined} onClose={() => { setIsEmployeeDialogOpen(false); setEditingEmployee(null); }} /></DialogContent>
      </Dialog>

      <Dialog open={isTimeEntryDialogOpen} onOpenChange={o => { if (!o) setIsTimeEntryDialogOpen(false); }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Log hours</DialogTitle></DialogHeader>
          <TimeEntryForm onClose={() => setIsTimeEntryDialogOpen(false)} /></DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTimeEntryId} onOpenChange={o => { if (!o) setDeleteTimeEntryId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete time entry?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTimeEntryId && deleteTimeEntryMutation.mutate(deleteTimeEntryId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Page body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px 40px" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>

          {/* ── Title row ── */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-.02em" }}>Payroll</h2>
              <p style={{ margin: "5px 0 0", fontSize: "13.5px", color: "var(--muted)" }}>
                {currentPeriod ? `Pay period · ${periodLabel(currentPeriod.start, currentPeriod.end)}` : "Employees, time tracking, and pay runs"}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {/* Log hours — secondary */}
              <button onClick={() => setIsTimeEntryDialogOpen(true)} style={{ display: "flex", alignItems: "center", gap: "7px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--muted)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-log-hours">
                Log hours
              </button>
              {/* Add employee — secondary */}
              <button onClick={() => { setEditingEmployee(null); setIsEmployeeDialogOpen(true); }} style={{ display: "flex", alignItems: "center", gap: "7px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--muted)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-add-employee">
                <Plus style={{ width: "14px", height: "14px" }} /> Add employee
              </button>
              {/* Period nav — only on payroll tab when periods exist */}
              {activeSection === "payroll" && periods.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "2px", background: "var(--track)", border: "1px solid var(--panel-bd)", borderRadius: "9px", padding: "3px" }}>
                  <button onClick={() => setPeriodIdx(i => Math.min(i + 1, periods.length - 1))} disabled={periodIdx >= periods.length - 1}
                    style={{ border: "none", background: "none", cursor: "pointer", width: "30px", height: "28px", borderRadius: "7px", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", opacity: periodIdx >= periods.length - 1 ? 0.3 : 1 }}>
                    <ChevronLeft style={{ width: "16px", height: "16px" }} />
                  </button>
                  <span style={{ fontSize: "12.5px", fontWeight: 600, padding: "0 8px", color: "var(--fg)", whiteSpace: "nowrap" }}>
                    {currentPeriod ? format(new Date(currentPeriod.start + "T12:00:00"), "MMM d") + " – " + format(new Date(currentPeriod.end + "T12:00:00"), "MMM d") : "—"}
                  </span>
                  <button onClick={() => setPeriodIdx(i => Math.max(i - 1, 0))} disabled={periodIdx <= 0}
                    style={{ border: "none", background: "none", cursor: "pointer", width: "30px", height: "28px", borderRadius: "7px", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", opacity: periodIdx <= 0 ? 0.3 : 1 }}>
                    <ChevronRight style={{ width: "16px", height: "16px" }} />
                  </button>
                </div>
              )}
              {/* Run payroll — primary */}
              <button onClick={() => setIsRunPayrollOpen(true)} style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "9px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(37,99,235,.3)" }} data-testid="button-run-payroll">
                Run payroll
              </button>
            </div>
          </div>

          {/* ── 4-stat strip ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "20px" }}>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Gross this period</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-gross">{payrollLoading ? "—" : fmt(gross)}</div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Total hours</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-hours">{payrollLoading ? "—" : totalHrs.toFixed(0)}</div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Overtime hours</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px", color: payrollLoading ? "var(--faint)" : (otHrs > 0 ? "#b6731a" : "var(--fg)") }} data-testid="stat-ot">{payrollLoading ? "—" : otHrs.toFixed(0)}</div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Crew on payroll</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-crew">{payrollLoading ? "—" : crewCount}</div>
            </div>
          </div>

          {/* ── Section tabs ── */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
            {SECTION_TABS.map(s => {
              const active = activeSection === s.key;
              return (
                <button key={s.key} onClick={() => setActiveSection(s.key)}
                  style={{ display: "inline-flex", alignItems: "center", gap: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 600, padding: "7px 13px", borderRadius: "8px", border: "1px solid " + (active ? "transparent" : "var(--panel-bd)"), background: active ? "var(--jox-primary)" : "var(--panel)", color: active ? "#fff" : "var(--muted)" }}
                  data-testid={`tab-${s.key}`}>
                  {s.label}
                  {s.key === "payroll" && !active && (payrollRecords?.filter(r => r.status === "pending").length ?? 0) > 0 && (
                    <span className="font-mono" style={{ fontSize: "11px", fontWeight: 600, padding: "0 6px", borderRadius: "5px", background: "var(--b-amber-bg)", color: "var(--b-amber-fg)" }}>
                      {payrollRecords!.filter(r => r.status === "pending").length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── PAY RUN TABLE ── */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          {activeSection === "payroll" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ ...TH }}>
                <span style={{ flex: 1, minWidth: 0 }}>Painter</span>
                <span style={{ width: "120px", flexShrink: 0 }}>Rate</span>
                <span style={{ width: "130px", flexShrink: 0 }}>Hours (reg + OT)</span>
                <span style={{ width: "104px", flexShrink: 0, textAlign: "right" }}>Gross</span>
                <span style={{ width: "96px", flexShrink: 0, textAlign: "center" }}>Status</span>
                <span style={{ width: "28px", flexShrink: 0 }}></span>
              </div>

              {payrollLoading && <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>Loading pay records…</div>}

              {!payrollLoading && periods.length === 0 && (
                <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>💰</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>No payroll runs yet</div>
                  <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>Log hours and run payroll to generate pay records.</div>
                  <button onClick={() => setIsRunPayrollOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-run-first-payroll">
                    <Play style={{ width: "14px", height: "14px" }} /> Run payroll
                  </button>
                </div>
              )}

              {!payrollLoading && periods.length > 0 && crewRows.length === 0 && (
                <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>No records for this period.</div>
              )}

              {crewRows.map((r, i) => (
                <div key={r.id} className="rowhover" style={{ display: "flex", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--panel-bd)" }} data-testid={`row-payroll-${r.id}`}>
                  {/* Painter */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", paddingRight: "12px" }}>
                    <div style={{ width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "12px", background: r.avBg, color: r.avFg }}>
                      {initials(r.employee?.name ?? "?")}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.employee?.name ?? "Unknown"}</div>
                      <div style={{ fontSize: "11.5px", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.employee?.position ?? "—"}</div>
                    </div>
                  </div>
                  {/* Rate */}
                  <div style={{ width: "120px", flexShrink: 0, fontSize: "12.5px", color: "var(--muted)" }}>
                    {r.employee?.position ?? "Painter"} · <span className="font-mono">${Number(r.employee?.hourlyRate ?? 0).toFixed(0)}/hr</span>
                  </div>
                  {/* Hours */}
                  <div style={{ width: "130px", flexShrink: 0 }}>
                    <div className="font-mono" style={{ fontSize: "13px", fontWeight: 600 }}>{r.hoursLabel}</div>
                    <div style={{ height: "5px", borderRadius: "3px", background: "var(--track)", overflow: "hidden", marginTop: "4px", width: "96px" }}>
                      <div style={{ width: `${r.barReg}%`, height: "100%", background: "var(--jox-primary)", float: "left" }} />
                      <div style={{ width: `${r.barOt}%`, height: "100%", background: OT_COLOR, float: "left" }} />
                    </div>
                  </div>
                  {/* Gross */}
                  <span className="font-mono" style={{ width: "104px", flexShrink: 0, textAlign: "right", fontSize: "13.5px", fontWeight: 700 }} data-testid={`gross-${r.id}`}>
                    {fmt(r.grossPay)}
                  </span>
                  {/* Status badge */}
                  <span style={{ width: "96px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                    <span style={{ background: r.badge.bg, color: r.badge.fg, fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px", textTransform: "capitalize", whiteSpace: "nowrap" }}>{r.badge.label}</span>
                  </span>
                  {/* Actions */}
                  <span style={{ width: "28px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                    {r.status !== "paid" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px 0", display: "flex", alignItems: "center" }} data-testid={`button-payroll-actions-${r.id}`}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={4}>
                          <DropdownMenuItem onClick={() => markPaidMutation.mutate(r.id)} data-testid={`button-mark-paid-${r.id}`}>
                            <CheckCircle className="h-4 w-4 mr-2 text-green-600" />Mark as paid
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </span>
                </div>
              ))}

              {/* Footer totals */}
              {crewRows.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", padding: "13px 18px", background: "var(--track)", borderTop: "1px solid var(--panel-bd)" }}>
                  <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 700 }}>Total</span>
                  <span style={{ width: "120px", flexShrink: 0 }}></span>
                  <span className="font-mono" style={{ width: "130px", flexShrink: 0, fontSize: "12.5px", color: "var(--muted)" }}>{totalHrs.toFixed(0)} hrs</span>
                  <span className="font-mono" style={{ width: "104px", flexShrink: 0, textAlign: "right", fontSize: "14px", fontWeight: 800 }}>{fmt(gross)}</span>
                  <span style={{ width: "96px", flexShrink: 0 }}></span>
                  <span style={{ width: "28px", flexShrink: 0 }}></span>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── EMPLOYEES TABLE ── */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          {activeSection === "employees" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
              {/* Toolbar */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", borderBottom: "1px solid var(--panel-bd)", background: "var(--track)" }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "7px", background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "6px 11px" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Search employees…" style={{ border: "none", background: "none", outline: "none", fontSize: "12.5px", color: "var(--fg)", fontFamily: "inherit", width: "100%" }} data-testid="input-search-employees" />
                </div>
                <button onClick={() => { setEditingEmployee(null); setIsEmployeeDialogOpen(true); }} style={{ display: "flex", alignItems: "center", gap: "6px", border: "none", background: "var(--jox-primary)", color: "#fff", borderRadius: "8px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-add-employee-tab">
                  <Plus style={{ width: "13px", height: "13px" }} />Add employee
                </button>
              </div>

              {/* Header */}
              <div style={{ ...TH }}>
                <span style={{ flex: 1, minWidth: 0 }}>Employee</span>
                <span style={{ width: "120px", flexShrink: 0 }}>Position</span>
                <span style={{ width: "100px", flexShrink: 0, textAlign: "right" }}>Rate</span>
                <span style={{ width: "88px", flexShrink: 0, textAlign: "right" }}>Hrs (month)</span>
                <span style={{ width: "100px", flexShrink: 0, textAlign: "right" }}>Month pay</span>
                <span style={{ width: "88px", flexShrink: 0, textAlign: "center" }}>Status</span>
                <span style={{ width: "28px", flexShrink: 0 }}></span>
              </div>

              {empLoading && <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>Loading employees…</div>}

              {!empLoading && filteredEmployees.length === 0 && (
                <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>👷</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>{empSearch ? "No employees found" : "No employees yet"}</div>
                  <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>{empSearch ? `No results for "${empSearch}"` : "Add your first employee to get started."}</div>
                  {!empSearch && <button onClick={() => setIsEmployeeDialogOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-add-first-employee"><Plus style={{ width: "15px", height: "15px" }} />Add employee</button>}
                </div>
              )}

              {filteredEmployees.map((emp, i) => {
                const active = emp.status === "active";
                const avBg = `var(${AV_BG[i % 6]})`;
                const avFg = `var(${AV_FG[i % 6]})`;
                return (
                  <div key={emp.id} className="rowhover" style={{ display: "flex", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--panel-bd)" }} data-testid={`row-employee-${emp.id}`}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", paddingRight: "12px" }}>
                      <div style={{ width: "34px", height: "34px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "11.5px", background: avBg, color: avFg }}>
                        {initials(emp.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 600, display: "flex", alignItems: "center", gap: "7px" }}>
                          {emp.name}
                          {!emp.phone && active && (
                            <span title="No phone — can't log hours by SMS" style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: "var(--b-amber-bg)", color: "var(--b-amber-fg)", fontSize: "10.5px", fontWeight: 600, padding: "1px 7px", borderRadius: "5px" }} data-testid={`badge-no-phone-${emp.id}`}>
                              <PhoneOff style={{ width: "10px", height: "10px" }} />No phone
                            </span>
                          )}
                        </div>
                        {emp.email && <div style={{ fontSize: "11.5px", color: "var(--faint)" }}>{emp.email}</div>}
                      </div>
                    </div>
                    <span style={{ width: "120px", flexShrink: 0, fontSize: "12.5px", color: "var(--muted)" }}>{emp.position || "—"}</span>
                    <span className="font-mono" style={{ width: "100px", flexShrink: 0, textAlign: "right", fontSize: "12.5px" }}>{fmtFull(emp.hourlyRate)}/hr</span>
                    <span className="font-mono" style={{ width: "88px", flexShrink: 0, textAlign: "right", fontSize: "12.5px", color: "var(--muted)" }}>{(emp.hoursThisPeriod || 0).toFixed(1)} hrs</span>
                    <span className="font-mono" style={{ width: "100px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600 }}>{fmtFull(emp.totalPay || 0)}</span>
                    <span style={{ width: "88px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      <span style={{ background: active ? "var(--b-green-bg)" : "var(--b-gray-bg)", color: active ? "var(--b-green-fg)" : "var(--b-gray-fg)", fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px", textTransform: "capitalize", whiteSpace: "nowrap" }}>
                        {emp.status}
                      </span>
                    </span>
                    <span style={{ width: "28px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px 0", display: "flex", alignItems: "center" }} data-testid={`button-employee-actions-${emp.id}`}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={4}>
                          <DropdownMenuItem onClick={() => { setEditingEmployee(emp); setIsEmployeeDialogOpen(true); }} data-testid={`button-edit-employee-${emp.id}`}>
                            <Edit className="h-4 w-4 mr-2" />Edit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </div>
                );
              })}

              {!empLoading && filteredEmployees.length > 0 && (
                <div style={{ padding: "12px 18px", fontSize: "12.5px", color: "var(--faint)" }}>
                  {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? "s" : ""} · {filteredEmployees.filter(e => e.status === "active").length} active
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── TIME ENTRIES TABLE ── */}
          {/* ══════════════════════════════════════════════════════════════════ */}
          {activeSection === "time" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
              {/* Toolbar */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 18px", borderBottom: "1px solid var(--panel-bd)", background: "var(--track)", flexWrap: "wrap" }}>
                {(["all","this_month","last_month","last_7"] as const).map(f => {
                  const labels: Record<string, string> = { all: "All time", this_month: "This month", last_month: "Last month", last_7: "Last 7 days" };
                  const active = timeFilter === f;
                  return (
                    <button key={f} onClick={() => setTimeFilter(f)} style={{ border: "1px solid " + (active ? "transparent" : "var(--panel-bd)"), background: active ? "var(--jox-primary)" : "var(--panel)", color: active ? "#fff" : "var(--muted)", borderRadius: "7px", padding: "5px 12px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} data-testid={`filter-time-${f}`}>
                      {labels[f]}
                    </button>
                  );
                })}
                <button onClick={() => setIsTimeEntryDialogOpen(true)} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", border: "none", background: "var(--jox-primary)", color: "#fff", borderRadius: "8px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-log-hours-tab">
                  <Plus style={{ width: "13px", height: "13px" }} />Log hours
                </button>
              </div>

              {/* Header */}
              <div style={{ ...TH }}>
                <span style={{ width: "96px", flexShrink: 0 }}>Date</span>
                <span style={{ width: "160px", flexShrink: 0 }}>Employee</span>
                <span style={{ flex: 1, minWidth: 0 }}>Job</span>
                <span style={{ width: "80px", flexShrink: 0, textAlign: "right" }}>Hours</span>
                <span style={{ width: "96px", flexShrink: 0, textAlign: "right" }}>Pay</span>
                <span style={{ width: "180px", flexShrink: 0 }}>Description</span>
                <span style={{ width: "32px", flexShrink: 0 }}></span>
              </div>

              {timeLoading && <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>Loading time entries…</div>}

              {!timeLoading && filteredTimeEntries.length === 0 && (
                <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>⏱️</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>No time entries</div>
                  <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>{timeFilter !== "all" ? "Try a different period." : "Start logging hours to track employee work."}</div>
                  {timeFilter === "all" && <button onClick={() => setIsTimeEntryDialogOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-log-first-hours"><Plus style={{ width: "15px", height: "15px" }} />Log hours</button>}
                </div>
              )}

              {filteredTimeEntries.map(entry => {
                const pay = entry.employee?.hourlyRate ? Number(entry.hoursWorked) * Number(entry.employee.hourlyRate) : null;
                return (
                  <div key={entry.id} className="rowhover" style={{ display: "flex", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--panel-bd)" }} data-testid={`row-time-${entry.id}`}>
                    <span className="font-mono" style={{ width: "96px", flexShrink: 0, fontSize: "12px", color: "var(--muted)" }}>
                      {format(new Date(entry.date), "MMM d")}
                    </span>
                    <span style={{ width: "160px", flexShrink: 0, fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "8px" }}>
                      {entry.employee?.name ?? "—"}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "8px" }}>
                      {entry.job?.title ?? "—"}
                    </span>
                    <span className="font-mono" style={{ width: "80px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600 }}>
                      {Number(entry.hoursWorked).toFixed(1)} hrs
                    </span>
                    <span className="font-mono" style={{ width: "96px", flexShrink: 0, textAlign: "right", fontSize: "12.5px", color: "var(--muted)" }}>
                      {pay !== null ? fmt(pay) : "—"}
                    </span>
                    <span style={{ width: "180px", flexShrink: 0, fontSize: "12px", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingLeft: "8px" }}>
                      {entry.description || "—"}
                    </span>
                    <span style={{ width: "32px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={() => setDeleteTimeEntryId(entry.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px", display: "flex", alignItems: "center" }} data-testid={`button-delete-entry-${entry.id}`}>
                        <Trash2 style={{ width: "14px", height: "14px" }} />
                      </button>
                    </span>
                  </div>
                );
              })}

              {!timeLoading && filteredTimeEntries.length > 0 && (
                <div style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>{filteredTimeEntries.length} entries</span>
                  <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                    Total: <span className="font-mono" style={{ fontWeight: 600, color: "var(--fg)" }}>{filteredTimeEntries.reduce((s,e) => s + Number(e.hoursWorked), 0).toFixed(1)} hrs</span>
                  </span>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
