import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "./db";
import { gustoEmployeeMappings, gustoIntegrations } from "@shared/schema";
import { storage } from "./storage";
import { encrypt } from "./encryption";

vi.mock("./gusto-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gusto-client")>()),
  gustoRequest: vi.fn(),
}));
const { gustoRequest, GustoProviderError } = await import("./gusto-client");
const { fillDemoCompany, samplePaySchedule, setUpSampleEmployees } = await import("./gusto-demo-sample");

const companyId = "company-sample-1";
const base = `/v1/companies/${companyId}`;
type FakeEmployee = { uuid: string; email: string; onboarding_status: string; payment: "Check" | "Direct Deposit" };
let state: {
  completed: string[]; locations: any[]; bankAccounts: any[]; schedules: any[]; employees: FakeEmployee[]; signatories: any[];
  failIndustry: boolean; failOnboarding: boolean;
};

/** A stateful fake Gusto, matched by URL and method. */
function fakeGusto() {
  vi.mocked(gustoRequest).mockImplementation(async (path: string, options: any = {}) => {
    const method = options.method ?? "GET";
    const route = `${method} ${path.replace(/\?.*$/, "")}`;
    switch (route) {
      case `GET ${base}`: return { uuid: companyId, name: "Crystal Grove LLP" };
      case `GET ${base}/onboarding_status`:
        return { onboarding_completed: false, onboarding_steps: ["add_addresses", "federal_tax_setup", "select_industry", "add_bank_info", "add_employees", "state_setup", "payroll_schedule", "sign_all_forms", "verify_bank_info"].map(id => ({ id, title: id, required: true, completed: state.completed.includes(id) })) };
      case `GET ${base}/locations`: return state.locations;
      case `POST ${base}/locations`: state.locations.push({ uuid: "loc-1" }); return { uuid: "loc-1" };
      case `GET ${base}/federal_tax_details`: return { version: "fed-v1" };
      case `PUT ${base}/federal_tax_details`: return {};
      case `PUT ${base}/industry_selection`:
        if (state.failIndustry) throw new GustoProviderError("rejected", 422, "invalid_attribute_value", "naics_code");
        return {};
      case `GET ${base}/bank_accounts`: return state.bankAccounts;
      case `POST ${base}/bank_accounts`: state.bankAccounts.push({ uuid: "bank-1", verification_status: "awaiting_deposits" }); return state.bankAccounts[0];
      case `POST ${base}/bank_accounts/bank-1/send_test_deposits`: return { deposit_1: 0.02, deposit_2: 0.42 };
      case `PUT ${base}/bank_accounts/bank-1/verify`: state.bankAccounts[0].verification_status = "verified"; return state.bankAccounts[0];
      case `GET ${base}/pay_schedules`: return state.schedules;
      case `POST ${base}/pay_schedules`: return {};
      case `GET ${base}/employees`: return state.employees;
      case `POST ${base}/employees`: {
        const employee: FakeEmployee = { uuid: `emp-${state.employees.length + 1}`, email: options.body.email, onboarding_status: "admin_onboarding_incomplete", payment: "Check" };
        state.employees.push(employee);
        return employee;
      }
      case `GET ${base}/signatories`: return state.signatories;
      case `POST ${base}/signatories`: return {};
    }
    const employeeRoute = /^(GET|POST|PUT) \/v1\/employees\/(emp-\d+)\/(\w+)$/.exec(route);
    if (employeeRoute) {
      const [, verb, uuid, resource] = employeeRoute;
      const employee = state.employees.find(e => e.uuid === uuid)!;
      if (resource === "home_addresses" || resource === "work_addresses") return {};
      if (resource === "jobs") return { current_compensation_uuid: "comp-1", compensations: [{ uuid: "comp-1", version: "comp-v1" }] };
      if (resource === "payment_method" && verb === "GET") {
        return employee.payment === "Direct Deposit" ? { type: "Direct Deposit", splits: [{ uuid: "split-1" }] } : { type: "Check", splits: null, version: "pm-v1" };
      }
      if (resource === "bank_accounts" && verb === "POST") { employee.payment = "Direct Deposit"; return {}; }
      if (resource === "state_taxes" && verb === "GET") return [{ state: "NY", questions: [{ key: "withholding_allowance", answers: [] }] }];
      if (resource === "state_taxes" && verb === "PUT") return {};
      if (resource === "onboarding_status" && verb === "PUT") {
        if (state.failOnboarding) throw new GustoProviderError("rejected", 422, "invalid_operation", "onboarding_status");
        employee.onboarding_status = "onboarding_completed";
        return {};
      }
    }
    if (route === "PUT /v1/compensations/comp-1") return {};
    throw new Error(`Unexpected Gusto request: ${route}`);
  });
}

