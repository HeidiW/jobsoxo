/**
 * AES-256-GCM field-level encryption for sensitive database values.
 *
 * Key format: 64 hex characters (32 bytes).
 * Ciphertext format: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * The "enc:v1:" prefix lets the migration script detect whether a value has
 * already been encrypted, so re-running the migration is safe.
 *
 * ## Key rotation (zero-downtime)
 *
 * To rotate the encryption key without taking the server offline:
 *
 *   1. Generate a new 64-hex-character key.
 *   2. Set `ENCRYPTION_KEY_PREVIOUS` = old key value.
 *   3. Set `ENCRYPTION_KEY` = new key value.
 *   4. Restart the server — it can now decrypt rows encrypted with EITHER key.
 *   5. Run: `npx tsx server/rotate-encryption-key.ts`
 *      This re-encrypts every bank_accounts row under the new key.
 *   6. After the script completes successfully, unset `ENCRYPTION_KEY_PREVIOUS`
 *      and restart the server. All rows now use the new key exclusively.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function parseKey(raw: string | undefined, label: string): Buffer {
  if (!raw) {
    throw new Error(
      `[encryption] ${label} is not set. ` +
        "Set it to a 64-character hex string (32 bytes) before starting the server."
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      `[encryption] ${label} must be exactly 64 hex characters (32 bytes). ` +
        `Got ${raw.length} characters.`
    );
  }
  return Buffer.from(raw, "hex");
}

function getKey(): Buffer {
  return parseKey(process.env.ENCRYPTION_KEY, "ENCRYPTION_KEY");
}

/**
 * Returns the previous key buffer if `ENCRYPTION_KEY_PREVIOUS` is set,
 * or `null` if it is absent. Used as a decryption fallback during key rotation.
 */
function getPreviousKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (!raw) return null;
  return parseKey(raw, "ENCRYPTION_KEY_PREVIOUS");
}

/**
 * Validates that ENCRYPTION_KEY is present and well-formed.
 * Also validates ENCRYPTION_KEY_PREVIOUS when it is set.
 * Call this at server startup so the process exits early with a clear error
 * rather than failing silently at the first DB read/write.
 */
export function validateEncryptionKey(): void {
  getKey(); // throws if missing or malformed
  getPreviousKey(); // throws if set but malformed
}

/**
 * Encrypts `plaintext` with AES-256-GCM using the current ENCRYPTION_KEY.
 * Returns a string in the format `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 */
export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, getKey());
}

/**
 * Encrypts `plaintext` with AES-256-GCM using an explicit key buffer.
 * Used by the key-rotation script to encrypt with the new key directly.
 */
export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts a value produced by `encrypt()`.
 * Returns the original plaintext string.
 *
 * During key rotation, if decryption with the current key fails (auth tag
 * mismatch) and `ENCRYPTION_KEY_PREVIOUS` is set, decryption is retried
 * with the previous key. This lets the server serve rows encrypted under
 * either key while the rotation script runs.
 *
 * Throws if the format is unrecognised or both key attempts fail.
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(PREFIX)) {
    throw new Error(
      "[encryption] decrypt() called on a value that does not start with 'enc:v1:'. " +
        "Either the value was not encrypted with this module, or the database has not been migrated yet."
    );
  }
  const rest = ciphertext.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) {
    throw new Error("[encryption] Malformed ciphertext — expected 3 colon-separated segments after the prefix.");
  }

  // Try primary key first
  try {
    return decryptWithKey(ciphertext, getKey());
  } catch (primaryErr) {
    // If a previous key is configured, try it as a fallback (rotation window)
    const prevKey = getPreviousKey();
    if (prevKey) {
      try {
        return decryptWithKey(ciphertext, prevKey);
      } catch {
        // Both keys failed — report the original error
        throw primaryErr;
      }
    }
    throw primaryErr;
  }
}

/**
 * Decrypts a value produced by `encrypt()` using an explicit key buffer.
 * Used by the key-rotation script to decrypt with the old key directly.
 * Throws if the format is unrecognised or authentication fails.
 */
export function decryptWithKey(ciphertext: string, key: Buffer): string {
  if (!ciphertext.startsWith(PREFIX)) {
    throw new Error(
      "[encryption] decryptWithKey() called on a value that does not start with 'enc:v1:'."
    );
  }
  const rest = ciphertext.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) {
    throw new Error("[encryption] Malformed ciphertext — expected 3 colon-separated segments after the prefix.");
  }
  const [ivHex, authTagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

/** Returns true when the value looks like an encrypted ciphertext produced by this module. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
