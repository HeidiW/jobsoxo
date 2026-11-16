// Online payments through Stripe Checkout. Clients reach it from the "Pay
// online" link on the invoice (a public, tokenized page; no sign-in). Bank
// transfer (ACH debit) is offered first because it costs a flat $5 instead of
// a card percentage; cards stay available. ACH clears days later, so the
// payment is recorded as "processing" when Checkout completes and counted
// toward the invoice only when Stripe's webhook says it settled.
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { invoices, payments, stripeEvents } from "@shared/schema";
import { statusForBalance } from "@shared/invoice-status";

export const STRIPE_API_VERSION = "2025-04-30.basil";

let client: Stripe | null = null;
/** Tests inject a fake client; production builds one from STRIPE_SECRET_KEY. */
export function setStripeClientForTests(fake: Stripe | null) { client = fake; }
export async function getStripe(): Promise<Stripe> {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  const StripeCtor = (await import("stripe")).default;
  client = new StripeCtor(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion });
  return client;
}

export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;
export const stripeWebhookConfigured = () => !!process.env.STRIPE_WEBHOOK_SECRET;

export interface CheckoutInvoice { id: string; invoiceNumber: string; balance: string }

export async function createCheckoutSession(invoice: CheckoutInvoice, payToken: string, companyName: string, baseUrl: string): Promise<string | null> {
  const stripe = await getStripe();
  const balanceCents = Math.round(Number(invoice.balance) * 100);
  const session = await stripe.checkout.sessions.create({
    // Bank first: it's the method we're asking clients to use.
    payment_method_types: ["us_bank_account", "card"],
    payment_method_options: {
      us_bank_account: { verification_method: "instant", financial_connections: { permissions: ["payment_method"] } },
    },
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: balanceCents,
        product_data: { name: `Invoice #${invoice.invoiceNumber}`, description: `Payment to ${companyName}` },
      },
    }],
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, payToken },
    payment_intent_data: { metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } },
    // The session id lets the pay page confirm the outcome with Stripe on
    // return, so the client sees the right status even if the webhook is late.
    success_url: `${baseUrl}/pay/${payToken}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/pay/${payToken}`,
  });
  return session.url;
}

export class StripeWebhookError extends Error {}

/** Verifies Stripe's signature and returns the event. */
export async function parseStripeEvent(rawBody: Buffer | string | undefined, signature: string | undefined): Promise<Stripe.Event> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new StripeWebhookError("STRIPE_WEBHOOK_SECRET is not configured");
  if (!rawBody || !signature) throw new StripeWebhookError("Missing body or signature");
  const stripe = await getStripe();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    throw new StripeWebhookError(error instanceof Error ? error.message : "Invalid signature");
  }
}

const methodLabel = (types: string[] | null | undefined) => (types?.includes("us_bank_account") ? "bank_transfer" : "credit_card");

export type CheckoutOutcome = "processing" | "paid" | "failed";

/** What a Checkout webhook event says happened. */
export function outcomeForEvent(event: Stripe.Event): CheckoutOutcome | null {
  const session = event.data.object as Stripe.Checkout.Session;
  switch (event.type) {
    case "checkout.session.completed": return session.payment_status === "paid" ? "paid" : "processing";
    case "checkout.session.async_payment_succeeded": return "paid";
    case "checkout.session.async_payment_failed": return "failed";
    default: return null;
  }
}

/**
 * What a Checkout session says happened, read straight from Stripe (the
 * reconcile and the pay page's return check use this). Needs the payment
 * intent expanded so a returned bank debit can be told from one still clearing.
 */
export function outcomeForSession(session: Stripe.Checkout.Session): CheckoutOutcome | null {
  if (session.status !== "complete") return null;
  if (session.payment_status === "paid") return "paid";
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  if (intent && (intent.status === "canceled" || intent.status === "requires_payment_method")) return "failed";
  return "processing";
}

/** Applies a webhook event to the invoice. Idempotent on the payment intent. */
export async function applyStripeEvent(event: Stripe.Event): Promise<{ handled: boolean; outcome?: string; invoiceId?: string }> {
  const outcome = outcomeForEvent(event);
  if (!outcome) return { handled: false };
  return applyCheckoutOutcome(event.data.object as Stripe.Checkout.Session, outcome);
}

