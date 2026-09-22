import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { buildAdminTestApp, buildTestApp } from "./test-helpers";
import { db } from "./db";
import { storage } from "./storage";
import { bankAccounts, employees, gustoEmployeeMappings, gustoIntegrations, gustoPayrollItems, gustoPayrollRuns, gustoWebhookEvents } from "@shared/schema";

vi.mock("./plaid", async () => ({
  ...(await vi.importActual<typeof import("./plaid")>("./plaid")),
  createProcessorToken: vi.fn(async (_token: string, _account: string, processor: string) => `processor-${processor}-token`),
  getBalance: vi.fn(async () => ({ current: 10000, available: 10000 })),
}));

let adminApp: Express;
let userApp: Express;
const runIds: string[] = [];
const eventIds: string[] = [];
const employeeIds: string[] = [];
const bankAccountIds: string[] = [];
const mappingEmployeeIds: string[] = [];
let adminUserId = "";
const originalSecret = process.env.GUSTO_WEBHOOK_SECRET;

beforeAll(async () => {
  adminApp = await buildAdminTestApp();
  userApp = await buildTestApp();
  adminUserId = (await storage.getUserByUsername("__test_admin__"))?.id ?? "";
  await db.execute(sql`select 1 from gusto_webhook_events limit 1`);
  await db.execute(sql`select 1 from gusto_payroll_runs limit 1`);
});

afterAll(async () => {
  if (runIds.length) {
    await db.delete(gustoPayrollItems).where(inArray(gustoPayrollItems.runId, runIds));
    await db.delete(gustoPayrollRuns).where(inArray(gustoPayrollRuns.id, runIds));
  }
  if (eventIds.length) {
    await db.delete(gustoWebhookEvents).where(inArray(gustoWebhookEvents.eventId, eventIds));
  }
  if (mappingEmployeeIds.length) await db.delete(gustoEmployeeMappings).where(inArray(gustoEmployeeMappings.employeeId, mappingEmployeeIds));
  if (bankAccountIds.length) await db.delete(bankAccounts).where(inArray(bankAccounts.id, bankAccountIds));
  if (employeeIds.length) await db.delete(employees).where(inArray(employees.id, employeeIds));
  if (originalSecret === undefined) delete process.env.GUSTO_WEBHOOK_SECRET;
  else process.env.GUSTO_WEBHOOK_SECRET = originalSecret;
});

async function setupEmployee(email = `gusto-${randomUUID()}@example.com`) {
  const employee = await storage.createEmployee({
    name: "Gusto Test Employee",
    email,
    dayRate: "200",
    status: "active",
  });
  employeeIds.push(employee.id);
  return employee;
}

async function setupBusinessAndIntegration() {
  process.env.GUSTO_ACCESS_TOKEN = "test-gusto-token";
  process.env.GUSTO_COMPANY_ID = "company-test";
  const account = await storage.createBankAccount({
    userId: adminUserId,
    entityType: "business",
    plaidItemId: `item-${randomUUID()}`,
    plaidAccessToken: "access-sandbox",
    plaidAccountId: `account-${randomUUID()}`,
    institutionName: "Test Bank",
    accountName: "Operating",
    accountMask: "1234",
    accountType: "checking",
  });
  bankAccountIds.push(account.id);
  await db.insert(gustoIntegrations).values({
    userId: adminUserId,
    companyId: "company-test",
    state: "connected",
    fundingAccountId: "funding-old",
    fundingStatus: "verified",
  }).onConflictDoUpdate({ target: gustoIntegrations.userId, set: { companyId: "company-test", state: "connected", fundingAccountId: "funding-old", fundingStatus: "verified" } });
  return account;
}

function signedBody(body: string) {
  const signature = createHmac("sha256", process.env.GUSTO_WEBHOOK_SECRET!).update(Buffer.from(body)).digest("hex");
  return request(adminApp)
    .post("/api/gusto/webhook")
    .set("Content-Type", "application/json")
    .set("x-gusto-signature", `sha256=${signature}`)
    .send(body);
}

