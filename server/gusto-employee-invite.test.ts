import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { gustoEmployeeMappings, gustoIntegrations } from "@shared/schema";
import { storage } from "./storage";
import { encrypt } from "./encryption";
import { buildAdminTestApp } from "./test-helpers";

vi.mock("./gusto-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gusto-client")>()),
  gustoRequest: vi.fn(),
}));
const { gustoRequest, GustoProviderError } = await import("./gusto-client");
const { gustoCompensation, inviteEmployeeToGusto } = await import("./gusto-employee-invite");

const companyId = "company-invite-1";
const base = `/v1/companies/${companyId}`;
type FakeEmployee = { uuid: string; email: string; onboarding_status: string; jobs: any[]; workAddresses: number };
let gusto: { employees: FakeEmployee[]; failJob: boolean };

function fakeGusto() {
  vi.mocked(gustoRequest).mockImplementation(async (path: string, options: any = {}) => {
    const method = options.method ?? "GET";
    const route = `${method} ${path.replace(/\?.*$/, "")}`;
    if (route === `GET ${base}/employees`) return gusto.employees;
    if (route === `POST ${base}/employees`) {
      const created = { uuid: `g-${gusto.employees.length + 1}`, email: options.body.email, onboarding_status: "self_onboarding_pending_invite", jobs: [], workAddresses: 0 };
      gusto.employees.push(created);
      return created;
    }
    if (route === `GET ${base}/locations`) return [{ uuid: "loc-mailing" }, { uuid: "loc-filing", filing_address: true }];
    const match = /^(GET|POST|PUT) \/v1\/employees\/(g-[\w-]+)(?:\/(\w+))?$/.exec(route);
    if (match) {
      const [, verb, uuid, resource] = match;
      const employee = gusto.employees.find((e) => e.uuid === uuid)!;
      if (!resource && verb === "GET") return employee;
      if (resource === "work_addresses" && verb === "GET") return Array.from({ length: employee.workAddresses }, () => ({}));
      if (resource === "work_addresses" && verb === "POST") { employee.workAddresses += 1; return {}; }
      if (resource === "jobs" && verb === "POST") {
        if (gusto.failJob) throw new GustoProviderError("rejected", 422, "invalid_attribute_value", "hire_date");
        employee.jobs.push({ uuid: "job-1" });
        return { current_compensation_uuid: "comp-1", compensations: [{ uuid: "comp-1", version: "v1" }] };
      }
      if (resource === "onboarding_status" && verb === "PUT") { employee.onboarding_status = options.body.onboarding_status; return {}; }
    }
    if (route === "PUT /v1/compensations/comp-1") return {};
    throw new Error(`Unexpected Gusto request: ${route}`);
  });
}

const calls = (method: string, path: string | RegExp) => vi.mocked(gustoRequest).mock.calls.filter(([p, o]: any[]) =>
  (o?.method ?? "GET") === method && (typeof path === "string" ? p === path : path.test(p)));

async function connect(userId?: string) {
  const id = userId ?? (await storage.createUser({ username: `invite-${Math.random()}@example.com`, password: "x", isAdmin: true })).id;
  await db.insert(gustoIntegrations).values({
    userId: id, companyId, environment: "demo", state: "connected",
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-token" })),
  });
  return id;
}

const employee = (overrides: Record<string, unknown> = {}) => storage.createEmployee({
  name: "Rosa Diaz", email: "rosa@example.com", dayRate: "240", payType: "hourly", employmentType: "w2",
  status: "active", position: "Painter", hireDate: new Date("2026-11-02T00:00:00Z"), ...overrides,
} as any);

beforeEach(() => {
  gusto = { employees: [], failJob: false };
  vi.mocked(gustoRequest).mockReset();
  fakeGusto();
});

describe("gustoCompensation", () => {
  it("converts JobsOxo pay to a Gusto rate", () => {
    expect(gustoCompensation({ payType: "hourly", dayRate: "240", annualSalary: null })).toEqual({ rate: "30.00", payment_unit: "Hour", flsa_status: "Nonexempt" });
    expect(gustoCompensation({ payType: "day", dayRate: "200", annualSalary: null })).toEqual({ rate: "25.00", payment_unit: "Hour", flsa_status: "Nonexempt" });
    expect(gustoCompensation({ payType: "salary", dayRate: "250", annualSalary: "70000" })).toEqual({ rate: "70000.00", payment_unit: "Year", flsa_status: "Salaried Nonexempt" });
  });
});

