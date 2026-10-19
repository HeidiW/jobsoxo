import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { gustoPayrollItems, gustoPayrollRuns } from "@shared/schema";
import { companyIntegration, employeeReadiness, syncCompany, syncEmployees } from "./gusto-company";
import { GustoProviderError, gustoRequest } from "./gusto-client";

type Run = typeof gustoPayrollRuns.$inferSelect;
type Item = typeof gustoPayrollItems.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class PayrollConflict extends Error {
  constructor(message: string, public code = "payroll_conflict") { super(message); }
}

export const pendingPayrollStates = new Set(["calculating", "submitting", "submission_pending", "unknown", "processing", "submitted", "cancelling"]);

export async function runForUser(id: string, userId: string) {
  return db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.id, id), eq(gustoPayrollRuns.userId, userId)) });
}

async function payrollPath(run: Run) {
  const integration = await companyIntegration(run.userId);
  if (run.companyId !== integration.companyId || run.environment !== integration.environment || !run.gustoPayrollId) {
    throw new PayrollConflict("Payroll belongs to a different Gusto company or environment. Its history cannot be reassigned.");
  }
  return `/v1/companies/${integration.companyId}/payrolls/${run.gustoPayrollId}`;
}

async function payrollPages(path: string, userId: string, method = "GET") {
  let result: any;
  const compensations: any[] = [];
  for (let page = 1; page <= 100; page++) {
    const next = await gustoRequest<any>(`${path}${path.includes("?") ? "&" : "?"}page=${page}&per=100`, { userId, method });
    if (!next || !Array.isArray(next.employee_compensations)) throw new GustoProviderError("Gusto returned an incomplete payroll.", 502, "invalid_response");
    if (!result) result = next;
    compensations.push(...next.employee_compensations);
    if (next.employee_compensations.length < 100) return { ...result, employee_compensations: compensations };
  }
  throw new GustoProviderError("Payroll exceeds the supported pagination limit.", 502, "pagination_limit");
}

async function currentPayroll(run: Run) {
  const provider = await payrollPages(`${await payrollPath(run)}?include=taxes,benefits,deductions`, run.userId);
  if (provider.payroll_uuid !== run.gustoPayrollId || provider.company_uuid !== run.companyId) {
    throw new GustoProviderError("Gusto returned a different payroll or company.", 502, "invalid_response");
  }
  return provider;
}

function money(value: unknown) {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new GustoProviderError("Gusto returned incomplete payroll amounts.", 502, "invalid_response");
  return parsed.toFixed(2);
}

function sum(rows: any[], field = "amount") {
  return rows.reduce((total, row) => total + Number(money(row[field])), 0).toFixed(2);
}

// Persist only the provider data needed for review, never raw employee/bank data.
export function reviewProjection(provider: any) {
  const rows = (provider.employee_compensations ?? []).filter((row: any) => !row.excluded).map((row: any) => ({
    employeeId: String(row.employee_uuid),
    // Gusto documents net_pay as nullable before the payroll is processed.
    // Show an unavailable employee net rather than inventing a tax estimate.
    gross: money(row.gross_pay), net: row.net_pay === null || row.net_pay === undefined ? null : money(row.net_pay),
    paymentMethod: row.payment_method,
    taxes: Array.isArray(row.taxes) ? sum(row.taxes.filter((tax: any) => tax.employer === false)) : null,
    deductions: (Number(sum(row.deductions ?? [])) + Number(sum((row.benefits ?? []).filter((benefit: any) => !benefit.imputed), "employee_deduction"))).toFixed(2),
    reimbursements: sum(row.reimbursements ?? []),
  })).sort((a: any, b: any) => a.employeeId.localeCompare(b.employeeId));
  return {
    gross: money(provider.totals?.gross_pay), net: money(provider.totals?.net_pay),
    debit: money(provider.totals?.company_debit),
    checkDate: provider.payroll_status_meta?.expected_check_date ?? provider.check_date,
    debitDate: provider.payroll_status_meta?.expected_debit_time?.slice(0, 10) ?? null,
    blockers: (provider.submission_blockers ?? []).map((blocker: any) =>
      typeof blocker === "string" ? blocker : `Gusto payroll blocker: ${String(blocker.key ?? blocker.blocker_type ?? blocker.type ?? "requires attention")}`).sort(),
    employees: rows,
  };
}

export function reviewFingerprint(provider: any) {
  return createHash("sha256").update(JSON.stringify(reviewProjection(provider))).digest("hex");
}

