import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, FlaskConical, RefreshCw, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import GustoDemoCompanySetup, { type GustoDemoSetupStatus } from "./gusto-demo-company-setup";
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
type GustoStatus = GustoDemoSetupStatus & {
  configured: boolean; available: boolean; state?: string; companyId?: string; companyName?: string;
  fundingAccount?: { id: string; status: string; accountMask?: string; name?: string } | null;
  onboardingComplete?: boolean; blockers?: string[]; error?: string; environment?: string; companyStatus?: string | null;
};
type UpcomingPayroll = { payrollId: string; periodStart: string; periodEnd: string; payDate: string };
type ReadinessEmployee = { id: string; name?: string; ready: boolean; blockers?: string[]; gustoEmployeeId?: string | null; onboardingStatus?: string | null; paymentMethodStatus?: string | null };
type GustoReadiness = { employees?: ReadinessEmployee[] };

/** Gusto's state for an employee in plain words, plus which action fixes it. */
function describeEmployee(e: ReadinessEmployee): { text: string; action: "invite" | "waiting" | "not_found" | "finish_onboarding" | "direct_deposit" | "contractor" | "ready" } {
  if (e.ready) return { text: "Ready for payroll", action: "ready" };
  if ((e.blockers ?? []).some(b => /contractor/i.test(b))) return { text: "Contractor — not W-2 payroll", action: "contractor" };
  if (!e.gustoEmployeeId) return { text: "Not in Gusto yet", action: "invite" };
  const status = e.onboardingStatus ?? "";
  if (status === "unknown") return { text: "Not found in Gusto — the link may be stale", action: "not_found" };
  if (status.startsWith("self_onboarding_invited")) return { text: "Invitation sent — waiting for the employee to finish", action: "waiting" };
  if (status === "self_onboarding_completed_by_employee" || status === "self_onboarding_awaiting_admin_review") return { text: "Employee finished — review in Gusto", action: "finish_onboarding" };
  if (status !== "complete") return { text: "Gusto onboarding incomplete", action: "finish_onboarding" };
  if (e.paymentMethodStatus !== "complete") return { text: "Direct deposit not set up", action: "direct_deposit" };
  return { text: e.blockers?.join(", ") || "Gusto setup needed", action: "finish_onboarding" };
}
type GustoRun = {
  id: string; status: string; providerStatus?: string; error?: string; blockers?: string[];
  periodStart?: string; periodEnd?: string; payDate?: string; expectedDebit?: number; expectedDebitDate?: string;
  totals?: { gross?: number; deductions?: number; taxes?: number | null; reimbursements?: number; net?: number };
  employees?: Array<{ id?: string; name?: string; hours?: number; days?: number; earnings?: number; deductions?: number | null; taxes?: number | null; reimbursements?: number | null; netPay?: number | null }>;
  updatedAt?: string; canCancel: boolean; canRecalculate?: boolean; canSubmit?: boolean;
};
type RunList = { runs: GustoRun[] };
type SampleStep = { step: string; status: "done" | "skipped" | "failed" | "manual"; detail?: string };
type ImportResult = { imported: string[]; needsRate: string[]; alreadyInJobsOxo: number };

