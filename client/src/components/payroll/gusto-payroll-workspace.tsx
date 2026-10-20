import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, RefreshCw, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { Employee } from "@shared/schema";

type PayrollRecordRow = {
  employeeId: string;
  grossPay: string;
  totalHours: string;
  employee: Employee;
};
type GustoStatus = {
  configured: boolean; available: boolean; state?: string; companyId?: string; companyName?: string;
  fundingAccount?: { id: string; status: string; accountMask?: string; name?: string } | null;
  onboardingComplete?: boolean; blockers?: string[]; error?: string; environment?: string;
};
type GustoReadiness = { employees?: Array<{ id: string; name?: string; ready: boolean; blockers?: string[]; gustoEmployeeId?: string | null }> };
type GustoRun = {
  id: string; status: string; providerStatus?: string; error?: string; blockers?: string[];
  periodStart?: string; periodEnd?: string; payDate?: string; expectedDebit?: number; expectedDebitDate?: string;
  totals?: { gross?: number; deductions?: number; taxes?: number | null; reimbursements?: number; net?: number };
  employees?: Array<{ id?: string; name?: string; hours?: number; days?: number; earnings?: number; deductions?: number | null; taxes?: number | null; reimbursements?: number | null; netPay?: number | null }>;
  updatedAt?: string; canCancel: boolean; canRecalculate?: boolean; canSubmit?: boolean;
};
type RunList = { runs: GustoRun[] };
type FlowType = "company_onboarding" | "add_bank_info" | "verify_bank_info" | "add_employees" | "employee_management" | "payroll_history" | "run_payroll";

const flowLabels: Array<{ type: FlowType; label: string }> = [
  { type: "company_onboarding", label: "Complete company setup" },
  { type: "add_bank_info", label: "Set up Gusto funding" },
  { type: "verify_bank_info", label: "Verify funding in Gusto" },
  { type: "add_employees", label: "Add employees in Gusto" },
  { type: "employee_management", label: "Manage employees" },
  { type: "payroll_history", label: "Gusto payroll history" },
  { type: "run_payroll", label: "Open Gusto payroll" },
];
const pendingStatuses = new Set(["calculating", "submitting", "submission_pending", "processing", "unknown", "cancelling", "submitted"]);
const money = (value?: number | null) => typeof value === "number"
  ? value.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";
const hasPositiveRunAmount = (run: GustoRun) =>
  [run.expectedDebit, run.totals?.gross, run.totals?.net, ...((run.employees ?? []).flatMap(employee => [employee.earnings, employee.netPay]))]
    .some(value => typeof value === "number" && value > 0);
const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "8px 12px", background: "var(--panel)",
  color: "var(--fg)", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};