async function persistProvider(tx: Transaction, run: Run, provider: any) {
  const requestStatus = provider.processing_request?.status;
  let status = run.status;
  let lastError: string | null = null;
  const afterSubmission = !!run.submittedAt;
  if (requestStatus === "processing_failed") {
    status = "failed";
    lastError = "Gusto could not finish processing this payroll. Review the Gusto payroll details before taking further action.";
  } else if (requestStatus === "submitting") status = "submitting";
  else if (provider.processed === true || requestStatus === "submit_success") {
    // Only a signed payroll.paid event confirms initiation of employee payments.
    if (!["paid", "processed", "reversed", "partially_reversed"].includes(run.status)) status = "submitted";
  } else if (run.status === "cancelling" && provider.processed === false && !requestStatus) status = "cancelled";
  else if (!afterSubmission && requestStatus === "calculating") status = "calculating";
  else if (!afterSubmission && (requestStatus === "calculate_success" || provider.calculated_at)) status = "ready_for_review";
  else if (!afterSubmission && run.status === "unknown" && provider.processed === false && !requestStatus) status = "draft";
  // An ambiguous submission is never changed to a retryable ready state just
  // because the provider's read replica still returns an unprocessed payroll.
  const projection = provider.totals ? reviewProjection(provider) : null;
  if (status === "ready_for_review" && !projection) throw new GustoProviderError("Gusto calculation has no totals.", 502, "invalid_response");
  if (projection) {
    const localItems = await tx.select().from(gustoPayrollItems).where(eq(gustoPayrollItems.runId, run.id));
    const expected = new Set(localItems.map(item => item.gustoEmployeeId));
    if (projection.employees.length !== expected.size || projection.employees.some((row: any) => !expected.has(row.employeeId))) {
      throw new PayrollConflict("Gusto payroll employees changed. Recalculate and review the entire payroll before submitting.", "employees_changed");
    }
    for (const row of projection.employees) {
      const item = localItems.find(item => item.gustoEmployeeId === row.employeeId)!;
      await tx.update(gustoPayrollItems).set({
        grossEarnings: row.gross, netPay: row.net ?? "0.00", deductions: row.deductions, taxes: row.taxes ?? "0.00",
        reimbursements: row.reimbursements, providerResult: row,
      }).where(eq(gustoPayrollItems.id, item.id));
    }
  }
  const fingerprint = projection ? reviewFingerprint(provider) : run.reviewFingerprint;
  const changed = status !== run.status || fingerprint !== run.reviewFingerprint || lastError !== run.lastError
    || run.canCancel !== (provider.payroll_status_meta?.cancellable === true)
    || run.lastProviderStatus !== (requestStatus ?? (provider.processed ? "submitted" : "unprocessed"));
  await tx.update(gustoPayrollRuns).set({
    status, providerRequestState: requestStatus ?? run.providerRequestState,
    lastProviderStatus: requestStatus ?? (provider.processed ? "submitted" : "unprocessed"),
    lastError, canCancel: provider.payroll_status_meta?.cancellable === true,
    ...(!run.submittedAt && (provider.processed === true || ["submitting", "submit_success"].includes(requestStatus))
      ? { submittedAt: new Date() } : {}),
    ...(projection ? {
      reviewFingerprint: fingerprint, grossTotal: projection.gross, netTotal: projection.net, debitTotal: projection.debit,
      checkDate: projection.checkDate, expectedDebitDate: projection.debitDate, blockers: projection.blockers,
    } : {}),
    ...(changed ? { updatedAt: new Date() } : {}),
  }).where(eq(gustoPayrollRuns.id, run.id));
  return { status, fingerprint, projection };
}

export async function reconcilePayroll(id: string, userId: string) {
  return db.transaction(async tx => {
    const [run] = await tx.select().from(gustoPayrollRuns).where(and(eq(gustoPayrollRuns.id, id), eq(gustoPayrollRuns.userId, userId))).for("update");
    if (!run?.gustoPayrollId) return;
    await persistProvider(tx, run, await currentPayroll(run));
  });
}

async function findRegularPayroll(run: Run, companyId: string): Promise<string> {
  const matches: any[] = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await gustoRequest<any[]>(`/v1/companies/${companyId}/payrolls?processing_statuses=unprocessed&payroll_types=regular&start_date=${run.periodStart}&end_date=${run.periodEnd}&per=100&page=${page}`, { userId: run.userId });
    if (!Array.isArray(rows)) throw new GustoProviderError("Gusto returned an invalid payroll list.", 502, "invalid_response");
    matches.push(...rows.filter(row => row.pay_period?.start_date === run.periodStart && row.pay_period?.end_date === run.periodEnd && row.check_date === run.payDate && !row.off_cycle && !row.processed));
    if (rows.length < 100) break;
    if (page === 100) throw new PayrollConflict("Gusto payroll list exceeds the supported size.");
  }
  if (matches.length !== 1) throw new PayrollConflict("Choose the exact period and pay date of one upcoming regular Gusto payroll. Configure the company pay schedule in Gusto setup if none matches.");
  return matches[0].payroll_uuid;
}