function importResultSteps(result: ImportResult): SampleStep[] {
  return [
    { step: "Imported from Gusto", status: "done", detail: result.imported.length ? result.imported.join(", ") : "No new employees" },
    ...(result.alreadyInJobsOxo ? [{ step: "Already in JobsOxo", status: "skipped" as const, detail: String(result.alreadyInJobsOxo) }] : []),
    ...(result.needsRate.length ? [{ step: "Set a day rate", status: "manual" as const, detail: `Gusto didn't share pay for ${result.needsRate.join(", ")}` }] : []),
  ];
}
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
/** Per-step outcome of a demo sample-data action. */
function SampleResults({ title, steps, testId }: { title: string; steps: SampleStep[]; testId: string }) {
  return (
    <div role="status" data-testid={testId} style={{ marginTop: "10px", padding: "10px", borderRadius: "8px", background: "var(--track)", fontSize: "12px" }}>
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>{title}</div>
      {steps.map(item => <div key={item.step} data-testid={`sample-step-${item.status}`}>
        <strong>{{ done: "✓", skipped: "–", failed: "✕", manual: "→" }[item.status]} {item.step}</strong>
        {item.status === "manual" ? " — still needed" : item.status === "failed" ? " — failed" : ""}
        {item.detail ? `: ${item.detail}` : ""}
      </div>)}
    </div>
  );
}

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
  const [sampleSteps, setSampleSteps] = useState<SampleStep[] | null>(null);
  const [employeeSampleSteps, setEmployeeSampleSteps] = useState<SampleStep[] | null>(null);
  const [importSteps, setImportSteps] = useState<SampleStep[] | null>(null);
  const [flowUrl, setFlowUrl] = useState("");
  const [flowTitle, setFlowTitle] = useState("");
  const [flowType, setFlowType] = useState<FlowType | null>(null);
  const [flowBeforeWarning, setFlowBeforeWarning] = useState<FlowType | null>(null);
  const [fundingWarning, setFundingWarning] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [removeCompanyId, setRemoveCompanyId] = useState("");
  const [removeEmployee, setRemoveEmployee] = useState<{ id: string; name: string } | null>(null);
  const removingCompany = useRef(false);
  const idempotencyKey = useRef<string | null>(null);
  const demoSetupRef = useRef<HTMLDivElement>(null);

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
  const upcomingQuery = useQuery<{ payrolls: UpcomingPayroll[] }>({ queryKey: ["/api/gusto/payrolls/upcoming"], staleTime: 30_000, retry: false, enabled: !!statusQuery.data?.companyId });
  const upcoming = upcomingQuery.data?.payrolls ?? [];
  const matchingUpcoming = period ? upcoming.find(p => p.periodStart === period.start && p.periodEnd === period.end) : undefined;
  const approved = !statusQuery.data?.companyStatus || statusQuery.data.companyStatus === "Approved";
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

  // Setup tasks show done (green) or to do (red); null while the data loads.
  const readinessEmployees = readinessQuery.data?.employees ?? [];
  const employeesKnown = readinessQuery.isSuccess;
  // Each row says why it's still to do, naming the people involved.
  const shortBlocker = (blocker: string) =>
    /not synchronized/i.test(blocker) ? "not in Gusto"
      : /onboarding is incomplete/i.test(blocker) ? "Gusto onboarding incomplete"
        : /direct deposit/i.test(blocker) ? "direct deposit not set up"
          : /contractor/i.test(blocker) ? "contractor, not W-2 payroll"
            : blocker;
  const nameBlockers = (people: typeof readinessEmployees) =>
    people.map(e => `${e.name || "Employee"}: ${e.gustoEmployeeId ? describeEmployee(e).text : shortBlocker(e.blockers?.[0] ?? "Gusto setup needed")}`).join(" · ");
  const unlinked = readinessEmployees.filter(e => !e.gustoEmployeeId);
  const notReady = readinessEmployees.filter(e => !e.ready);
  const companyStepsLeft = (status?.blockers ?? []).filter(b => b.startsWith("Complete Gusto setup")).length;
  const fundingStatus = status?.fundingAccount?.status;
  const setupChecklist: Array<{ type: FlowType; label: string; done: boolean | null; detail?: string }> = [
    { type: "company_onboarding", label: "Complete company setup", done: status ? status.onboardingComplete === true : null,
      detail: companyStepsLeft ? `${companyStepsLeft} step${companyStepsLeft === 1 ? "" : "s"} left in Gusto` : undefined },
    { type: "add_bank_info", label: "Set up Gusto funding", done: status ? !!status.fundingAccount : null,
      detail: status && !status.fundingAccount ? "No funding account yet" : undefined },
    { type: "verify_bank_info", label: "Verify funding in Gusto", done: status ? fundingStatus === "verified" : null,
      detail: fundingStatus && fundingStatus !== "verified" ? fundingStatus.replace(/_/g, " ") : undefined },
    { type: "add_employees", label: "Add employees in Gusto", done: employeesKnown ? readinessEmployees.length > 0 && unlinked.length === 0 : null,
      detail: !employeesKnown ? undefined : readinessEmployees.length === 0 ? "No active employees in JobsOxo yet" : unlinked.length ? nameBlockers(unlinked) : undefined },
    { type: "employee_management", label: "Manage employees", done: employeesKnown ? readinessEmployees.length > 0 && notReady.length === 0 : null,
      detail: !employeesKnown || readinessEmployees.length === 0 ? undefined : notReady.length
        ? `${readinessEmployees.length - notReady.length} of ${readinessEmployees.length} ready · ${nameBlockers(notReady)}` : undefined },
  ];
  const otherFlows = flowLabels.filter(flow => !setupChecklist.some(item => item.type === flow.type));
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
      // Gusto's check date for this period when it has one, else the period end.
      setPayDate(matchingUpcoming?.payDate ?? period.end);
    }
  }, [period?.start, period?.end, matchingUpcoming?.payDate]);

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

  async function removeCompany() {
    if (!removeCompanyId || removingCompany.current || busy) return;
    removingCompany.current = true;
    try {
      const result = await perform<{ removed: boolean }>("DELETE", "/api/gusto/company", {
        companyId: removeCompanyId, confirmRemove: true,
      });
      if (result?.removed) {
        setRemoveCompanyId("");
        setRunId("");
        setFlowUrl("");
        idempotencyKey.current = null;
        toast({ title: "Demo company removed from JobsOxo", description: "The company still exists in Gusto. Local employees and timesheets were kept." });
      }
    } finally { removingCompany.current = false; }
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
      setFlowType(flowType);
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

  async function closeFlow() {
    const closed = flowType;
    setFlowUrl("");
    setFlowTitle("");
    setFlowType(null);
    void statusQuery.refetch();
    if (closed === "add_employees" || closed === "employee_management") {
      // People added in Gusto's screens exist only in Gusto until imported.
      const result = await perform<ImportResult>("POST", "/api/gusto/employees/import");
      if (result?.imported) {
        setImportSteps(importResultSteps(result));
        await queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
        if (result.imported.length) toast({ title: `Imported ${result.imported.length} employee${result.imported.length === 1 ? "" : "s"} from Gusto`, description: result.imported.join(", ") });
      }
      return;
    }
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
                  {sampleSteps && <SampleResults title="Sample data results" steps={sampleSteps} testId="gusto-sample-results" />}
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                {!status.companyId && status.configured && <button type="button" style={buttonStyle} disabled={busy} onClick={() => void perform("POST", "/api/gusto/connect")}>Connect Gusto company</button>}
                {!status.companyId && !status.configured && status.environment === "demo" && status.setup?.canCreateDemoCompany
                  && !["demo_creating", "demo_creation_unknown"].includes(status.setup.creationState ?? "")
                  && <button type="button" style={buttonStyle} onClick={() => {
                    const setup = demoSetupRef.current;
                    setup?.scrollIntoView({ behavior: "smooth", block: "center" });
                    const input = setup?.querySelector<HTMLInputElement>("input:not(:disabled)");
                    if (input) input.focus({ preventScroll: true });
                    else setup?.focus({ preventScroll: true });
                  }}>Set up demo company</button>}
                {status.configured && <>
                  {/* Next setup steps sit beside the checklist they resolve. */}
                  {status.companyId && status.onboardingComplete === false && <button
                    type="button" style={{ ...buttonStyle, background: "var(--jox-primary)", color: "#fff", border: 0 }}
                    disabled={busy} onClick={() => void openFlow("company_onboarding", "Complete company setup")}
                    data-testid="button-gusto-complete-setup"
                  >Complete company setup</button>}
                  {status.fundingAccount && status.fundingAccount.status !== "verified" && <button
                    type="button" style={buttonStyle} disabled={busy}
                    onClick={() => void openFlow("verify_bank_info", "Verify funding in Gusto")}
                    data-testid="button-gusto-verify-funding"
                  >Verify funding</button>}
                  <button type="button" style={buttonStyle} disabled={busy} onClick={async () => {
                    const result = await perform<{ imported?: ImportResult }>("POST", "/api/gusto/sync");
                    if (result?.imported) {
                      setImportSteps(importResultSteps(result.imported));
                      await queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
                    }
                  }}>Sync readiness</button>
                  <button type="button" style={buttonStyle} disabled={busy} onClick={() => void openFlow("add_bank_info", "Set up Gusto funding")}>Funding setup</button>
                </>}
              </div>
            </div>
            {!status.configured && <p style={{ color: "var(--jx-orange-ink)", fontSize: "12px", margin: "10px 0 0" }}>{status.setup?.clientConfigured
              ? "The Gusto application is configured, but company credentials are not ready. A company must be created or connected before payroll is available."
              : "Gusto application credentials are not configured."} Payroll submission is unavailable; no manual payment route is offered.</p>}
          </div>

          {status.environment === "demo" && status.companyId && (
            <section aria-labelledby="gusto-demo-tools-title" style={{ ...panel, borderStyle: "dashed", background: "var(--jx-gold-tint)" }} data-testid="gusto-demo-tools">
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 700 }}>
                <FlaskConical aria-hidden="true" style={{ width: "15px", height: "15px" }} /><span id="gusto-demo-tools-title">Demo tools</span>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "12px", margin: "4px 0 10px" }}>Shortcuts that only exist in Gusto's demo environment. They stand in for steps Gusto performs itself for a real company (approval, bank verification, onboarding) and never appear in production.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                {!approved && <button
                  type="button" style={{ ...buttonStyle, background: "var(--jox-primary)", color: "#fff", border: 0 }} disabled={busy}
                  onClick={async () => {
                    const result = await perform<GustoStatus>("POST", "/api/gusto/demo-company/approve");
                    if (result?.companyStatus === "Approved") { toast({ title: "Demo company approved", description: "Gusto will now generate upcoming payrolls." }); await queryClient.invalidateQueries({ queryKey: ["/api/gusto/payrolls/upcoming"] }); }
                  }}
                  data-testid="button-gusto-approve-company"
                  title="Demo only: Gusto approves production companies itself"
                >Approve demo company</button>}
                {status.onboardingComplete === false && <button
                  type="button" style={buttonStyle} disabled={busy}
                  onClick={async () => {
                    const result = await perform<{ results?: SampleStep[] }>("POST", "/api/gusto/demo-company/sample-data");
                    if (result?.results) setSampleSteps(result.results);
                  }}
                  data-testid="button-gusto-sample-data"
                  title="Demo only: enters Gusto's test company, bank, pay schedule and employee details"
                >Fill with sample data</button>}
                {status.fundingAccount && status.fundingAccount.status !== "verified" && <button
                  type="button" style={buttonStyle} disabled={busy}
                  onClick={async () => {
                    const result = await perform<{ fundingAccount?: { status?: string } }>("POST", "/api/gusto/funding-account/test-deposits");
                    if (result?.fundingAccount?.status === "verified") toast({ title: "Demo funding account verified" });
                  }}
                  data-testid="button-gusto-test-deposits"
                  title="Demo only: Gusto doesn't send real test deposits in demo"
                >Simulate test deposits</button>}
                <button
                  type="button" style={buttonStyle} disabled={busy}
                  onClick={async () => {
                    const result = await perform<{ results?: SampleStep[] }>("POST", "/api/gusto/demo-company/sample-employees");
                    if (result?.results) setEmployeeSampleSteps(result.results);
                    await queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
                  }}
                  data-testid="button-gusto-sample-employees"
                  title="Demo only: adds the two sample employees in Gusto and JobsOxo and links them"
                >Add sample employees</button>
                <button
                  type="button" style={{ ...buttonStyle, color: "var(--jx-orange-ink)" }}
                  disabled={busy || !!flowUrl}
                  onClick={() => setRemoveCompanyId(status.companyId!)}
                >Remove demo company</button>
              </div>
            </section>
          )}

          <div ref={demoSetupRef} tabIndex={-1}>
            <GustoDemoCompanySetup status={status} statusReady={statusQuery.isSuccess && !statusQuery.isFetching} />
          </div>

          <div style={panel}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 700 }}><Users aria-hidden="true" style={{ width: "15px", height: "15px" }} />Gusto employee setup</div>
              <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                {status.companyId && <button
                  type="button" style={buttonStyle} disabled={busy}
                  onClick={async () => {
                    const result = await perform<ImportResult>("POST", "/api/gusto/employees/import");
                    if (!result?.imported) return;
                    setImportSteps(importResultSteps(result));
                    await queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
                  }}
                  data-testid="button-gusto-import-employees"
                  title="Creates a JobsOxo employee for each current Gusto employee not already here"
                >Import employees from Gusto</button>}
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
            {importSteps && <SampleResults title="Import results" steps={importSteps} testId="gusto-import-results" />}
            {employeeSampleSteps && <SampleResults title="Sample employee results" steps={employeeSampleSteps} testId="gusto-sample-employee-results" />}
            {readinessQuery.isLoading ? <p style={{ color: "var(--muted)", fontSize: "12px" }}>Checking Gusto employee setup…</p>
              : readinessQuery.isError ? <p role="alert" style={{ color: "var(--jx-orange-ink)", fontSize: "12px" }}>Gusto employee readiness could not load. Retry after syncing the company.</p>
                : readyEmployees.length === 0 ? <p style={{ color: "var(--muted)", fontSize: "12px", marginBottom: 0 }}>No Gusto employees are linked yet.</p>
                  : readyEmployees.map(employee => {
                    const state = describeEmployee(employee);
                    const name = employee.name ?? "Employee";
                    const act = (label: string, method: string, path: string, done: string, testId: string) => (
                      <button type="button" style={buttonStyle} disabled={busy} data-testid={`${testId}-${employee.id}`}
                        onClick={async () => { const result = await perform(method, path); if (result !== null) toast({ title: done }); }}>{label}</button>
                    );
                    return <div key={employee.id} data-testid={`readiness-${employee.id}`} data-action={state.action} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: "1px solid var(--panel-bd)", fontSize: "12px", flexWrap: "wrap" }}>
                      <span>{name}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end", textAlign: "right", flexWrap: "wrap" }}>
                        <span style={{ color: state.action === "ready" ? "var(--jx-green-ink)" : "var(--jx-orange-ink)" }}>{state.text}</span>
                        {status?.companyId && state.action === "invite" && act("Invite to Gusto", "POST", `/api/employees/${employee.id}/gusto-invite`, `Gusto invitation sent to ${name}`, "button-gusto-invite")}
                        {status?.companyId && state.action === "waiting" && <>
                          {act("Resend invitation", "POST", `/api/employees/${employee.id}/gusto-invite/resend`, `Invitation re-sent to ${name}`, "button-gusto-resend")}
                          <button type="button" style={buttonStyle} disabled={busy} data-testid={`button-gusto-take-over-${employee.id}`}
                            onClick={async () => {
                              const result = await perform("POST", `/api/employees/${employee.id}/gusto-onboarding/take-over`);
                              if (result !== null) { toast({ title: `You can now finish ${name}'s details in Gusto` }); void openFlow("add_employees", "Add employees in Gusto"); }
                            }}>Finish for them instead</button>
                        </>}
                        {status?.companyId && state.action === "not_found" && act("Unlink", "DELETE", `/api/employees/${employee.id}/gusto-link`, `${name} unlinked from Gusto`, "button-gusto-unlink")}
                        {status?.companyId && state.action === "finish_onboarding" && <button type="button" style={buttonStyle} disabled={busy} data-testid={`button-gusto-fix-${employee.id}`}
                          onClick={() => void openFlow("add_employees", "Add employees in Gusto")}>Fix in Gusto</button>}
                        {status?.companyId && state.action === "direct_deposit" && <button type="button" style={buttonStyle} disabled={busy} data-testid={`button-gusto-fix-${employee.id}`}
                          onClick={() => void openFlow("employee_management", "Manage employees")}>Fix in Gusto</button>}
                        {status?.companyId && ["invite", "waiting", "not_found", "finish_onboarding"].includes(state.action) && <button type="button"
                          style={{ ...buttonStyle, color: "hsl(var(--destructive))" }} disabled={busy} data-testid={`button-gusto-remove-${employee.id}`}
                          onClick={() => setRemoveEmployee({ id: employee.id, name })}>Remove</button>}
                      </span>
                    </div>;
                  })}
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
                {status?.companyId && upcomingQuery.isSuccess && <div data-testid="gusto-upcoming" style={{ width: "100%", fontSize: "12px", color: "var(--muted)", marginTop: "6px" }}>
                  {upcoming.length === 0
                    ? <span style={{ color: "var(--jx-orange-ink)" }}>Gusto has no upcoming payrolls yet{approved ? ". Check the pay schedule in Gusto setup." : " — the company must be approved first."}</span>
                    : <>
                      <span>Gusto's upcoming pay periods: </span>
                      {upcoming.map(p => <span key={p.payrollId} style={{ display: "inline-block", marginRight: "8px", fontWeight: period && p.periodStart === period.start && p.periodEnd === period.end ? 700 : 400, color: period && p.periodStart === period.start && p.periodEnd === period.end ? "var(--jx-green-ink)" : undefined }}>{p.periodStart} – {p.periodEnd} · pay {p.payDate}</span>)}
                      {period && !matchingUpcoming && <span role="alert" style={{ display: "block", color: "var(--jx-orange-ink)", marginTop: "4px" }}>This pay run ({period.start} – {period.end}) doesn't match a Gusto period. Prepare a pay run using one of the periods above.</span>}
                    </>}
                </div>}
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

      <div style={panel} aria-label="Gusto setup checklist" data-testid="gusto-setup-checklist">
        <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "4px" }}>Gusto setup checklist</div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {setupChecklist.map((item, index) => {
            const tone = item.done === null ? "var(--muted)" : item.done ? "var(--jx-green)" : "hsl(var(--destructive))";
            const state = item.done === null ? "Checking…" : item.done ? "Done" : "To do";
            return <li key={item.type} data-testid={`checklist-${item.type}`} data-state={item.done === null ? "unknown" : item.done ? "done" : "todo"}
              style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: index ? "1px solid var(--panel-bd)" : "none" }}>
              <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "50%", background: tone, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: "12px" }}>
                {item.label}
                {item.detail && !item.done && <span data-testid={`checklist-${item.type}-detail`} style={{ display: "block", color: "var(--muted)", fontSize: "11px", marginTop: "2px" }}>{item.detail}</span>}
              </span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: tone, minWidth: "54px", textAlign: "right" }}>{state}</span>
              <button type="button" style={buttonStyle} disabled={busy || status?.configured !== true}
                aria-label={`Open ${item.label}`} onClick={() => void openFlow(item.type, item.label)}>Open</button>
            </li>;
          })}
        </ul>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginTop: "10px" }} aria-label="Other Gusto tools">
          {otherFlows.map(flow => <button key={flow.type} type="button" style={buttonStyle} disabled={busy || status?.configured !== true} onClick={() => void openFlow(flow.type, flow.label)}>{flow.label}</button>)}
        </div>
      </div>

      <Dialog open={!!flowUrl} onOpenChange={open => { if (!open) closeFlow(); }}>
        <DialogContent className="max-w-5xl !flex flex-col h-[85dvh] max-h-[850px]">
          <DialogHeader><DialogTitle>{flowTitle}</DialogTitle><DialogDescription>Secure Gusto workflow displayed inside JobsOxo. Close this window when finished to refresh setup status.</DialogDescription></DialogHeader>
          {flowUrl && <iframe key={flowUrl} title={flowTitle} src={flowUrl} className="min-h-0 flex-1 w-full rounded border border-border" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals" />}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!removeEmployee} onOpenChange={open => { if (!open && !busy) setRemoveEmployee(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeEmployee?.name} entirely?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the employee from JobsOxo, including their logged hours, and deletes their un-onboarded record in Gusto.
              Gusto won't delete an employee who has finished onboarding; terminate them in Gusto first. Employees with payroll history
              can't be deleted here — mark them inactive instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep employee</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy} data-testid="button-confirm-remove-employee"
              onClick={async (event) => {
                event.preventDefault();
                if (!removeEmployee) return;
                const result = await perform<{ removedFromGusto?: boolean }>("DELETE", `/api/employees/${removeEmployee.id}/everywhere`);
                if (result !== null) {
                  await queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
                  toast({ title: `${removeEmployee.name} removed`, description: result.removedFromGusto ? "Deleted from Gusto and JobsOxo." : "Deleted from JobsOxo." });
                  setRemoveEmployee(null);
                }
              }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removeCompanyId} onOpenChange={open => { if (!open && !busy) setRemoveCompanyId(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove demo company from JobsOxo?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved connection and employee links for {status?.companyName || "this demo company"} from JobsOxo.
              The company and its data will remain in Gusto. Your JobsOxo employees, timesheets, and worksheets will be kept.
              Removal is blocked if any payroll history exists, including draft or pending runs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {runList.length > 0 && <p role="alert" className="text-sm text-destructive">This company has saved payroll history and cannot be removed.</p>}
          {runsQuery.isError && <p role="alert" className="text-sm text-destructive">Payroll history could not be checked. Refresh history before removing this company.</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep company</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || runsQuery.isLoading || runsQuery.isFetching || runsQuery.isError || runList.length > 0}
              onClick={event => { event.preventDefault(); void removeCompany(); }}
            >{busy ? "Removing…" : "Remove from JobsOxo"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