/**
 * Records what Stripe says about a Checkout session. One payment row per
 * payment intent: "processing" while a bank debit clears, then "succeeded"
 * (which is when the invoice balance moves) or "failed". Replaying the same
 * outcome changes nothing, so webhooks, the return check and the nightly
 * reconcile can all call this without coordinating.
 */
export async function applyCheckoutOutcome(session: Stripe.Checkout.Session, outcome: CheckoutOutcome): Promise<{ handled: boolean; outcome?: string; invoiceId?: string }> {
  const invoiceId = session.metadata?.invoiceId;
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!invoiceId || !intentId) return { handled: true, outcome: "ignored: no invoice or payment intent" };
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return { handled: true, outcome: "ignored: invoice not found", invoiceId };

  const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
  const method = methodLabel(session.payment_method_types);

  if (outcome === "failed") {
    await db.update(payments).set({ status: "failed", notes: "Bank payment failed or was returned." })
      .where(and(eq(payments.providerRef, intentId), eq(payments.status, "processing")));
    return { handled: true, outcome: "failed", invoiceId };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(payments).where(eq(payments.providerRef, intentId));
    if (existing?.status === "succeeded") return { handled: true, outcome: "already recorded", invoiceId };
    if (outcome === "processing") {
      if (!existing) {
        await tx.insert(payments).values({ invoiceId, amount, paymentMethod: method, referenceNumber: intentId, providerRef: intentId, status: "processing", notes: "Bank transfer started online; clears in a few business days." });
      }
      return { handled: true, outcome: "processing", invoiceId };
    }
    if (existing) {
      await tx.update(payments).set({ status: "succeeded", paymentDate: new Date(), notes: "Paid online." }).where(eq(payments.id, existing.id));
    } else {
      await tx.insert(payments).values({ invoiceId, amount, paymentMethod: method, referenceNumber: intentId, providerRef: intentId, status: "succeeded", notes: "Paid online." });
    }
    const [current] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    const amountPaid = Number(current.amountPaid) + Number(amount);
    const balance = Number(current.total) - amountPaid;
    await tx.update(invoices).set({
      amountPaid: amountPaid.toFixed(2),
      balance: balance.toFixed(2),
      status: statusForBalance(current.status === "paid" ? "paid" : "partial", balance, amountPaid),
    }).where(eq(invoices.id, invoiceId));
    return { handled: true, outcome: "recorded", invoiceId };
  });
}

/**
 * Stores a webhook delivery before anything acts on it. Returns "new" for a
 * first delivery, "retry" for a redelivery whose earlier processing failed,
 * and "duplicate" for one already processed (nothing more to do).
 */
export async function recordStripeEvent(event: Stripe.Event): Promise<"new" | "retry" | "duplicate"> {
  const inserted = await db.insert(stripeEvents)
    .values({ id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
    .onConflictDoNothing().returning({ id: stripeEvents.id });
  if (inserted.length) return "new";
  const [row] = await db.select({ processedAt: stripeEvents.processedAt }).from(stripeEvents).where(eq(stripeEvents.id, event.id));
  return row?.processedAt ? "duplicate" : "retry";
}

export async function markStripeEvent(id: string, result: { outcome?: string; error?: string }) {
  await db.update(stripeEvents).set(result.error
    ? { error: result.error }
    : { processedAt: new Date(), outcome: result.outcome ?? null, error: null }).where(eq(stripeEvents.id, id));
}

/** A Checkout session straight from Stripe, with its payment intent, for the return check and the reconcile. */
export async function retrieveCheckoutSession(id: string): Promise<Stripe.Checkout.Session> {
  const stripe = await getStripe();
  return stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent"] });
}

/** Online payments still clearing for an invoice; shown as "processing" rather than counted as paid. */
export async function processingAmount(invoiceId: string): Promise<number> {
  const rows = await db.select({ amount: payments.amount }).from(payments).where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, "processing")));
  return rows.reduce((sum, row) => sum + Number(row.amount), 0);
}
