/**
 * AES-256-GCM field-level encryption for sensitive database values.
 *
 * Key format: 64 hex characters (32 bytes).
 * Ciphertext format: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * The "enc:v1:" prefix lets the migration script detect whether a value has
 * already been encrypted, so re-running the migration is safe.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "[encryption] ENCRYPTION_KEY is not set. " +
        "Set it to a 64-character hex string (32 bytes) before starting the server."
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "[encryption] ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). " +
        `Got ${raw.length} characters.`
    );
  }
  return Buffer.from(raw, "hex");
}

/**
 * Validates that ENCRYPTION_KEY is present and well-formed.
 * Call this at server startup so the process exits early with a clear error
 * rather than failing silently at the first DB read/write.
 */
export function validateEncryptionKey(): void {
  getKey(); // throws if missing or malformed
}

/**
 * Encrypts `plaintext` with AES-256-GCM.
 * Returns a string in the format `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts a value produced by `encrypt()`.
 * Returns the original plaintext string.
 * Throws if the format is unrecognised or authentication fails.
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
  const [ivHex, authTagHex, ctHex] = parts;
  const key = getKey();
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
