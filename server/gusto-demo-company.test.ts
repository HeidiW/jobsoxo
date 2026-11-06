import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const fake = vi.hoisted(() => ({
  rows: [] as any[],
  queue: Promise.resolve() as Promise<unknown>,
}));
vi.mock("./db", () => {
  const store = {
    execute: vi.fn(),
    select: () => ({ from: async () => fake.rows }),
    insert: () => ({ values: (value: any) => ({
      onConflictDoUpdate: async ({ set }: any) => {
        const row = fake.rows.find(row => row.userId === value.userId);
        if (row) Object.assign(row, set);
        else fake.rows.push({ ...value });
      },
    }) }),
    update: () => ({ set: (value: any) => ({ where: async () => {
      Object.assign(fake.rows[0], value);
    } }) }),
    transaction: async (fn: any) => {
      const task = fake.queue.then(() => fn(store));
      fake.queue = task.catch(() => {});
      return task;
    },
  };
  return { db: store };
});
vi.mock("./encryption", () => ({
  encrypt: (value: string) => `test-encrypted:${Buffer.from(value).toString("base64")}`,
  decrypt: (value: string) => Buffer.from(value.slice(15), "base64").toString(),
}));

import { createDemoCompany, demoCompanySetup, registerGustoDemoRoutes } from "./gusto-demo-company";
const input = { companyName: "Demo Plaster", firstName: "Test", lastName: "Admin", email: "admin@example.test", confirmDemo: true };
const companyId = "123e4567-e89b-12d3-a456-426614174000";
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let fetchMock: ReturnType<typeof vi.fn>;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).session = { userId: req.get("x-test-user") };
  next();
});
registerGustoDemoRoutes(app, (req, res, next) => {
  if (!req.session?.userId) return void res.status(401).end();
  if (req.session.userId !== "admin") return void res.status(403).end();
  next();
});
const post = (value: unknown = input) => request(app).post("/api/gusto/demo-company").set("x-test-user", "admin").send(value);

beforeEach(() => {
  fake.rows = []; fake.queue = Promise.resolve();
  vi.stubEnv("GUSTO_ENV", "demo");
  vi.stubEnv("GUSTO_API_BASE_URL", "https://api.gusto-demo.com");
  vi.stubEnv("GUSTO_CLIENT_ID", "test-client-id");
  vi.stubEnv("GUSTO_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("GUSTO_ACCESS_TOKEN", "");
  vi.stubEnv("GUSTO_COMPANY_ID", "");
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/oauth/token")) return response({ access_token: "system-test-token" });
    if (url.endsWith("/v1/partner_managed_companies")) return response({
      company_uuid: companyId, access_token: "company-test-token", refresh_token: "refresh-test-token", expires_in: 7200,
    });
    throw new Error("Unexpected provider request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Gusto Embedded demo setup", () => {
  it("exchanges application credentials and persists encrypted company tokens, never returning them", async () => {
    const result = await post();
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ companyId, environment: "demo", state: "connected" });
    expect(result.text).not.toMatch(/token|secret/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      grant_type: "system_access", client_id: "test-client-id", client_secret: "test-client-secret",
    });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer system-test-token");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      user: { first_name: "Test", last_name: "Admin", email: "admin@example.test" },
      company: { name: "Demo Plaster" },
    });
    expect(fake.rows[0].encryptedAccessToken).not.toContain("company-test-token");
    expect(fake.rows[0].state).toBe("connected");
    expect((await demoCompanySetup("admin")).canCreateDemoCompany).toBe(false);
  });

  it("requires admin authentication", async () => {
    expect((await request(app).post("/api/gusto/demo-company").send(input)).status).toBe(401);
    expect((await request(app).post("/api/gusto/demo-company").set("x-test-user", "member").send(input)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([{ ...input, confirmDemo: false }, { ...input, email: "invalid" }, { ...input, companyName: " " }, { ...input, accessToken: "injected" }])(
    "rejects invalid setup input before contacting Gusto", async value => {
      expect((await post(value)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("blocks production and missing application credentials", async () => {
    vi.stubEnv("GUSTO_ENV", "production");
    expect((await post()).status).toBe(503);
    expect((await demoCompanySetup("admin")).canCreateDemoCompany).toBe(false);
    vi.stubEnv("GUSTO_ENV", "demo");
    vi.stubEnv("GUSTO_CLIENT_SECRET", "");
    expect((await post()).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never overwrites another administrator's existing company", async () => {
    fake.rows.push({ userId: "another-admin", companyId: "existing", environment: "demo", state: "connected" });
    expect((await post()).status).toBe(409);
    expect((await demoCompanySetup("admin")).canCreateDemoCompany).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks bootstrap credentials to avoid provisioning a duplicate", async () => {
    vi.stubEnv("GUSTO_ACCESS_TOKEN", "bootstrap-test");
    vi.stubEnv("GUSTO_COMPANY_ID", "existing");
    expect((await post()).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serializes simultaneous setup requests and creates only once", async () => {
    const results = await Promise.allSettled([createDemoCompany("admin", input), createDemoCompany("admin", input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous creation locked across retries", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/oauth/token")) return response({ access_token: "system-test-token" });
      throw new DOMException("timeout", "AbortError");
    });
    expect((await post()).body.code).toBe("creation_unknown");
    expect(fake.rows[0].state).toBe("demo_creation_unknown");
    expect((await post()).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await demoCompanySetup("admin")).canCreateDemoCompany).toBe(false);
  });

  it("allows correction after a rejected credential without leaking provider details", async () => {
    fetchMock.mockResolvedValue(response({ error: "invalid_client", secret: "never-return" }, 401));
    const result = await post();
    expect(result.body.code).toBe("creation_rejected");
    expect(result.text).not.toContain("never-return");
    expect(fake.rows[0].state).toBe("demo_creation_failed");
    expect((await demoCompanySetup("admin")).canCreateDemoCompany).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("locks a malformed successful company response instead of retrying", async () => {
    fetchMock.mockImplementation(async (url: string) => response(
      url.endsWith("/oauth/token") ? { access_token: "system-test-token" } : { company_uuid: companyId },
    ));
    expect((await post()).body.code).toBe("creation_unknown");
    expect(fake.rows[0].encryptedAccessToken).toBeUndefined();
    expect((await post()).status).toBe(409);
  });
});