describe("Gusto payroll route authorization and idempotency", () => {
  it("requires admin access for the integrated payroll routes", async () => {
    await request(userApp).get("/api/gusto/status").expect(403);
    await request(userApp).post("/api/gusto/payroll-runs").send({
      periodStart: "2040-01-01",
      periodEnd: "2040-01-14",
      payDate: "2040-01-18",
    }).expect(403);
  });

  it("returns the same run and items for a repeated idempotency key", async () => {
    const employee = await setupEmployee();
    await db.insert(gustoEmployeeMappings).values({ employeeId: employee.id, gustoEmployeeId: `mapped-${employee.id}`, onboardingStatus: "complete", paymentMethodStatus: "complete" });
    mappingEmployeeIds.push(employee.id);
    const idempotencyKey = `gusto-test-${randomUUID()}`;
    const payload = {
      periodStart: "2040-01-01",
      periodEnd: "2040-01-14",
      payDate: "2040-01-18",
      idempotencyKey,
      items: [{ employeeId: employee.id, hours: 40, grossEarnings: 1000 }],
    };
    const first = await request(adminApp).post("/api/gusto/payroll-runs").send(payload).expect(201);
    const second = await request(adminApp).post("/api/gusto/payroll-runs").send(payload).expect(200);
    runIds.push(first.body.id);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.employees).toEqual(first.body.employees);
  });

  it("does not disclose another tenant's payroll run", async () => {
    const employee = await setupEmployee();
    await db.insert(gustoEmployeeMappings).values({ employeeId: employee.id, gustoEmployeeId: `mapped-${employee.id}`, onboardingStatus: "complete", paymentMethodStatus: "complete" });
    mappingEmployeeIds.push(employee.id);
    const created = await request(adminApp).post("/api/gusto/payroll-runs").send({
      periodStart: "2040-02-01",
      periodEnd: "2040-02-14",
      payDate: "2040-02-18",
      idempotencyKey: `gusto-tenant-${randomUUID()}`,
      items: [{ employeeId: employee.id, hours: 40, grossEarnings: 1000 }],
    }).expect(201);
    runIds.push(created.body.id);
    await request(userApp).get(`/api/gusto/payroll-runs/${created.body.id}`).expect(403);
  });
});

