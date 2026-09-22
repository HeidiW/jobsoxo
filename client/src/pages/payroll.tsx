import { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "wouter";
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
import { Plus, Play, AlertTriangle, PhoneOff, Edit, Trash2, CheckCircle, ChevronLeft, ChevronRight, FileText, X, Settings2, Download, ClipboardList, ChevronDown, ChevronUp, MessageSquare, Landmark, Unlink, AlertCircle } from "lucide-react";
import { usePlaidLink, type PlaidAccountMeta } from "@/hooks/use-plaid-link";
import { Button } from "@/components/ui/button";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { Employee, TimeEntry, PayrollRecord, Job, SmsAttempt } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface EmployeeDeduction {
  id: string; employeeId: string; label: string; deductionType: string;
  amount: string; category: string; active: boolean; createdAt: string;
}
interface PayrollSettings { id: string; payFrequency: string; updatedAt: string; }
interface EmployeeWithStats extends Employee { hoursThisPeriod: number; totalPay: number; deductionsCount?: number; onboardingIncomplete?: boolean; }
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

// ── Onboarding Section (used inside employee form) ────────────────────────────
interface OnboardingItem { id: string; employeeId: string; label: string; completed: boolean; completedDate: string | null; sortOrder: number; }

function OnboardingSection({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const { data: items = [] } = useQuery<OnboardingItem[]>({
    queryKey: [`/api/employees/${employeeId}/onboarding`],
    enabled: !!employeeId,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const res = await apiRequest("PATCH", `/api/employees/${employeeId}/onboarding/${id}`, { completed });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}/onboarding`] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
    },
    onError: () => toast({ title: "Failed to update item", variant: "destructive" }),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/employees/${employeeId}/onboarding`, { label: newLabel });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}/onboarding`] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setAdding(false);
      setNewLabel("");
      toast({ title: "Item added" });
    },
    onError: () => toast({ title: "Failed to add item", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/employees/${employeeId}/onboarding/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}/onboarding`] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
    },
    onError: () => toast({ title: "Failed to remove item", variant: "destructive" }),
  });

  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length;
  const allDone = totalCount > 0 && completedCount === totalCount;

  return (
    <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "14px", marginTop: "4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: open ? "10px" : 0 }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          data-testid="button-toggle-onboarding">
          <ClipboardList style={{ width: "13px", height: "13px", color: "#64748b" }} />
          <span style={{ ...lbl, margin: 0 }}>Onboarding</span>
          {totalCount > 0 && (
            <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "5px",
              background: allDone ? "var(--b-green-bg, #f0fdf4)" : "var(--b-amber-bg, #fffbeb)",
              color: allDone ? "var(--b-green-fg, #16a34a)" : "var(--b-amber-fg, #b45309)" }}>
              {completedCount}/{totalCount}
            </span>
          )}
          {open ? <ChevronUp style={{ width: "13px", height: "13px", color: "#94a3b8" }} /> : <ChevronDown style={{ width: "13px", height: "13px", color: "#94a3b8" }} />}
        </button>
        {open && !adding && (
          <button type="button" onClick={() => setAdding(true)}
            style={{ fontSize: "11.5px", fontWeight: 700, color: "#2563eb", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
            data-testid="button-add-onboarding-item">
            <Plus style={{ width: "12px", height: "12px" }} /> Add
          </button>
        )}
      </div>

      {open && (
        <>
          {items.length === 0 && !adding && (
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>No onboarding items.</p>
          )}

          {items.map(item => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }} data-testid={`row-onboarding-${item.id}`}>
              <input type="checkbox" checked={item.completed}
                onChange={e => toggleMutation.mutate({ id: item.id, completed: e.target.checked })}
                style={{ cursor: "pointer", accentColor: "#2563eb", width: "15px", height: "15px", flexShrink: 0 }}
                data-testid={`toggle-onboarding-${item.id}`} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "13px", fontWeight: 500, color: item.completed ? "#94a3b8" : "#0f172a", textDecoration: item.completed ? "line-through" : "none" }}>
                  {item.label}
                </span>
                {item.completed && item.completedDate && (
                  <span style={{ marginLeft: "8px", fontSize: "11px", color: "#94a3b8" }}>
                    {format(new Date(item.completedDate), "MMM d, yyyy")}
                  </span>
                )}
              </div>
              <button type="button" onClick={() => deleteMutation.mutate(item.id)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: "2px", display: "flex" }}
                data-testid={`button-delete-onboarding-${item.id}`}>
                <X style={{ width: "14px", height: "14px" }} />
              </button>
            </div>
          ))}

          {adding && (
            <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center" }}>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Background check completed"
                style={{ ...inp, flex: 1, fontSize: "12.5px" }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (newLabel.trim()) addMutation.mutate(); } }}
                autoFocus
                data-testid="input-onboarding-label" />
              <button type="button" onClick={() => { setAdding(false); setNewLabel(""); }}
                style={{ padding: "7px 10px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "7px", fontSize: "12.5px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
              <button type="button" disabled={!newLabel.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}
                style={{ padding: "7px 13px", border: "none", background: "#2563eb", borderRadius: "7px", fontSize: "12.5px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: !newLabel.trim() ? 0.5 : 1 }}
                data-testid="button-save-onboarding-item">
                {addMutation.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          )}
        </>
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

        {/* Direct Deposit — only shown in edit mode */}
        {isEdit && employee?.id && (
          <DirectDepositSection employeeId={employee.id} employeeEmail={employee.email} employeeName={employee.name} />
        )}

        {/* Onboarding — only shown in edit mode */}
        {isEdit && employee?.id && (
          <OnboardingSection employeeId={employee.id} />
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

// ── Balance Pre-flight Banner ─────────────────────────────────────────────────
function BalancePreflightBanner({ estimatedPayroll }: { estimatedPayroll: number }) {
  const { data: balance, isLoading } = useQuery<{
    connected: boolean;
    available?: number;
    current?: number;
    institutionName?: string;
    accountMask?: string;
  }>({
    queryKey: ["/api/plaid/balance"],
    queryFn: async () => {
      const res = await fetch("/api/plaid/balance", { credentials: "include" });
      if (!res.ok) return { connected: false };
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--track)", borderRadius: "8px", padding: "10px 12px", fontSize: "12.5px", color: "var(--muted)" }}>
      <Landmark style={{ width: "14px", height: "14px", flexShrink: 0 }} />
      Checking bank balance…
    </div>
  );

  if (!balance?.connected) return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--track)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "10px 12px", fontSize: "12.5px", color: "var(--muted)" }} data-testid="balance-preflight-no-account">
      <Landmark style={{ width: "14px", height: "14px", flexShrink: 0 }} />
      <span>No bank account connected — <a href="/settings" style={{ color: "var(--jox-primary)", fontWeight: 600, textDecoration: "none" }}>connect one in Settings</a> to enable balance checks before payroll.</span>
    </div>
  );

  const avail = balance.available ?? balance.current ?? 0;
  const sufficient = avail >= estimatedPayroll;

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "10px", borderRadius: "8px", padding: "10px 12px",
      background: sufficient ? "#f0fdf4" : "#fef2f2",
      border: `1px solid ${sufficient ? "#bbf7d0" : "#fecaca"}`,
      fontSize: "12.5px",
    }} data-testid="balance-preflight-banner">
      {sufficient
        ? <CheckCircle style={{ width: "15px", height: "15px", color: "#16a34a", flexShrink: 0, marginTop: "1px" }} />
        : <AlertCircle style={{ width: "15px", height: "15px", color: "#dc2626", flexShrink: 0, marginTop: "1px" }} />}
      <div style={{ color: sufficient ? "#166534" : "#991b1b" }}>
        <span style={{ fontWeight: 700 }}>{balance.institutionName} ••••{balance.accountMask}</span>
        {" — "}
        <span>Available: <strong>${avail.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></span>
        {" · "}
        <span>Est. payroll: <strong>${estimatedPayroll.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></span>
        {!sufficient && <div style={{ marginTop: "3px", fontWeight: 600 }}>⚠ Insufficient balance — fund your account before running payroll.</div>}
      </div>
    </div>
  );
}

// ── Direct Deposit Section ────────────────────────────────────────────────────
function DirectDepositSection({ employeeId, employeeEmail, employeeName }: { employeeId: string; employeeEmail?: string | null; employeeName?: string }) {
  const { toast } = useToast();
  const [localAccount, setLocalAccount] = useState<PlaidAccountMeta | null | undefined>(undefined);
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const { data: accountData, isLoading } = useQuery<PlaidAccountMeta | null>({
    queryKey: ["/api/plaid/bank-account", "employee", employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/plaid/bank-account?entityType=employee&entityId=${employeeId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const account = localAccount !== undefined ? localAccount : accountData;

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/plaid/bank-accounts/${id}`); },
    onSuccess: () => {
      setLocalAccount(null);
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/bank-account", "employee", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/employee-bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-records"] });
      toast({ title: "Bank account disconnected" });
    },
    onError: (err: Error) => toast({ title: "Failed to disconnect", description: err.message, variant: "destructive" }),
  });

  const { open, isLoading: linkLoading } = usePlaidLink({
    entityType: "employee",
    entityId: employeeId,
    onSuccess: (acct) => {
      setLocalAccount(acct);
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/bank-account", "employee", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/employee-bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-records"] });
      toast({ title: "Bank account connected", description: `${acct.institutionName} ••••${acct.accountMask}` });
    },
  });

  async function sendSetupLink(force = false) {
    setSendingLink(true);
    try {
      // Use raw fetch so we can inspect a 409 response before deciding to throw
      const res = await fetch(`/api/employees/${employeeId}/send-deposit-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ force }),
      });
      const body = await res.json();
      if (res.status === 409 && body.hasPendingToken) {
        // Existing pending token — ask manager to confirm before overwriting
        setConfirmOverwrite(true);
        return;
      }
      if (!res.ok) throw new Error(body.error || "Failed to send link");
      setLinkSent(true);
      toast({ title: "Setup link sent", description: `Email sent to ${employeeEmail}` });
    } catch (err: any) {
      toast({ title: "Failed to send link", description: err.message, variant: "destructive" });
    } finally {
      setSendingLink(false);
    }
  }

  return (
    <>
    <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace existing setup link?</AlertDialogTitle>
          <AlertDialogDescription>
            A setup link has already been sent to <strong>{employeeEmail}</strong>. Sending a new one will invalidate the old link — the employee won't be able to use it anymore. Continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { setConfirmOverwrite(false); sendSetupLink(true); }}
            data-testid={`button-confirm-resend-deposit-link-${employeeId}`}
          >
            Send new link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div style={{ marginTop: "16px", borderTop: "1px solid var(--panel-bd)", paddingTop: "16px" }}>
      <div style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px" }}>Direct Deposit</div>
      {isLoading ? (
        <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "10px 12px", borderRadius: "8px", background: "var(--track)", fontSize: "12.5px", color: "var(--muted)" }}>
          <Landmark style={{ width: "13px", height: "13px" }} />
          Loading…
        </div>
      ) : account ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", border: "1px solid var(--panel-bd)", borderRadius: "8px", background: "var(--panel)", gap: "10px" }} data-testid={`direct-deposit-connected-${employeeId}`}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <Landmark style={{ width: "14px", height: "14px", flexShrink: 0, color: "var(--muted)" }} />
            <div>
              <div style={{ fontSize: "12.5px", fontWeight: 600 }}>{account.institutionName}</div>
              <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>
                {account.accountName} ••••{account.accountMask}
                {account.routingNumberMask && (
                  <span style={{ marginLeft: "8px" }}>· Routing: {account.routingNumberMask}</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => disconnectMutation.mutate(account.id)}
            disabled={disconnectMutation.isPending}
            style={{ display: "flex", alignItems: "center", gap: "5px", border: "1px solid #fecaca", borderRadius: "7px", padding: "5px 10px", background: "#fff5f5", color: "#dc2626", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
            data-testid={`button-disconnect-direct-deposit-${employeeId}`}
          >
            <Unlink style={{ width: "12px", height: "12px" }} />
            {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ fontSize: "12.5px", color: "var(--muted)", margin: 0 }}>No direct deposit account connected for this employee.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={open}
              disabled={linkLoading}
              style={{ display: "flex", alignItems: "center", gap: "7px", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "8px 14px", background: "var(--panel)", fontSize: "12.5px", fontWeight: 600, cursor: linkLoading ? "wait" : "pointer", fontFamily: "inherit", color: "var(--fg)" }}
              data-testid={`button-connect-bank-account-${employeeId}`}
            >
              <Landmark style={{ width: "13px", height: "13px" }} />
              {linkLoading ? "Opening…" : "Connect bank account"}
            </button>
            {employeeEmail && (
              <button
                type="button"
                onClick={() => sendSetupLink()}
                disabled={sendingLink || linkSent}
                style={{ display: "flex", alignItems: "center", gap: "7px", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "8px 14px", background: linkSent ? "#eff6ff" : "var(--panel)", fontSize: "12.5px", fontWeight: 600, cursor: (sendingLink || linkSent) ? "default" : "pointer", fontFamily: "inherit", color: linkSent ? "#2563eb" : "#2563eb", opacity: (sendingLink || linkSent) ? 0.75 : 1 }}
                data-testid={`button-send-deposit-link-${employeeId}`}
              >
                {linkSent ? <CheckCircle style={{ width: "13px", height: "13px" }} /> : <MessageSquare style={{ width: "13px", height: "13px" }} />}
                {sendingLink ? "Sending…" : linkSent ? "Link sent" : "Send setup link"}
              </button>
            )}
          </div>
          {!employeeEmail && (
            <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: 0 }}>
              Add an email address to send the employee a self-service setup link.
            </p>
          )}
        </div>
      )}
    </div>
    </>
  );
}