function prepareEmployeeUpdates(prepared: any, items: Item[]) {
  const rows = prepared.employee_compensations as any[];
  if (items.some(item => !rows.some(row => row.employee_uuid === item.gustoEmployeeId))) {
    throw new PayrollConflict("A selected employee is not in this Gusto payroll. Complete their Gusto setup first.");
  }
  return rows.map(row => {
    const item = items.find(item => item.gustoEmployeeId === row.employee_uuid);
    if (!row.version) throw new GustoProviderError("Prepared Gusto payroll has no employee version.", 502, "invalid_response");
    if (!item) return { employee_uuid: row.employee_uuid, version: row.version, excluded: true };
    const hourly = row.hourly_compensations ?? [];
    const regular = hourly.filter((compensation: any) => compensation.name === "Regular Hours");
    if (Number(item.hours) > 0 && regular.length !== 1) {
      throw new PayrollConflict("Hours cannot be assigned safely to multiple Gusto jobs or a missing Regular Hours compensation. Review employee compensation in Gusto setup.");
    }
    if (Number(item.days) > 0 && Number(item.hours) === 0 && regular.length > 0) {
      throw new PayrollConflict("Day-only earnings cannot be converted to hourly pay automatically. Configure the employee's actual Gusto compensation and record their payable hours.");
    }
    return {
      employee_uuid: row.employee_uuid, version: row.version, excluded: false, payment_method: "Direct Deposit",
      ...(Number(item.hours) > 0 ? {
        hourly_compensations: hourly.map((compensation: any) => ({
          name: compensation.name, job_uuid: compensation.job_uuid,
          hours: compensation.name === "Regular Hours" ? item.hours : "0.00",
        })),
      } : {}),
      // Reimbursements are supported one-time inputs; taxes, wage rates, and
      // deductions remain the Gusto company's configured source of truth.
      ...(Number(item.reimbursements) > 0 ? { reimbursements: [{ amount: item.reimbursements, description: "JobsOxo payroll reimbursement" }] } : {}),
    };
  });
}

export async function calculatePayroll(id: string, userId: string) {
  const integration = await companyIntegration(userId);
  let claimed = false;
  let mutationStarted = false;
  try {
    const [run] = await db.update(gustoPayrollRuns).set({ status: "calculating", lastError: null, providerRequestState: "preparing", updatedAt: new Date() })
      .where(and(eq(gustoPayrollRuns.id, id), eq(gustoPayrollRuns.userId, userId), isNull(gustoPayrollRuns.submittedAt), inArray(gustoPayrollRuns.status, ["draft", "ready_for_review", "failed"]))).returning();
    if (!run) throw new PayrollConflict("Payroll cannot be recalculated while processing or after submission.");
    claimed = true;
    if (run.submittedAt) throw new PayrollConflict("A submitted payroll cannot be recalculated.");
    if (run.companyId !== integration.companyId || run.environment !== integration.environment) throw new PayrollConflict("Payroll company or environment changed.");
    const providerId = run.gustoPayrollId ?? await findRegularPayroll(run, integration.companyId!);
    // Unique provider ID prevents a second local run from mutating/paying the
    // same payroll, even when a different client idempotency key is used.
    try {
      await db.update(gustoPayrollRuns).set({ gustoPayrollId: providerId }).where(eq(gustoPayrollRuns.id, run.id));
    } catch (error: any) {
      if ((error?.cause?.code ?? error?.code) === "23505") {
        throw new PayrollConflict("Another JobsOxo run already owns this Gusto payroll. Open that existing run instead of creating another.", "payroll_already_linked");
      }
      throw error;
    }
    run.gustoPayrollId = providerId;
    const path = await payrollPath(run);
    mutationStarted = true;
    const prepared = await payrollPages(`${path}/prepare`, userId, "PUT");
    const items = await db.select().from(gustoPayrollItems).where(eq(gustoPayrollItems.runId, id));
    const updates = prepareEmployeeUpdates(prepared, items);
    for (let start = 0; start < updates.length; start += 100) {
      await gustoRequest(path, { userId, method: "PUT", body: { employee_compensations: updates.slice(start, start + 100) } });
    }
    await gustoRequest(`${path}/calculate`, { userId, method: "PUT" });
    await db.update(gustoPayrollRuns).set({ providerRequestState: "calculating", lastProviderStatus: "calculating", updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, id));
  } catch (error) {
    if (claimed) {
      const ambiguous = mutationStarted && error instanceof GustoProviderError && (error.status >= 500 || error.code === "timeout");
      await db.update(gustoPayrollRuns).set({
        status: ambiguous ? "unknown" : "failed", providerRequestState: ambiguous ? "unknown" : "failed",
        lastError: error instanceof PayrollConflict || error instanceof GustoProviderError ? error.message : "Payroll preparation failed. Check Gusto company setup.",
        updatedAt: new Date(),
      }).where(and(eq(gustoPayrollRuns.id, id), eq(gustoPayrollRuns.userId, userId)));
    }
    throw error;
  }
}