describe("Gusto provider orchestration", () => {
  it("requires replacement confirmation and sends only a Plaid processor token to Gusto", async () => {
    await setupBusinessAndIntegration();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uuid: "funding-new", verification_status: "verified" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await request(adminApp).post("/api/gusto/funding-account").send({}).expect(409);
    const response = await request(adminApp).post("/api/gusto/funding-account")
      .send({ replaceDefault: true }).expect(201);
    expect(response.body).toMatchObject({ companyId: "company-test", fundingStatus: "verified" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ processor_token: "processor-gusto-token", account_type: "Checking" });
    expect(JSON.stringify(response.body)).not.toContain("access-sandbox");
  });

  it("synchronizes an existing Plaid-linked employee account through Gusto", async () => {
    await setupBusinessAndIntegration();
    const employee = await setupEmployee();
    const account = await storage.createBankAccount({
      userId: adminUserId,
      entityType: "employee",
      entityId: employee.id,
      plaidItemId: `employee-item-${randomUUID()}`,
      plaidAccessToken: "employee-access-secret",
      plaidAccountId: `employee-account-${randomUUID()}`,
      institutionName: "Employee Bank",
      accountName: "Checking",
      accountMask: "4321",
      accountType: "checking",
    });
    bankAccountIds.push(account.id);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "gusto-employee-1", email: employee.email, onboarding_status: "complete" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ verification_status: "complete" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(adminApp).post("/api/gusto/employees/sync").expect(200);
    expect(response.body.synced).toEqual([expect.objectContaining({
      employeeId: employee.id,
      gustoEmployeeId: "gusto-employee-1",
      paymentMethodStatus: "complete",
    })]);
    expect(fetchMock.mock.calls[1][0]).toContain("/v1/employees/gusto-employee-1/bank_accounts");
    expect(JSON.stringify(response.body)).not.toContain("employee-access-secret");
  });

  it("creates a nonzero run from submitted employee payroll inputs and sends them for provider calculation", async () => {
    await setupBusinessAndIntegration();
    const employee = await setupEmployee();
    await db.insert(gustoEmployeeMappings).values({
      employeeId: employee.id,
      gustoEmployeeId: "gusto-employee-input",
      onboardingStatus: "complete",
      paymentMethodStatus: "complete",
    });
    mappingEmployeeIds.push(employee.id);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      uuid: "provider-payroll-input",
      status: "calculated",
      gross_pay: 1250,
      net_pay: 1000,
      debit_total: 1350,
      employees: [{
        employee_id: "gusto-employee-input",
        taxes: 175,
        deductions: 250,
        net_pay: 925,
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const created = await request(adminApp).post("/api/gusto/payroll-runs").send({
      periodStart: "2040-04-01",
      periodEnd: "2040-04-14",
      payDate: "2040-04-18",
      idempotencyKey: `gusto-input-${randomUUID()}`,
      items: [{ employeeId: employee.id, hours: 80, grossEarnings: 1250, deductions: 250, reimbursements: 100 }],
    }).expect(201);
    runIds.push(created.body.id);
    const item = created.body.employees.find((row: any) => row.id === employee.id);
    expect(item).toMatchObject({ hours: 80, earnings: 1250, deductions: 250, reimbursements: 100 });
    const calculated = await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/calculate`).expect(200);
    expect(calculated.body).toMatchObject({ status: "ready_for_review", expectedDebit: 1350 });
    expect(calculated.body.employees).toContainEqual(expect.objectContaining({
      id: employee.id,
      taxes: 175,
      deductions: 250,
      netPay: 925,
    }));
    const storedItem = await db.query.gustoPayrollItems.findFirst({
      where: eq(gustoPayrollItems.runId, created.body.id),
    });
    expect(storedItem).toMatchObject({
      taxes: "175.00",
      deductions: "250.00",
      netPay: "925.00",
    });
    expect(storedItem?.providerResult).toMatchObject({ employee_id: "gusto-employee-input" });
    const providerPayload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(providerPayload.employees).toContainEqual(expect.objectContaining({ employee_id: "gusto-employee-input", gross_earnings: 1250, deductions: 250 }));
  });

  it("blocks calculation mutation after provider submission and preserves ambiguous submission state", async () => {
    await setupBusinessAndIntegration();
    const employee = await setupEmployee();
    await db.insert(gustoEmployeeMappings).values({
      employeeId: employee.id,
      gustoEmployeeId: "gusto-employee-submit",
      onboardingStatus: "complete",
      paymentMethodStatus: "complete",
    });
    mappingEmployeeIds.push(employee.id);
    let submitAttempts = 0;
    const fetchMock = vi.fn((url: string) => {
      if (!url.endsWith("/submit")) return Promise.resolve(new Response(JSON.stringify({ uuid: "provider-submit", status: "calculated", gross_pay: 100, net_pay: 90, debit_total: 100 }), { status: 200 }));
      if (url.endsWith("/submit")) {
        submitAttempts++;
        if (submitAttempts === 1) return Promise.reject(Object.assign(new Error("timeout"), { name: "AbortError" }));
        return Promise.resolve(new Response(JSON.stringify({ status: "submitted" }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const created = await request(adminApp).post("/api/gusto/payroll-runs").send({
      periodStart: "2040-05-01", periodEnd: "2040-05-14", payDate: "2040-05-18",
      idempotencyKey: `gusto-submit-${randomUUID()}`,
      items: [{ employeeId: employee.id, hours: 40, grossEarnings: 100 }],
    }).expect(201);
    runIds.push(created.body.id);
    await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/calculate`).expect(200);
    const firstSubmit = await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/submit`).expect(504);
    expect(firstSubmit.body.code).toBe("timeout");
    const pending = await request(adminApp).get(`/api/gusto/payroll-runs/${created.body.id}`).expect(200);
    expect(pending.body.status).toBe("submitting");
    expect(pending.body.providerStatus).toBe("calculated");
    const retry = await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/submit`).expect(200);
    expect(retry.body.status).toBe("submitted");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/submit"))).toHaveLength(2);
    await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/calculate`).expect(409);
  });

  it("blocks submission when the refreshed provider debit exceeds Plaid available balance", async () => {
    await setupBusinessAndIntegration();
    const employee = await setupEmployee();
    await db.insert(gustoEmployeeMappings).values({
      employeeId: employee.id, gustoEmployeeId: "gusto-balance", onboardingStatus: "complete", paymentMethodStatus: "complete",
    });
    mappingEmployeeIds.push(employee.id);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      uuid: "provider-balance", status: "calculated", gross_pay: 15000, net_pay: 12000, debit_total: 15000,
    }), { status: 200 })));
    const created = await request(adminApp).post("/api/gusto/payroll-runs").send({
      periodStart: "2040-06-01", periodEnd: "2040-06-14", payDate: "2040-06-18",
      idempotencyKey: `gusto-balance-${randomUUID()}`,
      items: [{ employeeId: employee.id, hours: 40, grossEarnings: 15000 }],
    }).expect(201);
    runIds.push(created.body.id);
    await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/calculate`).expect(200);
    const response = await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/submit`).expect(409);
    expect(response.body.blockers).toContain("Available bank balance is below the expected payroll debit");
  });

  it("uses provider idempotency keys for cancellation and reversal actions", async () => {
    await setupBusinessAndIntegration();
    const employee = await setupEmployee();
    await db.insert(gustoEmployeeMappings).values({
      employeeId: employee.id, gustoEmployeeId: "gusto-actions", onboardingStatus: "complete", paymentMethodStatus: "complete",
    });
    mappingEmployeeIds.push(employee.id);
    const created = await request(adminApp).post("/api/gusto/payroll-runs").send({
      periodStart: "2040-07-01", periodEnd: "2040-07-14", payDate: "2040-07-18",
      idempotencyKey: `gusto-actions-${randomUUID()}`,
      items: [{ employeeId: employee.id, hours: 40, grossEarnings: 100 }],
    }).expect(201);
    runIds.push(created.body.id);
    await db.update(gustoPayrollRuns).set({ gustoPayrollId: "provider-actions", status: "submitted" }).where(eq(gustoPayrollRuns.id, created.body.id));
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ status: "cancelled" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/cancel`).expect(200);
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/payrolls/provider-actions/cancel");
    await db.update(gustoPayrollRuns).set({ status: "submitted" }).where(eq(gustoPayrollRuns.id, created.body.id));
    await request(adminApp).post(`/api/gusto/payroll-runs/${created.body.id}/reverse`).expect(200);
    expect(fetchMock.mock.calls[1][0]).toContain("/v1/payrolls/provider-actions/reverse");
  });
});