const calls = (method: string, path: string | RegExp) => vi.mocked(gustoRequest).mock.calls.filter(([p, o]: any[]) =>
  (o?.method ?? "GET") === method && (typeof path === "string" ? p === path : path.test(p)));
const bodyOf = (method: string, path: string | RegExp) => calls(method, path)[0]?.[1]?.body;
const sampleLocals = async () => (await storage.getEmployees()).filter(e => ["sonofanorphan@example.com", "maria.lopez@example.com"].includes(e.email ?? ""));

async function connect(environment = "demo") {
  const user = await storage.createUser({ username: `sample-${Math.random()}@example.com`, password: "x", isAdmin: true });
  await db.insert(gustoIntegrations).values({
    userId: user.id, companyId, environment, state: "connected",
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-token" })),
  });
  return user.id;
}

beforeEach(() => {
  vi.stubEnv("GUSTO_ENV", "demo");
  state = { completed: [], locations: [], bankAccounts: [], schedules: [], employees: [], signatories: [], failIndustry: false, failOnboarding: false };
  vi.mocked(gustoRequest).mockReset();
  fakeGusto();
});
afterEach(() => vi.unstubAllEnvs());

describe("samplePaySchedule", () => {
  it("pays on the first Friday at least a week away, ending the period the Sunday before", () => {
    expect(samplePaySchedule("2026-11-08")).toEqual({ anchor_pay_date: "2026-11-20", anchor_end_of_pay_period: "2026-11-15" });
    expect(samplePaySchedule("2026-11-13")).toEqual({ anchor_pay_date: "2026-11-20", anchor_end_of_pay_period: "2026-11-15" });
  });
});

describe("fillDemoCompany", () => {
  it("enters Gusto's demo test values for every automatable step", async () => {
    const { results, status } = await fillDemoCompany(await connect());

    expect(bodyOf("POST", `${base}/locations`)).toMatchObject({ street_1: "123 Test Street", state: "NY", mailing_address: true, filing_address: true });
    expect(bodyOf("PUT", `${base}/federal_tax_details`)).toEqual({
      version: "fed-v1", legal_name: "Crystal Grove LLP", ein: "910532465", tax_payer_type: "LLP", filing_form: "941", taxable_as_scorp: false,
    });
    expect(bodyOf("PUT", `${base}/industry_selection`)).toMatchObject({ naics_code: "238320" });
    expect(bodyOf("POST", `${base}/bank_accounts`)).toMatchObject({ routing_number: "102001017", account_type: "Checking" });
    expect(bodyOf("POST", `${base}/pay_schedules`)).toMatchObject({ frequency: "Every week" });
    expect(calls("POST", `${base}/employees`).map(([, o]: any[]) => o.body.email)).toEqual(["sonofanorphan@example.com", "maria.lopez@example.com"]);
    expect(bodyOf("POST", /\/work_addresses$/)).toMatchObject({ location_uuid: "loc-1" });
    expect(bodyOf("PUT", "/v1/compensations/comp-1")).toMatchObject({ version: "comp-v1", rate: "35.00", payment_unit: "Hour" });
    expect(bodyOf("POST", /\/v1\/employees\/emp-\d+\/bank_accounts$/)).toMatchObject({ routing_number: "102001017", account_type: "Checking" });
    expect(calls("PUT", /\/onboarding_status$/)).toHaveLength(2);
    expect(bodyOf("POST", `${base}/signatories`)).toMatchObject({ first_name: "Pat", title: "Owner" });
    expect(calls("PUT", `${base}/bank_accounts/bank-1/verify`)).toHaveLength(1);

    expect(results.filter(r => r.status === "done").map(r => r.step)).toEqual([
      "Company address", "Federal tax information", "Industry", "Bank account", "Pay schedule", "Employees", "JobsOxo employees", "Signatory", "Verify bank account",
    ]);
    expect(results.filter(r => r.status === "manual").map(r => r.step)).toEqual(["State tax information", "Sign documents"]);
    expect(status.fundingAccount?.status).toBe("verified");
    expect(await sampleLocals()).toHaveLength(2);
  });

  it("never signs company forms", async () => {
    await fillDemoCompany(await connect());
    expect(vi.mocked(gustoRequest).mock.calls.some(([path]: any[]) => /forms/.test(path))).toBe(false);
  });

  it("skips steps Gusto already reports complete", async () => {
    state.completed = ["add_addresses", "federal_tax_setup", "select_industry", "payroll_schedule"];
    state.locations = [{ uuid: "loc-existing" }];

    const { results } = await fillDemoCompany(await connect());

    expect(calls("POST", `${base}/locations`)).toHaveLength(0);
    expect(calls("PUT", `${base}/federal_tax_details`)).toHaveLength(0);
    expect(calls("POST", `${base}/pay_schedules`)).toHaveLength(0);
    expect(bodyOf("POST", /\/work_addresses$/)).toMatchObject({ location_uuid: "loc-existing" });
    expect(results.find(r => r.step === "Industry")).toMatchObject({ status: "skipped" });
  });

  it("reports a failed step with Gusto's reason and carries on", async () => {
    state.failIndustry = true;
    const { results } = await fillDemoCompany(await connect());

    expect(results.find(r => r.step === "Industry")).toEqual({ step: "Industry", status: "failed", detail: "Gusto 422 invalid_attribute_value (naics_code)" });
    expect(results.find(r => r.step === "Pay schedule")).toMatchObject({ status: "done" });
  });

  it("refuses production companies without calling Gusto", async () => {
    vi.stubEnv("GUSTO_ENV", "production");
    const userId = await connect("production");

    await expect(fillDemoCompany(userId)).rejects.toMatchObject({ status: 409, code: "demo_only" });
    expect(gustoRequest).not.toHaveBeenCalled();
  });
});

