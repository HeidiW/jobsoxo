import type { Express, Request, Response, NextFunction } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "./db";
import { employees, gustoIntegrations, gustoPayrollItems, gustoPayrollRuns, gustoWebhookEvents } from "@shared/schema";
import { GustoConfigurationError, GustoProviderError, gustoConfigured, gustoEnvironment, verifyGustoSignature } from "./gusto-client";
import { companyIntegration, connectCompany, createFlow, employeeReadiness, syncCompany, syncEmployees } from "./gusto-company";
import { calculatePayroll, cancelPayroll, PayrollConflict, pendingPayrollStates, reconcilePayroll, runForUser, submitPayroll } from "./gusto-payroll";
import { derivePayrollInputs, payrollDate } from "./gusto-inputs";
import { registerPayrollBankView } from "./payroll-bank-view";
import { demoCompanySetup, registerGustoDemoRoutes } from "./gusto-demo-company";
import { registerGustoRemovalRoutes } from "./gusto-remove-company";

declare module "http" { interface IncomingMessage { rawBody: unknown } }

function fail(res: Response, error: unknown) {
  if (error instanceof PayrollConflict) return res.status(409).json({ error: error.message, code: error.code });
  if (error instanceof GustoConfigurationError) return res.status(503).json({ error: error.message, code: "not_configured" });
  if (error instanceof GustoProviderError) return res.status(error.status).json({ error: error.message, code: error.code });
  // Do not echo raw DB/provider payloads, constraint details or credentials.
  return res.status(500).json({ error: "Gusto payroll could not complete this action." });
}

async function publicRun(id: string, userId: string) {
  const run = await runForUser(id, userId);
  if (!run) return null;
  const items = await db.select({ item: gustoPayrollItems, name: employees.name }).from(gustoPayrollItems)
    .leftJoin(employees, eq(gustoPayrollItems.employeeId, employees.id)).where(eq(gustoPayrollItems.runId, id));
  return {
    id: run.id, status: run.status, providerStatus: run.lastProviderStatus, error: run.lastError, blockers: run.blockers,
    periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.checkDate ?? run.payDate,
    expectedDebit: Number(run.debitTotal), expectedDebitDate: run.expectedDebitDate,
    canCancel: run.canCancel && ["submitted", "processed"].includes(run.status),
    canRecalculate: !run.submittedAt && ["draft", "failed", "ready_for_review"].includes(run.status),
    canSubmit: !run.submittedAt && run.status === "ready_for_review" && !run.blockers.length,
    totals: { gross: Number(run.grossTotal), net: Number(run.netTotal),
      deductions: items.reduce((n, row) => n + Number(row.item.deductions), 0),
      taxes: items.some(row => (row.item.providerResult as any)?.taxes === null)
        ? null : items.reduce((n, row) => n + Number(row.item.taxes), 0),
      reimbursements: items.reduce((n, row) => n + Number(row.item.reimbursements), 0) },
    employees: items.map(({ item, name }) => ({ id: item.employeeId, name, hours: Number(item.hours), days: Number(item.days),
      earnings: Number(item.grossEarnings), deductions: Number(item.deductions), taxes: Number(item.taxes),
      reimbursements: Number(item.reimbursements),
      netPay: (item.providerResult as any)?.net === null ? null : Number(item.netPay),
      ...((item.providerResult as any)?.taxes === null ? { taxes: null } : {}),
    })),
    createdAt: run.createdAt, updatedAt: run.updatedAt,
  };
}