export async function submitPayroll(id: string, userId: string, reviewedUpdatedAt: unknown) {
  let shouldSubmit = false;
  let path = "";
  // Current readiness comes from Gusto, never from a cached Plaid connection.
  const run = await runForUser(id, userId);
  if (!run) throw new PayrollConflict("Payroll run not found.");
  if (run.environment === "production" && process.env.GUSTO_LIVE_PAYROLL_ENABLED !== "true") {
    throw new PayrollConflict("Live payroll is disabled until Gusto production approval and explicit live-release authorization.", "live_payroll_disabled");
  }
  if (run.submittedAt || pendingPayrollStates.has(run.status)) {
    if (run.gustoPayrollId) await reconcilePayroll(id, userId);
    return;
  }
  if (run.status !== "ready_for_review" || !run.gustoPayrollId) throw new PayrollConflict("Calculate and review payroll before submitting.");
  const company = await syncCompany(userId);
  await syncEmployees(userId);
  const readiness = await employeeReadiness(userId);
  const items = await db.select().from(gustoPayrollItems).where(eq(gustoPayrollItems.runId, id));
  const blockers = [...company.blockers, ...items.flatMap(item => {
    const employee = readiness.find(row => row.id === item.employeeId);
    return employee?.ready ? [] : employee?.blockers ?? ["Employee is not ready for Gusto direct deposit"];
  })];
  if (blockers.length) throw new PayrollConflict(blockers.join(". "), "readiness_blocked");
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(gustoPayrollRuns).where(and(eq(gustoPayrollRuns.id, id), eq(gustoPayrollRuns.userId, userId))).for("update");
    if (!locked || locked.status !== "ready_for_review" || locked.submittedAt) throw new PayrollConflict("Payroll submission is already in progress.");
    if (typeof reviewedUpdatedAt !== "string" || reviewedUpdatedAt !== locked.updatedAt.toISOString()) throw new PayrollConflict("Payroll changed. Refresh the calculation and review it again.", "review_changed");
    const provider = await currentPayroll(locked);
    const latest = await persistProvider(tx, locked, provider);
    if (latest.status !== "ready_for_review" || latest.fingerprint !== locked.reviewFingerprint || latest.projection?.blockers.length
      || latest.projection?.employees.some((employee: any) => employee.paymentMethod !== "Direct Deposit")) {
      // Commit the changed calculation, but require a fresh review before ACH.
      return;
    }
    path = await payrollPath(locked);
    await tx.update(gustoPayrollRuns).set({
      status: "submitting", providerRequestState: "submitting", submissionActorUserId: userId,
      submittedAt: new Date(), lastError: null, updatedAt: new Date(),
    }).where(eq(gustoPayrollRuns.id, id));
    shouldSubmit = true;
  });
  if (!shouldSubmit) throw new PayrollConflict("Gusto payroll details or blockers changed. Review the updated calculation before submitting.", "review_changed");
  try {
    // Exactly one claimant sends this operation. The 202 response is only an
    // acknowledgement; subsequent GETs/webhooks establish the actual outcome.
    await gustoRequest(`${path}/submit`, { userId, method: "PUT" });
  } catch (error) {
    await db.update(gustoPayrollRuns).set({
      status: "submission_pending", providerRequestState: "unknown",
      lastError: "Submission outcome is not confirmed. Refresh provider status; this payroll will not be submitted again automatically.",
      updatedAt: new Date(),
    }).where(eq(gustoPayrollRuns.id, id));
    throw error;
  }
}

export async function cancelPayroll(id: string, userId: string) {
  let path = "";
  await db.transaction(async tx => {
    const [run] = await tx.select().from(gustoPayrollRuns).where(and(eq(gustoPayrollRuns.id, id), eq(gustoPayrollRuns.userId, userId))).for("update");
    if (!run) throw new PayrollConflict("Payroll run not found.");
    if (run.status === "cancelled") return;
    const provider = await currentPayroll(run);
    if (provider.payroll_status_meta?.cancellable !== true || ["calculating", "submitting"].includes(provider.processing_request?.status)) {
      throw new PayrollConflict("Gusto does not currently allow this payroll to be cancelled. Cancellation is not an ACH reversal.");
    }
    if (run.status === "cancelling") return;
    path = await payrollPath(run);
    await tx.update(gustoPayrollRuns).set({ status: "cancelling", providerRequestState: "cancelling", updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, id));
  });
  if (!path) return;
  await gustoRequest(`${path}/cancel`, { userId, method: "PUT" });
  await reconcilePayroll(id, userId);
}
