import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mock = vi.hoisted(() => ({
  integration: null as any, history: [] as any[], deleted: [] as string[],
  lock: vi.fn(), failDelete: false,
}));
vi.mock("./db", async () => {
  const { gustoIntegrations, gustoPayrollRuns, gustoEmployeeMappings } = await import("@shared/schema");
  const store = {
    execute: mock.lock,
    select: () => ({ from: (table: unknown) => ({ where: () => ({
      for: async () => mock.integration ? [mock.integration] : [],
      limit: async () => table === gustoPayrollRuns ? mock.history : [],
    }) }) }),
    delete: (table: unknown) => ({ where: async () => {
      if (table === gustoIntegrations && mock.failDelete) throw new Error("test database failure secret");
      mock.deleted.push(table === gustoEmployeeMappings ? "mappings" : "integration");
    } }),
    transaction: async (fn: any) => {
      const previous = [...mock.deleted];
      try { return await fn(store); }
      catch (error) { mock.deleted = previous; throw error; }
    },
  };
  return { db: store };
});
import { registerGustoRemovalRoutes } from "./gusto-remove-company";
const app = express();
app.use(express.json());
app.use((req, _res, next) => { (req as any).session = { userId: req.get("x-test-user") }; next(); });
registerGustoRemovalRoutes(app, (req, res, next) => {
  if (!req.session.userId) return void res.status(401).end();
  if (req.session.userId !== "admin") return void res.status(403).end();
  next();
});
const input = { companyId: "demo-company", confirmRemove: true };
const remove = (body: unknown = input) => request(app).delete("/api/gusto/company").set("x-test-user", "admin").send(body);
let provider: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("GUSTO_ENV", "demo");
  mock.integration = { id: "integration", userId: "admin", companyId: "demo-company", environment: "demo", state: "connected" };
  mock.history = []; mock.deleted = []; mock.failDelete = false; mock.lock.mockClear();
  provider = vi.fn(() => { throw new Error("Removal must never call Gusto"); });
  vi.stubGlobal("fetch", provider);
});
afterEach(() => { expect(provider).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("remove demo company locally", () => {
  it("removes only mappings and the saved connection, never contacting Gusto", async () => {
    const result = await remove();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ removed: true, companyId: "demo-company", environment: "demo", removedFrom: "jobsoxo_only" });
    expect(mock.lock).toHaveBeenCalledOnce();
    expect(mock.deleted).toEqual(["mappings", "integration"]);
  });
  it("requires an authenticated admin", async () => {
    expect((await request(app).delete("/api/gusto/company").send(input)).status).toBe(401);
    expect((await request(app).delete("/api/gusto/company").set("x-test-user", "member").send(input)).status).toBe(403);
    expect(mock.deleted).toEqual([]);
  });
  it.each([{ companyId: "demo-company" }, { ...input, confirmRemove: false }, { ...input, environment: "demo" }])(
    "requires exact explicit confirmation", async body => {
      expect((await remove(body)).status).toBe(400);
      expect(mock.deleted).toEqual([]);
    },
  );
  it("does not remove another admin's connection", async () => {
    mock.integration.userId = "other-admin";
    expect((await remove()).status).toBe(404);
    expect(mock.deleted).toEqual([]);
  });
  it("rejects stale confirmation and an already removed connection", async () => {
    mock.integration.companyId = "different-company";
    expect((await remove()).status).toBe(409);
    mock.integration = null;
    expect((await remove()).status).toBe(404);
    expect(mock.deleted).toEqual([]);
  });
  it("rejects production mode and production records", async () => {
    vi.stubEnv("GUSTO_ENV", "production");
    expect((await remove()).status).toBe(409);
    vi.stubEnv("GUSTO_ENV", "demo");
    mock.integration.environment = "production";
    expect((await remove()).status).toBe(409);
    expect(mock.deleted).toEqual([]);
  });
  it.each(["draft", "submitted", "paid", "cancelled", "failed"])("preserves all payroll history (%s)", async status => {
    mock.history = [{ id: "existing-run", status }];
    expect((await remove()).status).toBe(409);
    expect(mock.deleted).toEqual([]);
  });
  it.each(["demo_creating", "demo_creation_unknown"])("does not clear unresolved setup (%s)", async state => {
    mock.integration.state = state;
    expect((await remove()).status).toBe(409);
    expect(mock.deleted).toEqual([]);
  });
  it("rolls back mapping removal if connection deletion fails and redacts the error", async () => {
    mock.failDelete = true;
    const result = await remove();
    expect(result.status).toBe(500);
    expect(result.text).not.toContain("secret");
    expect(mock.deleted).toEqual([]);
  });
});
