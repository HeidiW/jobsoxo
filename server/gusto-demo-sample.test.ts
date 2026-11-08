import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "./db";
import { gustoIntegrations } from "@shared/schema";
import { storage } from "./storage";
import { encrypt } from "./encryption";

vi.mock("./gusto-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gusto-client")>()),
  gustoRequest: vi.fn(),
}));
const { gustoRequest, GustoProviderError } = await import("./gusto-client");
const { fillDemoCompany, samplePaySchedule } = await import("./gusto-demo-sample");

const companyId = "company-sample-1";
const base = `/v1/companies/${companyId}`;
let state: {
  completed: string[]; locations: any[]; bankAccounts: any[]; schedules: any[]; employees: any[]; signatories: any[];
  failIndustry: boolean;
};

function fakeGusto() {
  let employeeCount = 0;
  vi.mocked(gustoRequest).mockImplementation(async (path: string, options: any = {}) => {
    const method = options.method ?? "GET";
    const route = `${method} ${path}`;
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
      case `POST ${base}/employees`: employeeCount += 1; return { uuid: `emp-${employeeCount}` };
      case `GET ${base}/signatories`: return state.signatories;
      case `POST ${base}/signatories`: return {};
    }
    if (method === "POST" && /^\/v1\/employees\/emp-\d+\/(home_addresses|work_addresses)$/.test(path)) return {};
    if (method === "POST" && /^\/v1\/employees\/emp-\d+\/jobs$/.test(path)) {
      return { current_compensation_uuid: "comp-1", compensations: [{ uuid: "comp-1", version: "comp-v1" }] };
    }
    if (method === "PUT" && path === "/v1/compensations/comp-1") return {};
    if (/^\/v1\/employees\/emp-\d+\/payment_method$/.test(path)) return { version: "pm-v1" };
    throw new Error(`Unexpected Gusto request: ${route}`);
  });
}

const calls = (method: string, path: string | RegExp) => vi.mocked(gustoRequest).mock.calls.filter(([p, o]: any[]) =>
  (o?.method ?? "GET") === method && (typeof path === "string" ? p === path : path.test(p)));
const bodyOf = (method: string, path: string | RegExp) => calls(method, path)[0]?.[1]?.body;

async function connect(environment = "demo") {
  const user = await storage.createUser({ username: `sample-${Math.random()}@example.com`, password: "x", isAdmin: true });
  await db.insert(gustoIntegrations).values({
    userId: user.id, companyId, environment, state: "connected",
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-token" })),
  });
  return user.id;
}

describe("samplePaySchedule", () => {
  it("pays on the first Friday at least a week away, ending the period the Sunday before", () => {
    expect(samplePaySchedule("2026-11-08")).toEqual({ anchor_pay_date: "2026-11-20", anchor_end_of_pay_period: "2026-11-15" });
    expect(samplePaySchedule("2026-11-13")).toEqual({ anchor_pay_date: "2026-11-20", anchor_end_of_pay_period: "2026-11-15" });
  });
});

describe("fillDemoCompany", () => {
  beforeEach(() => {
    vi.stubEnv("GUSTO_ENV", "demo");
    state = { completed: [], locations: [], bankAccounts: [], schedules: [], employees: [], signatories: [], failIndustry: false };
    vi.mocked(gustoRequest).mockReset();
    fakeGusto();
  });
  afterEach(() => vi.unstubAllEnvs());

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
    expect(bodyOf("PUT", /\/payment_method$/)).toEqual({ version: "pm-v1", type: "Check" });
    expect(bodyOf("POST", `${base}/signatories`)).toMatchObject({ first_name: "Pat", title: "Owner" });
    expect(calls("PUT", `${base}/bank_accounts/bank-1/verify`)).toHaveLength(1);

    expect(results.filter(r => r.status === "done").map(r => r.step)).toEqual([
      "Company address", "Federal tax information", "Industry", "Bank account", "Pay schedule", "Employees", "Signatory", "Verify bank account",
    ]);
    expect(results.filter(r => r.status === "manual").map(r => r.step)).toEqual(["State tax information", "Sign documents"]);
    expect(status.fundingAccount?.status).toBe("verified");
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

  it("doesn't add sample employees twice", async () => {
    state.employees = [{ email: "sonofanorphan@example.com" }, { email: "maria.lopez@example.com" }];
    const { results } = await fillDemoCompany(await connect());

    expect(calls("POST", `${base}/employees`)).toHaveLength(0);
    expect(results.find(r => r.step === "Employees")).toMatchObject({ status: "done", detail: "Sample employees already on file" });
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
