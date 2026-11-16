import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { buildTestApp, buildAdminTestApp } from "./test-helpers";
import { storage } from "./storage";
import { db } from "./db";
import { paymentDiscrepancies, payments } from "@shared/schema";
import { reconcileWithStripe, type StripeSessionLister } from "./stripe-reconcile";

type Session = Stripe.Checkout.Session;

function session(id: string, invoiceId: string, overrides: Partial<Session> & { intentStatus?: string; intentId?: string } = {}): Session {
  const { intentStatus, intentId = `pi_${id}`, ...rest } = overrides;
  return {
    id, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid",
    amount_total: 550000, currency: "usd", payment_method_types: ["card"], metadata: { invoiceId },
    payment_intent: intentStatus ? ({ id: intentId, object: "payment_intent", status: intentStatus } as never) : intentId,
    ...rest,
  } as never;
}

/** A Stripe that answers list() from pages of sessions. */
function fakeStripe(pages: Session[][]): StripeSessionLister & { calls: Stripe.Checkout.SessionListParams[] } {
  const calls: Stripe.Checkout.SessionListParams[] = [];
  let next = 0;
  return {
    calls,
    checkout: { sessions: { list: async (params) => { calls.push(params); const data = pages[next] ?? []; next += 1; return { data, has_more: next < pages.length }; } } },
  };
}

