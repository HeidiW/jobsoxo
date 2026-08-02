/**
 * Route-level integration tests for the Plaid bank-account connect flow.
 *
 * These tests verify that after encryption was added:
 * - POST /api/plaid/exchange-token stores encrypted ciphertext and returns safe masked fields
 * - Replacing an existing account deletes the old record and stores a fresh encrypted one
 * - GET /api/plaid/bank-account returns the masked view (never ciphertext)
 * - POST /api/employee-bank-setup/:token/exchange stores encrypted ciphertext for employee accounts
 *
 * The Plaid SDK is mocked so no real API calls are made.
 */

// Set the dummy encryption key before anything imports encryption.ts
import "./test-helpers";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { db } from "./db";
import { bankAccounts, users, employees } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isEncrypted } from "./encryption";
import bcrypt from "bcryptjs";

// ── Mock the Plaid module ────────────────────────────────────────────────────
// vi.mock is hoisted — all values referenced inside the factory must be
// defined with vi.hoisted() so they are available before the const declarations.

const { FAKE_ACCESS_TOKEN, FAKE_ITEM_ID, FAKE_ACCOUNT_INFO } = vi.hoisted(() => ({
  FAKE_ACCESS_TOKEN: "access-sandbox-fake-token-abc123",
  FAKE_ITEM_ID: "item-sandbox-fake-id-xyz789",
  FAKE_ACCOUNT_INFO: {
    accountId: "acct-001",
    institutionName: "First Test Bank",
    accountName: "Checking",
    accountMask: "1234",
    accountType: "depository",
    routingNumber: "021000021",
    currentBalance: 1500,
    availableBalance: 1200,
  },
}));

vi.mock("./plaid", () => ({
  isPlaidConfigured: () => true,
  createLinkToken: vi.fn().mockResolvedValue("link-sandbox-fake"),
  exchangePublicToken: vi.fn().mockResolvedValue({
    accessToken: "access-sandbox-fake-token-abc123",
    itemId: "item-sandbox-fake-id-xyz789",
  }),
  getAccountInfo: vi.fn().mockResolvedValue({
    accountId: "acct-001",
    institutionName: "First Test Bank",
    accountName: "Checking",
    accountMask: "1234",
    accountType: "depository",
    routingNumber: "021000021",
    currentBalance: 1500,
    availableBalance: 1200,
  }),
  getBalance: vi.fn().mockResolvedValue({ current: 1500, available: 1200 }),
  getTransactions: vi.fn().mockResolvedValue([]),
}));

// ── Test infrastructure ──────────────────────────────────────────────────────

let app: Express;
let testUserId: string;

// Track records to clean up after each suite.
const createdBankAccountIds: string[] = [];

beforeAll(async () => {
  app = await buildTestApp();

  // buildTestApp injects userId = "test-user" into the session.
  // We need that user to exist in the DB because bank_accounts has a FK on users.id.
  let existing = await storage.getUser("test-user");
  if (!existing) {
    const hash = await bcrypt.hash("Password1!", 10);
    await db
      .insert(users)
      .values({ id: "test-user", username: "__test_plaid_user__", password: hash })
      .onConflictDoNothing();
  }
  testUserId = "test-user";
});

afterAll(async () => {
  for (const id of createdBankAccountIds) {
    await storage.deleteBankAccount(id).catch(() => {});
  }
});

// ── POST /api/plaid/exchange-token (business account) ───────────────────────

