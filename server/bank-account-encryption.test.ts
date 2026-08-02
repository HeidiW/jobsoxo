/**
 * Tests that verify the encryption round-trip for bank account sensitive fields.
 *
 * createBankAccount() must store ciphertext, and all read methods must return
 * the original plaintext. The raw DB value must differ from the plaintext.
 */

// Provide a deterministic dummy key so encryption works without a real secret.
import "./test-helpers";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storage } from "./storage";
import { db } from "./db";
import { bankAccounts, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isEncrypted } from "./encryption";
import bcrypt from "bcryptjs";

// ── test fixtures ────────────────────────────────────────────────────────────

const PLAINTEXT = {
  plaidAccessToken: "access-sandbox-abc123",
  plaidItemId: "item-id-xyz789",
  routingNumber: "021000021",
};

async function createTestUserId(): Promise<string> {
  const username = `__test_bank_enc_${Date.now()}__`;
  const hash = await bcrypt.hash("Password1!", 10);
  const user = await storage.createUser({ username, password: hash });
  return user.id;
}

async function makeAccount(userId: string, extra: Partial<typeof sampleInsert> = {}) {
  return storage.createBankAccount({ ...sampleInsert, userId, ...extra });
}

const sampleInsert = {
  userId: "", // overridden per test
  entityType: "business" as const,
  entityId: null,
  plaidAccessToken: PLAINTEXT.plaidAccessToken,
  plaidItemId: PLAINTEXT.plaidItemId,
  plaidAccountId: "account-id-001",
  institutionName: "Test Bank",
  accountName: "Checking",
  accountMask: "0123",
  accountType: "depository",
  routingNumber: PLAINTEXT.routingNumber,
};

// ── test suite ───────────────────────────────────────────────────────────────

let testUserId: string;
const createdIds: string[] = [];

beforeAll(async () => {
  testUserId = await createTestUserId();
});

afterAll(async () => {
  // Clean up all bank accounts created during the test suite.
  if (createdIds.length > 0) {
    for (const id of createdIds) {
      await storage.deleteBankAccount(id);
    }
  }
  // Remove the test user.
  await db.delete(users).where(eq(users.id, testUserId));
});

// ── createBankAccount + getBankAccountById round-trip ────────────────────────

describe("createBankAccount / getBankAccountById round-trip", () => {
  it("returns the original plaintext plaidAccessToken after create → fetch", async () => {
    const created = await makeAccount(testUserId);
    createdIds.push(created.id);

    const fetched = await storage.getBankAccountById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.plaidAccessToken).toBe(PLAINTEXT.plaidAccessToken);
  });

  it("returns the original plaintext plaidItemId after create → fetch", async () => {
    const created = await makeAccount(testUserId);
    createdIds.push(created.id);

    const fetched = await storage.getBankAccountById(created.id);
    expect(fetched!.plaidItemId).toBe(PLAINTEXT.plaidItemId);
  });

  it("returns the original plaintext routingNumber after create → fetch", async () => {
    const created = await makeAccount(testUserId);
    createdIds.push(created.id);

    const fetched = await storage.getBankAccountById(created.id);
    expect(fetched!.routingNumber).toBe(PLAINTEXT.routingNumber);
  });

  it("handles null routingNumber without throwing", async () => {
    const created = await makeAccount(testUserId, { routingNumber: null });
    createdIds.push(created.id);

    const fetched = await storage.getBankAccountById(created.id);
    expect(fetched!.routingNumber).toBeNull();
  });
});

// ── raw DB values are ciphertext ─────────────────────────────────────────────

describe("raw DB values are encrypted, not plaintext", () => {
  it("stores ciphertext (not plaintext) for plaidAccessToken", async () => {
    const created = await makeAccount(testUserId);
    createdIds.push(created.id);

    const [row] = await db
      .select({ plaidAccessToken: bankAccounts.plaidAccessToken })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, created.id));

    expect(row.plaidAccessToken).not.toBe(PLAINTEXT.plaidAccessToken);
    expect(isEncrypted(row.plaidAccessToken)).toBe(true);
  });

  it("stores ciphertext (not plaintext) for plaidItemId", async () => {
    const created = await makeAccount(testUserId);
    createdIds.push(created.id);

    const [row] = await db
      .select({ plaidItemId: bankAccounts.plaidItemId })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, created.id));

    expect(row.plaidItemId).not.toBe(PLAINTEXT.plaidItemId);
    expect(isEncrypted(row.plaidItemId)).toBe(true);
  });

  it("stores ciphertext (not plaintext) for routingNumber", async () => {
    const created = await makeAccount(testUserId);
    createdIds.push(created.id);

    const [row] = await db
      .select({ routingNumber: bankAccounts.routingNumber })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, created.id));

    expect(row.routingNumber).not.toBe(PLAINTEXT.routingNumber);
    expect(row.routingNumber).not.toBeNull();
    expect(isEncrypted(row.routingNumber!)).toBe(true);
  });

  it("uses unique ciphertexts for each insert of the same plaintext (random IV)", async () => {
    const a = await makeAccount(testUserId);
    const b = await makeAccount(testUserId);
    createdIds.push(a.id, b.id);

    const [rowA] = await db
      .select({ token: bankAccounts.plaidAccessToken })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, a.id));

    const [rowB] = await db
      .select({ token: bankAccounts.plaidAccessToken })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, b.id));

    // Same plaintext → different ciphertext because the IV is random.
    expect(rowA.token).not.toBe(rowB.token);
  });
});