describe("inviteEmployeeToGusto", () => {
  it("adds a new employee to Gusto and sends the self-onboarding invitation", async () => {
    const userId = await connect();
    const rosa = await employee();

    const outcome = await inviteEmployeeToGusto(userId, rosa.id);

    expect(outcome).toEqual({ status: "invited", gustoEmployeeId: "g-1", onboardingStatus: "self_onboarding_invited" });
    expect(calls("POST", `${base}/employees`)[0][1].body).toEqual({ first_name: "Rosa", last_name: "Diaz", email: "rosa@example.com", self_onboarding: true });
    expect(calls("POST", "/v1/employees/g-1/work_addresses")[0][1].body).toEqual({ location_uuid: "loc-filing", effective_date: "2026-11-02" });
    expect(calls("POST", "/v1/employees/g-1/jobs")[0][1].body).toEqual({ title: "Painter", hire_date: "2026-11-02" });
    expect(calls("PUT", "/v1/compensations/comp-1")[0][1].body).toMatchObject({ rate: "30.00", payment_unit: "Hour" });
    expect(calls("PUT", "/v1/employees/g-1/onboarding_status")[0][1].body).toEqual({ onboarding_status: "self_onboarding_invited" });
    const [mapping] = await db.select().from(gustoEmployeeMappings).where(eq(gustoEmployeeMappings.employeeId, rosa.id));
    expect(mapping).toMatchObject({ gustoEmployeeId: "g-1", onboardingStatus: "self_onboarding_invited" });
  });

  it("uses the form's first and last names when given", async () => {
    const userId = await connect();
    const person = await employee({ name: "Mary Ann Van Dyke" });

    await inviteEmployeeToGusto(userId, person.id, { firstName: "Mary Ann", lastName: "Van Dyke" });

    expect(calls("POST", `${base}/employees`)[0][1].body).toMatchObject({ first_name: "Mary Ann", last_name: "Van Dyke" });
  });

  it("carries on after a partial failure instead of creating a duplicate", async () => {
    const userId = await connect();
    const rosa = await employee();
    gusto.failJob = true;
    await expect(inviteEmployeeToGusto(userId, rosa.id)).rejects.toMatchObject({ status: 422 });

    gusto.failJob = false;
    const outcome = await inviteEmployeeToGusto(userId, rosa.id);

    expect(calls("POST", `${base}/employees`)).toHaveLength(1);
    expect(calls("POST", "/v1/employees/g-1/work_addresses")).toHaveLength(1);
    expect(outcome.status).toBe("invited");
  });

  it("links someone already in Gusto by email without inviting twice", async () => {
    const userId = await connect();
    gusto.employees.push({ uuid: "g-existing", email: "ROSA@example.com", onboarding_status: "self_onboarding_invited", jobs: [{ uuid: "j" }], workAddresses: 1 });
    const rosa = await employee();

    const outcome = await inviteEmployeeToGusto(userId, rosa.id);

    expect(outcome).toMatchObject({ status: "already_invited", gustoEmployeeId: "g-existing" });
    expect(calls("POST", `${base}/employees`)).toHaveLength(0);
    expect(calls("PUT", /onboarding_status$/)).toHaveLength(0);
  });

  it("refuses employees Gusto can't invite", async () => {
    const userId = await connect();
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ email: null }, /email address/],
      [{ employmentType: "1099" }, /Contractors/],
      [{ status: "inactive" }, /active employees/],
      [{ name: "Cher" }, /first and last name/],
    ];
    for (const [overrides, message] of cases) {
      const person = await employee({ ...overrides, email: "email" in overrides ? overrides.email : `p${Math.random()}@example.com` });
      await expect(inviteEmployeeToGusto(userId, person.id)).rejects.toThrow(message);
    }
    expect(calls("POST", `${base}/employees`)).toHaveLength(0);
  });
});

describe("POST /api/employees with inviteToGusto", () => {
  let app: Express;
  let adminId: string;

  beforeAll(async () => {
    app = await buildAdminTestApp();
    adminId = (await storage.getUserByUsername("__test_admin__"))!.id;
  });

  const newEmployee = { name: "Rosa Diaz", firstName: "Rosa", lastName: "Diaz", email: "rosa@example.com", dayRate: "240", payType: "hourly", employmentType: "w2", status: "active" };

  it("saves the employee and reports the invitation", async () => {
    await connect(adminId);

    const res = await request(app).post("/api/employees").send({ ...newEmployee, inviteToGusto: true }).expect(201);

    expect(res.body).toMatchObject({ name: "Rosa Diaz", gustoInvite: { status: "invited", gustoEmployeeId: "g-1" } });
  });

  it("still saves the employee when the invitation fails", async () => {
    await connect(adminId);
    gusto.failJob = true;

    const res = await request(app).post("/api/employees").send({ ...newEmployee, inviteToGusto: true }).expect(201);

    expect(res.body.gustoInvite).toMatchObject({ status: "failed" });
    expect(await storage.getEmployee(res.body.id)).toBeDefined();
  });

  it("doesn't touch Gusto unless asked", async () => {
    await connect(adminId);

    const res = await request(app).post("/api/employees").send(newEmployee).expect(201);

    expect(res.body.gustoInvite).toBeUndefined();
    expect(gustoRequest).not.toHaveBeenCalled();
  });
});
