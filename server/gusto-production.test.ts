import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const fake = vi.hoisted(() => ({ rows: [] as any[], employees: [] as any[], mappings: [] as any[], queue: Promise.resolve() as Promise<unknown> }));
vi.mock("./db", async () => {
  const schema = await import("@shared/schema");
  const rowsFor = (table: unknown) => table === schema.employees ? fake.employees : table === schema.gustoEmployeeMappings ? fake.mappings : fake.rows;
  const store = {
    execute: vi.fn(),
    select: () => ({ from: (table: unknown) => Object.assign(Promise.resolve(rowsFor(table)), { where: async () => rowsFor(table) }) }),
    insert: () => ({ values: (value: any) => ({
      onConflictDoUpdate: async ({ set }: any) => {
        const row = fake.rows.find((row) => row.userId === value.userId);
        if (row) Object.assign(row, set); else fake.rows.push({ ...value });
      },
    }) }),
    update: () => ({ set: (value: any) => ({ where: async () => { Object.assign(fake.rows[0], value); } }) }),
    transaction: async (fn: any) => { const task = fake.queue.then(() => fn(store)); fake.queue = task.catch(() => {}); return task; },
  };
  return { db: store };
});
vi.mock("./encryption", () => ({
  encrypt: (value: string) => `test-encrypted:${Buffer.from(value).toString("base64")}`,
  decrypt: (value: string) => Buffer.from(value.slice(15), "base64").toString(),
}));

import { createProductionCompany, productionReadiness, registerGustoProductionRoutes } from "./gusto-production";

const input = { legalName: "Conor Foy Painting LLC", confirmLegalName: "Conor Foy Painting LLC", firstName: "Conor", lastName: "Foy", email: "conor@example.test", confirmProduction: true };
const companyId = "123e4567-e89b-12d3-a456-426614174000";
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let fetchMock: ReturnType<typeof vi.fn>;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).session = { userId: req.get("x-test-user") }; next(); });
registerGustoProductionRoutes(app, (req, res, next) => {
  if (!req.session?.userId) return void res.status(401).end();
  if (req.session.userId !== "admin") return void res.status(403).end();
  next();
});
const post = (value: unknown = input) => request(app).post("/api/gusto/production/company").set("x-test-user", "admin").send(value);
const readiness = () => request(app).get("/api/gusto/production/readiness").set("x-test-user", "admin");

beforeEach(() => {
  fake.rows = []; fake.employees = []; fake.mappings = []; fake.queue = Promise.resolve();
  vi.stubEnv("GUSTO_ENV", "production");
  vi.stubEnv("GUSTO_API_BASE_URL", "https://api.gusto.com");
  vi.stubEnv("GUSTO_CLIENT_ID", "prod-client-id");
  vi.stubEnv("GUSTO_CLIENT_SECRET", "prod-client-secret");
  vi.stubEnv("GUSTO_LIVE_COMPANY_CREATION_ENABLED", "true");
  vi.stubEnv("GUSTO_LIVE_PAYROLL_ENABLED", "false");
  vi.stubEnv("GUSTO_WEBHOOK_SECRET", "");
  vi.stubEnv("GUSTO_ACCESS_TOKEN", "");
  vi.stubEnv("GUSTO_COMPANY_ID", "");
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/oauth/token")) return response({ access_token: "system-live-token" });
    if (url.endsWith("/v1/partner_managed_companies")) return response({ company_uuid: companyId, access_token: "company-live-token", refresh_token: "refresh-live-token", expires_in: 7200 });
    throw new Error("Unexpected provider request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("creating the real Gusto company", () => {
  it("creates it once with the production host, reserving first and never returning tokens", async () => {
    const result = await post().expect(201);
    expect(result.body).toEqual({ companyId, environment: "production", state: "connected" });
    expect(JSON.stringify(result.body)).not.toContain("live-token");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["https://api.gusto.com/oauth/token", "https://api.gusto.com/v1/partner_managed_companies"]);
    expect(fake.rows[0]).toMatchObject({ environment: "production", state: "connected", companyId });
    expect(fake.rows[0].encryptedAccessToken).toContain("test-encrypted:");
    // A second attempt must not create another company.
    await post().expect(409);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/partner_managed_companies"))).toHaveLength(1);
  });

  it("is switched off by default, and off outside production, even with the switch on", async () => {
    vi.stubEnv("GUSTO_LIVE_COMPANY_CREATION_ENABLED", "false");
    const off = await post().expect(503);
    expect(off.body.error).toContain("switched off");
    vi.stubEnv("GUSTO_LIVE_COMPANY_CREATION_ENABLED", "true");
    vi.stubEnv("GUSTO_ENV", "demo");
    vi.stubEnv("GUSTO_API_BASE_URL", "https://api.gusto-demo.com");
    const demo = await post().expect(503);
    expect(demo.body.error).toContain("GUSTO_ENV=production");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.rows).toEqual([]);
  });

  it("insists the legal name is typed the same way twice and the confirmation is ticked", async () => {
    const mismatch = await post({ ...input, confirmLegalName: "Conor Foy Painting" }).expect(400);
    expect(mismatch.body.error).toContain("not typed the same way twice");
    await post({ ...input, confirmProduction: false }).expect(400);
    await post({ ...input, email: "not-an-email" }).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses while the demo company is still attached, and while a creation is unresolved", async () => {
    fake.rows = [{ userId: "admin", environment: "demo", state: "connected", companyId: "demo-company", encryptedAccessToken: "x" }];
    expect((await post().expect(409)).body.error).toContain("Remove the demo company first");
    fake.rows = [{ userId: "other", environment: "production", state: "company_creation_unknown" }];
    expect((await post().expect(409)).body.error).toContain("may already have reached Gusto");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks an ambiguous creation instead of retrying, and lets a rejection be corrected", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/oauth/token")) return response({ access_token: "system-live-token" });
      throw new Error("socket hang up");
    });
    await post().expect(409);
    expect(fake.rows[0].state).toBe("company_creation_unknown");
    await post().expect(409);

    fake.rows = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/oauth/token")) return response({ access_token: "system-live-token" });
      return response({ errors: [{ error_key: "company", category: "invalid_attribute_value", message: "secret detail" }] }, 422);
    });
    const rejected = await post().expect(502);
    expect(rejected.body.error).not.toContain("secret detail");
    expect(fake.rows[0].state).toBe("company_creation_failed");
    // Corrected details can be tried again.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/oauth/token")) return response({ access_token: "system-live-token" });
      return response({ company_uuid: companyId, access_token: "company-live-token", refresh_token: "refresh-live-token", expires_in: 7200 });
    });
    await post().expect(201);
  });

  it("requires an admin", async () => {
    await request(app).post("/api/gusto/production/company").send(input).expect(401);
    await request(app).post("/api/gusto/production/company").set("x-test-user", "member").send(input).expect(403);
  });
});

