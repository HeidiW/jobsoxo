/**
 * Tests for server/encryption.ts and the rotation helper in
 * server/rotate-encryption-key.ts.
 *
 * These are pure unit tests — no database required.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encrypt,
  decrypt,
  encryptWithKey,
  decryptWithKey,
  isEncrypted,
  validateEncryptionKey,
} from "./encryption";
import { reEncryptFields } from "./rotate-encryption-key";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEY_A_HEX = "a".repeat(64); // 64 hex chars = 32 bytes
const KEY_B_HEX = "b".repeat(64);
const KEY_C_HEX = "c".repeat(64);

const KEY_A = Buffer.from(KEY_A_HEX, "hex");
const KEY_B = Buffer.from(KEY_B_HEX, "hex");

function setEnvKeys(current: string, previous?: string) {
  process.env.ENCRYPTION_KEY = current;
  if (previous !== undefined) {
    process.env.ENCRYPTION_KEY_PREVIOUS = previous;
  } else {
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
  }
}

function clearEnvKeys() {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
}

// ---------------------------------------------------------------------------
// encryptWithKey / decryptWithKey — explicit-key round-trips
// ---------------------------------------------------------------------------

describe("encryptWithKey / decryptWithKey", () => {
  it("round-trips a simple string", () => {
    const plain = "access-token-abc123";
    const ct = encryptWithKey(plain, KEY_A);
    expect(ct).toMatch(/^enc:v1:/);
    expect(decryptWithKey(ct, KEY_A)).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plain = "same-plaintext";
    const ct1 = encryptWithKey(plain, KEY_A);
    const ct2 = encryptWithKey(plain, KEY_A);
    expect(ct1).not.toBe(ct2);
  });

  it("throws when decrypting with the wrong key", () => {
    const ct = encryptWithKey("secret", KEY_A);
    expect(() => decryptWithKey(ct, KEY_B)).toThrow();
  });

  it("throws when the ciphertext is tampered with", () => {
    const ct = encryptWithKey("secret", KEY_A);
    const tampered = ct.slice(0, -4) + "0000";
    expect(() => decryptWithKey(tampered, KEY_A)).toThrow();
  });

  it("throws when prefix is missing", () => {
    expect(() => decryptWithKey("plain-text-no-prefix", KEY_A)).toThrow(
      /enc:v1:/
    );
  });

  it("round-trips unicode and long strings", () => {
    const plain = "🔑 very long token " + "x".repeat(512);
    expect(decryptWithKey(encryptWithKey(plain, KEY_A), KEY_A)).toBe(plain);
  });
});

// ---------------------------------------------------------------------------
// isEncrypted
// ---------------------------------------------------------------------------

describe("isEncrypted", () => {
  it("returns true for ciphertext produced by this module", () => {
    expect(isEncrypted(encryptWithKey("hi", KEY_A))).toBe(true);
  });

  it("returns false for plain-text values", () => {
    expect(isEncrypted("plain-text")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encrypt / decrypt — env-var-based API
// ---------------------------------------------------------------------------

describe("encrypt / decrypt (env-var keys)", () => {
  afterEach(clearEnvKeys);

  it("round-trips using ENCRYPTION_KEY", () => {
    setEnvKeys(KEY_A_HEX);
    const ct = encrypt("my-secret");
    expect(decrypt(ct)).toBe("my-secret");
  });

  it("decrypt falls back to ENCRYPTION_KEY_PREVIOUS when primary key fails", () => {
    // Encrypt with key A (the "old" key)
    setEnvKeys(KEY_A_HEX);
    const ct = encryptWithKey("old-secret", KEY_A);

    // Switch to key B as primary, keep A as previous
    setEnvKeys(KEY_B_HEX, KEY_A_HEX);

    // Server should still be able to decrypt rows encrypted under the old key
    expect(decrypt(ct)).toBe("old-secret");
  });

  it("decrypt uses primary ENCRYPTION_KEY before falling back", () => {
    // Encrypt with new key (B)
    const ct = encryptWithKey("new-secret", KEY_B);
    setEnvKeys(KEY_B_HEX, KEY_A_HEX);
    expect(decrypt(ct)).toBe("new-secret");
  });

  it("decrypt throws when neither primary nor previous key can decrypt", () => {
    const ct = encryptWithKey("secret", KEY_A);
    // Set both keys to something unrelated
    setEnvKeys(KEY_B_HEX, KEY_C_HEX);
    expect(() => decrypt(ct)).toThrow();
  });

  it("decrypt throws when ciphertext lacks the enc:v1: prefix", () => {
    setEnvKeys(KEY_A_HEX);
    expect(() => decrypt("not-encrypted")).toThrow(/enc:v1:/);
  });
});

// ---------------------------------------------------------------------------
// validateEncryptionKey
// ---------------------------------------------------------------------------

describe("validateEncryptionKey", () => {
  afterEach(clearEnvKeys);

  it("passes when ENCRYPTION_KEY is valid", () => {
    setEnvKeys(KEY_A_HEX);
    expect(() => validateEncryptionKey()).not.toThrow();
  });

  it("throws when ENCRYPTION_KEY is missing", () => {
    clearEnvKeys();
    expect(() => validateEncryptionKey()).toThrow(/ENCRYPTION_KEY/);
  });

  it("throws when ENCRYPTION_KEY is wrong length", () => {
    process.env.ENCRYPTION_KEY = "abc123";
    expect(() => validateEncryptionKey()).toThrow(/64/);
  });

  it("throws when ENCRYPTION_KEY_PREVIOUS is set but malformed", () => {
    setEnvKeys(KEY_A_HEX, "not-hex!!!");
    expect(() => validateEncryptionKey()).toThrow(/ENCRYPTION_KEY_PREVIOUS/);
  });
});

// ---------------------------------------------------------------------------
// reEncryptFields — pure rotation logic
// ---------------------------------------------------------------------------

describe("reEncryptFields", () => {
  const ROW_ID = "test-row-id";

  it("re-encrypts fields from oldKey to newKey", () => {
    const row = {
      plaidAccessToken: encryptWithKey("access-token", KEY_A),
      plaidItemId: encryptWithKey("item-id", KEY_A),
      routingNumber: encryptWithKey("123456789", KEY_A),
    };

    const { newValues, alreadyRotated } = reEncryptFields(row, ROW_ID, KEY_A, KEY_B);

    expect(alreadyRotated).toBe(false);
    // New values must decrypt correctly with KEY_B
    expect(decryptWithKey(newValues.plaidAccessToken, KEY_B)).toBe("access-token");
    expect(decryptWithKey(newValues.plaidItemId, KEY_B)).toBe("item-id");
    expect(decryptWithKey(newValues.routingNumber!, KEY_B)).toBe("123456789");
    // New values must NOT decrypt with KEY_A
    expect(() => decryptWithKey(newValues.plaidAccessToken, KEY_A)).toThrow();
  });

  it("marks row as already rotated when all fields decrypt under newKey", () => {
    const row = {
      plaidAccessToken: encryptWithKey("access-token", KEY_B),
      plaidItemId: encryptWithKey("item-id", KEY_B),
      routingNumber: encryptWithKey("123456789", KEY_B),
    };

    const { alreadyRotated } = reEncryptFields(row, ROW_ID, KEY_A, KEY_B);
    expect(alreadyRotated).toBe(true);
  });

  it("handles null routingNumber", () => {
    const row = {
      plaidAccessToken: encryptWithKey("access-token", KEY_A),
      plaidItemId: encryptWithKey("item-id", KEY_A),
      routingNumber: null,
    };

    const { newValues, alreadyRotated } = reEncryptFields(row, ROW_ID, KEY_A, KEY_B);
    expect(alreadyRotated).toBe(false);
    expect(newValues.routingNumber).toBeNull();
    expect(decryptWithKey(newValues.plaidAccessToken, KEY_B)).toBe("access-token");
  });

  it("throws on plain-text fields (migration not run)", () => {
    const row = {
      plaidAccessToken: "plain-text-not-encrypted",
      plaidItemId: encryptWithKey("item-id", KEY_A),
      routingNumber: null,
    };

    expect(() => reEncryptFields(row, ROW_ID, KEY_A, KEY_B)).toThrow(
      /plain-text/
    );
  });

  it("throws when a field cannot be decrypted by either key", () => {
    const row = {
      plaidAccessToken: encryptWithKey("access-token", KEY_A),
      plaidItemId: encryptWithKey("item-id", KEY_A),
      routingNumber: null,
    };

    // Supply KEY_C as oldKey — neither KEY_C nor KEY_B can decrypt KEY_A ciphertext
    const KEY_C = Buffer.from(KEY_C_HEX, "hex");
    expect(() => reEncryptFields(row, ROW_ID, KEY_C, KEY_B)).toThrow(
      /cannot decrypt/
    );
  });

  it("is idempotent: re-running with same keys returns alreadyRotated", () => {
    const row = {
      plaidAccessToken: encryptWithKey("access-token", KEY_A),
      plaidItemId: encryptWithKey("item-id", KEY_A),
      routingNumber: null,
    };

    // First rotation
    const first = reEncryptFields(row, ROW_ID, KEY_A, KEY_B);
    expect(first.alreadyRotated).toBe(false);

    // Second rotation using the already-rotated values
    const second = reEncryptFields(first.newValues, ROW_ID, KEY_A, KEY_B);
    expect(second.alreadyRotated).toBe(true);
  });

  it("mixed row (some fields rotated, some not) is treated as needing rotation", () => {
    // Simulate a partially-written row (shouldn't happen with our conditional UPDATE
    // but should degrade gracefully if it does)
    const row = {
      plaidAccessToken: encryptWithKey("access-token", KEY_B), // already rotated
      plaidItemId: encryptWithKey("item-id", KEY_A),           // still old key
      routingNumber: null,
    };

    const { alreadyRotated, newValues } = reEncryptFields(row, ROW_ID, KEY_A, KEY_B);
    // alreadyRotated is false because plaidItemId is still under KEY_A
    expect(alreadyRotated).toBe(false);
    // Both fields should now decrypt with KEY_B
    expect(decryptWithKey(newValues.plaidAccessToken, KEY_B)).toBe("access-token");
    expect(decryptWithKey(newValues.plaidItemId, KEY_B)).toBe("item-id");
  });
});