export function registerGustoRoutes(app: Express, requireAdmin: (req: Request, res: Response, next: NextFunction) => void) {
  const baseRequireAdmin = requireAdmin;
  requireAdmin = (req, res, next) => {
    if (!req.session?.userId) return void res.status(401).json({ error: "Sign in to manage payroll." });
    baseRequireAdmin(req, res, next);
  };
  registerPayrollBankView(app, requireAdmin);
  registerGustoDemoRoutes(app, requireAdmin);
  registerGustoRemovalRoutes(app, requireAdmin);
  app.get("/api/gusto/status", requireAdmin, async (req, res) => {
    try {
      const setup = await demoCompanySetup(req.session.userId!);
      const integration = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, req.session.userId!) });
      if (!integration?.encryptedAccessToken) return res.json({
        setup,
        configured: gustoConfigured(), available: false, state: "not_connected", environment: gustoEnvironment(),
        error: setup.error || (gustoConfigured() ? "Connect the configured Gusto Embedded company to enable payroll."
          : setup.clientConfigured ? "Gusto application credentials are saved. Set up a demo company to continue."
          : "Gusto Embedded company credentials are not configured."),
      });
      res.json({ ...await syncCompany(req.session.userId!), setup });
    } catch (error) { fail(res, error); }
  });
  app.post("/api/gusto/connect", requireAdmin, async (req, res) => {
    try { res.json(await connectCompany(req.session.userId!)); } catch (error) { fail(res, error); }
  });
  app.post("/api/gusto/sync", requireAdmin, async (req, res) => {
    try { res.json(await syncCompany(req.session.userId!)); } catch (error) { fail(res, error); }
  });
  app.post("/api/gusto/funding-account", requireAdmin, async (req, res) => {
    // Compatibility endpoint is now discovery only: never create/replace a
    // company bank account using a Plaid processor token.
    try { res.json(await syncCompany(req.session.userId!)); } catch (error) { fail(res, error); }
  });
  app.post("/api/gusto/flows", requireAdmin, async (req, res) => {
    try { res.json(await createFlow(req.session.userId!, req.body.flowType)); } catch (error) { fail(res, error); }
  });
  app.get("/api/gusto/employees/readiness", requireAdmin, async (req, res) => {
    try { res.json({ employees: await employeeReadiness(req.session.userId!) }); } catch (error) { fail(res, error); }
  });
  app.post("/api/gusto/employees/sync", requireAdmin, async (req, res) => {
    try { res.json({ synced: await syncEmployees(req.session.userId!) }); } catch (error) { fail(res, error); }
  });

  app.post("/api/gusto/payroll-runs", requireAdmin, async (req, res) => {
    let periodStart: string, periodEnd: string, payDate: string;
    try {
      periodStart = payrollDate(req.body.periodStart); periodEnd = payrollDate(req.body.periodEnd); payDate = payrollDate(req.body.payDate);
      if (periodStart > periodEnd || payDate < periodEnd) throw new Error("The pay date must be on or after a valid pay period.");
      if (req.body.items !== undefined && !Array.isArray(req.body.items)) throw new Error("Payroll items must be an array.");
      if (req.body.idempotencyKey !== undefined && (typeof req.body.idempotencyKey !== "string" || !/^[a-zA-Z0-9:_-]{1,120}$/.test(req.body.idempotencyKey))) throw new Error("Invalid payroll request key.");
    } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
    try {
      const userId = req.session.userId!;
      const integration = await companyIntegration(userId);
      const clientKey = req.body.idempotencyKey ?? crypto.randomUUID();
      const key = crypto.createHash("sha256").update(`${userId}:${clientKey}`).digest("hex");
      const old = await db.query.gustoPayrollRuns.findFirst({ where: and(eq(gustoPayrollRuns.idempotencyKey, key), eq(gustoPayrollRuns.userId, userId)) });
      if (old) return res.json(await publicRun(old.id, userId));
      let inputs;
      try { inputs = await derivePayrollInputs(periodStart, periodEnd, req.body.items ?? [], integration.companyId!, integration.environment); }
      catch (error) { return res.status(400).json({ error: error instanceof Error && !(error as any).code ? error.message : "Invalid payroll inputs." }); }
      const id = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gusto-company-connect'))`);
        const [current] = await tx.select().from(gustoIntegrations).where(eq(gustoIntegrations.userId, userId));
        if (!current?.encryptedAccessToken || current.id !== integration.id ||
            current.companyId !== integration.companyId || current.environment !== integration.environment) {
          throw new PayrollConflict("The company connection changed. Refresh before creating payroll.");
        }
        const [inserted] = await tx.insert(gustoPayrollRuns).values({
          userId, companyId: integration.companyId, environment: integration.environment,
          periodStart, periodEnd, payDate, idempotencyKey: key,
        }).onConflictDoNothing({ target: gustoPayrollRuns.idempotencyKey }).returning();
        if (!inserted) {
          const [existing] = await tx.select().from(gustoPayrollRuns).where(and(eq(gustoPayrollRuns.idempotencyKey, key), eq(gustoPayrollRuns.userId, userId)));
          if (!existing) throw new PayrollConflict("Payroll request key is already in use.");
          return existing.id;
        }
        await tx.insert(gustoPayrollItems).values(inputs.map(item => ({ ...item, runId: inserted.id })));
        return inserted.id;
      });
      res.status(201).json(await publicRun(id, userId));
    } catch (error) { fail(res, error); }
  });
  app.get("/api/gusto/payroll-runs", requireAdmin, async (req, res) => {
    try {
      const rows = await db.select({ id: gustoPayrollRuns.id }).from(gustoPayrollRuns).where(eq(gustoPayrollRuns.userId, req.session.userId!))
        .orderBy(desc(gustoPayrollRuns.createdAt)).limit(50);
      res.json({ runs: await Promise.all(rows.map(row => publicRun(row.id, req.session.userId!))) });
    } catch (error) { fail(res, error); }
  });
  app.get("/api/gusto/payroll-runs/:id", requireAdmin, async (req, res) => {
    try {
      const run = await runForUser(req.params.id, req.session.userId!);
      if (!run) return res.status(404).json({ error: "Payroll run not found" });
      if (run.gustoPayrollId && pendingPayrollStates.has(run.status)) {
        try { await reconcilePayroll(run.id, req.session.userId!); }
        catch { return res.json({ ...await publicRun(run.id, req.session.userId!), error: "Gusto status could not be refreshed. The last confirmed state is shown; no payroll was retried." }); }
      }
      res.json(await publicRun(run.id, req.session.userId!));
    } catch (error) { fail(res, error); }
  });
  for (const action of ["calculate", "submit", "status", "cancel"] as const) {
    app.post(`/api/gusto/payroll-runs/:id/${action}`, requireAdmin, async (req, res) => {
      try {
        const run = await runForUser(req.params.id, req.session.userId!);
        if (!run) return res.status(404).json({ error: "Payroll run not found" });
        if (action === "calculate") await calculatePayroll(run.id, req.session.userId!);
        if (action === "submit") await submitPayroll(run.id, req.session.userId!, req.body.reviewedUpdatedAt);
        if (action === "status") await reconcilePayroll(run.id, req.session.userId!);
        if (action === "cancel") await cancelPayroll(run.id, req.session.userId!);
        res.json(await publicRun(run.id, req.session.userId!));
      } catch (error) { fail(res, error); }
    });
  }
  // No generic reverse endpoint: cancellation is provider-controlled, not an
  // invented guarantee that an ACH already sent can be reversed.
  app.post("/api/gusto/webhook", async (req, res) => {
    if (!Buffer.isBuffer(req.rawBody) || !verifyGustoSignature(req.rawBody, req.get("x-gusto-signature"))) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
    const event = req.body;
    if (typeof event?.uuid !== "string" || typeof event.event_type !== "string" || typeof event.resource_uuid !== "string" || typeof event.entity_uuid !== "string") {
      return res.status(400).json({ error: "Invalid Gusto event envelope." });
    }
    try {
      let duplicate = false;
      await db.transaction(async tx => {
        const [inserted] = await tx.insert(gustoWebhookEvents).values({
          eventId: event.uuid, eventType: event.event_type,
          payload: { resource_uuid: event.resource_uuid, entity_uuid: event.entity_uuid, timestamp: event.timestamp },
        }).onConflictDoNothing({ target: gustoWebhookEvents.eventId }).returning();
        if (!inserted) { duplicate = true; return; }
        const [run] = await tx.select().from(gustoPayrollRuns).where(and(
          eq(gustoPayrollRuns.gustoPayrollId, event.entity_uuid), eq(gustoPayrollRuns.companyId, event.resource_uuid),
          eq(gustoPayrollRuns.environment, gustoEnvironment()),
        )).for("update");
        if (!run || event.entity_type !== "Payroll") return;
        const states: Record<string, string> = {
          "payroll.submitted": "submitted", "payroll.processed": "processed", "payroll.paid": "paid",
          "payroll.processing_failed": "failed", "payroll.reversed": "reversed",
          "payroll.partially_reversed": "partially_reversed", "payroll.cancelled": "cancelled",
        };
        const status = states[event.event_type];
        if (!status) return; // Calculated events require fetching actual totals.
        const rank: Record<string, number> = { draft: 0, calculating: 0, ready_for_review: 0, unknown: 0, submitting: 1, submission_pending: 1,
          submitted: 2, processing: 3, processed: 3, paid: 4, failed: 5, cancelled: 6, partially_reversed: 7, reversed: 8 };
        if ((rank[status] ?? 0) < (rank[run.status] ?? 0)) return; // Never regress on a late/replayed event.
        await tx.update(gustoPayrollRuns).set({
          status, providerRequestState: status, lastProviderStatus: status, lastError: status === "failed" ? "Gusto reported payroll processing failure." : null,
          canCancel: false, updatedAt: new Date(),
          // Prevent external submission events from reopening mutable paths.
          ...(!run.submittedAt && ["submitted", "processed", "paid", "reversed", "partially_reversed"].includes(status) ? { submittedAt: new Date() } : {}),
        }).where(eq(gustoPayrollRuns.id, run.id));
      });
      res.status(200).json({ received: true, ...(duplicate ? { duplicate: true } : {}) });
    } catch (error) { fail(res, error); }
  });
}
