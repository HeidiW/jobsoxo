// Catch-up from Stripe's ledger. Webhooks are the fast path; this is the
// path that makes them optional. It lists every Checkout session Stripe has
// for the account in the window (not just the ones the app remembers), applies
// each one through the same state transitions the webhook uses, and then
// checks the invariant that matters: for each invoice, what Stripe has
// settled equals what the app has recorded as paid online. A difference is
// written to payment_discrepancies and shown on the dashboard until it clears.
import type Stripe from "stripe";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { paymentDiscrepancies, payments } from "@shared/schema";
import { applyCheckoutOutcome, getStripe, outcomeForSession } from "./stripe-payments";
import { log } from "./logger";

/** The slice of the Stripe client the reconcile needs; tests pass a fake. */
export interface StripeSessionLister {
  checkout: { sessions: { list(params: Stripe.Checkout.SessionListParams): Promise<{ data: Stripe.Checkout.Session[]; has_more: boolean }> } };
}

export interface ReconcileSummary {
  sessions: number;
  applied: Record<string, number>;
  invoicesChecked: number;
  mismatches: number;
  resolved: number;
}

const money = (cents: number | null | undefined) => Math.round(cents ?? 0) / 100;
const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function reconcileWithStripe(
  options: { sinceDays?: number; now?: Date } = {},
  stripe?: StripeSessionLister,
): Promise<ReconcileSummary> {
  const client = stripe ?? (await getStripe());
  const now = options.now ?? new Date();
  const since = Math.floor((now.getTime() - (options.sinceDays ?? 90) * 86_400_000) / 1000);
  const summary: ReconcileSummary = { sessions: 0, applied: {}, invoicesChecked: 0, mismatches: 0, resolved: 0 };

  // Stripe's view: what has settled, per invoice.
  const stripePaid = new Map<string, number>();
  let startingAfter: string | undefined;
  for (;;) {
    const page = await client.checkout.sessions.list({ created: { gte: since }, limit: 100, expand: ["data.payment_intent"], ...(startingAfter ? { starting_after: startingAfter } : {}) });
    for (const session of page.data) {
      summary.sessions += 1;
      const invoiceId = session.metadata?.invoiceId;
      if (!invoiceId) continue;
      if (!stripePaid.has(invoiceId)) stripePaid.set(invoiceId, 0);
      const outcome = outcomeForSession(session);
      if (!outcome) continue;
      const result = await applyCheckoutOutcome(session, outcome);
      const key = result.outcome ?? "ignored";
      summary.applied[key] = (summary.applied[key] ?? 0) + 1;
      if (outcome === "paid") stripePaid.set(invoiceId, stripePaid.get(invoiceId)! + money(session.amount_total));
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  // The app's view: succeeded payments that came through Stripe (they carry a provider ref).
  const invoiceIds = [...stripePaid.keys()];
  summary.invoicesChecked = invoiceIds.length;
  if (invoiceIds.length === 0) return summary;
  const appRows = await db
    .select({ invoiceId: payments.invoiceId, paid: sql<string>`COALESCE(SUM(${payments.amount}), 0)` })
    .from(payments)
    .where(and(inArray(payments.invoiceId, invoiceIds), eq(payments.status, "succeeded"), isNotNull(payments.providerRef)))
    .groupBy(payments.invoiceId);
  const appPaid = new Map(appRows.map((row) => [row.invoiceId, Number(row.paid)]));

  for (const invoiceId of invoiceIds) {
    const stripeAmount = stripePaid.get(invoiceId)!;
    const appAmount = appPaid.get(invoiceId) ?? 0;
    if (Math.abs(stripeAmount - appAmount) < 0.005) {
      const cleared = await db.update(paymentDiscrepancies).set({ resolvedAt: now })
        .where(and(eq(paymentDiscrepancies.invoiceId, invoiceId), isNull(paymentDiscrepancies.resolvedAt))).returning({ id: paymentDiscrepancies.id });
      summary.resolved += cleared.length;
      continue;
    }
    summary.mismatches += 1;
    const detail = `Stripe shows ${fmt(stripeAmount)} paid online; the app shows ${fmt(appAmount)}.`;
    await db.insert(paymentDiscrepancies)
      .values({ invoiceId, appPaid: appAmount.toFixed(2), stripePaid: stripeAmount.toFixed(2), detail, detectedAt: now, resolvedAt: null })
      .onConflictDoUpdate({ target: paymentDiscrepancies.invoiceId, set: { appPaid: appAmount.toFixed(2), stripePaid: stripeAmount.toFixed(2), detail, detectedAt: now, resolvedAt: null } });
    log(`Payment mismatch on invoice ${invoiceId}: ${detail}`, "stripe");
  }
  return summary;
}

/** Open mismatches, for the dashboard. */
export async function openPaymentDiscrepancies() {
  return db.select().from(paymentDiscrepancies).where(isNull(paymentDiscrepancies.resolvedAt));
}