describe("POST /api/plaid/exchange-token — business account connect", () => {
  it("returns 200 with masked fields (no access token, no full routing number)", async () => {
    const res = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    expect(res.body).toMatchObject({
      institutionName: FAKE_ACCOUNT_INFO.institutionName,
      accountName: FAKE_ACCOUNT_INFO.accountName,
      accountMask: FAKE_ACCOUNT_INFO.accountMask,
      accountType: FAKE_ACCOUNT_INFO.accountType,
    });
    // Must have a masked routing number, not plaintext
    expect(res.body.routingNumberMask).toBe("••••0021");
    // Must NOT expose the raw access token or item ID
    expect(res.body).not.toHaveProperty("plaidAccessToken");
    expect(res.body).not.toHaveProperty("plaidItemId");
    expect(res.body).not.toHaveProperty("routingNumber");

    createdBankAccountIds.push(res.body.id);
  });

  it("stores ciphertext in the DB for plaidAccessToken, not the plaintext", async () => {
    const res = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    const [row] = await db
      .select({ plaidAccessToken: bankAccounts.plaidAccessToken })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, res.body.id));

    expect(row.plaidAccessToken).not.toBe(FAKE_ACCESS_TOKEN);
    expect(isEncrypted(row.plaidAccessToken)).toBe(true);

    createdBankAccountIds.push(res.body.id);
  });

  it("stores ciphertext in the DB for plaidItemId, not the plaintext", async () => {
    const res = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    const [row] = await db
      .select({ plaidItemId: bankAccounts.plaidItemId })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, res.body.id));

    expect(row.plaidItemId).not.toBe(FAKE_ITEM_ID);
    expect(isEncrypted(row.plaidItemId)).toBe(true);

    createdBankAccountIds.push(res.body.id);
  });

  it("stores ciphertext in the DB for routingNumber, not the plaintext", async () => {
    const res = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    const [row] = await db
      .select({ routingNumber: bankAccounts.routingNumber })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, res.body.id));

    expect(row.routingNumber).not.toBe(FAKE_ACCOUNT_INFO.routingNumber);
    expect(isEncrypted(row.routingNumber!)).toBe(true);

    createdBankAccountIds.push(res.body.id);
  });

  it("stored credentials are decryptable via getBankAccountById (full round-trip)", async () => {
    const res = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    const account = await storage.getBankAccountById(res.body.id);
    expect(account).toBeDefined();
    expect(account!.plaidAccessToken).toBe(FAKE_ACCESS_TOKEN);
    expect(account!.plaidItemId).toBe(FAKE_ITEM_ID);
    expect(account!.routingNumber).toBe(FAKE_ACCOUNT_INFO.routingNumber);

    createdBankAccountIds.push(res.body.id);
  });

  it("returns 400 when publicToken is missing", async () => {
    const res = await request(app)
      .post("/api/plaid/exchange-token")
      .send({})
      .expect(400);

    expect(res.body.error).toBe("publicToken is required");
  });
});

// ── Account replacement ──────────────────────────────────────────────────────

describe("POST /api/plaid/exchange-token — replaces existing account", () => {
  it("removes the old record when a business account already exists", async () => {
    // First connect
    const first = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    const firstId = first.body.id;

    // Connect again (replacement)
    const second = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    const secondId = second.body.id;
    createdBankAccountIds.push(secondId);

    // Old record must be gone
    const old = await storage.getBankAccountById(firstId);
    expect(old).toBeUndefined();

    // New record has decryptable credentials
    const newAccount = await storage.getBankAccountById(secondId);
    expect(newAccount).toBeDefined();
    expect(newAccount!.plaidAccessToken).toBe(FAKE_ACCESS_TOKEN);
  });
});

// ── GET /api/plaid/bank-account ──────────────────────────────────────────────

describe("GET /api/plaid/bank-account — returns masked view", () => {
  it("returns masked metadata without exposing any ciphertext or raw sensitive fields", async () => {
    // Ensure there is a connected account
    const connectRes = await request(app)
      .post("/api/plaid/exchange-token")
      .send({ publicToken: "public-sandbox-fake" })
      .expect(200);

    createdBankAccountIds.push(connectRes.body.id);

    const res = await request(app)
      .get("/api/plaid/bank-account?entityType=business")
      .expect(200);

    expect(res.body).not.toBeNull();
    expect(res.body.institutionName).toBe(FAKE_ACCOUNT_INFO.institutionName);
    expect(res.body.accountMask).toBe(FAKE_ACCOUNT_INFO.accountMask);
    // Must show masked routing, not plaintext or ciphertext
    expect(res.body.routingNumberMask).toBe("••••0021");
    expect(res.body).not.toHaveProperty("plaidAccessToken");
    expect(res.body).not.toHaveProperty("routingNumber");
  });
});

// ── Employee exchange route ──────────────────────────────────────────────────
// The employee route authenticates via a one-time token (no session).
// We spy on storage methods that touch the directDepositToken column because
// that migration may not exist in all test database instances.

