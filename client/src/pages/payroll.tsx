import { useState, useMemo, useRef, useEffect } from "react";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { Plus, Play, AlertTriangle, PhoneOff, Edit, Trash2, CheckCircle, ChevronLeft, ChevronRight, FileText, X, Settings2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { Employee, TimeEntry, PayrollRecord, Job } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface EmployeeDeduction {
  id: string; employeeId: string; label: string; deductionType: string;
  amount: string; category: string; active: boolean; createdAt: string;
}
interface PayrollSettings { id: string; payFrequency: string; updatedAt: string; }
interface EmployeeWithStats extends Employee { hoursThisPeriod: number; totalPay: number; deductionsCount?: number; }
interface TimeEntryWithRelations extends TimeEntry { employee: Employee; job?: Job; }
interface PayrollRecordWithEmployee {
  id: string; employeeId: string; status: string; createdAt: string | Date;
  periodStart: string | Date; periodEnd: string | Date;
  totalHours: string; dayRate: string; grossPay: string; deductions: string; netPay: string;
  regularHours: string | null; overtimeHours: string | null;
  regularPay: string | null; overtimePay: string | null;
  taxWithheld: string | null; deductionsBreakdown: { label: string; amount: number; category: string }[] | null;
  paidDate?: string | Date | null;
  employee: Employee;
}

// ── Design helpers ─────────────────────────────────────────────────────────────
const AV_BG = ["--av1","--av2","--av3","--av4","--av5","--av6"];
const AV_FG = ["--av1f","--av2f","--av3f","--av4f","--av5f","--av6f"];
const OT_COLOR = "#e0a020";

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  paid:     { bg: "var(--b-green-bg)", fg: "var(--b-green-fg)", label: "Paid" },
  approved: { bg: "var(--b-amber-bg)", fg: "var(--b-amber-fg)", label: "Approved" },
  pending:  { bg: "var(--b-gray-bg)",  fg: "var(--b-gray-fg)",  label: "Pending" },
};

const DEDUCTION_CATEGORIES: { value: string; label: string }[] = [
  { value: "health",      label: "Health Insurance" },
  { value: "dental",      label: "Dental" },
  { value: "vision",      label: "Vision" },
  { value: "retirement",  label: "Retirement (401k)" },
  { value: "garnishment", label: "Wage Garnishment" },
  { value: "other",       label: "Other" },
];