export default function GustoPayrollWorkspace({ records, period }: { records: PayrollRecordRow[]; period: { start: string; end: string } | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState("");
  const [payDate, setPayDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [flowUrl, setFlowUrl] = useState("");
  const [flowTitle, setFlowTitle] = useState("");
  const [flowBeforeWarning, setFlowBeforeWarning] = useState<FlowType | null>(null);
  const [fundingWarning, setFundingWarning] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const statusQuery = useQuery<GustoStatus>({ queryKey: ["/api/gusto/status"], staleTime: 30_000, retry: false });
  const runsQuery = useQuery<RunList>({
    queryKey: ["/api/gusto/payroll-runs"],
    queryFn: async () => {
      const response = await fetch("/api/gusto/payroll-runs", { credentials: "include" });
      if (!response.ok) throw new Error("Payroll run history could not load.");
      return response.json();
    },
    staleTime: 15_000,
    retry: false,
  });
  const readinessQuery = useQuery<GustoReadiness>({ queryKey: ["/api/gusto/employees/readiness"], staleTime: 30_000, retry: false });
  const runList = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data?.runs]);
  const selectedRun = runList.find(item => item.id === runId);
  const runQuery = useQuery<GustoRun>({
    queryKey: ["/api/gusto/payroll-runs", runId],
    enabled: !!runId,
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status && pendingStatuses.has(status) ? 5000 : false;
    },
    retry: false,
  });
  const run = runQuery.data ?? selectedRun;
  const status = statusQuery.data;
  const runStatus = run?.status ?? "";
  const pending = pendingStatuses.has(runStatus);
  const readyEmployees = readinessQuery.data?.employees ?? [];
  const readinessById = useMemo(() => new Map(readyEmployees.map(employee => [employee.id, employee])), [readyEmployees]);
  const reviewItems = useMemo(() => {
    const byEmployee = new Map<string, { employeeId: string; name: string; hours: number; grossEstimate: number; payType: string }>();
    records.forEach(record => {
      const hours = Number(record.totalHours) || 0;
      const grossEstimate = Number(record.grossPay) || 0;
      if (hours <= 0 && grossEstimate <= 0) return;
      const employeeId = String(record.employeeId);
      const payType = (record.employee as Employee & { payType?: string }).payType ?? "hourly";
      const existing = byEmployee.get(employeeId);
      if (existing) {
        existing.hours += hours;
        existing.grossEstimate += grossEstimate;
      } else {
        byEmployee.set(employeeId, { employeeId, name: record.employee?.name ?? "Employee", hours, grossEstimate, payType });
      }
    });
    return [...byEmployee.values()];
  }, [records]);
  // Saved local records contain hours but no explicit worked-day count. Never
  // infer provider compensation days from an assumed eight-hour workday.
  const reviewMismatches = reviewItems.filter(item => item.payType === "day");
  const readinessComplete = !readinessQuery.isLoading && !readinessQuery.isError && Array.isArray(readinessQuery.data?.employees);
  const employeeBlockers = reviewItems.flatMap(item => {
    const employee = readinessById.get(item.employeeId);
    if (!readinessComplete) return [`${item.name}: Gusto employee readiness is not available.`];
    if (!employee) return [`${item.name}: No Gusto readiness record was returned.`];
    return employee.ready === false ? [`${item.name}: ${(employee.blockers ?? ["Gusto employee setup is incomplete."]).join(", ")}`] : [];
  });
  const samePeriodRun = period && runList.find(item =>
    String(item.periodStart ?? "").slice(0, 10) === period.start
    && String(item.periodEnd ?? "").slice(0, 10) === period.end
    && !["paid", "processed", "cancelled"].includes(item.status),
  );
  const canCreate = !!period && !!payDate && reviewItems.length > 0 && !reviewMismatches.length && !employeeBlockers.length
    && readinessComplete && !runsQuery.isLoading && !runsQuery.isError && !samePeriodRun
    && status?.configured === true && status.available === true && !busy;

  useEffect(() => {
    if (period) {
      setPayDate(period.end);
    }
  }, [period?.start, period?.end]);

  async function perform<T = unknown>(method: string, path: string, body?: unknown): Promise<T | null> {
    setBusy(true);
    try {
      const response = await apiRequest(method, path, body);
      const value = await response.json().catch(() => null) as T | null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/gusto/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/gusto/payroll-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/gusto/employees/readiness"] }),
      ]);
      return value ?? ({} as T);
    } catch (error) {
      toast({ title: "Gusto action failed", description: (error as Error).message, variant: "destructive" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startFlow(flowType: FlowType, label: string) {
    setBusy(true);
    setFlowUrl("");
    try {
      const response = await apiRequest("POST", "/api/gusto/flows", { flowType });
      const result = await response.json() as { url?: string };
      if (!result.url) throw new Error("Gusto did not provide a secure setup link.");
      const url = new URL(result.url);
      if (url.protocol !== "https:" || !["https://flows.gusto-demo.com", "https://flows.gusto.com"].includes(url.origin)
        || !url.pathname.startsWith("/flows/")) {
        throw new Error("Gusto returned a link outside its secure domain. Try again or contact support.");
      }
      setFlowTitle(label);
      setFlowUrl(url.toString());
    } catch (error) {
      toast({ title: "Could not open Gusto", description: (error as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function openFlow(flowType: FlowType, label: string) {
    if (flowType === "add_bank_info") {
      setFlowBeforeWarning(flowType);
      setFlowTitle(label);
      setFundingWarning(true);
      return;
    }
    void startFlow(flowType, label);
  }

  async function createRun() {
    if (!canCreate || !period) return;
    idempotencyKey.current ??= crypto.randomUUID();
    const created = await perform<GustoRun>("POST", "/api/gusto/payroll-runs", {
      periodStart: period.start,
      periodEnd: period.end,
      payDate,
      idempotencyKey: idempotencyKey.current,
      items: reviewItems.map(({ employeeId, hours, grossEstimate }) => ({
        employeeId, hours, grossEarnings: grossEstimate,
      })),
    });
    if (created?.id) {
      idempotencyKey.current = null;
      setRunId(created.id);
      toast({
        title: "Gusto payroll review created",
        description: created.status === "calculating"
          ? "Gusto is calculating payroll. No local tax estimate was submitted."
          : "Review created in Gusto. Choose Calculate with Gusto to start provider calculation.",
      });
    }
  }

  async function submitReviewedRun() {
    if (!run || run.status !== "ready_for_review" || run.canSubmit === false || !run.updatedAt) return;
    await perform("POST", `/api/gusto/payroll-runs/${run.id}/submit`, { reviewedUpdatedAt: run.updatedAt });
  }

  function closeFlow() {
    setFlowUrl("");
    setFlowTitle("");
    void statusQuery.refetch();
    void readinessQuery.refetch();
  }

  const panel: React.CSSProperties = {
    border: "1px solid var(--panel-bd)", borderRadius: "10px", padding: "14px", background: "var(--panel)",
  };

  return (
    <section style={{ marginBottom: "18px", display: "flex", flexDirection: "column", gap: "12px" }} aria-label="Gusto payroll workspace" data-testid="gusto-payroll-workspace">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
        <div><div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)" }}>Gusto payroll</div><h3 style={{ margin: "4px 0 0", fontSize: "18px" }}>Provider-run payroll</h3>
          <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: "12px" }}>JobsOxo prepares source records. Gusto calculates taxes, deductions and take-home pay.</p>
        </div>
        <button type="button" style={buttonStyle} onClick={() => void statusQuery.refetch()} disabled={statusQuery.isFetching}>
          <RefreshCw aria-hidden="true" style={{ width: "12px", height: "12px", verticalAlign: "middle", marginRight: "5px" }} />Refresh Gusto status
        </button>
      </div>

      {statusQuery.isLoading ? <div style={{ ...panel, color: "var(--muted)", fontSize: "13px" }}>Loading Gusto workspace…</div> : null}
      {statusQuery.isError && <div role="alert" style={{ ...panel, color: "var(--jx-orange-ink)", background: "var(--jx-orange-tint)" }}>Gusto status is unavailable. The independent bank view and local payroll history remain available. <button type="button" style={buttonStyle} onClick={() => void statusQuery.refetch()}>Retry</button></div>}

      {!statusQuery.isLoading && status && (
        <>
          <div style={panel}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", gap: "10px" }}>
                <Building2 aria-hidden="true" style={{ width: "18px", color: "var(--jox-primary)", marginTop: "2px" }} />
                <div><div style={{ fontSize: "13px", fontWeight: 700 }}>{status.companyName || "Gusto company"}</div>
                  <div style={{ marginTop: "3px", color: "var(--muted)", fontSize: "12px" }}>
                    {status.companyId ? `Company ${status.companyId}` : "Company not connected"} · {status.environment || "Gusto"}
                    {status.onboardingComplete ? " · Company setup complete" : " · Company setup incomplete"}
                  </div>
                  <div style={{ marginTop: "5px", color: "var(--muted)", fontSize: "12px" }}>
                    Funding: {status.fundingAccount?.name || "Not configured"}{status.fundingAccount?.accountMask ? ` · ••••${status.fundingAccount.accountMask}` : ""}{status.fundingAccount?.status ? ` · ${status.fundingAccount.status}` : ""}
                  </div>
                  {status.fundingAccount?.status === "verified" && <p role="note" style={{ color: "var(--muted)", fontSize: "11px", margin: "5px 0 0" }}>Gusto currently reports this funding account as verified. This status is read-only here; any verification steps or changes take place in Gusto.</p>}
                  {status.error && <div role="status" style={{ color: "var(--jx-orange-ink)", fontSize: "12px", marginTop: "5px" }}>{status.error}</div>}
                  {status.blockers?.map((blocker, index) => <div key={`${blocker}-${index}`} style={{ color: "var(--jx-orange-ink)", fontSize: "12px", marginTop: "4px" }}><AlertTriangle aria-hidden="true" style={{ width: "12px", height: "12px", verticalAlign: "middle", marginRight: "5px" }} />{blocker}</div>)}
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                {!status.companyId && <button type="button" style={buttonStyle} disabled={busy || !status.configured} onClick={() => void perform("POST", "/api/gusto/connect")}>Connect Gusto company</button>}
                <button type="button" style={buttonStyle} disabled={busy || !status.configured} onClick={() => void perform("POST", "/api/gusto/sync")}>Sync readiness</button>
                <button type="button" style={buttonStyle} disabled={busy || !status.configured} onClick={() => void openFlow("add_bank_info", "Set up Gusto funding")}>Funding setup</button>
              </div>
            </div>
            {!status.configured && <p style={{ color: "var(--jx-orange-ink)", fontSize: "12px", margin: "10px 0 0" }}>Gusto credentials are not configured. Payroll submission is unavailable; no manual payment route is offered.</p>}
          </div>

          <div style={panel}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 700 }}><Users aria-hidden="true" style={{ width: "15px", height: "15px" }} />Gusto employee setup</div>
              <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                <button type="button" style={buttonStyle} disabled={busy || !status.configured} onClick={() => void openFlow("add_employees", "Add employees in Gusto")}>Add employees</button>
                <button type="button" style={buttonStyle} disabled={busy} onClick={async () => {
                  const result = await perform("POST", "/api/gusto/employees/sync");
                  if (result !== null) {
                    await queryClient.invalidateQueries({ queryKey: ["/api/gusto/employees/readiness"] });
                    await queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
                    toast({ title: "Gusto employee details synced" });
                  }
                }}>Sync Gusto payment methods</button>
              </div>
            </div>
            {readinessQuery.isLoading ? <p style={{ color: "var(--muted)", fontSize: "12px" }}>Checking Gusto employee setup…</p>
              : readinessQuery.isError ? <p role="alert" style={{ color: "var(--jx-orange-ink)", fontSize: "12px" }}>Gusto employee readiness could not load. Retry after syncing the company.</p>
                : readyEmployees.length === 0 ? <p style={{ color: "var(--muted)", fontSize: "12px", marginBottom: 0 }}>No Gusto employees are linked yet.</p>
                  : readyEmployees.map(employee => <div key={employee.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", padding: "8px 0", borderTop: "1px solid var(--panel-bd)", fontSize: "12px" }}>
                    <span>{employee.name || "Employee"}{employee.gustoEmployeeId ? <span style={{ color: "var(--muted)" }}> · Gusto linked</span> : ""}</span>
                    <span style={{ color: employee.ready ? "var(--jx-green-ink)" : "var(--jx-orange-ink)", textAlign: "right" }}>{employee.ready ? "Gusto payment method ready" : (employee.blockers?.join(", ") || "Gusto setup needed")}</span>
                  </div>)}
          </div>

          {reviewMismatches.length > 0 && <div role="alert" style={{ ...panel, borderColor: "var(--jx-gold)", color: "var(--jx-gold-ink)", fontSize: "12px" }}>
            Daily-pay employees need an explicit worked-day count before Gusto review: {reviewMismatches.map(item => item.name).join(", ")}. Saved hours are not converted using an assumed eight-hour day, and gross is not submitted as bonus pay.
          </div>}
          {employeeBlockers.length > 0 && <div role="alert" style={{ ...panel, borderColor: "var(--jx-gold)", color: "var(--jx-gold-ink)", fontSize: "12px" }}>Gusto employee setup blocks this review: {employeeBlockers.join(" · ")}</div>}
          {samePeriodRun && !run && <div role="alert" style={{ ...panel, borderColor: "var(--jx-gold)", color: "var(--jx-gold-ink)", fontSize: "12px" }}>
            A Gusto run for this period is unresolved ({samePeriodRun.status}). Open it to reconcile or continue; a second review cannot be created for this period.
            <button type="button" style={{ ...buttonStyle, marginLeft: "10px" }} onClick={() => setRunId(samePeriodRun.id)}>Open existing Gusto run</button>
          </div>}

          {!run && !samePeriodRun && (
            <div style={panel}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
                <div><div style={{ fontSize: "12px", fontWeight: 700 }}>Payroll source review · {reviewItems.length} employee{reviewItems.length === 1 ? "" : "s"}</div><div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "3px" }}>Gross values are estimates from saved local records. Gusto calculates final payroll; no local tax totals are sent.</div></div>
                {period && <label style={{ fontSize: "11px", color: "var(--muted)" }}>Pay date<input aria-label="Gusto pay date" data-testid="input-gusto-pay-date" type="date" min={period.end} value={payDate} onChange={event => setPayDate(event.target.value)} style={{ display: "block", ...buttonStyle, marginTop: "4px", color: "var(--fg)" }} /></label>}
              </div>
              {reviewItems.length === 0 ? <p style={{ color: "var(--muted)", fontSize: "12px", marginBottom: 0 }}>No local payroll source records for this period. The local worksheet and history remain available.</p>
                : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead><tr>{["Employee", "Source hours", "Local gross estimate", "Gusto setup"].map(label => <th key={label} style={{ textAlign: label === "Employee" ? "left" : "right", padding: "8px", color: "var(--muted)", borderBottom: "1px solid var(--panel-bd)" }}>{label}</th>)}</tr></thead>
                  <tbody>{reviewItems.map(item => <tr key={item.employeeId}><td style={{ padding: "8px", borderBottom: "1px solid var(--panel-bd)" }}>{item.name}</td><td style={{ padding: "8px", textAlign: "right", borderBottom: "1px solid var(--panel-bd)" }}>{item.hours.toFixed(2)}h</td><td style={{ padding: "8px", textAlign: "right", borderBottom: "1px solid var(--panel-bd)" }}>{money(item.grossEstimate)}</td><td style={{ padding: "8px", textAlign: "right", borderBottom: "1px solid var(--panel-bd)", color: readinessById.get(item.employeeId)?.ready ? "var(--jx-green-ink)" : "var(--jx-orange-ink)" }}>{readinessById.get(item.employeeId)?.ready ? "Ready" : "Needs setup"}</td></tr>)}</tbody>
                </table></div>}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}><button type="button" style={{ ...buttonStyle, background: "var(--jox-primary)", color: "#fff", border: 0 }} disabled={!canCreate} onClick={() => void createRun()}>{busy ? "Creating…" : "Create Gusto payroll review"}</button></div>
            </div>
          )}

          {run && <div style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <strong>Gusto run {run.id.slice(0, 8)} · {run.status}</strong>
              <span style={{ color: "var(--muted)", fontSize: "11px" }}>{run.periodStart} – {run.periodEnd}{run.payDate ? ` · Pay date ${run.payDate}` : ""}</span>
            </div>
            {pending && <p role="status" style={{ padding: "9px", background: "var(--jx-gold-tint)", color: "var(--jx-gold-ink)", fontSize: "12px" }}>Gusto has not reached a final status for this run. Do not submit again or create another run. Reconcile its status to continue.</p>}
            {run.error && <p role="alert" style={{ color: "var(--jx-orange-ink)", fontSize: "12px" }}>{run.error}</p>}
            {run.blockers?.map((blocker, index) => <p key={`${blocker}-${index}`} style={{ color: "var(--jx-orange-ink)", fontSize: "12px" }}><AlertTriangle aria-hidden="true" style={{ width: "12px", height: "12px", verticalAlign: "middle", marginRight: "5px" }} />{blocker}</p>)}
            {run.employees && <div style={{ overflowX: "auto", marginTop: "10px" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}><tbody>
              {run.employees.map((employee, index) => <tr key={employee.id || index}><td style={{ padding: "8px", borderTop: "1px solid var(--panel-bd)" }}>{employee.name || reviewItems.find(item => item.employeeId === employee.id)?.name || "Employee"}</td><td style={{ padding: "8px", textAlign: "right", borderTop: "1px solid var(--panel-bd)" }}>{employee.hours == null ? "—" : `${employee.hours}h`}{typeof employee.days === "number" ? ` / ${employee.days}d` : ""}</td><td style={{ padding: "8px", textAlign: "right", borderTop: "1px solid var(--panel-bd)" }}>Gusto earnings {money(employee.earnings)}</td><td style={{ padding: "8px", textAlign: "right", borderTop: "1px solid var(--panel-bd)" }}>Gusto taxes {money(employee.taxes)} · Net {money(employee.netPay)}</td></tr>)}
            </tbody></table></div>}
            {run.employees?.some(employee => employee.taxes == null || employee.netPay == null) && <p role="status" style={{ color: "var(--muted)", fontSize: "11px", margin: "8px 0 0" }}>Gusto has not supplied all employee-level tax and net values yet. Values appear after Gusto processes the run; no local estimates are substituted.</p>}
            {run.totals && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: "8px", background: "var(--track)", padding: "10px", marginTop: "10px", fontSize: "12px" }}>
              {Object.entries(run.totals).map(([key, value]) => <div key={key}><span style={{ color: "var(--muted)", display: "block" }}>Gusto {key}</span><strong>{money(value)}</strong></div>)}
              <div><span style={{ color: "var(--muted)", display: "block" }}>Expected debit</span><strong>{money(run.expectedDebit)}</strong></div>
            </div>}
            {run.status === "processed" && hasPositiveRunAmount(run) && <p style={{ color: "var(--muted)", fontSize: "11px" }}>Gusto reports that the company debit was initiated. This does not mean employee payments were initiated or settled.</p>}
            {run.status === "paid" && hasPositiveRunAmount(run) && <p style={{ color: "var(--muted)", fontSize: "11px" }}>Gusto reports employee payments initiated. This does not confirm that funds have settled in employees’ bank accounts.</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "7px", flexWrap: "wrap", marginTop: "12px" }}>
              <button type="button" style={buttonStyle} disabled={busy} onClick={() => void perform("POST", `/api/gusto/payroll-runs/${run.id}/status`)}>Reconcile Gusto status</button>
              {run.canRecalculate === true && !pending && <button type="button" style={buttonStyle} disabled={busy} onClick={() => void perform("POST", `/api/gusto/payroll-runs/${run.id}/calculate`)}>Calculate with Gusto</button>}
              {run.status === "ready_for_review" && run.canSubmit !== false && <button type="button" style={{ ...buttonStyle, background: "var(--jox-primary)", color: "#fff", border: 0 }} disabled={busy || !run.updatedAt} onClick={() => setSubmitConfirm(true)}>Submit reviewed totals to Gusto</button>}
              {run.canCancel && <button type="button" style={buttonStyle} disabled={busy} onClick={() => setCancelConfirm(true)}>Cancel Gusto run</button>}
              <button type="button" style={buttonStyle} onClick={() => { setRunId(""); idempotencyKey.current = null; }}>Back to period review</button>
            </div>
          </div>}

        </>
      )}

      {runsQuery.isLoading && <div style={{ ...panel, color: "var(--muted)", fontSize: "12px" }}>Loading Gusto payroll history…</div>}
      {runsQuery.isError && <div role="alert" style={{ ...panel, color: "var(--jx-orange-ink)", fontSize: "12px" }}>Gusto payroll history could not load. <button type="button" style={buttonStyle} onClick={() => void runsQuery.refetch()}>Retry</button></div>}
      {runList.length > 0 && <details style={panel} data-testid="gusto-payroll-history">
        <summary style={{ cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>Gusto payroll history ({runList.length})</summary>
        <div style={{ marginTop: "8px" }}>{runList.map(item => <button key={item.id} type="button" onClick={() => setRunId(item.id)} style={{ display: "flex", justifyContent: "space-between", width: "100%", textAlign: "left", border: 0, borderTop: "1px solid var(--panel-bd)", padding: "9px 0", background: "transparent", color: "var(--fg)", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" }}>
          <span>{item.periodStart} – {item.periodEnd} · {item.status}</span><span>{hasPositiveRunAmount(item) ? item.status === "paid" ? "Employee payments initiated" : item.status === "processed" ? "Company debit initiated" : "" : ""}</span>
        </button>)}</div>
      </details>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }} aria-label="Gusto hosted workflows">
        {flowLabels.map(flow => <button key={flow.type} type="button" style={buttonStyle} disabled={busy || status?.configured !== true} onClick={() => void openFlow(flow.type, flow.label)}>{flow.label}</button>)}
      </div>

      <Dialog open={!!flowUrl} onOpenChange={open => { if (!open) closeFlow(); }}>
        <DialogContent className="max-w-5xl !flex flex-col h-[85dvh] max-h-[850px]">
          <DialogHeader><DialogTitle>{flowTitle}</DialogTitle><DialogDescription>Secure Gusto workflow displayed inside JobsOxo. Close this window when finished to refresh setup status.</DialogDescription></DialogHeader>
          {flowUrl && <iframe key={flowUrl} title={flowTitle} src={flowUrl} className="min-h-0 flex-1 w-full rounded border border-border" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />}
        </DialogContent>
      </Dialog>
      <AlertDialog open={cancelConfirm} onOpenChange={setCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Cancel this Gusto payroll run?</AlertDialogTitle><AlertDialogDescription>Gusto cancellation reopens an unprocessed payroll. It does not reverse an ACH payment. Continue only if Gusto says this run can be cancelled.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep run</AlertDialogCancel><AlertDialogAction onClick={() => { setCancelConfirm(false); if (run?.canCancel) void perform("POST", `/api/gusto/payroll-runs/${run.id}/cancel`); }}>Cancel run in Gusto</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={submitConfirm} onOpenChange={setSubmitConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit reviewed payroll to Gusto?</AlertDialogTitle>
            <AlertDialogDescription>
              Gusto will debit the company funding account and initiate employee ACH payments. Confirm that these exact Gusto-calculated totals are reviewed. Payment initiation is not bank settlement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Return to review</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setSubmitConfirm(false);
              void submitReviewedRun();
            }}>Confirm and submit to Gusto</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={fundingWarning} onOpenChange={setFundingWarning}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Change Gusto’s funding account?</AlertDialogTitle><AlertDialogDescription>Gusto may disable its previous default funding account when you replace it. Funding setup happens in Gusto; this read-only bank view is not used for payroll funding.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel onClick={() => setFlowBeforeWarning(null)}>Keep current account</AlertDialogCancel><AlertDialogAction onClick={() => {
            setFundingWarning(false);
            if (flowBeforeWarning) void startFlow(flowBeforeWarning, "Set up Gusto funding");
            setFlowBeforeWarning(null);
          }}>Continue to Gusto</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
