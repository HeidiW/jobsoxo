import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "./db";
import { gustoIntegrations } from "@shared/schema";
import { storage } from "./storage";
import { encrypt } from "./encryption";

vi.mock("./gusto-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gusto-client")>()),
  gustoRequest: vi.fn(),
}));
const { gustoRequest } = await import("./gusto-client");
const { approveDemoCompany, syncCompany, upcomingPayrolls } = await import("./gusto-company");

const companyId = "company-approve-1";
const base = `/v1/companies/${companyId}`;
let company: { company_status: string; onboarding_completed: boolean };
let payrolls: any[];

function fakeGusto() {
  vi.mocked(gustoRequest).mockImplementation(async (path: string, options: any = {}) => {
    const method = options.method ?? "GET";
    const route = `${method} ${path.replace(/\?.*$/, "")}`;
    switch (route) {
      case `GET ${base}`: return { uuid: companyId, name: "Crystal Grove LLP", company_status: company.company_status };
      case `GET ${base}/onboarding_status`: return { onboarding_completed: company.onboarding_completed, onboarding_steps: [] };
      case `GET ${base}/bank_accounts`: return [{ uuid: "bank-1", verification_status: "verified" }];
      case `PUT ${base}/finish_onboarding`: company.onboarding_completed = true; return {};
      case `PUT ${base}/approve`: company.company_status = "Approved"; return { uuid: companyId, company_status: "Approved" };
      case `GET ${base}/payrolls`: return payrolls;
    }
    throw new Error(`Unexpected Gusto request: ${route}`);
  });
}

async function connect(environment = "demo") {
  const user = await storage.createUser({ username: `approve-${Math.random()}@example.com`, password: "x", isAdmin: true });
  await db.insert(gustoIntegrations).values({
    userId: user.id, companyId, environment, state: "connected",
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-token" })),
  });
  return user.id;
}

const puts = () => vi.mocked(gustoRequest).mock.calls.filter(([, o]: any[]) => o?.method === "PUT").map(([p]: any[]) => p.replace(base, ""));

beforeEach(() => {
  vi.stubEnv("GUSTO_ENV", "demo");
  company = { company_status: "Not Approved", onboarding_completed: true };
  payrolls = [];
  vi.mocked(gustoRequest).mockReset();
  fakeGusto();
});
afterEach(() => vi.unstubAllEnvs());

describe("company approval", () => {
  it("reports an unapproved company as a blocker in status", async () => {
    const status = await syncCompany(await connect());
    expect(status.companyStatus).toBe("Not Approved");
    expect(status.blockers).toEqual([expect.stringContaining('Gusto company status is "Not Approved"')]);
  });

  it("approves a demo company whose onboarding is finished", async () => {
    const status = await approveDemoCompany(await connect());

    expect(puts()).toEqual(["/approve"]);
    expect(status.companyStatus).toBe("Approved");
    expect(status.blockers).toEqual([]);
  });

  it("finishes onboarding first when Gusto still reports it open", async () => {
    company.onboarding_completed = false;

    await approveDemoCompany(await connect());

    expect(puts()).toEqual(["/finish_onboarding", "/approve"]);
  });

  it("refuses for production companies without calling Gusto", async () => {
    vi.stubEnv("GUSTO_ENV", "production");
    const userId = await connect("production");

    await expect(approveDemoCompany(userId)).rejects.toMatchObject({ status: 409, code: "demo_only" });
    expect(gustoRequest).not.toHaveBeenCalled();
  });
});

describe("upcomingPayrolls", () => {
  it("lists Gusto's unprocessed regular payrolls by check date", async () => {
    payrolls = [
      { payroll_uuid: "p2", pay_period: { start_date: "2026-11-16", end_date: "2026-11-22" }, check_date: "2026-11-27", off_cycle: false, processed: false },
      { payroll_uuid: "p1", pay_period: { start_date: "2026-11-09", end_date: "2026-11-15" }, check_date: "2026-11-20", off_cycle: false, processed: false },
      { payroll_uuid: "bonus", pay_period: { start_date: "2026-11-09", end_date: "2026-11-15" }, check_date: "2026-11-18", off_cycle: true, processed: false },
    ];

    const result = await upcomingPayrolls(await connect());

    expect(result).toEqual([
      { payrollId: "p1", periodStart: "2026-11-09", periodEnd: "2026-11-15", payDate: "2026-11-20" },
      { payrollId: "p2", periodStart: "2026-11-16", periodEnd: "2026-11-22", payDate: "2026-11-27" },
    ]);
    const [path] = vi.mocked(gustoRequest).mock.calls.find(([p]: any[]) => p.includes("/payrolls"))!;
    expect(path).toContain("processing_statuses=unprocessed");
    expect(path).toContain("payroll_types=regular");
  });

  it("returns an empty list when Gusto has generated none yet", async () => {
    expect(await upcomingPayrolls(await connect())).toEqual([]);
  });
});
