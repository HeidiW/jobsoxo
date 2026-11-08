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
const { testDepositAmounts, verifyDemoFunding } = await import("./gusto-company");

const companyId = "company-demo-1";
const bank = (status: string) => ({ uuid: "bank-1", verification_status: status, name: "Employer Funding Account", hidden_account_number: "XXXX6789" });
let bankStatus: string;
let testDeposits: unknown;

/** Fakes Gusto by URL and method (requests run concurrently in syncCompany). */
function fakeGusto() {
  vi.mocked(gustoRequest).mockImplementation(async (path: string, options: any = {}) => {
    const method = options.method ?? "GET";
    const base = `/v1/companies/${companyId}`;
    if (method === "GET" && path === base) return { uuid: companyId, name: "Crystal Grove LLP" };
    if (method === "GET" && path === `${base}/onboarding_status`) return { onboarding_completed: false, onboarding_steps: [] };
    if (method === "GET" && path === `${base}/bank_accounts`) return [bank(bankStatus)];
    if (method === "POST" && path === `${base}/bank_accounts/bank-1/send_test_deposits`) return testDeposits;
    if (method === "PUT" && path === `${base}/bank_accounts/bank-1/verify`) {
      bankStatus = "verified";
      return bank("verified");
    }
    throw new Error(`Unexpected Gusto request: ${method} ${path}`);
  });
}

const calls = (method: string, suffix: string) =>
  vi.mocked(gustoRequest).mock.calls.filter(([path, options]: any[]) => (options?.method ?? "GET") === method && path.endsWith(suffix));

async function connectDemoCompany(environment = "demo") {
  const user = await storage.createUser({ username: `gusto-${Math.random()}@example.com`, password: "x", isAdmin: true });
  await db.insert(gustoIntegrations).values({
    userId: user.id, companyId, environment, state: "connected",
    encryptedAccessToken: encrypt(JSON.stringify({ accessToken: "test-token" })),
  });
  return user.id;
}

describe("testDepositAmounts", () => {
  it("reads two micro-deposit amounts in the shapes Gusto may return", () => {
    expect(testDepositAmounts({ deposit_1: 0.02, deposit_2: "0.42" })).toEqual([0.02, 0.42]);
    expect(testDepositAmounts({ deposits: [0.11, 0.07] })).toEqual([0.11, 0.07]);
    expect(testDepositAmounts([{ amount: "0.03" }, { amount: "0.31" }])).toEqual([0.03, 0.31]);
  });

  it("rejects anything that isn't two micro-deposits", () => {
    expect(testDepositAmounts({})).toBeNull();
    expect(testDepositAmounts({ deposit_1: 0.02 })).toBeNull();
    expect(testDepositAmounts({ deposit_1: 5, deposit_2: 0.42 })).toBeNull();
    expect(testDepositAmounts({ deposits: [0.01, 0.02, 0.03] })).toBeNull();
  });
});

describe("verifyDemoFunding", () => {
  beforeEach(() => {
    vi.stubEnv("GUSTO_ENV", "demo");
    bankStatus = "awaiting_deposits";
    testDeposits = { deposit_1: 0.02, deposit_2: 0.42 };
    vi.mocked(gustoRequest).mockReset();
    fakeGusto();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("simulates the deposits, confirms them with Gusto and returns the verified status", async () => {
    const userId = await connectDemoCompany();

    const status = await verifyDemoFunding(userId);

    expect(calls("POST", "/send_test_deposits")).toHaveLength(1);
    expect(calls("PUT", "/verify")[0][1]).toMatchObject({ body: { deposit_1: 0.02, deposit_2: 0.42 } });
    expect(status.fundingAccount).toMatchObject({ id: "bank-1", status: "verified" });
  });

  it("does nothing to an account that's already verified", async () => {
    bankStatus = "verified";
    const userId = await connectDemoCompany();

    await verifyDemoFunding(userId);

    expect(calls("POST", "/send_test_deposits")).toHaveLength(0);
    expect(calls("PUT", "/verify")).toHaveLength(0);
  });

  it("refuses for production companies without calling Gusto", async () => {
    vi.stubEnv("GUSTO_ENV", "production");
    const userId = await connectDemoCompany("production");

    await expect(verifyDemoFunding(userId)).rejects.toMatchObject({ status: 409, code: "demo_only" });
    expect(gustoRequest).not.toHaveBeenCalled();
  });

  it("doesn't verify with amounts it can't read", async () => {
    testDeposits = { message: "queued" };
    const userId = await connectDemoCompany();

    await expect(verifyDemoFunding(userId)).rejects.toMatchObject({ status: 502, code: "invalid_response" });
    expect(calls("PUT", "/verify")).toHaveLength(0);
  });
});