describe("production readiness", () => {
  it("names the next step from the gates, in order", async () => {
    vi.stubEnv("GUSTO_ENV", "demo");
    expect((await readiness().expect(200)).body.nextStep).toContain("Set GUSTO_ENV=production");

    vi.stubEnv("GUSTO_ENV", "production");
    vi.stubEnv("GUSTO_CLIENT_ID", "");
    expect((await readiness().expect(200)).body.nextStep).toContain("production client ID and secret");

    vi.stubEnv("GUSTO_CLIENT_ID", "prod-client-id");
    fake.rows = [{ userId: "admin", environment: "demo", state: "connected", companyId: "demo-company", encryptedAccessToken: null }];
    expect((await readiness().expect(200)).body.nextStep).toContain("demo company is still attached");

    fake.rows = [];
    vi.stubEnv("GUSTO_LIVE_COMPANY_CREATION_ENABLED", "false");
    expect((await readiness().expect(200)).body.nextStep).toContain("GUSTO_LIVE_COMPANY_CREATION_ENABLED=true");
    vi.stubEnv("GUSTO_LIVE_COMPANY_CREATION_ENABLED", "true");
    expect((await readiness().expect(200)).body.nextStep).toContain("Create the real company below");

    fake.rows = [{ userId: "admin", environment: "production", state: "connected", companyId, encryptedAccessToken: "x" }];
    let body = (await readiness().expect(200)).body;
    expect(body.company).toMatchObject({ attached: true, companyId, environment: "production" });
    expect(body.nextStep).toContain("Register the webhook");

    vi.stubEnv("GUSTO_WEBHOOK_SECRET", "token");
    body = (await readiness().expect(200)).body;
    expect(body.nextStep).toContain("Live payroll stays off");
    expect(body.gates).toMatchObject({ productionEnvironment: true, applicationCredentials: true, companyCreationEnabled: true, webhookSecret: true, livePayrollEnabled: false });

    vi.stubEnv("GUSTO_LIVE_PAYROLL_ENABLED", "true");
    expect((await readiness().expect(200)).body.nextStep).toContain("Live payroll is enabled");
  });

  it("counts active employees and how many are linked", async () => {
    fake.rows = [{ userId: "admin", environment: "production", state: "connected", companyId, encryptedAccessToken: "x" }];
    fake.employees = [{ id: "e1" }, { id: "e2" }];
    fake.mappings = [{ id: "m1" }];
    const body = (await readiness().expect(200)).body;
    expect(body.employees).toEqual({ active: 2, linked: 1 });
    expect(await productionReadiness("admin")).toMatchObject({ environment: "production" });
    await expect(createProductionCompany("admin", { ...input, confirmProduction: true })).rejects.toThrow();
  });
});