// ── getEmployeeBankAccounts ───────────────────────────────────────────────────

describe("getEmployeeBankAccounts decrypts on read", () => {
  it("returns decrypted fields for employee accounts", async () => {
    const userId2 = await createTestUserId();
    const employeeId = "emp-test-001";

    const created = await storage.createBankAccount({
      ...sampleInsert,
      userId: userId2,
      entityType: "employee",
      entityId: employeeId,
    });

    try {
      const accounts = await (storage as any).getEmployeeBankAccounts(userId2);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].plaidAccessToken).toBe(PLAINTEXT.plaidAccessToken);
      expect(accounts[0].plaidItemId).toBe(PLAINTEXT.plaidItemId);
      expect(accounts[0].routingNumber).toBe(PLAINTEXT.routingNumber);
    } finally {
      await storage.deleteBankAccount(created.id);
      await db.delete(users).where(eq(users.id, userId2));
    }
  });
});

// ── getBankAccountByEntityPublic ──────────────────────────────────────────────

describe("getBankAccountByEntityPublic decrypts on read", () => {
  it("returns decrypted fields when looking up by entityType + entityId", async () => {
    const userId3 = await createTestUserId();
    const employeeId = "emp-public-lookup-001";

    const created = await storage.createBankAccount({
      ...sampleInsert,
      userId: userId3,
      entityType: "employee",
      entityId: employeeId,
    });

    try {
      const result = await (storage as any).getBankAccountByEntityPublic("employee", employeeId);
      expect(result).toBeDefined();
      expect(result!.plaidAccessToken).toBe(PLAINTEXT.plaidAccessToken);
      expect(result!.plaidItemId).toBe(PLAINTEXT.plaidItemId);
      expect(result!.routingNumber).toBe(PLAINTEXT.routingNumber);
    } finally {
      await storage.deleteBankAccount(created.id);
      await db.delete(users).where(eq(users.id, userId3));
    }
  });
});

// ── getBankAccountByEntity (business path) ───────────────────────────────────

describe("getBankAccountByEntity / getBusinessBankAccount decrypts on read", () => {
  it("returns decrypted fields via getBusinessBankAccount", async () => {
    const userId4 = await createTestUserId();
    const created = await storage.createBankAccount({
      ...sampleInsert,
      userId: userId4,
    });

    try {
      const result = await storage.getBusinessBankAccount(userId4);
      expect(result).toBeDefined();
      expect(result!.plaidAccessToken).toBe(PLAINTEXT.plaidAccessToken);
      expect(result!.plaidItemId).toBe(PLAINTEXT.plaidItemId);
      expect(result!.routingNumber).toBe(PLAINTEXT.routingNumber);
    } finally {
      await storage.deleteBankAccount(created.id);
      await db.delete(users).where(eq(users.id, userId4));
    }
  });

  it("returns decrypted fields via getBankAccountByEntity", async () => {
    const userId5 = await createTestUserId();
    const created = await storage.createBankAccount({
      ...sampleInsert,
      userId: userId5,
    });

    try {
      const result = await storage.getBankAccountByEntity(userId5, "business");
      expect(result).toBeDefined();
      expect(result!.plaidAccessToken).toBe(PLAINTEXT.plaidAccessToken);
      expect(result!.plaidItemId).toBe(PLAINTEXT.plaidItemId);
    } finally {
      await storage.deleteBankAccount(created.id);
      await db.delete(users).where(eq(users.id, userId5));
    }
  });
});

// ── createBankAccount return value is already decrypted ───────────────────────

describe("createBankAccount return value", () => {
  it("returns decrypted plaintext directly from create (not ciphertext)", async () => {
    const created = await makeAccount(testUserId);
    createdIds.push(created.id);

    // The value returned by createBankAccount must already be decrypted.
    expect(created.plaidAccessToken).toBe(PLAINTEXT.plaidAccessToken);
    expect(created.plaidItemId).toBe(PLAINTEXT.plaidItemId);
    expect(created.routingNumber).toBe(PLAINTEXT.routingNumber);
    expect(isEncrypted(created.plaidAccessToken)).toBe(false);
  });
});
