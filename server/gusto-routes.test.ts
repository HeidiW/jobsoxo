import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
import { createHmac, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { encrypt, decrypt } from "./encryption";
import { employees, gustoEmployeeMappings, gustoIntegrations, gustoPayrollItems, gustoPayrollRuns, gustoWebhookEvents, users } from "@shared/schema";
import { registerGustoRoutes } from "./gusto-routes";
import { gustoRequest } from "./gusto-client";

// Concurrency/locking tests need independent committed connections, not the
// default rollback-only connection. Cleanup below is scoped to owned IDs.
vi.unmock("./db");

vi.mock("./plaid", () => ({
  getBalance: vi.fn(async () => { throw new Error("Plaid disabled"); }),
}));
vi.mock("./plaid-sync", () => ({ syncPlaidTransactionsForUser: vi.fn() }));

const companyId = `company-${randomUUID()}`;
let adminId = "", otherAdminId = "", employeeId = "", providerId = "";
const userIds: string[] = [], employeeIds: string[] = [], runIds: string[] = [], eventIds: string[] = [];
let provider: any, fetchMock: ReturnType<typeof vi.fn>, timeoutSubmit = false;
let tokenInfo: any;
const app = express();
app.use(express.json({ verify: (req, _res, raw) => { (req as any).rawBody = Buffer.from(raw); } }));
app.use(session({ secret: "isolated-payroll-test", resave: false, saveUninitialized: false }));
app.use((req, _res, next) => { req.session.userId = req.get("x-test-user")!; next(); });
registerGustoRoutes(app, (req, res, next) => {
  if (![adminId, otherAdminId].includes(req.session.userId)) return void res.status(403).json({ error: "Admin required" });
  next();
});
const get = (path: string) => request(app).get(path).set("x-test-user", adminId);
const post = (path: string) => request(app).post(path).set("x-test-user", adminId);
const response = (value: unknown, status = 200) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const [user] = await db.insert(users).values({ username: `__gusto_${randomUUID()}`, password: "unused-test-password", isAdmin: true }).returning();
    userIds.push(user.id);
  }
  [adminId, otherAdminId] = userIds;
});