// ── Run Payroll Form ──────────────────────────────────────────────────────────
function RunPayrollForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data: employees } = useQuery<EmployeeWithStats[]>({ queryKey: ["/api/employees"] });
  const { data: payrollRecords } = useQuery<PayrollRecordWithEmployee[]>({ queryKey: ["/api/payroll-records"] });
  const { data: payrollSettings } = useQuery<PayrollSettings>({ queryKey: ["/api/payroll-settings"] });
  const { data: empBankAccounts } = useQuery<{ entityId: string }[]>({ queryKey: ["/api/plaid/employee-bank-accounts"] });
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
        {mutation.isPending && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "9px 12px", fontSize: "12.5px", color: "#0369a1" }} data-testid="banner-payroll-locked">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>Payroll run in progress — fields are locked until the run completes.</span>
          </div>
        )}
        <div>
          <label style={{ ...lbl, marginBottom: "8px" }}>Quick period</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {presets.map(p => (
              <Tooltip key={p.label} open={mutation.isPending ? undefined : false}>
                <TooltipTrigger asChild>
                  <span>
                    <button type="button" onClick={() => { if (!mutation.isPending) { form.setValue("periodStart", p.start); form.setValue("periodEnd", p.end); } }}
                      disabled={mutation.isPending}
                      style={{ padding: "6px 12px", border: "1px solid #cbd5e1", background: mutation.isPending ? "#f1f5f9" : "#fff", borderRadius: "7px", fontSize: "12.5px", fontWeight: 600, color: mutation.isPending ? "#94a3b8" : "#475569", cursor: mutation.isPending ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: mutation.isPending ? 0.6 : 1 }}
                      data-testid={`preset-${p.label.toLowerCase().replace(/ /g,"-")}`}>
                      {p.label}
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Payroll run in progress</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <FormField control={form.control} name="periodStart" render={({ field }) => (
            <FormItem><label style={{ ...lbl, color: mutation.isPending ? "#94a3b8" : undefined }}>Period start *</label>
              <Tooltip open={mutation.isPending ? undefined : false}>
                <TooltipTrigger asChild>
                  <span style={{ display: "block" }}>
                    <FormControl><input {...field} type="date" disabled={mutation.isPending} style={{ ...inp, background: mutation.isPending ? "#f1f5f9" : undefined, color: mutation.isPending ? "#94a3b8" : undefined, cursor: mutation.isPending ? "not-allowed" : undefined, pointerEvents: mutation.isPending ? "none" : undefined }} data-testid="input-payroll-start" /></FormControl>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Payroll run in progress</TooltipContent>
              </Tooltip>
              <FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="periodEnd" render={({ field }) => (
            <FormItem><label style={{ ...lbl, color: mutation.isPending ? "#94a3b8" : undefined }}>Period end *</label>
              <Tooltip open={mutation.isPending ? undefined : false}>
                <TooltipTrigger asChild>
                  <span style={{ display: "block" }}>
                    <FormControl><input {...field} type="date" disabled={mutation.isPending} style={{ ...inp, background: mutation.isPending ? "#f1f5f9" : undefined, color: mutation.isPending ? "#94a3b8" : undefined, cursor: mutation.isPending ? "not-allowed" : undefined, pointerEvents: mutation.isPending ? "none" : undefined }} data-testid="input-payroll-end" /></FormControl>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Payroll run in progress</TooltipContent>
              </Tooltip>
              <FormMessage /></FormItem>
          )} />
        </div>
        {/* Balance pre-flight check */}
        {watchStart && watchEnd && (
          <BalancePreflightBanner estimatedPayroll={
            (employees?.filter(e => e.status === "active") ?? []).reduce((sum, e) => {
              const days = Math.ceil((new Date(watchEnd).getTime() - new Date(watchStart).getTime()) / (1000 * 60 * 60 * 24)) / 7 * 5;
              return sum + (Number((e as any).dayRate ?? 0) * Math.max(1, days));
            }, 0)
          } />
        )}
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
            {empBankAccounts !== undefined && activeCount > 0 && (() => {
              const connectedIds = new Set((empBankAccounts ?? []).map(a => a.entityId));
              const connectedCount = (employees?.filter(e => e.status === "active" && connectedIds.has(e.id)) ?? []).length;
              const missingCount = activeCount - connectedCount;
              return (
                <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px" }}>
                  <Landmark style={{ width: "12px", height: "12px", flexShrink: 0 }} />
                  {connectedCount === activeCount
                    ? <span style={{ color: "#16a34a", fontWeight: 600 }}>All {activeCount} employees have direct deposit connected.</span>
                    : <span>
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>{connectedCount}</span>
                        {" of "}
                        <span style={{ fontWeight: 600, color: "var(--fg)" }}>{activeCount}</span>
                        {" employees have direct deposit connected"}
                        {missingCount > 0 && <span style={{ color: "#b45309" }}> — {missingCount} not set up</span>}
                      </span>
                  }
                </div>
              );
            })()}
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

// ── Payroll Register Preview Dialog ───────────────────────────────────────────
function PayrollRegisterPreviewDialog({
  records, period, companyName, onClose,
}: {
  records: PayrollRecordWithEmployee[];
  period: { start: string; end: string };
  companyName: string;
  onClose: () => void;
}) {
  const [isDownloading, setIsDownloading] = useState(false);

  const totalRegHrs = records.reduce((s, r) => s + Number(r.regularHours ?? Math.max(0, Number(r.totalHours) - Number(r.overtimeHours ?? 0))), 0);
  const totalOtHrs  = records.reduce((s, r) => s + Number(r.overtimeHours ?? 0), 0);
  const totalGross  = records.reduce((s, r) => s + Number(r.grossPay), 0);
  const totalTax    = records.reduce((s, r) => s + Number(r.taxWithheld ?? 0), 0);
  const totalDed    = records.reduce((s, r) => s + Number(r.deductions ?? 0), 0);
  const totalNet    = records.reduce((s, r) => s + Number(r.netPay), 0);

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 14;
      const contentW = pageW - margin * 2;
      const rowH = 8;
      const pageBottomLimit = pageH - 16;

      const cols = [
        { label: "Employee",     w: contentW * 0.20, align: "left"   as const },
        { label: "Type",         w: contentW * 0.07, align: "center" as const },
        { label: "Reg Hrs",      w: contentW * 0.09, align: "right"  as const },
        { label: "OT Hrs",       w: contentW * 0.09, align: "right"  as const },
        { label: "Gross Pay",    w: contentW * 0.13, align: "right"  as const },
        { label: "Tax Withheld", w: contentW * 0.13, align: "right"  as const },
        { label: "Deductions",   w: contentW * 0.12, align: "right"  as const },
        { label: "Net Pay",      w: contentW * 0.13, align: "right"  as const },
        { label: "Status",       w: contentW * 0.04, align: "center" as const },
      ];

      function drawPageHeader() {
        doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
        doc.text(companyName, margin, 18);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
        doc.text("Payroll Register", margin, 24);
        doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(15, 23, 42);
        const pl = `Pay period: ${period.start} – ${period.end}`;
        doc.text(pl, pageW - margin - doc.getTextWidth(pl), 18);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
        const gen = `Generated ${format(new Date(), "MMM d, yyyy")}`;
        doc.text(gen, pageW - margin - doc.getTextWidth(gen), 24);
        doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.4);
        doc.line(margin, 28, pageW - margin, 28);
      }

      function drawTableHeader(y: number) {
        doc.setFillColor(248, 250, 252); doc.rect(margin, y - 5, contentW, rowH, "F");
        doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3);
        doc.line(margin, y - 5, pageW - margin, y - 5);
        doc.line(margin, y + 3, pageW - margin, y + 3);
        doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
        let xc = margin;
        cols.forEach(col => {
          const tx = col.align === "right" ? xc + col.w - 1 : col.align === "center" ? xc + col.w / 2 : xc + 1;
          doc.text(col.label.toUpperCase(), tx, y, { align: col.align });
          xc += col.w;
        });
        return y + rowH;
      }

      function drawPageNumber(pageNum: number, total: number) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
        const label = `Page ${pageNum} of ${total}`;
        doc.text(label, pageW - margin - doc.getTextWidth(label), pageH - 6);
      }

      drawPageHeader();
      let y = drawTableHeader(34);
      let pageNum = 1;

      const firstPageRows = Math.floor((pageBottomLimit - (34 + rowH)) / rowH);
      const subsequentPageRows = Math.floor((pageBottomLimit - (34 + rowH)) / rowH);
      const totalPages = records.length <= firstPageRows
        ? 1
        : 1 + Math.ceil((records.length - firstPageRows) / subsequentPageRows);

      records.forEach((r, idx) => {
        if (y + rowH > pageBottomLimit) {
          drawPageNumber(pageNum, totalPages);
          doc.addPage(); pageNum++;
          drawPageHeader(); y = drawTableHeader(34);
        }
        const emp = r.employee;
        const is1099 = (emp as any).employmentType === "1099";
        const regHrs = Number(r.regularHours ?? Math.max(0, Number(r.totalHours) - Number(r.overtimeHours ?? 0)));
        const otHrs  = Number(r.overtimeHours ?? 0);
        const gross  = Number(r.grossPay);
        const tax    = Number(r.taxWithheld ?? 0);
        const ded    = Number(r.deductions ?? 0);
        const net    = Number(r.netPay);

        if (idx % 2 === 0) { doc.setFillColor(249, 250, 251); doc.rect(margin, y - 5, contentW, rowH, "F"); }
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(15, 23, 42);

        const cells = [
          { val: emp.name,                                        col: cols[0] },
          { val: is1099 ? "1099" : "W-2",                        col: cols[1] },
          { val: regHrs.toFixed(1),                              col: cols[2] },
          { val: otHrs > 0 ? otHrs.toFixed(1) : "—",            col: cols[3] },
          { val: `$${gross.toFixed(2)}`,                         col: cols[4] },
          { val: tax > 0 ? `($${tax.toFixed(2)})` : "—",        col: cols[5] },
          { val: ded > 0 ? `($${ded.toFixed(2)})` : "—",        col: cols[6] },
          { val: `$${net.toFixed(2)}`,                           col: cols[7] },
          { val: (r.status ?? "pending").charAt(0).toUpperCase() + (r.status ?? "pending").slice(1), col: cols[8] },
        ];
        let xCursor = margin;
        cells.forEach(({ val, col }) => {
          const tx = col.align === "right" ? xCursor + col.w - 1 : col.align === "center" ? xCursor + col.w / 2 : xCursor + 1;
          const maxW = col.w - 2;
          const text = doc.getTextWidth(val) > maxW ? doc.splitTextToSize(val, maxW)[0] + "…" : val;
          if (col === cols[7]) { doc.setTextColor(21, 128, 61); doc.setFont("helvetica", "bold"); }
          else if (col === cols[5] && tax > 0) { doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "normal"); }
          else if (col === cols[6] && ded > 0) { doc.setTextColor(124, 58, 237); doc.setFont("helvetica", "normal"); }
          else if (col === cols[3] && otHrs > 0) { doc.setTextColor(224, 160, 32); doc.setFont("helvetica", "bold"); }
          else { doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "normal"); }
          doc.text(text, tx, y, { align: col.align });
          xCursor += col.w;
        });
        doc.setDrawColor(241, 245, 249); doc.setLineWidth(0.2);
        doc.line(margin, y + 3, pageW - margin, y + 3);
        y += rowH;
      });

      if (y + rowH + 8 > pageBottomLimit) {
        drawPageNumber(pageNum, totalPages); doc.addPage(); pageNum++;
        drawPageHeader(); y = drawTableHeader(34);
      }
      y += 2;
      doc.setDrawColor(15, 23, 42); doc.setLineWidth(0.5);
      doc.line(margin, y - 2, pageW - margin, y - 2);

      const totals = [
        { val: `${records.length} employee${records.length !== 1 ? "s" : ""}`, col: cols[0] },
        { val: "", col: cols[1] },
        { val: records.reduce((s, r) => s + Number(r.regularHours ?? Math.max(0, Number(r.totalHours) - Number(r.overtimeHours ?? 0))), 0).toFixed(1), col: cols[2] },
        { val: records.reduce((s, r) => s + Number(r.overtimeHours ?? 0), 0) > 0
                ? records.reduce((s, r) => s + Number(r.overtimeHours ?? 0), 0).toFixed(1) : "—", col: cols[3] },
        { val: `$${records.reduce((s, r) => s + Number(r.grossPay), 0).toFixed(2)}`, col: cols[4] },
        { val: records.reduce((s, r) => s + Number(r.taxWithheld ?? 0), 0) > 0
                ? `($${records.reduce((s, r) => s + Number(r.taxWithheld ?? 0), 0).toFixed(2)})` : "—", col: cols[5] },
        { val: records.reduce((s, r) => s + Number(r.deductions ?? 0), 0) > 0
                ? `($${records.reduce((s, r) => s + Number(r.deductions ?? 0), 0).toFixed(2)})` : "—", col: cols[6] },
        { val: `$${records.reduce((s, r) => s + Number(r.netPay), 0).toFixed(2)}`, col: cols[7] },
        { val: "", col: cols[8] },
      ];
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      let xCursor = margin;
      totals.forEach(({ val, col }) => {
        const tx = col.align === "right" ? xCursor + col.w - 1 : col.align === "center" ? xCursor + col.w / 2 : xCursor + 1;
        if (col === cols[7]) doc.setTextColor(21, 128, 61); else doc.setTextColor(15, 23, 42);
        doc.text(val, tx, y + 5, { align: col.align });
        xCursor += col.w;
      });
      drawPageNumber(pageNum, totalPages);
      doc.save(`payroll-register-${period.start}.pdf`);
    } catch (e) {
      console.error("PDF error", e);
    } finally {
      setIsDownloading(false);
    }
  }

  const TH_CELL: React.CSSProperties = {
    fontSize: "10px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase",
    color: "#64748b", padding: "8px 10px", background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap",
  };
  const TD_CELL: React.CSSProperties = {
    fontSize: "12.5px", padding: "8px 10px", color: "#0f172a",
    borderBottom: "1px solid #f1f5f9",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {/* Paper preview */}
      <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "20px 18px", overflowX: "auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "14px", paddingBottom: "10px", borderBottom: "2px solid #0f172a" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>{companyName}</div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>Payroll Register</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>Pay period: {period.start} – {period.end}</div>
            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>Generated {format(new Date(), "MMM d, yyyy")}</div>
          </div>
        </div>

        {/* Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
          <thead>
            <tr>
              <th style={{ ...TH_CELL, textAlign: "left" }}>Employee</th>
              <th style={{ ...TH_CELL, textAlign: "center" }}>Type</th>
              <th style={{ ...TH_CELL, textAlign: "right" }}>Reg Hrs</th>
              <th style={{ ...TH_CELL, textAlign: "right" }}>OT Hrs</th>
              <th style={{ ...TH_CELL, textAlign: "right" }}>Gross Pay</th>
              <th style={{ ...TH_CELL, textAlign: "right" }}>Tax Withheld</th>
              <th style={{ ...TH_CELL, textAlign: "right" }}>Deductions</th>
              <th style={{ ...TH_CELL, textAlign: "right" }}>Net Pay</th>
              <th style={{ ...TH_CELL, textAlign: "center" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, idx) => {
              const emp = r.employee;
              const is1099 = (emp as any).employmentType === "1099";
              const regHrs = Number(r.regularHours ?? Math.max(0, Number(r.totalHours) - Number(r.overtimeHours ?? 0)));
              const otHrs  = Number(r.overtimeHours ?? 0);
              const gross  = Number(r.grossPay);
              const tax    = Number(r.taxWithheld ?? 0);
              const ded    = Number(r.deductions ?? 0);
              const net    = Number(r.netPay);
              const status = (r.status ?? "pending");
              const badge  = STATUS_BADGE[status] ?? STATUS_BADGE.pending;
              return (
                <tr key={r.id} style={{ background: idx % 2 === 0 ? "#f9fafb" : "#ffffff" }}>
                  <td style={{ ...TD_CELL, fontWeight: 600 }}>{emp.name}</td>
                  <td style={{ ...TD_CELL, textAlign: "center", fontSize: "11.5px", color: "#475569" }}>{is1099 ? "1099" : "W-2"}</td>
                  <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace" }}>{regHrs.toFixed(1)}</td>
                  <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", color: otHrs > 0 ? OT_COLOR : "#94a3b8", fontWeight: otHrs > 0 ? 700 : 400 }}>{otHrs > 0 ? otHrs.toFixed(1) : "—"}</td>
                  <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace" }}>${gross.toFixed(2)}</td>
                  <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", color: tax > 0 ? "#dc2626" : "#94a3b8" }}>{tax > 0 ? `($${tax.toFixed(2)})` : "—"}</td>
                  <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", color: ded > 0 ? "#7c3aed" : "#94a3b8" }}>{ded > 0 ? `($${ded.toFixed(2)})` : "—"}</td>
                  <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#15803d" }}>${net.toFixed(2)}</td>
                  <td style={{ ...TD_CELL, textAlign: "center" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: "5px", background: badge.bg, color: badge.fg }}>{badge.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid #0f172a" }}>
              <td style={{ ...TD_CELL, fontWeight: 700, paddingTop: "10px" }}>{records.length} employee{records.length !== 1 ? "s" : ""}</td>
              <td style={{ ...TD_CELL }}></td>
              <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>{totalRegHrs.toFixed(1)}</td>
              <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: totalOtHrs > 0 ? OT_COLOR : "#94a3b8" }}>{totalOtHrs > 0 ? totalOtHrs.toFixed(1) : "—"}</td>
              <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>${totalGross.toFixed(2)}</td>
              <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: totalTax > 0 ? "#dc2626" : "#94a3b8" }}>{totalTax > 0 ? `($${totalTax.toFixed(2)})` : "—"}</td>
              <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: totalDed > 0 ? "#7c3aed" : "#94a3b8" }}>{totalDed > 0 ? `($${totalDed.toFixed(2)})` : "—"}</td>
              <td style={{ ...TD_CELL, textAlign: "right", fontFamily: "monospace", fontWeight: 800, color: "#15803d" }}>${totalNet.toFixed(2)}</td>
              <td style={{ ...TD_CELL }}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "14px" }}>
        <button type="button" onClick={onClose} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }} data-testid="button-close-register-preview">Close</button>
        <button type="button" onClick={handleDownload} disabled={isDownloading}
          style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 16px", border: "none", background: "#0f172a", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: isDownloading ? 0.7 : 1 }}
          data-testid="button-download-register-pdf">
          <Download style={{ width: "14px", height: "14px" }} /> {isDownloading ? "Generating…" : "Download PDF"}
        </button>
      </div>
    </div>
  );
}

// ── SMS status helpers ────────────────────────────────────────────────────────
const SMS_STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  ok:                { bg: "var(--b-green-bg)",  fg: "var(--b-green-fg)",  label: "Logged" },
  unknown_number:    { bg: "#fee2e2",            fg: "#b91c1c",            label: "Unknown #" },
  inactive_employee: { bg: "var(--b-gray-bg)",   fg: "var(--b-gray-fg)",   label: "Inactive" },
  parse_error:       { bg: "var(--b-amber-bg)",  fg: "var(--b-amber-fg)",  label: "Bad format" },
  over_cap:          { bg: "#fef3c7",            fg: "#b45309",            label: "Over 24h cap" },
  help:              { bg: "var(--b-blue-bg, #eff6ff)", fg: "var(--b-blue-fg, #1d4ed8)", label: "HELP" },
};

// ── Section tab types ─────────────────────────────────────────────────────────
type Section = "payroll" | "employees" | "time" | "smslog" | "settings";

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
  const [sourceFilter, setSourceFilter] = useState("all");
  const [payStubRecord, setPayStubRecord] = useState<PayrollRecordWithEmployee | null>(null);
  const [isRegisterPreviewOpen, setIsRegisterPreviewOpen] = useState(false);
  const [isExportRangeOpen, setIsExportRangeOpen] = useState(false);
  const [exportRangeStart, setExportRangeStart] = useState("");
  const [exportRangeEnd, setExportRangeEnd] = useState("");
  const [isRangeRegisterPreviewOpen, setIsRangeRegisterPreviewOpen] = useState(false);
  const [rangeExportRecords, setRangeExportRecords] = useState<PayrollRecordWithEmployee[]>([]);
  const [rangeExportPeriod, setRangeExportPeriod] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const { toast } = useToast();

  const { data: employees, isLoading: empLoading } = useQuery<EmployeeWithStats[]>({ queryKey: ["/api/employees"] });
  const { data: timeEntries, isLoading: timeLoading } = useQuery<TimeEntryWithRelations[]>({ queryKey: ["/api/time-entries"] });
  const { data: payrollRecords, isLoading: payrollLoading } = useQuery<PayrollRecordWithEmployee[]>({ queryKey: ["/api/payroll-records"] });
  const { data: appSettings } = useQuery<{ companyName?: string }>({ queryKey: ["/api/settings"] });
  const { data: empBankAccountsList } = useQuery<{ entityId: string }[]>({
    queryKey: ["/api/plaid/employee-bank-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/plaid/employee-bank-accounts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const connectedBankIds = useMemo(() => new Set((empBankAccountsList ?? []).map((a: { entityId: string }) => a.entityId)), [empBankAccountsList]);
  const companyName = appSettings?.companyName || "JobsOxo";
  const { data: smsAttempts = [], isLoading: smsLoading } = useQuery<SmsAttempt[]>({ queryKey: ["/api/sms/attempts"] });

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

  const markAllPaidMutation = useMutation({
    mutationFn: async ({ periodStart, periodEnd }: { periodStart: string; periodEnd: string }) => {
      const res = await apiRequest("POST", "/api/payroll-records/mark-all-paid", { periodStart, periodEnd });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-records"] });
      toast({ title: `${data.count} record${data.count !== 1 ? "s" : ""} marked as paid` });
    },
    onError: () => toast({ title: "Failed to mark records as paid", variant: "destructive" }),
  });

  const deleteTimeEntryMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/time-entries/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/time-entries"] }); queryClient.invalidateQueries({ queryKey: ["/api/employees"] }); setDeleteTimeEntryId(null); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  // ── Export helpers ─────────────────────────────────────────────────────────
  function exportCSV() {
    if (!currentRecords.length || !currentPeriod) return;
    const header = ["Name", "Type", "Pay Period", "Regular Hours", "Overtime Hours", "Gross Pay", "Tax Withheld", "Deductions", "Net Pay", "Status"];
    const periodStr = `${currentPeriod.start} to ${currentPeriod.end}`;
    const rows = currentRecords.map(r => {
      const emp = r.employee;
      const is1099 = (emp as any).employmentType === "1099";
      const regHrs = Number(r.regularHours ?? Math.max(0, Number(r.totalHours) - Number(r.overtimeHours ?? 0)));
      const otHrs = Number(r.overtimeHours ?? 0);
      return [
        emp.name,
        is1099 ? "1099" : "W-2",
        periodStr,
        regHrs.toFixed(2),
        otHrs.toFixed(2),
        Number(r.grossPay).toFixed(2),
        Number(r.taxWithheld ?? 0).toFixed(2),
        Number(r.deductions ?? 0).toFixed(2),
        Number(r.netPay).toFixed(2),
        r.status ?? "pending",
      ];
    });
    const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-register-${currentPeriod.start}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    if (!currentRecords.length || !currentPeriod) return;
    setIsRegisterPreviewOpen(true);
  }

  function getRecordsForRange(start: string, end: string): PayrollRecordWithEmployee[] {
    if (!payrollRecords || !start || !end) return [];
    return payrollRecords.filter(r => {
      const ps = toDateStr(r.periodStart);
      const pe = toDateStr(r.periodEnd);
      return ps >= start && pe <= end;
    });
  }

  function exportRangeCSV() {
    const records = getRecordsForRange(exportRangeStart, exportRangeEnd);
    if (!records.length) {
      toast({ title: "No records in that range", variant: "destructive" });
      return;
    }
    const header = ["Name", "Type", "Period Start", "Period End", "Regular Hours", "Overtime Hours", "Gross Pay", "Tax Withheld", "Deductions", "Net Pay", "Status"];
    const rows = records.map(r => {
      const emp = r.employee;
      const is1099 = (emp as any).employmentType === "1099";
      const regHrs = Number(r.regularHours ?? Math.max(0, Number(r.totalHours) - Number(r.overtimeHours ?? 0)));
      const otHrs = Number(r.overtimeHours ?? 0);
      return [
        emp.name,
        is1099 ? "1099" : "W-2",
        toDateStr(r.periodStart),
        toDateStr(r.periodEnd),
        regHrs.toFixed(2),
        otHrs.toFixed(2),
        Number(r.grossPay).toFixed(2),
        Number(r.taxWithheld ?? 0).toFixed(2),
        Number(r.deductions ?? 0).toFixed(2),
        Number(r.netPay).toFixed(2),
        r.status ?? "pending",
      ];
    });
    const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-register-${exportRangeStart}-to-${exportRangeEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setIsExportRangeOpen(false);
  }

  function exportRangePDF() {
    const records = getRecordsForRange(exportRangeStart, exportRangeEnd);
    if (!records.length) {
      toast({ title: "No records in that range", variant: "destructive" });
      return;
    }
    setRangeExportRecords(records);
    setRangeExportPeriod({ start: exportRangeStart, end: exportRangeEnd });
    setIsExportRangeOpen(false);
    setIsRangeRegisterPreviewOpen(true);
  }

  // ── Filtered employees ─────────────────────────────────────────────────────
  const filteredEmployees = (employees ?? []).filter(e =>
    e.name.toLowerCase().includes(empSearch.toLowerCase()) ||
    e.email?.toLowerCase().includes(empSearch.toLowerCase()) ||
    e.position?.toLowerCase().includes(empSearch.toLowerCase())
  );

  // ── Filtered time entries ──────────────────────────────────────────────────
  const now = new Date();
  const filteredTimeEntries = (timeEntries ?? []).filter(entry => {
    if (sourceFilter !== "all" && entry.source !== sourceFilter) return false;
    if (timeFilter === "all") return true;
    const d = new Date(entry.date);
    if (timeFilter === "this_month") return d >= startOfMonth(now) && d <= endOfMonth(now);
    if (timeFilter === "last_month") return d >= startOfMonth(subMonths(now,1)) && d <= endOfMonth(subMonths(now,1));
    if (timeFilter === "last_7") return d >= new Date(now.getTime() - 7*864e5);
    return true;
  });

  const smsEntryCount = (timeEntries ?? []).filter(e => e.source === "sms").length;
  const smsRejectedCount = smsAttempts.filter(a => a.status !== "ok" && a.status !== "help").length;

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

  const SECTION_TABS: { key: Section; label: string; badge?: number | null }[] = [
    { key: "payroll",   label: "Pay run" },
    { key: "employees", label: "Employees" },
    { key: "time",      label: "Time entries", badge: smsEntryCount > 0 ? smsEntryCount : null },
    { key: "smslog",    label: "SMS log" },
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
        <DialogContent className="max-w-md !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Run payroll</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <RunPayrollForm onClose={() => setIsRunPayrollOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isEmployeeDialogOpen} onOpenChange={o => { if (!o) { setIsEmployeeDialogOpen(false); setEditingEmployee(null); } }}>
        <DialogContent className="max-w-lg !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>{editingEmployee ? "Edit employee" : "Add employee"}</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <EmployeeForm employee={editingEmployee || undefined} onClose={() => { setIsEmployeeDialogOpen(false); setEditingEmployee(null); }} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isTimeEntryDialogOpen} onOpenChange={o => { if (!o) setIsTimeEntryDialogOpen(false); }}>
        <DialogContent className="max-w-md !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Log hours</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            <TimeEntryForm onClose={() => setIsTimeEntryDialogOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payStubRecord} onOpenChange={o => { if (!o) setPayStubRecord(null); }}>
        <DialogContent className="max-w-md !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Pay Stub</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
            {payStubRecord && <PayStubDialog record={payStubRecord} onClose={() => setPayStubRecord(null)} />}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isRegisterPreviewOpen} onOpenChange={o => { if (!o) setIsRegisterPreviewOpen(false); }}>
        <DialogContent className="max-w-4xl !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Payroll Register Preview</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 px-1 pb-1">
            {isRegisterPreviewOpen && currentPeriod && (
              <PayrollRegisterPreviewDialog
                records={currentRecords}
                period={currentPeriod}
                companyName={companyName}
                onClose={() => setIsRegisterPreviewOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isRangeRegisterPreviewOpen} onOpenChange={o => { if (!o) setIsRangeRegisterPreviewOpen(false); }}>
        <DialogContent className="max-w-4xl !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0"><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Payroll Register — Custom Range</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 px-1 pb-1">
            {isRangeRegisterPreviewOpen && rangeExportPeriod.start && (
              <PayrollRegisterPreviewDialog
                records={rangeExportRecords}
                period={rangeExportPeriod}
                companyName={companyName}
                onClose={() => setIsRangeRegisterPreviewOpen(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isExportRangeOpen} onOpenChange={o => { if (!o) setIsExportRangeOpen(false); }}>
        <DialogContent className="max-w-sm !flex flex-col">
          <DialogHeader className="shrink-0"><DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>Export date range</DialogTitle></DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", paddingTop: "4px" }}>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
              Export all payroll records whose pay period falls within the selected range.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label style={lbl}>Start date</label>
                <input
                  type="date"
                  value={exportRangeStart}
                  onChange={e => setExportRangeStart(e.target.value)}
                  style={inp}
                  data-testid="input-export-range-start"
                />
              </div>
              <div>
                <label style={lbl}>End date</label>
                <input
                  type="date"
                  value={exportRangeEnd}
                  onChange={e => setExportRangeEnd(e.target.value)}
                  style={inp}
                  data-testid="input-export-range-end"
                />
              </div>
            </div>
            {exportRangeStart && exportRangeEnd && exportRangeStart > exportRangeEnd && (
              <p style={{ margin: 0, fontSize: "12px", color: "#dc2626" }}>Start date must be before end date.</p>
            )}
            {exportRangeStart && exportRangeEnd && exportRangeStart <= exportRangeEnd && (() => {
              const count = getRecordsForRange(exportRangeStart, exportRangeEnd).length;
              return (
                <p style={{ margin: 0, fontSize: "12px", color: count > 0 ? "#15803d" : "#94a3b8" }}>
                  {count > 0 ? `${count} payroll record${count !== 1 ? "s" : ""} found in this range.` : "No records found in this range."}
                </p>
              );
            })()}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
              <button type="button" onClick={() => setIsExportRangeOpen(false)}
                style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}
                data-testid="button-export-range-cancel">
                Cancel
              </button>
              <button type="button"
                disabled={!exportRangeStart || !exportRangeEnd || exportRangeStart > exportRangeEnd}
                onClick={exportRangeCSV}
                style={{ padding: "9px 14px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#0f172a", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px", opacity: (!exportRangeStart || !exportRangeEnd || exportRangeStart > exportRangeEnd) ? 0.4 : 1 }}
                data-testid="button-export-range-csv">
                <FileText style={{ width: "13px", height: "13px" }} /> CSV
              </button>
              <button type="button"
                disabled={!exportRangeStart || !exportRangeEnd || exportRangeStart > exportRangeEnd}
                onClick={exportRangePDF}
                style={{ padding: "9px 14px", border: "none", background: "#0f172a", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "6px", opacity: (!exportRangeStart || !exportRangeEnd || exportRangeStart > exportRangeEnd) ? 0.4 : 1 }}
                data-testid="button-export-range-pdf">
                <FileText style={{ width: "13px", height: "13px" }} /> PDF
              </button>
            </div>
          </div>
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
              <Link href="/payroll/worksheet" className="flex items-center gap-2 rounded-[9px] border border-primary px-3.5 py-2 text-[13px] font-semibold text-primary no-underline hover:bg-primary/5" data-testid="link-gusto-worksheet">
                <ClipboardList className="h-3.5 w-3.5" /> Gusto worksheet
              </Link>
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
              {activeSection === "payroll" && (payrollRecords?.length ?? 0) > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button style={{ display: "flex", alignItems: "center", gap: "6px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--muted)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }} data-testid="button-export-payroll">
                      <Download style={{ width: "14px", height: "14px" }} /> Export
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4}>
                    {currentRecords.length > 0 && (
                      <>
                        <DropdownMenuItem onClick={exportCSV} data-testid="button-export-csv">
                          <FileText className="h-4 w-4 mr-2" /> Download CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={exportPDF} data-testid="button-export-pdf">
                          <FileText className="h-4 w-4 mr-2" /> Download PDF
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuItem onClick={() => { setExportRangeStart(""); setExportRangeEnd(""); setIsExportRangeOpen(true); }} data-testid="button-export-range">
                      <Download className="h-4 w-4 mr-2" /> Export range…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                  {s.key === "smslog" && <MessageSquare style={{ width: "12px", height: "12px" }} />}
                  {s.label}
                  {s.key === "payroll" && !active && (payrollRecords?.filter(r => r.status === "pending").length ?? 0) > 0 && (
                    <span className="font-mono" style={{ fontSize: "11px", fontWeight: 600, padding: "0 6px", borderRadius: "5px", background: "var(--b-amber-bg)", color: "var(--b-amber-fg)" }}>
                      {payrollRecords!.filter(r => r.status === "pending").length}
                    </span>
                  )}
                  {s.key === "smslog" && !active && smsRejectedCount > 0 && (
                    <span className="font-mono" style={{ fontSize: "11px", fontWeight: 600, padding: "0 6px", borderRadius: "5px", background: "#fee2e2", color: "#b91c1c" }}>
                      {smsRejectedCount}
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
                <span style={{ width: "104px", flexShrink: 0, textAlign: "center" }}>Payment</span>
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
                    {/* Payment method */}
                    <span style={{ width: "104px", flexShrink: 0, display: "flex", justifyContent: "center" }} onClick={e => e.stopPropagation()}>
                      <button
                        data-testid={`payment-method-${r.id}`}
                        onClick={() => { setEditingEmployee(r.employee as any); setIsEmployeeDialogOpen(true); }}
                        title={`Click to edit employee${(r as any).hasDirectDeposit ? " (Direct Deposit)" : " (Check)"}`}
                        style={{ border: "none", cursor: "pointer", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "4px", ...(
                          (r as any).hasDirectDeposit
                            ? { background: "var(--b-green-bg, #dcfce7)", color: "var(--b-green-fg, #15803d)" }
                            : { background: "var(--b-gray-bg, #f1f5f9)", color: "var(--b-gray-fg, #475569)" }
                        ) }}>
                        {(r as any).hasDirectDeposit
                          ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>Direct Deposit</>
                          : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/><path d="M6 14h4"/></svg>Check</>
                        }
                      </button>
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
                  <span style={{ width: "104px", flexShrink: 0 }}></span>
                  <span style={{ width: "28px", flexShrink: 0 }}></span>
                </div>
              )}

              {/* Mark all paid action */}
              {crewRows.length > 0 && currentRecords.some(r => r.status === "pending") && currentPeriod && (
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "10px", padding: "10px 18px", borderTop: "1px solid var(--panel-bd)", background: "var(--panel)" }}>
                  <span style={{ fontSize: "12px", color: "var(--faint)" }}>
                    {currentRecords.filter(r => r.status === "pending").length} record{currentRecords.filter(r => r.status === "pending").length !== 1 ? "s" : ""} pending payment
                  </span>
                  <button
                    onClick={() => markAllPaidMutation.mutate({ periodStart: currentPeriod.start, periodEnd: currentPeriod.end })}
                    disabled={markAllPaidMutation.isPending}
                    data-testid="button-mark-all-paid"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 14px", border: "none", borderRadius: "8px", background: "#15803d", color: "#fff", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: markAllPaidMutation.isPending ? 0.7 : 1 }}
                  >
                    <CheckCircle style={{ width: "13px", height: "13px" }} />
                    {markAllPaidMutation.isPending ? "Marking paid…" : "Mark all paid"}
                  </button>
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
                <span style={{ width: "92px", flexShrink: 0, textAlign: "center" }}>Bank</span>
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
                        <div style={{ fontSize: "13.5px", fontWeight: 600, display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                          <Link
                            href={`/payroll/worksheet?employeeId=${emp.id}`}
                            className="text-foreground hover:text-primary hover:underline"
                            data-testid={`link-run-payroll-${emp.id}`}
                          >
                            {emp.name}
                          </Link>
                          {!emp.phone && active && (
                            <span title="No phone — can't log hours by SMS" style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: "var(--b-amber-bg)", color: "var(--b-amber-fg)", fontSize: "10.5px", fontWeight: 600, padding: "1px 7px", borderRadius: "5px" }} data-testid={`badge-no-phone-${emp.id}`}>
                              <PhoneOff style={{ width: "10px", height: "10px" }} />No phone
                            </span>
                          )}
                          {emp.onboardingIncomplete && (
                            <span title="Onboarding incomplete — click Edit to review" style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: "var(--b-amber-bg)", color: "var(--b-amber-fg)", fontSize: "10.5px", fontWeight: 600, padding: "1px 7px", borderRadius: "5px", cursor: "pointer" }}
                              onClick={() => { setEditingEmployee(emp); setIsEmployeeDialogOpen(true); }}
                              data-testid={`badge-onboarding-incomplete-${emp.id}`}>
                              <ClipboardList style={{ width: "10px", height: "10px" }} />Incomplete
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
                    {/* Bank status */}
                    <span style={{ width: "92px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      {empBankAccountsList !== undefined ? (
                        connectedBankIds.has(emp.id) ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => { setEditingEmployee(emp); setIsEmployeeDialogOpen(true); }}
                                style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "5px", background: "#f0fdf4", color: "#16a34a", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
                                data-testid={`badge-bank-connected-${emp.id}`}
                              >
                                <Landmark style={{ width: "10px", height: "10px" }} />
                                Connected
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Direct deposit connected — click to view</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => { setEditingEmployee(emp); setIsEmployeeDialogOpen(true); }}
                                style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "5px", background: "#fff7ed", color: "#c2410c", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
                                data-testid={`badge-bank-missing-${emp.id}`}
                              >
                                <Landmark style={{ width: "10px", height: "10px" }} />
                                Not set up
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>No direct deposit — click to set up</TooltipContent>
                          </Tooltip>
                        )
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
                          <DropdownMenuItem asChild>
                            <Link href={`/payroll/worksheet?employeeId=${emp.id}`} data-testid={`button-run-gusto-payroll-${emp.id}`}>
                              <ClipboardList className="h-4 w-4 mr-2" />Prepare Gusto payroll
                            </Link>
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
                <div style={{ width: "1px", height: "20px", background: "var(--panel-bd)", margin: "0 4px" }} />
                {(["all","manual","sms"] as const).map(f => {
                  const labels: Record<string, string> = { all: "All sources", manual: "Manual", sms: "SMS" };
                  const active = sourceFilter === f;
                  return (
                    <button key={f} onClick={() => setSourceFilter(f)}
                      style={{ border: "1px solid " + (active ? "transparent" : "var(--panel-bd)"), background: active ? (f === "sms" ? "#2563eb" : "var(--jox-primary)") : "var(--panel)", color: active ? "#fff" : "var(--muted)", borderRadius: "7px", padding: "5px 12px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px" }}
                      data-testid={`filter-source-${f}`}>
                      {f === "sms" && <MessageSquare style={{ width: "11px", height: "11px" }} />}
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
                <span style={{ width: "150px", flexShrink: 0 }}>Employee</span>
                <span style={{ flex: 1, minWidth: 0 }}>Job</span>
                <span style={{ width: "68px", flexShrink: 0, textAlign: "center" }}>Source</span>
                <span style={{ width: "80px", flexShrink: 0, textAlign: "right" }}>Hours</span>
                <span style={{ width: "96px", flexShrink: 0, textAlign: "right" }}>Pay</span>
                <span style={{ width: "160px", flexShrink: 0 }}>Description</span>
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

              {filteredTimeEntries.map((entry) => {
                const isSms = entry.source === "sms";
                return (
                  <div key={entry.id} className="rowhover" style={{ display: "flex", alignItems: "center", padding: "11px 18px", borderBottom: "1px solid var(--panel-bd)" }} data-testid={`row-time-${entry.id}`}>
                    <span style={{ width: "96px", flexShrink: 0, fontSize: "12.5px", color: "var(--muted)" }}>
                      {format(new Date(entry.date), "MMM d, yyyy")}
                    </span>
                    <span style={{ width: "150px", flexShrink: 0, fontSize: "13px", fontWeight: 500 }}>{entry.employee?.name ?? "—"}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(entry as any).job?.title ?? "—"}</span>
                    <span style={{ width: "68px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      {isSms ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "5px", background: "var(--b-blue-bg, #eff6ff)", color: "var(--b-blue-fg, #1d4ed8)", whiteSpace: "nowrap" }} data-testid={`badge-source-sms-${entry.id}`}>
                          <MessageSquare style={{ width: "9px", height: "9px" }} />SMS
                        </span>
                      ) : (
                        <span style={{ fontSize: "10.5px", color: "var(--faint)" }} data-testid={`badge-source-manual-${entry.id}`}>Manual</span>
                      )}
                    </span>
                    <span className="font-mono" style={{ width: "80px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600 }}>{Number(entry.hoursWorked).toFixed(1)} hrs</span>
                    <span className="font-mono" style={{ width: "96px", flexShrink: 0, textAlign: "right", fontSize: "12.5px" }}>{fmtFull(Number(entry.hoursWorked) * Number(entry.employee?.dayRate ?? 0))}</span>
                    <span style={{ width: "160px", flexShrink: 0, fontSize: "12px", color: "var(--faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.description || "—"}</span>
                    <span style={{ width: "28px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={() => setDeleteTimeEntryId(entry.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px", display: "flex" }} data-testid={`button-delete-time-${entry.id}`}>
                        <Trash2 style={{ width: "14px", height: "14px" }} />
                      </button>
                    </span>
                  </div>
                );
              })}

              {!timeLoading && filteredTimeEntries.length > 0 && (
                <div style={{ padding: "12px 18px", fontSize: "12.5px", color: "var(--faint)" }}>
                  {filteredTimeEntries.length} entr{filteredTimeEntries.length !== 1 ? "ies" : "y"} · {filteredTimeEntries.reduce((s, e) => s + Number(e.hoursWorked), 0).toFixed(1)} total hours
                  {smsEntryCount > 0 && <> · <span style={{ color: "var(--b-blue-fg, #1d4ed8)", fontWeight: 600 }}>{smsEntryCount} via SMS</span></>}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════ */}
          {/* ── SMS LOG ── */}
          {activeSection === "smslog" && (
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", borderBottom: "1px solid var(--panel-bd)", background: "var(--track)" }}>
                <MessageSquare style={{ width: "15px", height: "15px", color: "var(--jox-primary)" }} />
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 700 }}>SMS Activity Log</div>
                  <div style={{ fontSize: "12px", color: "var(--faint)" }}>All inbound SMS messages — successful logs and rejections</div>
                </div>
                {smsRejectedCount > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 600, padding: "4px 10px", borderRadius: "7px", background: "#fee2e2", color: "#b91c1c" }}>
                    {smsRejectedCount} rejected
                  </span>
                )}
              </div>

              <div style={{ ...TH }}>
                <span style={{ width: "148px", flexShrink: 0 }}>Time</span>
                <span style={{ width: "130px", flexShrink: 0 }}>From</span>
                <span style={{ width: "140px", flexShrink: 0 }}>Employee</span>
                <span style={{ width: "78px", flexShrink: 0, textAlign: "center" }}>Status</span>
                <span style={{ width: "64px", flexShrink: 0, textAlign: "right" }}>Hours</span>
                <span style={{ flex: 1, minWidth: 0 }}>Message</span>
              </div>

              {smsLoading && <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>Loading SMS log…</div>}

              {!smsLoading && smsAttempts.length === 0 && (
                <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                  <div style={{ fontSize: "32px", marginBottom: "10px" }}>📱</div>
                  <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>No SMS activity yet</div>
                  <div style={{ fontSize: "13px", color: "var(--faint)" }}>When employees text in their hours, all attempts will appear here.</div>
                </div>
              )}

              {smsAttempts.map((attempt) => {
                const badge = SMS_STATUS[attempt.status] ?? { bg: "var(--b-gray-bg)", fg: "var(--b-gray-fg)", label: attempt.status };
                const isRejected = !["ok", "help"].includes(attempt.status);
                return (
                  <div key={attempt.id} className="rowhover" style={{ display: "flex", alignItems: "center", padding: "10px 18px", borderBottom: "1px solid var(--panel-bd)", background: isRejected ? "rgba(254,226,226,0.18)" : undefined }} data-testid={`row-sms-${attempt.id}`}>
                    <span style={{ width: "148px", flexShrink: 0, fontSize: "12px", color: "var(--muted)" }}>
                      {format(new Date(attempt.createdAt), "MMM d, h:mm a")}
                    </span>
                    <span className="font-mono" style={{ width: "130px", flexShrink: 0, fontSize: "12px", color: "var(--faint)" }}>
                      {attempt.fromPhone}
                    </span>
                    <span style={{ width: "140px", flexShrink: 0, fontSize: "13px", fontWeight: attempt.employeeName ? 500 : 400, color: attempt.employeeName ? "var(--fg)" : "var(--faint)" }}>
                      {attempt.employeeName ?? <span style={{ fontStyle: "italic" }}>Unknown</span>}
                    </span>
                    <span style={{ width: "78px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "2px 7px", borderRadius: "5px", background: badge.bg, color: badge.fg, whiteSpace: "nowrap" }} data-testid={`badge-sms-status-${attempt.id}`}>
                        {badge.label}
                      </span>
                    </span>
                    <span className="font-mono" style={{ width: "64px", flexShrink: 0, textAlign: "right", fontSize: "12.5px", color: attempt.hoursRequested ? "var(--fg)" : "var(--faint)" }}>
                      {attempt.hoursRequested ? `${Number(attempt.hoursRequested).toFixed(1)}h` : "—"}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12px", color: "var(--faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: "16px" }}>
                      {attempt.body}
                    </span>
                  </div>
                );
              })}

              {!smsLoading && smsAttempts.length > 0 && (
                <div style={{ padding: "12px 18px", fontSize: "12.5px", color: "var(--faint)" }}>
                  {smsAttempts.length} message{smsAttempts.length !== 1 ? "s" : ""}
                  {" · "}{smsAttempts.filter(a => a.status === "ok").length} logged
                  {smsRejectedCount > 0 && <> · <span style={{ color: "#b91c1c", fontWeight: 600 }}>{smsRejectedCount} rejected</span></>}
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
