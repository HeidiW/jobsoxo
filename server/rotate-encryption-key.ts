/**
 * Key-rotation script: re-encrypts all sensitive bank_accounts fields from the
 * old encryption key to the new one using optimistic concurrency, so the server
 * can keep serving requests throughout.
 *
 * ## Usage
 *
 *   npx tsx server/rotate-encryption-key.ts
 *
 * No command-line arguments.  The script reads the same two environment
 * variables that the server already uses:
 *
 *   ENCRYPTION_KEY          — the NEW (target) key (64 hex chars / 32 bytes)
 *   ENCRYPTION_KEY_PREVIOUS — the OLD (source) key (64 hex chars / 32 bytes)
 *
 * Set both variables in your secret manager or deployment config before
 * running — never pass keys inline on the command line, as that exposes them
 * in process listings and shell history.
 *
 * ## Zero-downtime rotation procedure
 *
 *   1. Generate a new 64-hex key:
 *        openssl rand -hex 32
 *      Store the result securely (e.g. in Replit Secrets).
 *
 *   2. In your secret manager / deployment config set:
 *        ENCRYPTION_KEY_PREVIOUS = <current ENCRYPTION_KEY value>
 *        ENCRYPTION_KEY          = <new key from step 1>
 *
 *   3. Restart the server.  It now accepts rows encrypted under either key
 *      (primary ENCRYPTION_KEY first, ENCRYPTION_KEY_PREVIOUS as fallback).
 *
 *   4. Run this script (keys come from the same env vars — no extra setup):
 *        npx tsx server/rotate-encryption-key.ts
 *
 *   5. After the script exits with "Rotation complete" and 0 errors, remove
 *      ENCRYPTION_KEY_PREVIOUS from your config and restart the server.
 *      All rows are now exclusively under the new key.
 *
 * ## Concurrency safety
 *
 *   Each row is updated with a conditional WHERE that includes the original
 *   ciphertext values (optimistic concurrency).  If the application updates
 *   a row between our read and write, the WHERE clause will not match
 *   (0 rows updated) and the script re-reads and retries up to 5 times.
 *   This prevents stale ciphertext from overwriting freshly-written Plaid
 *   credentials.  Rows deleted between read and write are silently skipped.
 *
 * ## Idempotency
 *
 *   Rows already encrypted under the new key are detected and skipped.
 *   Re-running the script after a partial failure is safe.
 */

import { db } from "./db";
import { bankAccounts } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { decryptWithKey, encryptWithKey, isEncrypted } from "./encryption";

// ---------------------------------------------------------------------------
// Key loading — reads the same vars the server uses
// ---------------------------------------------------------------------------

function loadRequiredKey(envVar: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    console.error(
      `[rotate] ${envVar} is not set. ` +
        "Set both ENCRYPTION_KEY (new) and ENCRYPTION_KEY_PREVIOUS (old) in your " +
        "secret manager before running this script."
    );
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    console.error(
      `[rotate] ${envVar} must be exactly 64 hex characters (32 bytes). Got ${raw.length}.`
    );
    process.exit(1);
  }
  return Buffer.from(raw, "hex");
}

// ---------------------------------------------------------------------------
// Pure re-encryption logic (exported for tests)
// ---------------------------------------------------------------------------

export interface RowSnapshot {
  plaidAccessToken: string;
  plaidItemId: string;
  routingNumber: string | null;
}

export interface ReEncryptResult {
  newValues: RowSnapshot;
  /** true when all fields were already encrypted under the new key */
  alreadyRotated: boolean;
}

/**
 * Inspects and re-encrypts the three sensitive fields of a bank_accounts row.
 *
 * Each field is resolved as follows:
 *   1. If decryption with `newKey` succeeds → already rotated (preserve value).
 *   2. Otherwise, decrypt with `oldKey` and encrypt with `newKey`.
 *
 * Throws if a field cannot be decrypted with either key, or if a field
 * is stored as plain text (migration has not been run).
 *
 * This function is pure — it does not touch the database.
 */
