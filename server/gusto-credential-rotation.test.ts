import { describe, expect, it } from "vitest";
import { decryptWithKey, encryptWithKey } from "./encryption";
import { reEncryptGustoCredential } from "./rotate-encryption-key";

const oldKey = Buffer.alloc(32, 1), newKey = Buffer.alloc(32, 2);
describe("Gusto credential rotation", () => {
  it("rotates the whole access/refresh-token bundle and is repeatable", () => {
    const bundle = JSON.stringify({ accessToken: "fake-access", refreshToken: "fake-refresh", expiresAt: 12345 });
    const old = encryptWithKey(bundle, oldKey);
    const result = reEncryptGustoCredential(old, oldKey, newKey);
    expect(result.alreadyRotated).toBe(false);
    expect(decryptWithKey(result.value, newKey)).toBe(bundle);
    expect(reEncryptGustoCredential(result.value, oldKey, newKey)).toEqual({ value: result.value, alreadyRotated: true });
  });
  it("fails without disclosing plaintext or ciphertext", () => {
    expect(() => reEncryptGustoCredential("fake-plaintext-token", oldKey, newKey)).toThrow("Gusto credential is not encrypted.");
    const unknown = encryptWithKey("fake-refresh-token", Buffer.alloc(32, 3));
    expect(() => reEncryptGustoCredential(unknown, oldKey, newKey)).toThrow("Gusto credential cannot be decrypted with either encryption key.");
  });
});