const PAY_FREQUENCY_LABELS: Record<string,string> = {
  weekly: "Weekly", biweekly: "Bi-weekly", semimonthly: "Semi-monthly", monthly: "Monthly",
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
function toDateStr(d: string | Date | null | undefined): string {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}
function periodLabel(start: string | Date, end: string | Date) {
  try {
    const s = new Date(toDateStr(start) + "T12:00:00");
    const e = new Date(toDateStr(end) + "T12:00:00");
    return format(s, "MMM d") + " – " + format(e, "MMM d, yyyy");
  } catch { return `${toDateStr(start)} – ${toDateStr(end)}`; }
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
  firstName: z.string().min(1, "First name is required"),
  middleName: z.string().optional(),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  dayRate: z.string().min(1, "Rate is required")
    .refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Must be a positive number"),
  annualSalary: z.string().optional(),
  position: z.string().optional(),
  status: z.enum(["active", "inactive"]),
  employmentType: z.enum(["w2", "1099"]),
  payType: z.enum(["hourly", "salary", "day"]),
  filingStatus: z.enum(["single", "married", "head_of_household"]),
  taxAllowances: z.string().optional(),
  stateCode: z.string().optional(),
  taxpayerIdNumber: z.string().optional(),
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

/** Returns the most recent complete period dates for a given pay frequency. */
function getFrequencyPeriod(freq: string): { start: string; end: string } {
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  if (freq === "weekly") {
    const day = now.getUTCDay(); // 0=Sun
    const lastSun = new Date(now); lastSun.setUTCDate(now.getUTCDate() - (day === 0 ? 7 : day));
    const lastMon = new Date(lastSun); lastMon.setUTCDate(lastSun.getUTCDate() - 6);
    return { start: format(lastMon, "yyyy-MM-dd"), end: format(lastSun, "yyyy-MM-dd") };
  }
  if (freq === "biweekly") {
    const day = now.getUTCDay();
    const lastSun = new Date(now); lastSun.setUTCDate(now.getUTCDate() - (day === 0 ? 7 : day));
    const twoWeekMon = new Date(lastSun); twoWeekMon.setUTCDate(lastSun.getUTCDate() - 13);
    return { start: format(twoWeekMon, "yyyy-MM-dd"), end: format(lastSun, "yyyy-MM-dd") };
  }
  if (freq === "semimonthly") {
    const d = now.getUTCDate();
    if (d >= 16) {
      // Return first half of this month
      return { start: format(startOfMonth(now), "yyyy-MM-dd"), end: `${format(now, "yyyy-MM")}-15` };
    }
    // Return second half of last month
    const lastMo = subMonths(now, 1);
    return { start: `${format(lastMo, "yyyy-MM")}-16`, end: format(endOfMonth(lastMo), "yyyy-MM-dd") };
  }
  // monthly — last full month
  return {
    start: format(startOfMonth(subMonths(now,1)), "yyyy-MM-dd"),
    end: format(endOfMonth(subMonths(now,1)), "yyyy-MM-dd"),
  };
}

// ── Deductions section (used inside employee form) ────────────────────────────
function DeductionsSection({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("fixed");
  const [newAmount, setNewAmount] = useState("");
  const [newCategory, setNewCategory] = useState("other");

  const { data: deductions = [] } = useQuery<EmployeeDeduction[]>({
    queryKey: [`/api/employees/${employeeId}/deductions`],
    enabled: !!employeeId,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/employees/${employeeId}/deductions`, {
        label: newLabel, deductionType: newType, amount: parseFloat(newAmount), category: newCategory,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}/deductions`] });
      setAdding(false); setNewLabel(""); setNewAmount(""); setNewType("fixed"); setNewCategory("other");
      toast({ title: "Deduction added" });
    },
    onError: () => toast({ title: "Failed to add deduction", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/employees/${employeeId}/deductions/${id}`, { active });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}/deductions`] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/employees/${employeeId}/deductions/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}/deductions`] });
      toast({ title: "Deduction removed" });
    },
  });

  return (
    <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "14px", marginTop: "4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ ...lbl, margin: 0 }}>Recurring Deductions</span>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)}
            style={{ fontSize: "11.5px", fontWeight: 700, color: "#2563eb", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
            data-testid="button-add-deduction">
            <Plus style={{ width: "12px", height: "12px" }} /> Add
          </button>
        )}
      </div>

      {deductions.length === 0 && !adding && (
        <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>No deductions — health, 401k, garnishments, etc.</p>
      )}

      {deductions.map(d => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }} data-testid={`row-deduction-${d.id}`}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: d.active ? "#0f172a" : "#94a3b8" }}>{d.label}</span>
            <span style={{ marginLeft: "8px", fontSize: "11.5px", color: "#64748b" }}>
              {d.deductionType === "percent" ? `${d.amount}%` : fmtFull(d.amount)} · {DEDUCTION_CATEGORIES.find(c => c.value === d.category)?.label ?? d.category}
            </span>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
            <input type="checkbox" checked={d.active} onChange={e => toggleMutation.mutate({ id: d.id, active: e.target.checked })} style={{ cursor: "pointer" }} data-testid={`toggle-deduction-${d.id}`} />
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>{d.active ? "Active" : "Off"}</span>
          </label>
          <button type="button" onClick={() => deleteMutation.mutate(d.id)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: "2px", display: "flex" }} data-testid={`button-delete-deduction-${d.id}`}>
            <X style={{ width: "14px", height: "14px" }} />
          </button>
        </div>
      ))}

      {adding && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px", marginTop: "8px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <label style={lbl}>Label *</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Health insurance" style={{ ...inp, fontSize: "12.5px" }} data-testid="input-deduction-label" />
            </div>
            <div>
              <label style={lbl}>Category</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)} style={{ ...inp, fontSize: "12.5px" }} data-testid="select-deduction-category">
                {DEDUCTION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <label style={lbl}>Type</label>
              <select value={newType} onChange={e => setNewType(e.target.value)} style={{ ...inp, fontSize: "12.5px" }} data-testid="select-deduction-type">
                <option value="fixed">Fixed ($)</option>
                <option value="percent">Percent (%)</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Amount *</label>
              <input value={newAmount} onChange={e => setNewAmount(e.target.value)} type="number" step="0.01" placeholder={newType === "percent" ? "5" : "150"} style={{ ...inp, fontSize: "12.5px" }} data-testid="input-deduction-amount" />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
            <button type="button" onClick={() => setAdding(false)} style={{ padding: "7px 13px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "7px", fontSize: "12.5px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button type="button" disabled={!newLabel || !newAmount || addMutation.isPending} onClick={() => addMutation.mutate()}
              style={{ padding: "7px 13px", border: "none", background: "#2563eb", borderRadius: "7px", fontSize: "12.5px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: (!newLabel || !newAmount) ? 0.5 : 1 }}
              data-testid="button-save-deduction">
              {addMutation.isPending ? "Saving…" : "Add deduction"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Employee Form ─────────────────────────────────────────────────────────────
function EmployeeForm({ employee, onClose }: { employee?: EmployeeWithStats; onClose: () => void }) {
  const { toast } = useToast();
  const isEdit = !!employee;
  // Split stored full name into parts for editing
  const nameParts = employee?.name?.trim().split(/\s+/) ?? [];
  const defaultFirst = nameParts[0] ?? "";
  const defaultLast = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
  const defaultMiddle = nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "";

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      firstName: defaultFirst,
      middleName: defaultMiddle,
      lastName: defaultLast,
      email: employee?.email || "",
      phone: employee?.phone || "",
      dayRate: employee?.dayRate?.toString() || "",
      annualSalary: (employee as any)?.annualSalary?.toString() || "",
      position: employee?.position || "",
      status: (employee?.status as EmployeeFormValues["status"]) || "active",
      employmentType: ((employee as any)?.employmentType as EmployeeFormValues["employmentType"]) || "w2",
      payType: ((employee as any)?.payType as EmployeeFormValues["payType"]) || "hourly",
      filingStatus: ((employee as any)?.filingStatus as EmployeeFormValues["filingStatus"]) || "single",
      taxAllowances: (employee as any)?.taxAllowances?.toString() || "0",
      stateCode: (employee as any)?.stateCode || "NY",
      taxpayerIdNumber: (employee as any)?.taxpayerIdNumber || "",
    },
  });
  const watchPayType = form.watch("payType");
  const watchEmpType = form.watch("employmentType");

  const mutation = useMutation({
    mutationFn: async (data: EmployeeFormValues) => {
      const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(" ");
      const payload = {
        ...data,
        name: fullName,
        taxAllowances: parseInt(data.taxAllowances || "0"),
        annualSalary: data.annualSalary ? String(parseFloat(data.annualSalary)) : null,
      };
      const res = await apiRequest(isEdit ? "PATCH" : "POST", isEdit ? `/api/employees/${employee.id}` : "/api/employees", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: isEdit ? "Employee updated" : "Employee added" });
      if (!isEdit) onClose();
    },
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
        {/* Basic info */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="firstName" render={({ field }) => (
            <FormItem><label style={lbl}>First name *</label><FormControl><input {...field} style={inp} placeholder="Jane" data-testid="input-employee-first-name" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="middleName" render={({ field }) => (
            <FormItem><label style={lbl}>Middle name</label><FormControl><input {...field} style={inp} placeholder="(optional)" data-testid="input-employee-middle-name" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="lastName" render={({ field }) => (
            <FormItem><label style={lbl}>Last name *</label><FormControl><input {...field} style={inp} placeholder="Smith" data-testid="input-employee-last-name" /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="taxpayerIdNumber" render={({ field }) => (
          <FormItem><label style={lbl}>Taxpayer ID / SSN</label><FormControl><input {...field} style={inp} placeholder="XXX-XX-XXXX" data-testid="input-employee-taxpayer-id" /></FormControl><FormMessage /></FormItem>
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
          <FormField control={form.control} name="position" render={({ field }) => (
            <FormItem><label style={lbl}>Position</label><FormControl><input {...field} style={inp} placeholder="Painter, Foreman…" data-testid="input-employee-position" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="status" render={({ field }) => (
            <FormItem><label style={lbl}>Status</label>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-employee-status"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            <FormMessage /></FormItem>
          )} />
        </div>

        {/* Employment classification */}
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "9px", padding: "12px 14px" }}>
          <p style={{ ...lbl, marginBottom: "10px", color: "#334155" }}>Employment Classification</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <FormField control={form.control} name="employmentType" render={({ field }) => (
              <FormItem><label style={lbl}>Type</label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-employment-type"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="w2">W-2 Employee</SelectItem>
                    <SelectItem value="1099">1099 Contractor</SelectItem>
                  </SelectContent>
                </Select>
              <FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="payType" render={({ field }) => (
              <FormItem><label style={lbl}>Pay basis</label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-pay-type"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="salary">Salary</SelectItem>
                    <SelectItem value="day">Day rate</SelectItem>
                  </SelectContent>
                </Select>
              <FormMessage /></FormItem>
            )} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
            <FormField control={form.control} name="dayRate" render={({ field }) => (
              <FormItem>
                <label style={lbl}>{watchPayType === "salary" ? "Daily (for time tracking)" : "Day rate ($) *"}</label>
                <FormControl><input {...field} type="text" inputMode="decimal" style={inp} placeholder="38.00" data-testid="input-employee-rate" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {watchPayType === "salary" && (
              <FormField control={form.control} name="annualSalary" render={({ field }) => (
                <FormItem><label style={lbl}>Annual salary ($) *</label>
                  <FormControl><input {...field} type="text" inputMode="decimal" style={inp} placeholder="65000" data-testid="input-employee-salary" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}
          </div>
        </div>

        {/* Tax withholding (W-2 only) */}
        {watchEmpType === "w2" && (
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "9px", padding: "12px 14px" }}>
            <p style={{ ...lbl, marginBottom: "10px", color: "#334155" }}>Tax Withholding (Federal + State)</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: "12px" }}>
              <FormField control={form.control} name="filingStatus" render={({ field }) => (
                <FormItem><label style={lbl}>Filing status</label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-filing-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="single">Single</SelectItem>
                      <SelectItem value="married">Married</SelectItem>
                      <SelectItem value="head_of_household">Head of Household</SelectItem>
                    </SelectContent>
                  </Select>
                <FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="stateCode" render={({ field }) => (
                <FormItem><label style={lbl}>State</label>
                  <FormControl><input {...field} style={inp} placeholder="CA" maxLength={2} onChange={e => field.onChange(e.target.value.toUpperCase())} data-testid="input-state-code" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="taxAllowances" render={({ field }) => (
                <FormItem><label style={lbl}>Allowances</label>
                  <FormControl><input {...field} type="number" min="0" max="20" style={inp} placeholder="0" data-testid="input-tax-allowances" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "6px" }}>
              Uses 2024 federal brackets + state rate. 1099 contractors handle their own taxes.
            </p>
          </div>
        )}
        {watchEmpType === "1099" && (
          <div style={{ display: "flex", gap: "8px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "10px 12px" }}>
            <AlertTriangle style={{ width: "14px", height: "14px", color: "#b45309", flexShrink: 0, marginTop: "1px" }} />
            <p style={{ fontSize: "12px", color: "#92400e", margin: 0 }}>1099 contractors — no tax is withheld. They receive gross pay minus deductions.</p>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
          <button type="button" onClick={onClose} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-cancel-employee">Cancel</button>
          <button type="submit" disabled={mutation.isPending} style={{ padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: mutation.isPending ? 0.7 : 1 }} data-testid="button-save-employee">
            {mutation.isPending ? "Saving…" : isEdit ? "Update employee" : "Add employee"}
          </button>
        </div>

        {/* Deductions — only shown in edit mode */}
        {isEdit && employee?.id && (
          <DeductionsSection employeeId={employee.id} />
        )}
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
  const { data: payrollSettings } = useQuery<PayrollSettings>({ queryKey: ["/api/payroll-settings"] });
  const activeCount = employees?.filter(e => e.status === "active").length ?? 0;
  const w2Count = employees?.filter(e => e.status === "active" && (e as any).employmentType !== "1099").length ?? 0;
  const presets = periodPresets();

  // Derive smart defaults from saved pay frequency; fall back to "This Month"
  const freqPeriod = payrollSettings
    ? getFrequencyPeriod(payrollSettings.payFrequency)
    : presets[0];

  const form = useForm<RunPayrollValues>({
    resolver: zodResolver(runPayrollSchema),
    defaultValues: { periodStart: presets[0].start, periodEnd: presets[0].end },
  });

  // When settings load async, reset to the frequency-driven period
  useEffect(() => {
    if (payrollSettings) {
      const p = getFrequencyPeriod(payrollSettings.payFrequency);
      form.reset({ periodStart: p.start, periodEnd: p.end });
    }
  }, [payrollSettings]);
  const mutation = useMutation({
    mutationFn: async (data: RunPayrollValues) => {
      const res = await apiRequest("POST", "/api/payroll-records/run", { periodStart: data.periodStart, periodEnd: data.periodEnd });
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
  const overlapping = (payrollRecords && watchStart && watchEnd)
    ? payrollRecords.filter(r => new Date(toDateStr(r.periodStart)) < new Date(watchEnd) && new Date(toDateStr(r.periodEnd)) > new Date(watchStart))
      .reduce<{ periodStart: string; periodEnd: string }[]>((acc, r) => {
        const ps = toDateStr(r.periodStart); const pe = toDateStr(r.periodEnd);
        if (!acc.some(x => x.periodStart === ps && x.periodEnd === pe)) acc.push({ periodStart: ps, periodEnd: pe });
        return acc;
      }, [])
    : [];
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {payrollSettings && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "10px 12px", fontSize: "12.5px", color: "#0369a1" }}>
            Pay schedule: <strong>{PAY_FREQUENCY_LABELS[payrollSettings.payFrequency]}</strong> — change in Settings tab.
          </div>
        )}
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
            <div>{activeCount} active employee{activeCount !== 1 ? "s" : ""} will get pay records.</div>
            {w2Count > 0 && <div>{w2Count} W-2 employees will have federal + state tax withheld automatically.</div>}
            <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748b" }}>OT calculated per work week (Mon–Sun). Recurring deductions applied per employee.</div>
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

// ── Pay Stub Dialog ───────────────────────────────────────────────────────────
function PayStubDialog({ record, onClose }: { record: PayrollRecordWithEmployee; onClose: () => void }) {
  const { data: appSettings } = useQuery<{ companyName?: string }>({ queryKey: ["/api/settings"] });
  const companyName = appSettings?.companyName || "JobsOxo";
  const emp = record.employee;
  const gross = Number(record.grossPay);
  const regPay = Number(record.regularPay ?? 0);
  const otPay = Number(record.overtimePay ?? 0);
  const taxWithheld = Number(record.taxWithheld ?? 0);
  const deductions = Number(record.deductions ?? 0);
  const net = Number(record.netPay);
  const regHrs = Number(record.regularHours ?? record.totalHours);
  const otHrs = Number(record.overtimeHours ?? 0);
  const breakdown = (record.deductionsBreakdown ?? []) as { label: string; amount: number; category: string }[];
  const is1099 = (emp as any).employmentType === "1099";
  const [isPrinting, setIsPrinting] = useState(false);
  const stubRef = useRef<HTMLDivElement | null>(null);

  async function downloadPdf() {
    const el = stubRef.current;
    if (!el) return;
    setIsPrinting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`paystub-${emp.name.replace(/\s+/g,"-").toLowerCase()}-${toDateStr(record.periodStart)}.pdf`);
    } catch (e) {
      console.error("PDF error", e);
    } finally {
      setIsPrinting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {/* Printable content area */}
      <div ref={stubRef} style={{ background: "#ffffff" }}>
      {/* Company header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", paddingBottom: "12px", borderBottom: "2px solid #0f172a" }}>
        <div>
          <div style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>{companyName}</div>
          <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".04em" }}>Pay Stub</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "12px", color: "#64748b" }}>Pay period</div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{toDateStr(record.periodStart)} – {toDateStr(record.periodEnd)}</div>
        </div>
      </div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
        <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "var(--av1)", color: "var(--av1f)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "14px", flexShrink: 0 }}>
          {initials(emp.name)}
        </div>
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700 }}>{emp.name}</div>
          <div style={{ fontSize: "12.5px", color: "var(--muted)" }}>
            {(emp as any).position ?? "Employee"} · {is1099 ? "1099 Contractor" : "W-2 Employee"}
          </div>
        </div>
      </div>

      {/* Earnings */}
      <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)", marginBottom: "6px" }}>Earnings</div>
      <div style={{ background: "var(--track)", borderRadius: "8px", overflow: "hidden", marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", fontSize: "13px" }}>
          <span>Regular pay ({regHrs.toFixed(1)} hrs × ${Number(record.dayRate).toFixed(2)}/day)</span>
          <span className="font-mono" style={{ fontWeight: 600 }}>{fmtFull(regPay)}</span>
        </div>
        {otHrs > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", fontSize: "13px", borderTop: "1px solid var(--panel-bd)" }}>
            <span style={{ color: OT_COLOR, fontWeight: 600 }}>Overtime ({otHrs.toFixed(1)} hrs × 1.5×)</span>
            <span className="font-mono" style={{ fontWeight: 600, color: OT_COLOR }}>{fmtFull(otPay)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", fontSize: "13.5px", fontWeight: 700, borderTop: "1px solid var(--panel-bd)", background: "var(--panel)" }}>
          <span>Gross pay</span>
          <span className="font-mono">{fmtFull(gross)}</span>
        </div>
      </div>

      {/* Tax withholding */}
      {!is1099 && taxWithheld > 0 && (
        <>
          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)", marginBottom: "6px" }}>Tax Withholding</div>
          <div style={{ background: "var(--track)", borderRadius: "8px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", fontSize: "13px" }}>
              <span>Federal + State income tax</span>
              <span className="font-mono" style={{ color: "#dc2626" }}>({fmtFull(taxWithheld)})</span>
            </div>
          </div>
        </>
      )}

      {/* Deductions */}
      {breakdown.length > 0 && (
        <>
          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--faint)", marginBottom: "6px" }}>Deductions</div>
          <div style={{ background: "var(--track)", borderRadius: "8px", overflow: "hidden", marginBottom: "12px" }}>
            {breakdown.map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", fontSize: "13px", borderTop: i > 0 ? "1px solid var(--panel-bd)" : "none" }}>
                <span>{d.label}</span>
                <span className="font-mono" style={{ color: "#dc2626" }}>({fmtFull(d.amount)})</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Net pay */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "9px", marginBottom: "16px" }}>
        <span style={{ fontSize: "14px", fontWeight: 700, color: "#15803d" }}>Net pay</span>
        <span className="font-mono" style={{ fontSize: "20px", fontWeight: 800, color: "#15803d" }}>{fmtFull(net)}</span>
      </div>
      </div>{/* end stubRef */}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
        <button type="button" onClick={onClose} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-close-paystub">Close</button>
        <button type="button" onClick={downloadPdf} disabled={isPrinting} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 16px", border: "none", background: "#0f172a", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: isPrinting ? 0.7 : 1 }} data-testid="button-print-paystub">
          <FileText style={{ width: "14px", height: "14px" }} /> {isPrinting ? "Generating…" : "Download PDF"}
        </button>
      </div>
    </div>
  );
}

// ── Pay Settings Panel ────────────────────────────────────────────────────────
function PaySettings() {
  const { toast } = useToast();
  const { data: ps } = useQuery<PayrollSettings>({ queryKey: ["/api/payroll-settings"] });
  const [freq, setFreq] = useState<string | null>(null);
  const currentFreq = freq ?? ps?.payFrequency ?? "biweekly";

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/payroll-settings", { payFrequency: currentFreq });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-settings"] });
      toast({ title: "Pay schedule saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", padding: "24px", maxWidth: "520px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
        <Settings2 style={{ width: "18px", height: "18px", color: "var(--jox-primary)" }} />
        <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>Pay Schedule</h3>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label style={lbl}>Pay frequency</label>
        <select value={currentFreq} onChange={e => setFreq(e.target.value)}
          style={{ ...inp, maxWidth: "280px" }} data-testid="select-pay-frequency">
          <option value="weekly">Weekly (every week)</option>
          <option value="biweekly">Bi-weekly (every 2 weeks)</option>
          <option value="semimonthly">Semi-monthly (1st & 15th)</option>
          <option value="monthly">Monthly</option>
        </select>
        <p style={{ fontSize: "12px", color: "#94a3b8", marginTop: "6px" }}>
          This is informational and controls the default period in Run Payroll. Tax withholding is always calculated from the actual period dates.
        </p>
      </div>

      <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}
        style={{ padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: mutation.isPending ? 0.7 : 1 }}
        data-testid="button-save-pay-settings">
        {mutation.isPending ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}

// ── Section tab types ─────────────────────────────────────────────────────────
type Section = "payroll" | "employees" | "time" | "settings";

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Payroll() {
  const [activeSection, setActiveSection] = useState<Section>("payroll");
  const [periodIdx, setPeriodIdx] = useState(0);
  const [isRunPayrollOpen, setIsRunPayrollOpen] = useState(false);
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeWithStats | null>(null);
  const [isTimeEntryDialogOpen, setIsTimeEntryDialogOpen] = useState(false);
  const [deleteTimeEntryId, setDeleteTimeEntryId] = useState<string | null>(null);
  const [empSearch, setEmpSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const [payStubRecord, setPayStubRecord] = useState<PayrollRecordWithEmployee | null>(null);
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
      const ps = toDateStr(r.periodStart); const pe = toDateStr(r.periodEnd);
      const key = `${ps}|${pe}`;
      if (!seen.has(key)) { seen.add(key); result.push({ start: ps, end: pe }); }
    }
    return result.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
  }, [payrollRecords]);

  const currentPeriod = periods[periodIdx] ?? null;
  const currentRecords = useMemo(() => {
    if (!currentPeriod || !payrollRecords) return [];
    return payrollRecords.filter(r => toDateStr(r.periodStart) === currentPeriod.start && toDateStr(r.periodEnd) === currentPeriod.end);
  }, [currentPeriod, payrollRecords]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const gross = currentRecords.reduce((s, r) => s + Number(r.grossPay), 0);
  const netTotal = currentRecords.reduce((s, r) => s + Number(r.netPay), 0);
  const totalHrs = currentRecords.reduce((s, r) => s + Number(r.totalHours), 0);
  const otHrs = currentRecords.reduce((s, r) => s + Number(r.overtimeHours ?? 0), 0);
  const taxTotal = currentRecords.reduce((s, r) => s + Number(r.taxWithheld ?? 0), 0);
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
    const hrs = Number(r.totalHours);
    const reg = Number(r.regularHours ?? Math.min(hrs, 40));
    const ot = Number(r.overtimeHours ?? Math.max(0, hrs - 40));
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
    { key: "settings",  label: "Settings" },
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
        <DialogContent className="max-w-lg" style={{ maxHeight: "90vh", overflowY: "auto" }}>
          <DialogHeader><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>{editingEmployee ? "Edit employee" : "Add employee"}</DialogTitle></DialogHeader>
          <EmployeeForm employee={editingEmployee || undefined} onClose={() => { setIsEmployeeDialogOpen(false); setEditingEmployee(null); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={isTimeEntryDialogOpen} onOpenChange={o => { if (!o) setIsTimeEntryDialogOpen(false); }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Log hours</DialogTitle></DialogHeader>
          <TimeEntryForm onClose={() => setIsTimeEntryDialogOpen(false)} /></DialogContent>
      </Dialog>

      <Dialog open={!!payStubRecord} onOpenChange={o => { if (!o) setPayStubRecord(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Pay Stub</DialogTitle></DialogHeader>
          {payStubRecord && <PayStubDialog record={payStubRecord} onClose={() => setPayStubRecord(null)} />}
        </DialogContent>
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
              <button onClick={() => setIsTimeEntryDialogOpen(true)} style={{ display: "flex", alignItems: "center", gap: "7px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--muted)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-log-hours">
                Log hours</button>
              <button onClick={() => { setEditingEmployee(null); setIsEmployeeDialogOpen(true); }} style={{ display: "flex", alignItems: "center", gap: "7px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--muted)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-add-employee">
                <Plus style={{ width: "14px", height: "14px" }} /> Add employee</button>
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
              <button onClick={() => setIsRunPayrollOpen(true)} style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "9px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(37,99,235,.3)" }} data-testid="button-run-payroll">
                Run payroll</button>
            </div>
          </div>

          {/* ── 5-stat strip ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "12px", marginBottom: "20px" }}>
            {[
              { label: "Gross this period", value: fmt(gross), testid: "stat-gross" },
              { label: "Net pay (take-home)", value: fmt(netTotal), testid: "stat-net", highlight: true },
              { label: "Tax withheld", value: fmt(taxTotal), testid: "stat-tax" },
              { label: "Overtime hours", value: otHrs > 0 ? otHrs.toFixed(0) + " hrs" : "0", testid: "stat-ot", warn: otHrs > 0 },
              { label: "Crew on payroll", value: String(crewCount), testid: "stat-crew" },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>{s.label}</div>
                <div className="font-mono" style={{ fontSize: "20px", fontWeight: 600, marginTop: "6px", color: s.warn ? "#b6731a" : s.highlight ? "#15803d" : "var(--fg)" }} data-testid={s.testid}>{payrollLoading ? "—" : s.value}</div>
              </div>
            ))}
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
          {activeSection === "payroll" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ ...TH }}>
                <span style={{ flex: 1, minWidth: 0 }}>Painter</span>
                <span style={{ width: "90px", flexShrink: 0 }}>Type</span>
                <span style={{ width: "80px", flexShrink: 0, textAlign: "right" }}>Reg hrs</span>
                <span style={{ width: "72px", flexShrink: 0, textAlign: "right" }}>OT hrs</span>
                <span style={{ width: "96px", flexShrink: 0, textAlign: "right" }}>Gross</span>
                <span style={{ width: "86px", flexShrink: 0, textAlign: "right" }}>Tax</span>
                <span style={{ width: "86px", flexShrink: 0, textAlign: "right" }}>Deductions</span>
                <span style={{ width: "96px", flexShrink: 0, textAlign: "right" }}>Net pay</span>
                <span style={{ width: "88px", flexShrink: 0, textAlign: "center" }}>Status</span>
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

              {crewRows.map((r) => {
                const taxW = Number((r as any).taxWithheld ?? 0);
                const dedW = Number(r.deductions ?? 0);
                const is1099 = (r.employee as any).employmentType === "1099";
                return (
                  <div key={r.id} className="rowhover" style={{ display: "flex", alignItems: "center", padding: "11px 18px", borderBottom: "1px solid var(--panel-bd)", cursor: "pointer" }}
                    onClick={() => setPayStubRecord(r as PayrollRecordWithEmployee)} data-testid={`row-payroll-${r.id}`}>
                    {/* Painter */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "10px", paddingRight: "10px" }}>
                      <div style={{ width: "34px", height: "34px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "11.5px", background: r.avBg, color: r.avFg }}>
                        {initials(r.employee?.name ?? "?")}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.employee?.name ?? "Unknown"}</div>
                        <div style={{ fontSize: "11px", color: "var(--faint)", whiteSpace: "nowrap" }}>${Number(r.dayRate ?? 0).toFixed(0)}/day</div>
                      </div>
                    </div>
                    {/* Type */}
                    <div style={{ width: "90px", flexShrink: 0 }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 7px", borderRadius: "5px", background: is1099 ? "var(--b-amber-bg)" : "var(--b-blue-bg, #eff6ff)", color: is1099 ? "var(--b-amber-fg)" : "var(--b-blue-fg, #1d4ed8)" }}>{is1099 ? "1099" : "W-2"}</span>
                    </div>
                    {/* Reg hrs */}
                    <span className="font-mono" style={{ width: "80px", flexShrink: 0, textAlign: "right", fontSize: "12.5px" }}>
                      {Number(r.regularHours ?? Math.max(0, Number(r.totalHours) - Number(r.overtimeHours ?? 0))).toFixed(1)}
                    </span>
                    {/* OT hrs */}
                    <span className="font-mono" style={{ width: "72px", flexShrink: 0, textAlign: "right", fontSize: "12.5px", fontWeight: Number(r.overtimeHours ?? 0) > 0 ? 700 : 400, color: Number(r.overtimeHours ?? 0) > 0 ? OT_COLOR : "var(--faint)" }} data-testid={`ot-${r.id}`}>
                      {Number(r.overtimeHours ?? 0) > 0 ? Number(r.overtimeHours).toFixed(1) : "—"}
                    </span>
                    {/* Gross */}
                    <span className="font-mono" style={{ width: "96px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 700 }} data-testid={`gross-${r.id}`}>{fmt(r.grossPay)}</span>
                    {/* Tax */}
                    <span className="font-mono" style={{ width: "86px", flexShrink: 0, textAlign: "right", fontSize: "12px", color: taxW > 0 ? "#dc2626" : "var(--faint)" }} data-testid={`tax-${r.id}`}>{taxW > 0 ? `(${fmt(taxW)})` : "—"}</span>
                    {/* Deductions */}
                    <span className="font-mono" style={{ width: "86px", flexShrink: 0, textAlign: "right", fontSize: "12px", color: dedW > 0 ? "#7c3aed" : "var(--faint)" }} data-testid={`ded-${r.id}`}>{dedW > 0 ? `(${fmt(dedW)})` : "—"}</span>
                    {/* Net */}
                    <span className="font-mono" style={{ width: "96px", flexShrink: 0, textAlign: "right", fontSize: "13.5px", fontWeight: 800, color: "#15803d" }} data-testid={`net-${r.id}`}>{fmt(r.netPay)}</span>
                    {/* Status */}
                    <span style={{ width: "88px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      <span style={{ background: r.badge.bg, color: r.badge.fg, fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px", textTransform: "capitalize", whiteSpace: "nowrap" }}>{r.badge.label}</span>
                    </span>
                    {/* Actions */}
                    <span style={{ width: "28px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }} onClick={e => e.stopPropagation()}>
                      {r.status !== "paid" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px 0", display: "flex", alignItems: "center" }} data-testid={`button-payroll-actions-${r.id}`}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" sideOffset={4}>
                            <DropdownMenuItem onClick={() => setPayStubRecord(r as PayrollRecordWithEmployee)} data-testid={`button-view-stub-${r.id}`}>
                              <FileText className="h-4 w-4 mr-2" />View pay stub
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => markPaidMutation.mutate(r.id)} data-testid={`button-mark-paid-${r.id}`}>
                              <CheckCircle className="h-4 w-4 mr-2 text-green-600" />Mark as paid
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {r.status === "paid" && (
                        <button style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px", display: "flex", alignItems: "center" }} onClick={e => { e.stopPropagation(); setPayStubRecord(r as PayrollRecordWithEmployee); }} data-testid={`button-stub-${r.id}`}>
                          <FileText style={{ width: "14px", height: "14px" }} />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}

              {/* Footer totals */}
              {crewRows.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", padding: "12px 18px", background: "var(--track)", borderTop: "1px solid var(--panel-bd)" }}>
                  <span style={{ flex: 1, fontSize: "12.5px", fontWeight: 700 }}>Total</span>
                  <span style={{ width: "90px", flexShrink: 0 }}></span>
                  <span className="font-mono" style={{ width: "80px", flexShrink: 0, textAlign: "right", fontSize: "12px", color: "var(--muted)" }}>{totalHrs.toFixed(0)} hrs</span>
                  <span style={{ width: "72px", flexShrink: 0 }}></span>
                  <span className="font-mono" style={{ width: "96px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 700 }}>{fmt(gross)}</span>
                  <span className="font-mono" style={{ width: "86px", flexShrink: 0, textAlign: "right", fontSize: "12px", color: taxTotal > 0 ? "#dc2626" : "var(--faint)" }}>{taxTotal > 0 ? `(${fmt(taxTotal)})` : "—"}</span>
                  <span style={{ width: "86px", flexShrink: 0 }}></span>
                  <span className="font-mono" style={{ width: "96px", flexShrink: 0, textAlign: "right", fontSize: "14px", fontWeight: 800, color: "#15803d" }}>{fmt(netTotal)}</span>
                  <span style={{ width: "88px", flexShrink: 0 }}></span>
                  <span style={{ width: "28px", flexShrink: 0 }}></span>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── EMPLOYEES TABLE ── */}
          {activeSection === "employees" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", borderBottom: "1px solid var(--panel-bd)", background: "var(--track)" }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "7px", background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "6px 11px" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Search employees…" style={{ border: "none", background: "none", outline: "none", fontSize: "12.5px", color: "var(--fg)", fontFamily: "inherit", width: "100%" }} data-testid="input-search-employees" />
                </div>
                <button onClick={() => { setEditingEmployee(null); setIsEmployeeDialogOpen(true); }} style={{ display: "flex", alignItems: "center", gap: "6px", border: "none", background: "var(--jox-primary)", color: "#fff", borderRadius: "8px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-add-employee-tab">
                  <Plus style={{ width: "13px", height: "13px" }} />Add employee
                </button>
              </div>

              <div style={{ ...TH }}>
                <span style={{ flex: 1, minWidth: 0 }}>Employee</span>
                <span style={{ width: "80px", flexShrink: 0 }}>Type</span>
                <span style={{ width: "100px", flexShrink: 0 }}>Position</span>
                <span style={{ width: "100px", flexShrink: 0, textAlign: "right" }}>Day rate</span>
                <span style={{ width: "88px", flexShrink: 0, textAlign: "right" }}>Hrs (month)</span>
                <span style={{ width: "100px", flexShrink: 0, textAlign: "right" }}>Month pay</span>
                <span style={{ width: "80px", flexShrink: 0, textAlign: "center" }}>Deductions</span>
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
                const is1099 = (emp as any).employmentType === "1099";
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
                    <span style={{ width: "80px", flexShrink: 0 }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 7px", borderRadius: "5px", background: is1099 ? "var(--b-amber-bg)" : "var(--b-blue-bg, #eff6ff)", color: is1099 ? "var(--b-amber-fg)" : "var(--b-blue-fg, #1d4ed8)" }}>{is1099 ? "1099" : "W-2"}</span>
                    </span>
                    <span style={{ width: "100px", flexShrink: 0, fontSize: "12.5px", color: "var(--muted)" }}>{emp.position || "—"}</span>
                    <span className="font-mono" style={{ width: "100px", flexShrink: 0, textAlign: "right", fontSize: "12.5px" }}>{fmtFull(emp.dayRate)}/day</span>
                    <span className="font-mono" style={{ width: "88px", flexShrink: 0, textAlign: "right", fontSize: "12.5px", color: "var(--muted)" }}>{(emp.hoursThisPeriod || 0).toFixed(1)} hrs</span>
                    <span className="font-mono" style={{ width: "100px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600 }}>{fmtFull(emp.totalPay || 0)}</span>
                    <span style={{ width: "80px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      {((emp as EmployeeWithStats).deductionsCount ?? 0) > 0 ? (
                        <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "5px", background: "#f0fdf4", color: "#16a34a", cursor: "pointer", whiteSpace: "nowrap" }}
                          onClick={() => { setEditingEmployee(emp); setIsEmployeeDialogOpen(true); }}
                          data-testid={`badge-deductions-${emp.id}`}>
                          {(emp as EmployeeWithStats).deductionsCount} deduction{((emp as EmployeeWithStats).deductionsCount ?? 0) !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--faint)" }}>—</span>
                      )}
                    </span>
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
                            <Edit className="h-4 w-4 mr-2" />Edit &amp; deductions
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
                  · {filteredEmployees.filter(e => (e as any).employmentType === "1099").length} contractors
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── TIME ENTRIES TABLE ── */}
          {activeSection === "time" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
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

              <div style={{ ...TH }}>
                <span style={{ width: "96px", flexShrink: 0 }}>Date</span>
                <span style={{ width: "160px", flexShrink: 0 }}>Employee</span>
                <span style={{ flex: 1, minWidth: 0 }}>Job</span>
                <span style={{ width: "80px", flexShrink: 0, textAlign: "right" }}>Hours</span>
                <span style={{ width: "96px", flexShrink: 0, textAlign: "right" }}>Pay</span>
                <span style={{ width: "180px", flexShrink: 0 }}>Description</span>
                <span style={{ width: "28px", flexShrink: 0 }}></span>
              </div>

              {timeLoading && <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>Loading time entries…</div>}

              {!timeLoading && filteredTimeEntries.length === 0 && (
                <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>⏱️</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>No time entries</div>
                  <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>Log hours to track time worked by your crew.</div>
                  <button onClick={() => setIsTimeEntryDialogOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-add-first-time-entry">
                    <Plus style={{ width: "15px", height: "15px" }} />Log hours
                  </button>
                </div>
              )}

              {filteredTimeEntries.map((entry) => (
                <div key={entry.id} className="rowhover" style={{ display: "flex", alignItems: "center", padding: "11px 18px", borderBottom: "1px solid var(--panel-bd)" }} data-testid={`row-time-${entry.id}`}>
                  <span style={{ width: "96px", flexShrink: 0, fontSize: "12.5px", color: "var(--muted)" }}>
                    {format(new Date(entry.date), "MMM d, yyyy")}
                  </span>
                  <span style={{ width: "160px", flexShrink: 0, fontSize: "13px", fontWeight: 500 }}>{entry.employee?.name ?? "—"}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(entry as any).job?.title ?? "—"}</span>
                  <span className="font-mono" style={{ width: "80px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600 }}>{Number(entry.hoursWorked).toFixed(1)} hrs</span>
                  <span className="font-mono" style={{ width: "96px", flexShrink: 0, textAlign: "right", fontSize: "12.5px" }}>{fmtFull(Number(entry.hoursWorked) * Number(entry.employee?.dayRate ?? 0))}</span>
                  <span style={{ width: "180px", flexShrink: 0, fontSize: "12px", color: "var(--faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.description || "—"}</span>
                  <span style={{ width: "28px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setDeleteTimeEntryId(entry.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px", display: "flex" }} data-testid={`button-delete-time-${entry.id}`}>
                      <Trash2 style={{ width: "14px", height: "14px" }} />
                    </button>
                  </span>
                </div>
              ))}

              {!timeLoading && filteredTimeEntries.length > 0 && (
                <div style={{ padding: "12px 18px", fontSize: "12.5px", color: "var(--faint)" }}>
                  {filteredTimeEntries.length} entr{filteredTimeEntries.length !== 1 ? "ies" : "y"} · {filteredTimeEntries.reduce((s, e) => s + Number(e.hoursWorked), 0).toFixed(1)} total hours
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── SETTINGS ── */}
          {activeSection === "settings" && <PaySettings />}

        </div>
      </div>
    </>
  );
}