export function reEncryptFields(
  row: RowSnapshot,
  rowId: string,
  oldKey: Buffer,
  newKey: Buffer,
): ReEncryptResult {
  function resolveField(
    value: string,
    fieldName: string,
  ): { newCiphertext: string; alreadyRotated: boolean } {
    if (!isEncrypted(value)) {
      throw new Error(
        `[rotate] Row ${rowId}: field "${fieldName}" is plain-text — run ` +
          "migrate-encrypt-bank-accounts before rotating."
      );
    }

    // Try the new key first — if it decrypts, the field is already rotated.
    try {
      const plaintext = decryptWithKey(value, newKey);
      return { newCiphertext: encryptWithKey(plaintext, newKey), alreadyRotated: true };
    } catch {
      // Expected: field is still encrypted under the old key.
    }

    // Decrypt with the old key and re-encrypt with the new key.
    try {
      const plaintext = decryptWithKey(value, oldKey);
      return { newCiphertext: encryptWithKey(plaintext, newKey), alreadyRotated: false };
    } catch (err) {
      throw new Error(
        `[rotate] Row ${rowId}: cannot decrypt field "${fieldName}" with either key. ` +
          "Verify ENCRYPTION_KEY_PREVIOUS is set to the correct old key. " +
          "Original error: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }

  const tokenResult = resolveField(row.plaidAccessToken, "plaidAccessToken");
  const itemResult = resolveField(row.plaidItemId, "plaidItemId");
  const routingResult =
    row.routingNumber !== null
      ? resolveField(row.routingNumber, "routingNumber")
      : null;

  const alreadyRotated =
    tokenResult.alreadyRotated &&
    itemResult.alreadyRotated &&
    (routingResult === null || routingResult.alreadyRotated);

  return {
    newValues: {
      plaidAccessToken: tokenResult.newCiphertext,
      plaidItemId: itemResult.newCiphertext,
      routingNumber: routingResult !== null ? routingResult.newCiphertext : null,
    },
    alreadyRotated,
  };
}

// ---------------------------------------------------------------------------
// Database rotation with optimistic concurrency
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;

/**
 * Re-encrypts a single row with optimistic concurrency.
 *
 * The UPDATE includes the original ciphertext values in its WHERE clause.
 * If 0 rows are updated (meaning the app concurrently changed the row),
 * the row is re-read and the operation is retried up to MAX_RETRIES times.
 * If the row no longer exists (deleted), the function returns "skipped".
 *
 * Returns one of:
 *   "rotated"        — row was successfully re-encrypted under the new key
 *   "alreadyRotated" — all fields were already under the new key
 *   "skipped"        — row was deleted before we could update it
 */
async function rotateRowWithRetry(
  rowId: string,
  oldKey: Buffer,
  newKey: Buffer,
): Promise<"rotated" | "alreadyRotated" | "skipped"> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Read the current state of the row.
    const [current] = await db
      .select({
        plaidAccessToken: bankAccounts.plaidAccessToken,
        plaidItemId: bankAccounts.plaidItemId,
        routingNumber: bankAccounts.routingNumber,
      })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, rowId));

    if (!current) {
      // Row was deleted between the initial scan and now.
      return "skipped";
    }

    const { newValues, alreadyRotated } = reEncryptFields(current, rowId, oldKey, newKey);

    if (alreadyRotated) {
      return "alreadyRotated";
    }

    // Conditional UPDATE: only succeeds if the ciphertext values haven't changed
    // since we read them, preventing stale overwrites on concurrent app updates.
    const whereClause = current.routingNumber !== null
      ? and(
          eq(bankAccounts.id, rowId),
          eq(bankAccounts.plaidAccessToken, current.plaidAccessToken),
          eq(bankAccounts.plaidItemId, current.plaidItemId),
          eq(bankAccounts.routingNumber, current.routingNumber),
        )
      : and(
          eq(bankAccounts.id, rowId),
          eq(bankAccounts.plaidAccessToken, current.plaidAccessToken),
          eq(bankAccounts.plaidItemId, current.plaidItemId),
        );

    const updated = await db
      .update(bankAccounts)
      .set({
        plaidAccessToken: newValues.plaidAccessToken,
        plaidItemId: newValues.plaidItemId,
        routingNumber: newValues.routingNumber,
      })
      .where(whereClause)
      .returning({ id: bankAccounts.id });

    if (updated.length > 0) {
      return "rotated";
    }

    // 0 rows updated → concurrent modification detected; retry.
    console.log(
      `[rotate] Row ${rowId}: concurrent update detected (attempt ${attempt}/${MAX_RETRIES}), retrying…`
    );
  }

  throw new Error(
    `[rotate] Row ${rowId}: could not complete rotation after ${MAX_RETRIES} attempts ` +
      "due to repeated concurrent modifications."
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // The script uses the same env vars as the server for consistency.
  // ENCRYPTION_KEY      = new (target) key
  // ENCRYPTION_KEY_PREVIOUS = old (source) key
  const newKey = loadRequiredKey("ENCRYPTION_KEY");
  const oldKey = loadRequiredKey("ENCRYPTION_KEY_PREVIOUS");

  if (oldKey.equals(newKey)) {
    console.error(
      "[rotate] ENCRYPTION_KEY and ENCRYPTION_KEY_PREVIOUS must be different. " +
        "Did you forget to update one of them?"
    );
    process.exit(1);
  }

  console.log("[rotate] Starting key rotation for bank_accounts …");

  const ids = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts);

  if (ids.length === 0) {
    console.log("[rotate] No rows found. Nothing to do.");
    process.exit(0);
  }

  console.log(`[rotate] Found ${ids.length} row(s) to inspect.`);

  let rotated = 0;
  let alreadyRotated = 0;
  let skipped = 0;
  let errors = 0;

  for (const { id } of ids) {
    try {
      const outcome = await rotateRowWithRetry(id, oldKey, newKey);
      if (outcome === "rotated") rotated++;
      else if (outcome === "alreadyRotated") alreadyRotated++;
      else skipped++;
    } catch (err) {
      console.error(
        `[rotate] ERROR on row ${id}:`,
        err instanceof Error ? err.message : err
      );
      errors++;
    }
  }

  console.log(
    `[rotate] Rotation complete — rotated: ${rotated}, already up-to-date: ${alreadyRotated}, skipped (deleted): ${skipped}, errors: ${errors}.`
  );

  if (errors > 0) {
    console.error(
      "[rotate] Some rows could not be rotated. Fix the errors above and re-run the script."
    );
    process.exit(1);
  }

  process.exit(0);
}

// Only run when executed directly (not when imported by tests or other modules).
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("rotate-encryption-key.ts") ||
    process.argv[1].endsWith("rotate-encryption-key.js"));

if (isMain) {
  main().catch((err) => {
    console.error("[rotate] Fatal error:", err);
    process.exit(1);
  });
}