describe("Stripe reconcile", () => {
  let app: Express;
  let invoiceId: string;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    const client = await storage.createClient({ name: "Ramp Contractors", email: "ap@example.test" } as never);
    const invoice = await storage.createInvoice({ clientId: client.id, invoiceNumber: `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: "sent", issueDate: new Date(), dueDate: new Date(), subtotal: "5500.00", taxRate: "0", taxAmount: "0", total: "5500.00", amountPaid: "0", balance: "5500.00" } as never);
    invoiceId = invoice.id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("records a payment the webhook never delivered, straight from Stripe's list", async () => {
    const stripe = fakeStripe([[session("cs_missed", invoiceId)]]);
    const summary = await reconcileWithStripe({ sinceDays: 30, now: new Date("2026-11-16T09:00:00Z") }, stripe);
    expect(summary).toMatchObject({ sessions: 1, applied: { recorded: 1 }, invoicesChecked: 1, mismatches: 0 });
    expect(stripe.calls[0]).toMatchObject({ limit: 100, expand: ["data.payment_intent"], created: { gte: Math.floor(new Date("2026-10-17T09:00:00Z").getTime() / 1000) } });
    expect((await storage.getInvoice(invoiceId))!).toMatchObject({ status: "paid", amountPaid: "5500.00", balance: "0.00" });
    // Running again changes nothing.
    expect(await reconcileWithStripe({ sinceDays: 30 }, fakeStripe([[session("cs_missed", invoiceId)]]))).toMatchObject({ applied: { "already recorded": 1 }, mismatches: 0 });
    expect(await db.select().from(payments).where(eq(payments.invoiceId, invoiceId))).toHaveLength(1);
  });

  it("follows a bank debit from processing to settled across runs, and marks a returned one failed", async () => {
    const clearing = session("cs_ach", invoiceId, { payment_status: "unpaid", payment_method_types: ["us_bank_account"], intentStatus: "processing" });
    expect(await reconcileWithStripe({}, fakeStripe([[clearing]]))).toMatchObject({ applied: { processing: 1 } });
    expect((await storage.getInvoice(invoiceId))!.status).toBe("sent");
    const settled = session("cs_ach", invoiceId, { payment_status: "paid", payment_method_types: ["us_bank_account"], intentStatus: "succeeded" });
    expect(await reconcileWithStripe({}, fakeStripe([[settled]]))).toMatchObject({ applied: { recorded: 1 }, mismatches: 0 });
    expect((await storage.getInvoice(invoiceId))!).toMatchObject({ status: "paid", balance: "0.00" });

    const other = await storage.createInvoice({ clientId: (await storage.getInvoice(invoiceId))!.clientId, invoiceNumber: `REC-F-${Date.now()}`, status: "sent", issueDate: new Date(), dueDate: new Date(), subtotal: "100.00", taxRate: "0", taxAmount: "0", total: "100.00", amountPaid: "0", balance: "100.00" } as never);
    await reconcileWithStripe({}, fakeStripe([[session("cs_ret", other.id, { payment_status: "unpaid", amount_total: 10000, intentStatus: "processing" })]]));
    await reconcileWithStripe({}, fakeStripe([[session("cs_ret", other.id, { payment_status: "unpaid", amount_total: 10000, intentStatus: "canceled" })]]));
    const [row] = await db.select().from(payments).where(eq(payments.providerRef, "pi_cs_ret"));
    expect(row.status).toBe("failed");
    expect((await storage.getInvoice(other.id))!).toMatchObject({ status: "sent", balance: "100.00" });
  });

  it("flags an invoice where the app and Stripe disagree, shows it on the dashboard, and clears it when they agree again", async () => {
    // The app believes a card payment succeeded; Stripe says that intent was cancelled.
    await db.insert(payments).values({ invoiceId, amount: "5500.00", paymentMethod: "credit_card", referenceNumber: "pi_cs_bad", providerRef: "pi_cs_bad", status: "succeeded", notes: "Paid online." });
    const summary = await reconcileWithStripe({}, fakeStripe([[session("cs_bad", invoiceId, { payment_status: "unpaid", intentStatus: "canceled" })]]));
    expect(summary).toMatchObject({ mismatches: 1, resolved: 0 });
    const [open] = await db.select().from(paymentDiscrepancies).where(eq(paymentDiscrepancies.invoiceId, invoiceId));
    expect(open).toMatchObject({ appPaid: "5500.00", stripePaid: "0.00", resolvedAt: null });
    expect(open.detail).toBe("Stripe shows $0.00 paid online; the app shows $5,500.00.");

    const dashboard = (await request(app).get("/api/dashboard").expect(200)).body;
    const item = dashboard.needsAttention.find((row: { invoiceId: string }) => row.invoiceId === invoiceId);
    expect(item).toMatchObject({ reason: "payment-mismatch", detail: open.detail, client: "Ramp Contractors" });
    expect(dashboard.needsAttention[0].invoiceId).toBe(invoiceId);

    // Stripe now agrees (the intent succeeded after all): the mismatch resolves.
    expect(await reconcileWithStripe({}, fakeStripe([[session("cs_bad", invoiceId, { intentStatus: "succeeded" })]]))).toMatchObject({ mismatches: 0, resolved: 1 });
    const [closed] = await db.select().from(paymentDiscrepancies).where(eq(paymentDiscrepancies.invoiceId, invoiceId));
    expect(closed.resolvedAt).not.toBeNull();
    expect((await request(app).get("/api/dashboard").expect(200)).body.needsAttention.some((row: { reason: string }) => row.reason === "payment-mismatch")).toBe(false);
  });

  it("pages through Stripe's list and skips sessions that aren't finished or aren't ours", async () => {
    const open = session("cs_open", invoiceId, { status: "open", payment_status: "unpaid" });
    const foreign = session("cs_foreign", "", { metadata: {} });
    const stripe = fakeStripe([[open, foreign], [session("cs_paid", invoiceId)]]);
    const summary = await reconcileWithStripe({}, stripe);
    expect(stripe.calls).toHaveLength(2);
    expect(stripe.calls[1]).toMatchObject({ starting_after: "cs_foreign" });
    expect(summary).toMatchObject({ sessions: 3, applied: { recorded: 1 }, invoicesChecked: 1, mismatches: 0 });
    expect((await storage.getInvoice(invoiceId))!.status).toBe("paid");
  });

  it("exposes the sweep to admins on demand, and to nobody else", async () => {
    await request(app).post("/api/payments/reconcile").expect(403);
    const admin = await buildAdminTestApp();
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await request(admin).post("/api/payments/reconcile").expect(503)).body.error).toContain("STRIPE_SECRET_KEY");
  });
});
