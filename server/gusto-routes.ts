import type { Express, Request, Response, NextFunction } from "express";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "./db";
import { storage } from "./storage";
import { bankAccounts, employees, gustoEmployeeMappings, gustoIntegrations, gustoPayrollItems, gustoPayrollRuns, gustoWebhookEvents, payrollRecords, payrollWorksheets } from "@shared/schema";
import { createProcessorToken, getBalance } from "./plaid";
import { syncPlaidTransactionsForUser } from "./plaid-sync";
import { decrypt } from "./encryption";
import { GustoConfigurationError, GustoProviderError, gustoRequest, verifyGustoSignature } from "./gusto-client";

declare module "http" { interface IncomingMessage { rawBody: unknown } }

const safeError = (error: any) => error instanceof GustoProviderError
  ? { status: error.status, body: { error: error.message, code: error.code } }
  : error instanceof GustoConfigurationError
    ? { status: 503, body: { error: error.message, code: "not_configured" } }
    : { status: 500, body: { error: "Gusto integration failed" } };

function isoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Dates must use YYYY-MM-DD format");
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  return date.toISOString().slice(0, 10);
}

function numeric(value: unknown, label: string, nonnegative = true): string {
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`${label} must be a number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (nonnegative && parsed < 0)) throw new Error(`${label} must be a valid non-negative number`);
  return parsed.toFixed(2);
}

function publicRun(run: any, items: any[]) {
  return {
    id: run.id, status: run.status, providerStatus: run.lastProviderStatus,
    error: run.lastError, blockers: run.blockers ?? [],
    periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate,
    expectedDebit: Number(run.debitTotal ?? 0), expectedDebitDate: run.expectedDebitDate,
    totals: { gross: Number(run.grossTotal ?? 0), deductions: items.reduce((n, x) => n + Number(x.deductions || 0), 0), taxes: items.reduce((n, x) => n + Number(x.taxes || 0), 0), reimbursements: items.reduce((n, x) => n + Number(x.reimbursements || 0), 0), net: Number(run.netTotal ?? 0) },
    employees: items.map((item) => ({ id: item.employeeId, name: item.employeeName ?? null, hours: Number(item.hours), earnings: Number(item.grossEarnings), deductions: Number(item.deductions), taxes: Number(item.taxes), reimbursements: Number(item.reimbursements), netPay: Number(item.netPay), reviewed: true })),
    createdAt: run.createdAt, updatedAt: run.updatedAt,
  };
}

function ambiguousProviderError(error: unknown): boolean {
  return error instanceof GustoProviderError &&
    (error.status === 504 || error.code === "timeout" || error.code === "provider_unavailable");
}

async function persistProviderEmployeeResults(runId: string, provider: any) {
  const results = Array.isArray(provider?.employees)
    ? provider.employees
    : Array.isArray(provider?.employee_compensations)
      ? provider.employee_compensations
      : Array.isArray(provider?.payroll_items)
        ? provider.payroll_items
        : [];
  if (!results.length) return;

  const items = await db.select().from(gustoPayrollItems).where(eq(gustoPayrollItems.runId, runId));
  for (const result of results) {
    const providerEmployeeId = String(
      result?.employee_id ?? result?.employee_uuid ?? result?.uuid ?? "",
    );
    const item = items.find((candidate) => candidate.gustoEmployeeId === providerEmployeeId);
    if (!item) continue;
    const taxes = Number(result?.taxes ?? result?.employee_taxes ?? result?.total_taxes ?? 0);
    const netPay = Number(result?.net_pay ?? result?.net_pay_amount ?? result?.net_amount ?? 0);
    const deductions = Number(result?.deductions ?? result?.total_deductions ?? item.deductions);
    await db.update(gustoPayrollItems).set({
      taxes: Number.isFinite(taxes) ? taxes.toFixed(2) : item.taxes,
      netPay: Number.isFinite(netPay) ? netPay.toFixed(2) : item.netPay,
      deductions: Number.isFinite(deductions) ? deductions.toFixed(2) : item.deductions,
      providerResult: result,
    }).where(eq(gustoPayrollItems.id, item.id));
  }
}

async function derivePayrollInputs(
  periodStart: string,
  periodEnd: string,
  explicitItems: unknown[],
  mappings: any[],
) {
  const activeEmployees = await db.select().from(employees).where(eq(employees.status, "active"));
  const employeeById = new Map(activeEmployees.map((employee) => [employee.id, employee]));
  const mappingByEmployee = new Map(mappings.map((mapping) => [mapping.employeeId, mapping]));
  let inputs: any[] = [];

  if (explicitItems.length > 0) {
    inputs = explicitItems.map((item: any) => ({
      employeeId: item?.employeeId,
      hours: numeric(item?.hours ?? 0, "hours"),
      days: numeric(item?.days ?? 0, "days"),
      grossEarnings: numeric(item?.grossEarnings ?? item?.earnings ?? 0, "grossEarnings"),
      deductions: numeric(item?.deductions ?? 0, "deductions"),
      taxes: numeric(item?.taxes ?? 0, "taxes"),
      reimbursements: numeric(item?.reimbursements ?? 0, "reimbursements"),
      netPay: numeric(item?.netPay ?? 0, "netPay"),
    }));
  } else {
    const start = new Date(`${periodStart}T00:00:00.000Z`);
    const end = new Date(`${periodEnd}T23:59:59.999Z`);
    const [records, worksheets] = await Promise.all([
      db.select().from(payrollRecords).where(and(gte(payrollRecords.periodStart, start), lte(payrollRecords.periodEnd, end))),
      db.select().from(payrollWorksheets).where(and(gte(payrollWorksheets.periodStart, periodStart), lte(payrollWorksheets.periodEnd, periodEnd))),
    ]);
    const byEmployee = new Map<string, any>();
    for (const record of records) {
      const current = byEmployee.get(record.employeeId) ?? { employeeId: record.employeeId, hours: 0, days: 0, grossEarnings: 0, deductions: 0, taxes: 0, reimbursements: 0, netPay: 0 };
      current.hours += Number(record.totalHours ?? 0);
      current.grossEarnings += Number(record.grossPay ?? 0);
      current.deductions += Number(record.deductions ?? 0);
      current.taxes += Number(record.taxWithheld ?? 0);
      current.netPay += Number(record.netPay ?? 0);
      byEmployee.set(record.employeeId, current);
    }
    // Worksheets are the reviewable fallback when a payroll record has not
    // been materialized yet. They remain source inputs; Gusto calculates tax.
    for (const worksheet of worksheets) {
      if (byEmployee.has(worksheet.employeeId)) continue;
      byEmployee.set(worksheet.employeeId, {
        employeeId: worksheet.employeeId,
        hours: 0,
        days: Number(worksheet.daysWorked ?? 0),
        grossEarnings: Number(worksheet.grossPay ?? 0),
        deductions: Number(worksheet.totalDeductions ?? 0),
        taxes: 0,
        reimbursements: 0,
        netPay: Number(worksheet.netPay ?? 0),
      });
    }
    inputs = [...byEmployee.values()].map((item) => ({
      ...item,
      hours: numeric(item.hours, "hours"),
      days: numeric(item.days, "days"),
      grossEarnings: numeric(item.grossEarnings, "grossEarnings"),
      deductions: numeric(item.deductions, "deductions"),
      taxes: numeric(item.taxes, "taxes"),
      reimbursements: numeric(item.reimbursements, "reimbursements"),
      netPay: numeric(item.netPay, "netPay"),
    }));
  }

  if (inputs.length === 0) throw new Error("No payable payroll inputs were found for this period.");
  for (const input of inputs) {
    const employee = employeeById.get(input.employeeId);
    if (!employee) throw new Error("Payroll item references an invalid active employee.");
    if (Number(input.grossEarnings) <= 0) throw new Error(`Employee ${employee.name} has no nonzero payable earnings for this period.`);
    const mapping = mappingByEmployee.get(input.employeeId);
    if (!mapping?.gustoEmployeeId) throw new Error(`Employee ${employee.name} is not mapped to Gusto. Sync employees before preparing payroll.`);
    input.gustoEmployeeId = mapping.gustoEmployeeId;
    input.employeeName = employee.name;
  }
  return inputs;
}

export function registerGustoRoutes(app: Express, requireAdmin: (req: Request, res: Response, next: NextFunction) => void) {
  const admin = [requireAdmin];
  app.get("/api/gusto/status", ...admin, async (req, res) => {
    const integration = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, req.session.userId!) });
    const account = await storage.getBusinessBankAccount(req.session.userId!);
    res.json({
      configured: !!process.env.GUSTO_ACCESS_TOKEN,
      state: integration?.state ?? "not_connected",
      companyId: integration?.companyId ?? null,
      fundingStatus: integration?.fundingStatus ?? null,
      fundingAccount: integration?.fundingAccountId ? { id: integration.fundingAccountId, status: integration.fundingStatus, institutionName: account?.institutionName ?? null, accountMask: account?.accountMask ?? null } : null,
      bankConnected: !!account,
      lastSyncedAt: integration?.lastSyncedAt ?? null,
      error: integration?.lastError ?? null,
    });
  });

  app.get("/api/gusto/bank-summary", ...admin, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const account = await storage.getBusinessBankAccount(userId);
      if (!account) return res.status(409).json({ error: "Connect a business bank account with Plaid before running payroll." });
      const balance = await getBalance(account.plaidAccessToken);
      await syncPlaidTransactionsForUser(userId);
      const transactions = await storage.getPlaidTransactions(userId, 10);
      res.json({
        connected: true, institutionName: account.institutionName, accountName: account.accountName, accountMask: account.accountMask, accountType: account.accountType,
        current: balance.current, available: balance.available, balance, refreshedAt: new Date().toISOString(),
        transactions: transactions.slice(0, 10).map((tx) => ({ id: tx.id, date: tx.date, amount: tx.amount, name: tx.name, merchantName: tx.merchantName, pending: tx.pending })),
      });
    } catch (error) { const e = safeError(error); res.status(e.status).json(e.body); }
  });

  app.post("/api/gusto/funding-account", ...admin, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const account = await storage.getBusinessBankAccount(userId);
      if (!account) return res.status(409).json({ error: "Connect a business bank account with Plaid before setting up Gusto funding." });
      if (!process.env.GUSTO_COMPANY_ID) throw new GustoConfigurationError("Gusto company is not configured. Add GUSTO_COMPANY_ID.");
      const previous = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, userId) });
      if (previous?.fundingAccountId && previous.fundingStatus === "verified" && req.body.replaceDefault !== true) {
        return res.status(409).json({ error: "Replacing the verified default funding account disables the previous account. Confirm replaceDefault to continue.", code: "replace_confirmation_required" });
      }
      const processorToken = await createProcessorToken(account.plaidAccessToken, account.plaidAccountId, "gusto");
      const result = await gustoRequest<any>(`/v1/companies/${process.env.GUSTO_COMPANY_ID}/bank_accounts`, { method: "POST", body: { processor_token: processorToken, account_type: "Checking" } });
      await db.insert(gustoIntegrations).values({ userId, companyId: process.env.GUSTO_COMPANY_ID, state: "connected", fundingAccountId: result?.uuid ?? result?.id ?? null, fundingStatus: result?.verification_status ?? "submitted", lastSyncedAt: new Date() }).onConflictDoUpdate({ target: gustoIntegrations.userId, set: { companyId: process.env.GUSTO_COMPANY_ID, state: "connected", fundingAccountId: result?.uuid ?? result?.id ?? null, fundingStatus: result?.verification_status ?? "submitted", lastSyncedAt: new Date(), updatedAt: new Date() } });
      res.status(201).json({ companyId: process.env.GUSTO_COMPANY_ID, fundingStatus: result?.verification_status ?? "submitted" });
    } catch (error) { const e = safeError(error); res.status(e.status).json(e.body); }
  });

  app.get("/api/gusto/employees/readiness", ...admin, async (_req, res) => {
    const rows = await db.select({ employee: employees, mapping: gustoEmployeeMappings }).from(employees).leftJoin(gustoEmployeeMappings, eq(employees.id, gustoEmployeeMappings.employeeId)).where(eq(employees.status, "active"));
    res.json({ employees: rows.map(({ employee, mapping }) => {
      const blockers = [];
      if (!mapping) blockers.push("Employee is not synchronized to Gusto");
      if (mapping && mapping.onboardingStatus !== "complete") blockers.push("Gusto onboarding is incomplete");
      if (mapping && mapping.paymentMethodStatus !== "complete") blockers.push("Direct deposit setup is incomplete");
      return { id: employee.id, name: employee.name, ready: blockers.length === 0, blockers, correctionPath: `/payroll?employeeId=${employee.id}`, gustoEmployeeId: mapping?.gustoEmployeeId ?? null };
    }) });
  });

  app.post("/api/gusto/employees/sync", ...admin, async (_req, res) => {
    try {
      const userId = _req.session.userId!;
      const integration = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, userId) });
      if (!integration?.companyId) return res.status(409).json({ error: "Set up the Gusto company and funding account first." });
      const [providerEmployees, localEmployees, employeeAccounts] = await Promise.all([
        gustoRequest<any[]>(`/v1/companies/${integration.companyId}/employees`),
        db.select().from(employees).where(eq(employees.status, "active")),
        storage.getEmployeeBankAccounts(userId),
      ]);
      const synced = [];
      for (const employee of localEmployees) {
        const match = providerEmployees.find((candidate: any) => candidate.email && employee.email && candidate.email.toLowerCase() === employee.email.toLowerCase());
        if (!match?.uuid && !match?.id) continue;
        const gustoEmployeeId = String(match.uuid ?? match.id);
        const onboardingStatus = match.onboarding_status ?? match.onboardingStatus ?? "unknown";
        const employeeAccount = employeeAccounts.find((account) => account.entityId === employee.id);
        let paymentMethodStatus = "bank_not_connected";
        if (employeeAccount) {
          const processorToken = await createProcessorToken(
            employeeAccount.plaidAccessToken,
            employeeAccount.plaidAccountId,
            "gusto",
          );
          const paymentMethod = await gustoRequest<any>(
            `/v1/employees/${gustoEmployeeId}/bank_accounts`,
            {
              method: "POST",
              body: { processor_token: processorToken },
              idempotencyKey: `employee-bank:${employee.id}:${employeeAccount.id}`,
            },
          );
          paymentMethodStatus =
            paymentMethod?.verification_status ??
            paymentMethod?.status ??
            "submitted";
        }
        await db.insert(gustoEmployeeMappings).values({ employeeId: employee.id, gustoEmployeeId, onboardingStatus, paymentMethodStatus, lastSyncedAt: new Date() }).onConflictDoUpdate({ target: gustoEmployeeMappings.employeeId, set: { gustoEmployeeId, onboardingStatus, paymentMethodStatus, lastSyncedAt: new Date(), updatedAt: new Date() } });
        synced.push({ employeeId: employee.id, gustoEmployeeId, onboardingStatus, paymentMethodStatus });
      }
      res.json({ synced });
    } catch (error) { const e = safeError(error); res.status(e.status).json(e.body); }
  });

  app.post("/api/gusto/payroll-runs", ...admin, async (req, res) => {
    try {
      const periodStart = isoDate(req.body.periodStart), periodEnd = isoDate(req.body.periodEnd), payDate = isoDate(req.body.payDate);
      if (periodStart > periodEnd) return res.status(400).json({ error: "periodStart must be before periodEnd" });
      const inputItems = Array.isArray(req.body.items) ? req.body.items : [];
      const runIdempotency = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.length > 0 ? req.body.idempotencyKey : crypto.randomUUID();
      const mappings = await db.select().from(gustoEmployeeMappings);
      const inputs = await derivePayrollInputs(periodStart, periodEnd, inputItems, mappings);
      const [run] = await db.insert(gustoPayrollRuns).values({ userId: req.session.userId!, periodStart, periodEnd, payDate, idempotencyKey: runIdempotency }).onConflictDoNothing({ target: gustoPayrollRuns.idempotencyKey }).returning();
      const existing = run ?? await db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.idempotencyKey, runIdempotency), eq(gustoPayrollRuns.userId, req.session.userId!)) });
      if (!existing) throw new Error("Unable to create payroll run");
      if (run) {
        await db.insert(gustoPayrollItems).values(inputs.map((item) => ({
          runId: existing.id,
          employeeId: item.employeeId,
          gustoEmployeeId: item.gustoEmployeeId,
          hours: item.hours,
          days: item.days,
          grossEarnings: item.grossEarnings,
          deductions: item.deductions,
          taxes: item.taxes,
          reimbursements: item.reimbursements,
          netPay: item.netPay,
        })));
      }
      res.status(run ? 201 : 200).json(await getRun(existing.id, req.session.userId!));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid payroll run" }); }
  });

  app.get("/api/gusto/payroll-runs/:id", ...admin, async (req, res) => {
    const run = await getRun(req.params.id, req.session.userId!);
    if (!run) return res.status(404).json({ error: "Payroll run not found" });
    res.json(run);
  });

  app.post("/api/gusto/payroll-runs/:id/calculate", ...admin, async (req, res) => {
    try {
      const run = await db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.id, req.params.id), eq(gustoPayrollRuns.userId, req.session.userId!)) });
      if (!run) return res.status(404).json({ error: "Payroll run not found" });
      if (["unknown", "submission_pending", "submitting", "submitted", "processed", "paid", "reversed", "cancelled"].includes(run.status)) {
        return res.status(409).json({ error: run.status === "unknown" || run.status === "submission_pending" ? "Provider status must be reconciled before recalculation." : "Submitted payrolls are immutable." });
      }
      await db.update(gustoPayrollRuns).set({ status: "calculating", providerRequestState: "calculating", lastError: null, updatedAt: new Date() }).where(and(eq(gustoPayrollRuns.id, run.id), eq(gustoPayrollRuns.userId, req.session.userId!)));
      const integration = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, req.session.userId!) });
      if (!integration?.companyId) {
        await db.update(gustoPayrollRuns).set({ status: "failed", providerRequestState: "failed", lastError: "Set up the Gusto funding account first.", updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, run.id));
        return res.status(409).json({ error: "Set up the Gusto funding account first." });
      }
      const items = await db.select().from(gustoPayrollItems).where(eq(gustoPayrollItems.runId, run.id));
       const provider = run.gustoPayrollId
         ? await gustoRequest<any>(`/v1/payrolls/${run.gustoPayrollId}/calculate`, { method: "POST", idempotencyKey: `${run.idempotencyKey}:calculate` })
         : await gustoRequest<any>(`/v1/companies/${integration.companyId}/payrolls`, { method: "POST", body: { pay_period: { start_date: run.periodStart, end_date: run.periodEnd }, check_date: run.payDate, employees: items.map((item) => ({ employee_id: item.gustoEmployeeId, hours: Number(item.hours), days: Number(item.days), gross_earnings: Number(item.grossEarnings), deductions: Number(item.deductions), reimbursements: Number(item.reimbursements) })) }, idempotencyKey: `${run.idempotencyKey}:calculate` });
       const providerId = provider?.uuid ?? provider?.id ?? run.gustoPayrollId;
       if (!providerId) throw new GustoProviderError("Gusto did not return a payroll identifier", 502, "provider_invalid_response");
       await persistProviderEmployeeResults(run.id, provider);
       await db.update(gustoPayrollRuns).set({ status: "ready_for_review", providerRequestState: "calculated", gustoPayrollId: providerId, grossTotal: String(provider?.gross_pay ?? run.grossTotal ?? 0), netTotal: String(provider?.net_pay ?? run.netTotal ?? 0), debitTotal: String(provider?.debit_total ?? provider?.gross_pay ?? run.debitTotal ?? 0), lastProviderStatus: provider?.status ?? "calculated", updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, run.id));
      res.json(await getRun(run.id, req.session.userId!));
    } catch (error) {
      const e = safeError(error);
      if (req.params.id) await db.update(gustoPayrollRuns).set(ambiguousProviderError(error)
        ? { status: "unknown", providerRequestState: "unknown", lastError: "Gusto calculation status is unknown; reconcile before retrying.", updatedAt: new Date() }
        : { status: "failed", providerRequestState: "failed", lastError: e.body.error, updatedAt: new Date() })
        .where(and(eq(gustoPayrollRuns.id, req.params.id), eq(gustoPayrollRuns.userId, req.session.userId!))).catch(() => {});
      res.status(e.status).json(e.body);
    }
  });

  app.post("/api/gusto/payroll-runs/:id/submit", ...admin, async (req, res) => {
    let submissionClaimed = false;
    try {
      const run = await db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.id, req.params.id), eq(gustoPayrollRuns.userId, req.session.userId!)) });
      if (!run) return res.status(404).json({ error: "Payroll run not found" });
      if (["submitted", "processing", "processed", "paid"].includes(run.status)) return res.json(await getRun(run.id, req.session.userId!));
      if (run.status === "submitting" || run.status === "submission_pending") {
        // An earlier request may have timed out after Gusto accepted it.
        // Reconcile first; only retry the same provider operation/key when
        // Gusto confirms it is still calculated and not submitted.
        if (!run.gustoPayrollId) return res.status(409).json({ error: "Submission is pending provider reconciliation.", code: "submission_unknown" });
        const current = await gustoRequest<any>(`/v1/payrolls/${run.gustoPayrollId}`);
        const providerStatus = String(current?.status ?? "").toLowerCase();
        const settled: Record<string, string> = { submitted: "submitted", processing: "processing", processed: "processed", paid: "paid", "processing-failed": "failed", failed: "failed", reversed: "reversed", "partially-reversed": "partially_reversed", cancelled: "cancelled" };
        if (settled[providerStatus]) {
          await db.update(gustoPayrollRuns).set({ status: settled[providerStatus], providerRequestState: providerStatus, lastProviderStatus: providerStatus, lastError: null, updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, run.id));
          return res.json(await getRun(run.id, req.session.userId!));
        }
        if (!["draft", "calculated", "ready_for_review"].includes(providerStatus)) {
          return res.status(409).json({ error: "Gusto has not confirmed that this payroll is safe to retry.", code: "submission_unknown" });
        }
        const provider = await gustoRequest<any>(`/v1/payrolls/${run.gustoPayrollId}/submit`, { method: "POST", idempotencyKey: run.idempotencyKey });
        await db.update(gustoPayrollRuns).set({ status: provider?.status === "paid" ? "paid" : "submitted", providerRequestState: "submitted", lastProviderStatus: provider?.status ?? "submitted", lastError: null, updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, run.id));
        return res.json(await getRun(run.id, req.session.userId!));
      }
      if (!run.gustoPayrollId || run.status !== "ready_for_review") return res.status(409).json({ error: "Payroll must be calculated and ready for review before submission." });
      const account = await storage.getBusinessBankAccount(req.session.userId!);
      if (!account) return res.status(409).json({ error: "Business funding account is not connected.", code: "funding_not_connected" });
      const balance = await getBalance(account.plaidAccessToken);
      const integration = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, req.session.userId!) });
      // Gusto is the calculation system of record; refresh immediately before
      // the funding check so stale totals cannot be submitted.
      const refreshed = await gustoRequest<any>(`/v1/payrolls/${run.gustoPayrollId}/calculate`, { method: "POST", idempotencyKey: `${run.idempotencyKey}:calculate` });
      const refreshedDebit = Number(refreshed?.debit_total ?? refreshed?.gross_pay ?? run.debitTotal);
      await persistProviderEmployeeResults(run.id, refreshed);
      await db.update(gustoPayrollRuns).set({ grossTotal: String(refreshed?.gross_pay ?? run.grossTotal), netTotal: String(refreshed?.net_pay ?? run.netTotal), debitTotal: String(refreshedDebit), lastProviderStatus: refreshed?.status ?? "calculated", updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, run.id));
      const readiness = await db.select().from(gustoEmployeeMappings);
      const items = await db.select().from(gustoPayrollItems).where(eq(gustoPayrollItems.runId, run.id));
      const readinessByEmployee = new Map(readiness.map((mapping) => [mapping.employeeId, mapping]));
      const blockers = items.flatMap((item) => {
        const mapping = readinessByEmployee.get(item.employeeId);
        return !item.gustoEmployeeId ||
          mapping?.onboardingStatus !== "complete" ||
          mapping?.paymentMethodStatus !== "complete"
          ? [`Employee ${item.employeeId} is not ready for direct deposit`]
          : [];
      });
      if (!integration || integration.fundingStatus !== "verified") blockers.push("Gusto funding account is not verified");
      if (balance.available === null || balance.available < refreshedDebit) blockers.push("Available bank balance is below the expected payroll debit");
      if (blockers.length) return res.status(409).json({ error: "Payroll cannot be submitted.", blockers });
      const [claimed] = await db.update(gustoPayrollRuns).set({ status: "submitting", providerRequestState: "submitting", submissionActorUserId: req.session.userId!, submittedAt: new Date(), updatedAt: new Date() }).where(and(eq(gustoPayrollRuns.id, run.id), eq(gustoPayrollRuns.userId, req.session.userId!), eq(gustoPayrollRuns.status, "ready_for_review"))).returning();
      if (!claimed) return res.status(409).json({ error: "Payroll submission is already in progress.", code: "submission_in_progress" });
      submissionClaimed = true;
      const provider = await gustoRequest<any>(`/v1/payrolls/${run.gustoPayrollId}/submit`, { method: "POST", idempotencyKey: run.idempotencyKey });
      await db.update(gustoPayrollRuns).set({ status: provider?.status === "paid" ? "paid" : "submitted", providerRequestState: "submitted", lastProviderStatus: provider?.status ?? "submitted", updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, run.id));
      res.json(await getRun(run.id, req.session.userId!));
    } catch (error) {
      const e = safeError(error);
      await db.update(gustoPayrollRuns).set(submissionClaimed
        ? { status: "submitting", providerRequestState: "unknown", lastError: e.body.error, updatedAt: new Date() }
        : { status: "failed", providerRequestState: "failed", lastError: e.body.error, updatedAt: new Date() })
        .where(and(eq(gustoPayrollRuns.id, req.params.id), eq(gustoPayrollRuns.userId, req.session.userId!))).catch(() => {});
      res.status(e.status).json(e.body);
    }
  });

  app.post("/api/gusto/payroll-runs/:id/status", ...admin, async (req, res) => {
    try {
      const run = await db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.id, req.params.id), eq(gustoPayrollRuns.userId, req.session.userId!)) });
      if (!run?.gustoPayrollId) return res.status(404).json({ error: "Provider payroll not found for this run." });
      const provider = await gustoRequest<any>(`/v1/payrolls/${run.gustoPayrollId}`);
      const providerStatus = String(provider?.status ?? "").toLowerCase();
      const mapped: Record<string, string> = {
        draft: "ready_for_review", calculated: "ready_for_review", ready_for_review: "ready_for_review",
        submitted: "submitted", processing: "processing", processed: "processed", paid: "paid",
        "processing-failed": "failed", failed: "failed", reversed: "reversed",
        "partially-reversed": "partially_reversed", cancelled: "cancelled",
      };
      const status = mapped[providerStatus];
      if (!status) return res.status(409).json({ error: "Gusto returned an unrecognized payroll status; no local state was changed.", code: "unknown_provider_status" });
      await db.update(gustoPayrollRuns).set({ status, providerRequestState: status === "ready_for_review" ? "calculated" : providerStatus, lastProviderStatus: providerStatus, lastError: null, updatedAt: new Date() }).where(and(eq(gustoPayrollRuns.id, run.id), eq(gustoPayrollRuns.userId, req.session.userId!)));
      res.json(await getRun(run.id, req.session.userId!));
    } catch (error) {
      const e = safeError(error);
      res.status(e.status).json(e.body);
    }
  });

  for (const action of ["cancel", "reverse"] as const) app.post(`/api/gusto/payroll-runs/:id/${action}`, ...admin, async (req, res) => {
    try {
      const run = await db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.id, req.params.id), eq(gustoPayrollRuns.userId, req.session.userId!)) });
      if (!run?.gustoPayrollId) return res.status(404).json({ error: "Payroll run not found" });
      const provider = await gustoRequest<any>(`/v1/payrolls/${run.gustoPayrollId}/${action}`, { method: "POST", idempotencyKey: `${run.idempotencyKey}:${action}` });
      await db.update(gustoPayrollRuns).set({ status: action === "cancel" ? "cancelled" : "reversed", lastProviderStatus: provider?.status ?? action, updatedAt: new Date() }).where(eq(gustoPayrollRuns.id, run.id));
      res.json(await getRun(run.id, req.session.userId!));
    } catch (error) { const e = safeError(error); res.status(e.status).json(e.body); }
  });

  app.post("/api/gusto/webhook", async (req, res) => {
    const raw = (Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body ?? {})));
    if (!verifyGustoSignature(raw, req.headers["x-gusto-signature"] as string | undefined)) return res.status(401).json({ error: "Invalid webhook signature" });
    const event = req.body ?? {}, eventId = String(event.id ?? event.event_id ?? "");
    if (!eventId) return res.status(400).json({ error: "Webhook event id is required" });
    const [inserted] = await db.insert(gustoWebhookEvents).values({ eventId, eventType: String(event.type ?? "unknown"), payload: event }).onConflictDoNothing({ target: gustoWebhookEvents.eventId }).returning();
    if (!inserted) return res.status(200).json({ received: true, duplicate: true });
    const payrollId = event.data?.payroll_id ?? event.payroll_id;
    const status = String(event.data?.status ?? event.status ?? "").toLowerCase();
    if (payrollId && status) {
      const mapped: Record<string, string> = { calculated: "ready_for_review", submitted: "submitted", processing: "processing", processed: "processed", paid: "paid", "processing-failed": "failed", reversed: "reversed", "partially-reversed": "partially_reversed", cancelled: "cancelled" };
      await db.update(gustoPayrollRuns).set({ status: mapped[status] ?? status, lastProviderStatus: status, updatedAt: new Date() }).where(eq(gustoPayrollRuns.gustoPayrollId, String(payrollId)));
    }
    res.status(202).json({ received: true });
  });
}

async function getRun(id: string, userId: string) {
  const run = await db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.id, id), eq(gustoPayrollRuns.userId, userId)) });
  if (!run) return null;
  const items = await db.select().from(gustoPayrollItems).where(eq(gustoPayrollItems.runId, id));
  const employeeRows = await db.select({ id: employees.id, name: employees.name }).from(employees);
  const names = new Map(employeeRows.map((employee) => [employee.id, employee.name]));
  return publicRun(run, items.map((item) => ({ ...item, employeeName: names.get(item.employeeId) ?? null })));
}