describe("POST /api/employee-bank-setup/:token/exchange — employee account connect", () => {
  it("stores encrypted credentials and returns masked fields for an employee account", async () => {
    // Create a lightweight test employee in the DB
    const hash = await bcrypt.hash("Password1!", 10);
    const empUser = await storage.createUser({
      username: `__test_emp_exchange_${Date.now()}__`,
      password: hash,
    });

    // Stub the storage methods that require the directDepositToken column so
    // the test works regardless of whether that migration has been applied.
    const fakeToken = "setup-token-abc123";
    const fakeEmployee = {
      id: `emp-exchange-test-${Date.now()}`,
      name: "Test Worker",
      directDepositToken: fakeToken,
      directDepositTokenExpiry: new Date(Date.now() + 3600_000),
      directDepositLinkUserId: empUser.id,
    };

    const getByToken = vi
      .spyOn(storage, "getEmployeeByDirectDepositToken")
      .mockResolvedValue(fakeEmployee as any);
    const clearToken = vi
      .spyOn(storage, "clearEmployeeDirectDepositToken")
      .mockResolvedValue(undefined);

    let createdId: string | undefined;
    try {
      const res = await request(app)
        .post(`/api/employee-bank-setup/${fakeToken}/exchange`)
        .send({ publicToken: "public-sandbox-fake" })
        .expect(200);

      createdId = res.body.id;

      // Response must be masked — no raw credentials
      expect(res.body.routingNumberMask).toBe("••••0021");
      expect(res.body).not.toHaveProperty("plaidAccessToken");
      expect(res.body).not.toHaveProperty("routingNumber");

      // Raw DB value must be ciphertext
      const [row] = await db
        .select({ plaidAccessToken: bankAccounts.plaidAccessToken })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, createdId));

      expect(isEncrypted(row.plaidAccessToken)).toBe(true);
      expect(row.plaidAccessToken).not.toBe(FAKE_ACCESS_TOKEN);

      // Round-trip: storage decrypts correctly
      const stored = await storage.getBankAccountById(createdId);
      expect(stored!.plaidAccessToken).toBe(FAKE_ACCESS_TOKEN);
      expect(stored!.plaidItemId).toBe(FAKE_ITEM_ID);
      expect(stored!.routingNumber).toBe(FAKE_ACCOUNT_INFO.routingNumber);

      // clearEmployeeDirectDepositToken was called once (token invalidated)
      expect(clearToken).toHaveBeenCalledOnce();
    } finally {
      getByToken.mockRestore();
      clearToken.mockRestore();
      if (createdId) await storage.deleteBankAccount(createdId).catch(() => {});
      await db.delete(users).where(eq(users.id, empUser.id));
    }
  });

  it("replaces an existing employee account when one is already connected", async () => {
    const hash = await bcrypt.hash("Password1!", 10);
    const empUser = await storage.createUser({
      username: `__test_emp_replace_${Date.now()}__`,
      password: hash,
    });

    const fakeToken = "setup-token-replace-456";
    const fakeEmployeeId = `emp-replace-test-${Date.now()}`;
    const fakeEmployee = {
      id: fakeEmployeeId,
      name: "Replace Worker",
      directDepositToken: fakeToken,
      directDepositTokenExpiry: new Date(Date.now() + 3600_000),
      directDepositLinkUserId: empUser.id,
    };

    const getByToken = vi
      .spyOn(storage, "getEmployeeByDirectDepositToken")
      .mockResolvedValue(fakeEmployee as any);
    const clearToken = vi
      .spyOn(storage, "clearEmployeeDirectDepositToken")
      .mockResolvedValue(undefined);

    const firstIds: string[] = [];
    try {
      // First connect
      const first = await request(app)
        .post(`/api/employee-bank-setup/${fakeToken}/exchange`)
        .send({ publicToken: "public-sandbox-fake" })
        .expect(200);
      firstIds.push(first.body.id);

      // Second connect (replacement)
      const second = await request(app)
        .post(`/api/employee-bank-setup/${fakeToken}/exchange`)
        .send({ publicToken: "public-sandbox-fake" })
        .expect(200);

      // Old record gone
      const old = await storage.getBankAccountById(firstIds[0]);
      expect(old).toBeUndefined();

      // New record decryptable
      const newAccount = await storage.getBankAccountById(second.body.id);
      expect(newAccount!.plaidAccessToken).toBe(FAKE_ACCESS_TOKEN);

      if (second.body.id) await storage.deleteBankAccount(second.body.id).catch(() => {});
    } finally {
      getByToken.mockRestore();
      clearToken.mockRestore();
      for (const id of firstIds) await storage.deleteBankAccount(id).catch(() => {});
      await db.delete(users).where(eq(users.id, empUser.id));
    }
  });
});
