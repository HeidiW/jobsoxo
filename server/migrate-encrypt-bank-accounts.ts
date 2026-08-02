/**
 * One-time migration: encrypt the three sensitive fields in bank_accounts
 * (plaidAccessToken, plaidItemId, routingNumber) for any rows that are still
 * stored as plain text.
 *
 * Detection: encrypted values start with "enc:v1:".  Rows that already start
 * with that prefix are skipped, so this script is safe to re-run.
 *
 * Called automatically from server/index.ts at startup.
 */

import { db } from "./db";
import { bankAccounts } from "@shared/schema";
import { encrypt, isEncrypted } from "./encryption";
import { eq } from "drizzle-orm";

export async function migrateEncryptBankAccounts(): Promise<void> {
  const rows = await db.select().from(bankAccounts);

  if (rows.length === 0) return;

  let migrated = 0;
  for (const row of rows) {
    const needsMigration =
      !isEncrypted(row.plaidAccessToken) ||
      !isEncrypted(row.plaidItemId) ||
      (row.routingNumber !== null && !isEncrypted(row.routingNumber));

    if (!needsMigration) continue;

    // Propagate failures: a row that cannot be encrypted must abort startup.
    // Leaving plaintext rows while the app serves requests is worse than not starting.
    await db
      .update(bankAccounts)
      .set({
        plaidAccessToken: isEncrypted(row.plaidAccessToken)
          ? row.plaidAccessToken
          : encrypt(row.plaidAccessToken),
        plaidItemId: isEncrypted(row.plaidItemId)
          ? row.plaidItemId
          : encrypt(row.plaidItemId),
        routingNumber:
          row.routingNumber === null
            ? null
            : isEncrypted(row.routingNumber)
            ? row.routingNumber
            : encrypt(row.routingNumber),
      })
      .where(eq(bankAccounts.id, row.id));
    migrated++;
  }

  if (migrated > 0) {
    console.log(`[migrate-encrypt] Encrypted ${migrated} bank_accounts row(s).`);
  }
}