describe("Gusto signed webhook", () => {
  beforeAll(() => { process.env.GUSTO_WEBHOOK_SECRET = "route-webhook-secret"; });

  it("rejects an invalid signature without recording an event", async () => {
    const eventId = `gusto-invalid-${randomUUID()}`;
    const body = JSON.stringify({ id: eventId, type: "payroll.paid" });
    await request(adminApp).post("/api/gusto/webhook").set("Content-Type", "application/json")
      .set("x-gusto-signature", "sha256=bad").send(body).expect(401);
    expect(await db.query.gustoWebhookEvents.findFirst({ where: eq(gustoWebhookEvents.eventId, eventId) })).toBeUndefined();
  });

  it("accepts exact raw bytes and deduplicates redeliveries", async () => {
    const eventId = `gusto-valid-${randomUUID()}`;
    eventIds.push(eventId);
    const body = `{"type":"payroll.paid","data":{"status":"paid"},"id":"${eventId}"}`;
    await signedBody(body).expect(202);
    const duplicate = await signedBody(body).expect(200);
    expect(duplicate.body.duplicate).toBe(true);
    const rows = await db.select().from(gustoWebhookEvents).where(eq(gustoWebhookEvents.eventId, eventId));
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["paid", "paid"],
    ["processing-failed", "failed"],
    ["partially-reversed", "partially_reversed"],
  ])("maps %s provider status to %s", async (providerStatus, expectedStatus) => {
    const eventId = `gusto-status-${providerStatus}-${randomUUID()}`;
    const providerPayrollId = `provider-${randomUUID()}`;
    const employee = await setupEmployee();
    await db.insert(gustoEmployeeMappings).values({ employeeId: employee.id, gustoEmployeeId: `mapped-${employee.id}`, onboardingStatus: "complete", paymentMethodStatus: "complete" });
    mappingEmployeeIds.push(employee.id);
    eventIds.push(eventId);
    const created = await request(adminApp).post("/api/gusto/payroll-runs").send({
      periodStart: "2040-03-01",
      periodEnd: "2040-03-14",
      payDate: "2040-03-18",
      idempotencyKey: `gusto-webhook-${randomUUID()}`,
      items: [{ employeeId: employee.id, hours: 1, grossEarnings: 1 }],
    }).expect(201);
    runIds.push(created.body.id);
    await db.update(gustoPayrollRuns)
      .set({ gustoPayrollId: providerPayrollId })
      .where(eq(gustoPayrollRuns.id, created.body.id));
    const body = JSON.stringify({
      id: eventId,
      type: "payroll.updated",
      data: { payroll_id: providerPayrollId, status: providerStatus },
    });
    await signedBody(body).expect(202);
    const row = await db.query.gustoWebhookEvents.findFirst({ where: eq(gustoWebhookEvents.eventId, eventId) });
    const run = await db.query.gustoPayrollRuns.findFirst({ where: eq(gustoPayrollRuns.id, created.body.id) });
    expect(row?.eventType).toBe("payroll.updated");
    expect(run?.status).toBe(expectedStatus);
    expect(run?.lastProviderStatus).toBe(providerStatus);
  });
});