beforeEach(async () => {
  vi.stubEnv("GUSTO_ENV", "demo");
  vi.stubEnv("GUSTO_API_BASE_URL", "https://api.gusto-demo.com");
  vi.stubEnv("GUSTO_WEBHOOK_SECRET", "test-signature-secret");
  vi.stubEnv("GUSTO_ACCESS_TOKEN", undefined);
  vi.stubEnv("GUSTO_COMPANY_ID", undefined);
  timeoutSubmit = false;
  const [employee] = await db.insert(employees).values({ name: "Payroll Test Worker", email: `gusto-${randomUUID()}@example.test`, dayRate: "200", employmentType: "w2", payType: "hourly", status: "active" }).returning();
  employeeId = employee.id; employeeIds.push(employeeId);
  providerId = `payroll-${randomUUID()}`;
  await db.insert(gustoIntegrations).values({
    userId: adminId, companyId, environment: "demo", state: "connected",
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-company-token" })),
    fundingAccountId: "funding-test", fundingStatus: "verified",
  }).onConflictDoUpdate({ target: gustoIntegrations.userId, set: {
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-company-token" })),
    environment: "demo", companyId, fundingStatus: "verified",
  } });
  await db.insert(gustoEmployeeMappings).values({
    employeeId, gustoEmployeeId: `gusto-${employeeId}`, companyId, environment: "demo",
    onboardingStatus: "complete", paymentMethodStatus: "complete",
  });
  provider = {
    payroll_uuid: providerId, company_uuid: companyId,
    pay_period: { start_date: "2040-01-01", end_date: "2040-01-14" },
    check_date: "2040-01-18", processed: false, calculated_at: null, processing_request: null,
    payroll_status_meta: { expected_check_date: "2040-01-18", expected_debit_time: "2040-01-15T20:00:00Z", cancellable: false },
    employee_compensations: [{
      employee_uuid: `gusto-${employeeId}`, version: "compensation-version", excluded: false,
      payment_method: "Direct Deposit", hourly_compensations: [{ name: "Regular Hours", hours: "0", job_uuid: "job-test" }],
      gross_pay: "1000.00", net_pay: null, taxes: [{ name: "Federal", employer: false, amount: "100" }, { name: "Employer tax", employer: true, amount: "80" }],
      deductions: [{ name: "Deduction", amount: "25" }], benefits: [], reimbursements: [],
    }],
    submission_blockers: [],
  };
  tokenInfo = { resource: { type: "Company", uuid: companyId }, scope: "payrolls:read payrolls:write payrolls:run flows:write companies:read company_onboarding_status:read company_bank_accounts:read employees:read employee_payment_methods:read" };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    const path = parsed.pathname, method = init?.method ?? "GET";
    if (path === "/v1/token_info") return response(tokenInfo);
    if (path === `/v1/companies/${companyId}`) return response({ uuid: companyId, name: "Test Company" });
    if (path.endsWith("/onboarding_status")) return response({ onboarding_completed: true, onboarding_steps: [] });
    if (path.endsWith("/bank_accounts")) return response([{ uuid: "funding-test", company_uuid: companyId, verification_status: "verified", hidden_account_number: "XXXX1234", routing_number: "secret-routing", account_number: "secret-account", name: "Operating" }]);
    if (path.endsWith("/employees")) return response([{ uuid: `gusto-${employeeId}`, email: employee.email, onboarding_status: "onboarding_completed" }]);
    if (path.endsWith("/payment_method")) return response({ type: "Direct Deposit", splits: [{ uuid: "employee-bank", split_amount: 100 }] });
    if (path.endsWith("/flows")) return response({ url: "https://flows.gusto-demo.com/flows/test-sensitive-session" }, 201);
    if (path === `/v1/companies/${companyId}/payrolls`) return response([provider]);
    if (path.endsWith(`/${providerId}/prepare`) && method === "PUT") return response(provider);
    if (path.endsWith(`/${providerId}/calculate`) && method === "PUT") {
      provider.processing_request = { status: "calculating" };
      return response(null, 202);
    }
    if (path.endsWith(`/${providerId}/submit`) && method === "PUT") {
      if (timeoutSubmit) throw new DOMException("timeout", "AbortError");
      provider.processing_request = { status: "submitting" };
      return response(null, 202);
    }
    if (path.endsWith(`/${providerId}/cancel`) && method === "PUT") {
      provider.processed = false; provider.processing_request = null; provider.payroll_status_meta.cancellable = false;
      return response(null, 202);
    }
    if (path.endsWith(`/${providerId}`) && method === "PUT") return response(provider);
    if (path.endsWith(`/${providerId}`) && method === "GET") return response(provider);
    throw new Error(`Unexpected mock request ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  // Capture even runs whose HTTP assertion failed before createRun returned.
  const ownedRuns = userIds.length
    ? await db.select({ id: gustoPayrollRuns.id }).from(gustoPayrollRuns).where(inArray(gustoPayrollRuns.userId, userIds))
    : [];
  runIds.push(...ownedRuns.map(run => run.id));
  if (runIds.length) {
    await db.delete(gustoPayrollItems).where(inArray(gustoPayrollItems.runId, runIds));
    await db.delete(gustoPayrollRuns).where(inArray(gustoPayrollRuns.id, runIds));
    runIds.length = 0;
  }
  await db.delete(gustoEmployeeMappings).where(inArray(gustoEmployeeMappings.employeeId, employeeIds));
  await db.delete(employees).where(inArray(employees.id, employeeIds));
  employeeIds.length = 0;
  if (eventIds.length) await db.delete(gustoWebhookEvents).where(inArray(gustoWebhookEvents.eventId, eventIds));
  eventIds.length = 0;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
afterAll(async () => {
  await db.delete(gustoIntegrations).where(inArray(gustoIntegrations.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

async function createRun(key = randomUUID()) {
  const created = await post("/api/gusto/payroll-runs").send({
    periodStart: "2040-01-01", periodEnd: "2040-01-14", payDate: "2040-01-18", idempotencyKey: key,
    items: [{ employeeId, hours: 40, grossEarnings: 1000, taxes: 999, deductions: 555, netPay: 1 }],
  }).expect(201);
  if (!runIds.includes(created.body.id)) runIds.push(created.body.id);
  return created.body;
}
async function readyRun() {
  const created = await createRun();
  await post(`/api/gusto/payroll-runs/${created.id}/calculate`).expect(200);
  provider.processing_request = { status: "calculate_success" };
  provider.calculated_at = "2040-01-15T12:00:00Z";
  provider.totals = { gross_pay: "1000", net_pay: "875", company_debit: "1080" };
  return (await get(`/api/gusto/payroll-runs/${created.id}`).expect(200)).body;
}
function webhook(type: string, overrides: any = {}) {
  const event = { uuid: `event-${randomUUID()}`, event_type: type, resource_type: "Company", resource_uuid: companyId, entity_type: "Payroll", entity_uuid: providerId, timestamp: 2200000000, ...overrides };
  eventIds.push(event.uuid);
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", "test-signature-secret").update(raw).digest("hex");
  return { raw, signature };
}
function sendWebhook(event: { raw: string; signature: string }) {
  return request(app).post("/api/gusto/webhook").set("Content-Type", "application/json").set("x-gusto-signature", event.signature).send(event.raw);
}

describe("Gusto-only payroll", () => {
  it("requires authentication/admin and hides another administrator's runs", async () => {
    await request(app).get("/api/gusto/status").expect(401);
    await request(app).get("/api/gusto/status").set("x-test-user", "ordinary-user").expect(403);
    const run = await createRun();
    await request(app).get(`/api/gusto/payroll-runs/${run.id}`).set("x-test-user", otherAdminId).expect(404);
    await request(app).post(`/api/gusto/payroll-runs/${run.id}/submit`).set("x-test-user", otherAdminId).expect(404);
  });
  it("creates an atomic idempotent local run and rejects invalid dates and duplicate employees", async () => {
    const key = randomUUID();
    const run = await createRun(key);
    const repeated = await post("/api/gusto/payroll-runs").send({
      periodStart: "2040-01-01", periodEnd: "2040-01-14", payDate: "2040-01-18", idempotencyKey: key,
    }).expect(200);
    expect(repeated.body.id).toBe(run.id);
    expect(run.employees).toHaveLength(1);
    expect(run.employees[0]).toMatchObject({ taxes: 0, deductions: 0, netPay: 0 });
    await post("/api/gusto/payroll-runs").send({ periodStart: "2040-02-31", periodEnd: "2040-03-14", payDate: "2040-03-18" }).expect(400);
    await post("/api/gusto/payroll-runs").send({ periodStart: "2040-01-01", periodEnd: "2040-01-14", payDate: "2040-01-18",
      items: [{ employeeId, grossEarnings: 1000 }, { employeeId, grossEarnings: 1000 }] }).expect(400);
  });
  it("validates the Embedded company and scopes before binding credentials", async () => {
    vi.stubEnv("GUSTO_ACCESS_TOKEN", "test-bootstrap-token"); vi.stubEnv("GUSTO_COMPANY_ID", companyId);
    tokenInfo.scope = "companies:read";
    await post("/api/gusto/connect").expect(503);
    tokenInfo.resource.uuid = "wrong-company";
    await post("/api/gusto/connect").expect(503);
  });
  it("connects only a company-scoped Embedded credential and encrypts it", async () => {
    vi.stubEnv("GUSTO_ACCESS_TOKEN", "test-bootstrap-token"); vi.stubEnv("GUSTO_COMPANY_ID", companyId);
    const result = await post("/api/gusto/connect").send({ companyId: "not-trusted" }).expect(200);
    expect(result.body.companyId).toBe(companyId);
    expect(JSON.stringify(result.body)).not.toContain("test-bootstrap-token");
    const saved = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, adminId) });
    expect(saved!.encryptedAccessToken).not.toContain("test-bootstrap-token");
    expect(JSON.parse(decrypt(saved!.encryptedAccessToken!)).accessToken).toBe("test-bootstrap-token");
    await request(app).post("/api/gusto/connect").set("x-test-user", otherAdminId).expect(503);
  });
  it("discovers redacted Gusto company funding without calling Plaid", async () => {
    const { getBalance } = await import("./plaid");
    const result = await get("/api/gusto/status").expect(200);
    expect(result.body).toMatchObject({ available: true, onboardingComplete: true, fundingAccount: { status: "verified", accountMask: "1234" } });
    expect(JSON.stringify(result.body)).not.toMatch(/secret-routing|secret-account|test-company-token/);
    expect(getBalance).not.toHaveBeenCalled();
  });
  it("syncs employee readiness from Gusto payment method, never from Plaid", async () => {
    await post("/api/gusto/employees/sync").expect(200);
    const ready = await get("/api/gusto/employees/readiness").expect(200);
    expect(ready.body.employees.find((employee: any) => employee.id === employeeId)).toMatchObject({ ready: true });
    expect(fetchMock.mock.calls.some(([url]) => url.includes("/payment_method"))).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("never treats a foreign-company mapping as ready", async () => {
    await db.update(gustoEmployeeMappings).set({ companyId: "other-company" }).where(eq(gustoEmployeeMappings.employeeId, employeeId));
    const ready = await get("/api/gusto/employees/readiness").expect(200);
    expect(ready.body.employees.find((employee: any) => employee.id === employeeId).ready).toBe(false);
  });
  it("uses versioned company-scoped PUT endpoints and waits for asynchronous calculation", async () => {
    const run = await createRun();
    const calculated = await post(`/api/gusto/payroll-runs/${run.id}/calculate`).expect(200);
    expect(calculated.body.status).toBe("calculating");
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: calculated.body.updatedAt }).expect(200);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
    const update = fetchMock.mock.calls.find(([url, init]) => new URL(url).pathname.endsWith(providerId) && init?.method === "PUT");
    expect(JSON.parse(String(update?.[1]?.body)).employee_compensations[0]).toMatchObject({
      version: "compensation-version", employee_uuid: `gusto-${employeeId}`, payment_method: "Direct Deposit",
      hourly_compensations: [{ name: "Regular Hours", hours: "40.00", job_uuid: "job-test" }],
    });
    expect(String(update?.[1]?.body)).not.toContain("555");
    expect(String(update?.[1]?.body)).not.toContain("999");
  });
  it("shows Gusto totals and unavailable pre-processing employee net honestly", async () => {
    const run = await readyRun();
    expect(run).toMatchObject({ status: "ready_for_review", expectedDebit: 1080, totals: { gross: 1000, net: 875, taxes: 100 } });
    expect(run.employees[0]).toMatchObject({ netPay: null, taxes: 100, deductions: 25 });
    expect(JSON.stringify(run)).not.toContain("test-company-token");
  });
  it("submits once while Plaid is disabled, without recalculating reviewed amounts", async () => {
    const run = await readyRun();
    const submitted = await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(200);
    expect(submitted.body.status).toBe("submitting");
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(200);
    const sends = fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"));
    expect(sends).toHaveLength(1);
    expect(sends[0][1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/calculate"))).toHaveLength(1);
    const { getBalance } = await import("./plaid"); expect(getBalance).not.toHaveBeenCalled();
  });
  it("allows only one claimant when two admins requests submit simultaneously", async () => {
    const run = await readyRun();
    const attempts = await Promise.all([post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }),
      post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt })]);
    expect(attempts.some(result => result.status === 200)).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(1);
  });
  it("does not resend after an ambiguous timeout even when provider still reports calculated", async () => {
    const run = await readyRun(); timeoutSubmit = true;
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(504);
    const pending = await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(200);
    expect(pending.body.status).toBe("submission_pending");
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(1);
  });
  it("requires another review when Gusto totals have changed", async () => {
    const run = await readyRun();
    provider.totals.company_debit = "1200";
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(409);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
    const updated = await get(`/api/gusto/payroll-runs/${run.id}`).expect(200);
    expect(updated.body.expectedDebit).toBe(1200);
    expect(updated.body.updatedAt).not.toBe(run.updatedAt);
  });
  it("rejects a stale review timestamp before initiating payment", async () => {
    const run = await readyRun();
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: "2020-01-01T00:00:00Z" }).expect(409);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
  });
  it("allows only one local run to own a provider payroll even with another request key", async () => {
    const first = await readyRun();
    const second = await createRun();
    const preparedBefore = fetchMock.mock.calls.filter(([url]) => url.includes("/prepare")).length;
    await post(`/api/gusto/payroll-runs/${second.id}/calculate`).expect(409);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/prepare"))).toHaveLength(preparedBefore);
    expect((await get(`/api/gusto/payroll-runs/${first.id}`).expect(200)).body.status).toBe("ready_for_review");
  });
  it("keeps payroll calculating until the provider reports success and then tracks accepted submission", async () => {
    const run = await readyRun();
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(200);
    const pending = await get(`/api/gusto/payroll-runs/${run.id}`).expect(200);
    expect(pending.body.status).toBe("submitting");
    provider.processing_request = { status: "submit_success" }; provider.processed = true;
    provider.employee_compensations[0].net_pay = "875";
    const processed = await get(`/api/gusto/payroll-runs/${run.id}`).expect(200);
    expect(processed.body).toMatchObject({ status: "submitted", canRecalculate: false, canSubmit: false });
    expect(processed.body.employees[0].netPay).toBe(875);
    expect(processed.body.status).not.toBe("paid");
  });
  it("does not send live payroll when production execution is disabled", async () => {
    const run = await readyRun();
    await db.update(gustoPayrollRuns).set({ environment: "production" }).where(eq(gustoPayrollRuns.id, run.id));
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(409);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
  });
  it("blocks unverified Gusto funding and incomplete employee methods but never checks a balance", async () => {
    const run = await readyRun();
    const defaultFetch = fetchMock.getMockImplementation()!;
    // Company, onboarding and account requests run concurrently, with async
    // token lookups. Their arrival order is not guaranteed.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (new URL(url).pathname.endsWith("/bank_accounts")) {
        return response([{ uuid: "funding-test", verification_status: "awaiting_deposits" }]);
      }
      return defaultFetch(url, init);
    });
    const blocked = await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(409);
    expect(blocked.body.error).toContain("Gusto funding account is not verified");
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/submit"))).toHaveLength(0);
  });
  it("keeps asynchronous submission failures immutable instead of retryable", async () => {
    const run = await readyRun();
    await post(`/api/gusto/payroll-runs/${run.id}/submit`).send({ reviewedUpdatedAt: run.updatedAt }).expect(200);
    provider.processing_request = { status: "processing_failed", errors: [{ message: "sensitive raw provider value" }] };
    const failed = await get(`/api/gusto/payroll-runs/${run.id}`).expect(200);
    expect(failed.body).toMatchObject({ status: "failed", canRecalculate: false, canSubmit: false });
    expect(JSON.stringify(failed.body)).not.toContain("sensitive raw");
    await post(`/api/gusto/payroll-runs/${run.id}/calculate`).expect(409);
  });
  it("accepts signed official events idempotently and never regresses paid to processed", async () => {
    const run = await readyRun();
    const paid = webhook("payroll.paid");
    await sendWebhook(paid).expect(200);
    const repeated = await sendWebhook(paid).expect(200);
    expect(repeated.body.duplicate).toBe(true);
    await sendWebhook(webhook("payroll.processed")).expect(200);
    const result = await get(`/api/gusto/payroll-runs/${run.id}`).expect(200);
    expect(result.body.status).toBe("paid");
  });
  it("rejects forged signatures and ignores another company's valid event", async () => {
    const run = await readyRun();
    const event = webhook("payroll.paid", { resource_uuid: "foreign-company" });
    await request(app).post("/api/gusto/webhook").send(JSON.parse(event.raw)).expect(401);
    await sendWebhook(event).expect(200);
    const result = await get(`/api/gusto/payroll-runs/${run.id}`).expect(200);
    expect(result.body.status).toBe("ready_for_review");
  });
  it("creates Gusto-hosted setup without accepting browser-supplied bank credentials", async () => {
    const result = await post("/api/gusto/flows").send({ flowType: "add_bank_info", account_number: "not-forwarded" }).expect(200);
    expect(result.body.url).toBe("https://flows.gusto-demo.com/flows/test-sensitive-session");
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith("/flows"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ flow_type: "add_bank_info" });
    await post("/api/gusto/flows").send({ flowType: "arbitrary" }).expect(400);
  });
  it("keeps the independent bank view accessible without Gusto configured", async () => {
    await db.delete(gustoIntegrations).where(eq(gustoIntegrations.userId, adminId));
    vi.spyOn(storage, "getBusinessBankAccount").mockResolvedValue(undefined);
    const result = await get("/api/plaid/bank-summary").expect(200);
    expect(result.body).toEqual({ connected: false, transactions: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cancels only when the provider allows it, with the correct PUT contract", async () => {
    const run = await readyRun();
    await post(`/api/gusto/payroll-runs/${run.id}/cancel`).expect(409);
    provider.processed = true; provider.processing_request = { status: "submit_success" }; provider.payroll_status_meta.cancellable = true;
    await post(`/api/gusto/payroll-runs/${run.id}/status`).expect(200);
    const cancelled = await post(`/api/gusto/payroll-runs/${run.id}/cancel`).expect(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith("/cancel") && init?.method === "PUT")).toHaveLength(1);
    await post(`/api/gusto/payroll-runs/${run.id}/cancel`).expect(200);
  });
  it("serializes rotating refresh tokens and never returns them to the browser", async () => {
    vi.stubEnv("GUSTO_CLIENT_ID", "test-client"); vi.stubEnv("GUSTO_CLIENT_SECRET", "test-client-secret");
    await db.update(gustoIntegrations).set({ encryptedAccessToken: encrypt(JSON.stringify({
      accessToken: "expired", refreshToken: "refresh-old", expiresAt: 1,
    })) }).where(eq(gustoIntegrations.userId, adminId));
    const api = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/oauth/token")) return response({ access_token: "new-token", refresh_token: "refresh-new", expires_in: 7200 });
      return api(url, init);
    });
    await Promise.all([gustoRequest(`/v1/companies/${companyId}`, { userId: adminId }), gustoRequest(`/v1/companies/${companyId}`, { userId: adminId })]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/oauth/token"))).toHaveLength(1);
    const saved = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, adminId) });
    expect(saved!.encryptedAccessToken).not.toContain("refresh-new");
    expect(JSON.parse(decrypt(saved!.encryptedAccessToken!)).refreshToken).toBe("refresh-new");
  });
});