describe("setUpSampleEmployees", () => {
  it("switches existing Gusto samples to direct deposit, finishes onboarding, and adds and links JobsOxo employees", async () => {
    state.locations = [{ uuid: "loc-1" }];
    state.employees = [
      { uuid: "emp-1", email: "sonofanorphan@example.com", onboarding_status: "admin_onboarding_incomplete", payment: "Check" },
      { uuid: "emp-2", email: "maria.lopez@example.com", onboarding_status: "admin_onboarding_incomplete", payment: "Check" },
    ];

    const { results } = await setUpSampleEmployees(await connect());

    expect(calls("POST", `${base}/employees`)).toHaveLength(0);
    expect(calls("POST", /\/bank_accounts$/).map(([path]: any[]) => path)).toEqual(["/v1/employees/emp-1/bank_accounts", "/v1/employees/emp-2/bank_accounts"]);
    expect(results).toEqual([
      { step: "Gusto employees", status: "done", detail: "Sample employees already on file; direct deposit set" },
      { step: "JobsOxo employees", status: "done", detail: "Added 2" },
      { step: "Link and check readiness", status: "done", detail: "2 of 2 ready for payroll" },
    ]);
    const locals = await sampleLocals();
    expect(locals.map(e => e.employmentType)).toEqual(["w2", "w2"]);
    const mappings = await db.select().from(gustoEmployeeMappings);
    expect(mappings.filter(m => locals.some(e => e.id === m.employeeId)).map(m => m.gustoEmployeeId).sort()).toEqual(["emp-1", "emp-2"]);
  });

  it("doesn't duplicate JobsOxo employees that already exist", async () => {
    state.locations = [{ uuid: "loc-1" }];
    await storage.createEmployee({ name: "Alexander Hamilton", email: "sonofanorphan@example.com", dayRate: "280", status: "active" });

    const { results } = await setUpSampleEmployees(await connect());

    expect(results.find(r => r.step === "JobsOxo employees")).toMatchObject({ detail: "Added 1" });
    expect(await sampleLocals()).toHaveLength(2);
  });

  it("explains when Gusto won't finish an employee's onboarding", async () => {
    state.locations = [{ uuid: "loc-1" }];
    state.failOnboarding = true;

    const { results } = await setUpSampleEmployees(await connect());

    expect(results[0].status).toBe("failed");
    expect(results[0].detail).toContain("Alexander Hamilton: onboarding not finished (Gusto 422 invalid_operation (onboarding_status)); finish it in Gusto with Manage employees");
    expect(results.find(r => r.step === "Link and check readiness")).toMatchObject({ status: "failed", detail: "0 of 2 ready for payroll" });
  });

  it("refuses production companies without calling Gusto", async () => {
    vi.stubEnv("GUSTO_ENV", "production");
    const userId = await connect("production");

    await expect(setUpSampleEmployees(userId)).rejects.toMatchObject({ status: 409, code: "demo_only" });
    expect(gustoRequest).not.toHaveBeenCalled();
  });
});
