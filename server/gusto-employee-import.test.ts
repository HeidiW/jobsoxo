import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "./db";
import { gustoEmployeeMappings, gustoIntegrations } from "@shared/schema";
import { storage } from "./storage";
import { encrypt } from "./encryption";

vi.mock("./gusto-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gusto-client")>()),
  gustoRequest: vi.fn(),
}));
const { gustoRequest } = await import("./gusto-client");
const { importGustoEmployees, payFromGustoJob, syncCompanyAndImport } = await import("./gusto-employee-import");

const companyId = "company-import-1";
let gustoEmployees: any[];

function fakeGusto() {
  vi.mocked(gustoRequest).mockImplementation(async (path: string, options: any = {}) => {
    const method = options.method ?? "GET";
    if (method === "GET" && path.startsWith(`/v1/companies/${companyId}/employees`)) return gustoEmployees;
    if (method === "GET" && path === `/v1/companies/${companyId}/locations`) return [{ uuid: "loc-1", state: "NY", filing_address: true }];
    if (method === "GET" && path === `/v1/companies/${companyId}`) return { uuid: companyId, name: "Crystal Grove LLP" };
    if (method === "GET" && path === `/v1/companies/${companyId}/onboarding_status`) return { onboarding_completed: true, onboarding_steps: [] };
    if (method === "GET" && path === `/v1/companies/${companyId}/bank_accounts`) return [{ uuid: "bank-1", verification_status: "verified" }];
    if (method === "GET" && /^\/v1\/employees\/[\w-]+\/payment_method$/.test(path)) return { type: "Direct Deposit", splits: [{ uuid: "s1" }] };
    throw new Error(`Unexpected Gusto request: ${method} ${path}`);
  });
}

async function connect() {
  const user = await storage.createUser({ username: `import-${Math.random()}@example.com`, password: "x", isAdmin: true });
  await db.insert(gustoIntegrations).values({
    userId: user.id, companyId, environment: "demo", state: "connected",
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-token" })),
  });
  return user.id;
}

const byName = async (name: string) => (await storage.getEmployees()).find((e) => e.name === name);

describe("payFromGustoJob", () => {
  it("converts Gusto pay into a JobsOxo day rate", () => {
    expect(payFromGustoJob({ rate: "35.00", payment_unit: "Hour" })).toEqual({ dayRate: "280.00", payType: "hourly" });
    expect(payFromGustoJob({ rate: "1000", payment_unit: "Week" })).toEqual({ dayRate: "200.00", payType: "salary" });
    expect(payFromGustoJob({ rate: "5200", payment_unit: "Month" })).toEqual({ dayRate: "240.00", payType: "salary" });
    expect(payFromGustoJob({ rate: "65000", payment_unit: "Year" })).toEqual({ dayRate: "250.00", payType: "salary", annualSalary: "65000.00" });
  });

  it("returns null when Gusto doesn't share a usable rate", () => {
    expect(payFromGustoJob({ title: "Painter" })).toBeNull();
    expect(payFromGustoJob({ rate: "500", payment_unit: "Paycheck" })).toBeNull();
    expect(payFromGustoJob(undefined)).toBeNull();
  });
});

describe("importGustoEmployees", () => {
  beforeEach(() => {
    vi.mocked(gustoRequest).mockReset();
    fakeGusto();
    gustoEmployees = [
      { uuid: "g-new", first_name: "Rosa", last_name: "Diaz", email: "rosa@example.com", phone: "2125550111", terminated: false,
        onboarding_status: "onboarding_completed", jobs: [{ primary: true, title: "Painter", hire_date: "2026-10-05", rate: "30.00", payment_unit: "Hour" }] },
      { uuid: "g-no-email", first_name: "Sam", last_name: "Lee", preferred_first_name: "Sammy", terminated: false,
        onboarding_status: "admin_onboarding_incomplete", jobs: [{ title: "Plasterer" }] },
      { uuid: "g-existing", first_name: "Ann", last_name: "Existing", email: "ANN@example.com", terminated: false, jobs: [] },
      { uuid: "g-gone", first_name: "Old", last_name: "Hand", email: "old@example.com", terminated: true, jobs: [] },
    ];
  });

  it("creates JobsOxo employees for current Gusto employees and links them by Gusto ID", async () => {
    await storage.createEmployee({ name: "Ann Existing", email: "ann@example.com", dayRate: "200", status: "active" });

    const result = await importGustoEmployees(await connect());

    expect(result).toMatchObject({ imported: ["Rosa Diaz", "Sammy Lee"], needsRate: ["Sammy Lee"], alreadyInJobsOxo: 1 });
    const rosa = await byName("Rosa Diaz");
    expect(rosa).toMatchObject({ email: "rosa@example.com", phone: "2125550111", position: "Painter", dayRate: "240.00", payType: "hourly", employmentType: "w2", stateCode: "NY" });
    expect(rosa?.hireDate?.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    const sammy = await byName("Sammy Lee");
    expect(sammy).toMatchObject({ email: null, position: "Plasterer", dayRate: "0.00" });
    expect(await byName("Old Hand")).toBeUndefined();

    const mappings = await db.select().from(gustoEmployeeMappings);
    expect(mappings.find((m) => m.employeeId === rosa!.id)?.gustoEmployeeId).toBe("g-new");
    expect(mappings.find((m) => m.employeeId === sammy!.id)?.gustoEmployeeId).toBe("g-no-email");
  });

  it("doesn't import anyone twice", async () => {
    const userId = await connect();
    await importGustoEmployees(userId);

    const again = await importGustoEmployees(userId);

    expect(again.imported).toEqual([]);
    expect((await storage.getEmployees()).filter((e) => e.name === "Rosa Diaz")).toHaveLength(1);
  });

  it("Sync readiness refreshes company status and imports new Gusto employees", async () => {
    const result = await syncCompanyAndImport(await connect());

    expect(result).toMatchObject({ companyId, onboardingComplete: true, fundingAccount: { status: "verified" } });
    expect(result.imported.imported).toEqual(["Rosa Diaz", "Sammy Lee", "Ann Existing"]);
    expect(await byName("Rosa Diaz")).toBeDefined();
  });
});
