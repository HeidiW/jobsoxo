/**
 * Shared Plaid transaction sync logic.
 *
 * Extracted from the POST /api/plaid/sync-transactions route so that
 * both the manual "Sync now" button and the daily scheduled job can
 * call the same code path.
 */

import { getTransactions, isPlaidConfigured } from "./plaid";
import { storage } from "./storage";
import { db } from "./db";
import { payments } from "@shared/schema";
import { log } from "./logger";

export interface PlaidSyncResult {
  ok: boolean;
  synced: number;
  matched: number;
  /** false when Plaid reports PRODUCT_NOT_READY */
  ready: boolean;
  error?: string;
}

/**
 * Sync Plaid transactions for a single user who has a business bank account
 * connected. Returns a result summary; never throws.
 */
export async function syncPlaidTransactionsForUser(userId: string): Promise<PlaidSyncResult> {
  if (!isPlaidConfigured()) {
    return { ok: false, synced: 0, matched: 0, ready: false, error: "Plaid not configured" };
  }

  const account = await storage.getBusinessBankAccount(userId);
  if (!account) {
    return { ok: false, synced: 0, matched: 0, ready: false, error: "No bank account connected" };
  }

  let rawTxns: Awaited<ReturnType<typeof getTransactions>>;
  try {
    rawTxns = await getTransactions(account.plaidAccessToken, 90);
  } catch (txError: any) {
    if (txError?.code === "PRODUCT_NOT_READY") {
      return { ok: true, synced: 0, matched: 0, ready: false };
    }
    throw txError;
  }

  const toInsert = rawTxns.map(t => ({
    userId,
    plaidTransactionId: t.transactionId,
    plaidAccountId: account.plaidAccountId,
    date: new Date(t.date),
    amount: String(t.amount),
    name: t.name,
    merchantName: t.merchantName ?? null,
    pending: false,
  }));

  const stored = await storage.upsertPlaidTransactions(toInsert);

  // Auto-match: find invoice payments close in amount and date
  const allPayments = await db.select().from(payments);
  let matched = 0;
  for (const tx of stored) {
    if (tx.matchedPaymentId) continue;
    const txAmt = Math.abs(Number(tx.amount));
    const txDate = new Date(tx.date);
    const hit = allPayments.find(p => {
      const pAmt = Number(p.amount);
      // Check both raw and /100 (covers pence-stored amounts)
      const closeRaw = Math.abs(pAmt - txAmt) <= 1.0;
      const closePence = Math.abs(pAmt / 100 - txAmt) <= 1.0;
      if (!closeRaw && !closePence) return false;
      const dayDiff = Math.abs(new Date(p.paymentDate).getTime() - txDate.getTime()) / 864e5;
      return dayDiff <= 5;
    });
    if (hit) {
      await storage.matchPlaidTransaction(tx.plaidTransactionId, hit.id);
      matched++;
    }
  }

  return { ok: true, synced: stored.length, matched, ready: true };
}

/**
 * Sync Plaid transactions for all users who have a business bank account
 * connected. Called by the daily scheduler.
 */
export async function syncPlaidTransactionsForAllUsers(): Promise<void> {
  if (!isPlaidConfigured()) {
    log("Plaid auto-sync skipped — Plaid is not configured", "scheduler");
    return;
  }

  const usersWithAccounts = await storage.getUsersWithBusinessBankAccounts();

  if (usersWithAccounts.length === 0) {
    log("Plaid auto-sync skipped — no users with a business bank account connected", "scheduler");
    return;
  }

  let synced = 0;
  let errors = 0;

  for (const user of usersWithAccounts) {
    try {
      const result = await syncPlaidTransactionsForUser(user.userId);
      if (result.ok && result.ready) {
        synced++;
        log(
          `Plaid auto-sync for user ${user.userId}: ${result.synced} transactions, ${result.matched} matched`,
          "scheduler"
        );
      } else if (!result.ready) {
        log(`Plaid auto-sync for user ${user.userId}: transactions not ready yet`, "scheduler");
      }
    } catch (err) {
      log(`Plaid auto-sync error for user ${user.userId}: ${err}`, "scheduler");
      errors++;
    }
  }

  log(
    `Plaid auto-sync complete — ${usersWithAccounts.length} accounts processed, ${synced} synced, ${errors} errors`,
    "scheduler"
  );
}
