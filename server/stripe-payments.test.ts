import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { db } from "./db";
import { payments, stripeEvents } from "@shared/schema";
import { applyStripeEvent, markStripeEvent, parseStripeEvent, recordStripeEvent, StripeWebhookError } from "./stripe-payments";
import { defaultPaymentInstructions, paymentInstructionsFor } from "@shared/payment-instructions";
import { howToPayHtml } from "./email";

const SECRET = "whsec_test_secret";

function sessionEvent(type: string, overrides: Record<string, unknown>) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, api_version: "2025-04-30.basil", created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 0, request: null,
    data: { object: { object: "checkout.session", id: "cs_test", mode: "payment", amount_total: 550000, currency: "usd", payment_method_types: ["us_bank_account", "card"], ...overrides } },
  } as never;
}

function sign(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

describe("payment instructions", () => {
  it("defaults to asking for a bank transfer and lets a business write its own", () => {
    expect(defaultPaymentInstructions("Conor Foy Painting")).toContain("Bank transfer (ACH) is preferred");
    expect(defaultPaymentInstructions("Conor Foy Painting")).toContain("Checks payable to Conor Foy Painting.");
    expect(paymentInstructionsFor({ paymentInstructions: "Zelle to 555-0100", companyName: "X" })).toBe("Zelle to 555-0100");
    expect(paymentInstructionsFor({ paymentInstructions: "  ", companyName: "X" })).toContain("Checks payable to X.");
  });

  it("renders the block with the pay link in emails", () => {
    const html = howToPayHtml({ companyName: "Conor Foy Painting" }, "https://app.example/pay/tok");
    expect(html).toContain("How to pay");
    expect(html).toContain('href="https://app.example/pay/tok"');
    expect(html).toContain("Bank transfer (ACH) is preferred");
    expect(howToPayHtml({ companyName: "X" })).not.toContain("href=");
  });
});

describe("Stripe webhook", () => {
  let app: Express;
  let invoiceId: string;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    const client = await storage.createClient({ name: "Ramp Contractors", email: "ap@example.test" } as never);
    const invoice = await storage.createInvoice({ clientId: client.id, invoiceNumber: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: "sent", issueDate: new Date(), dueDate: new Date(), subtotal: "5500", taxRate: "0", taxAmount: "0", total: "5500.00", amountPaid: "0", balance: "5500.00" } as never);
    invoiceId = invoice.id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("verifies Stripe's signature over the raw body", async () => {
    const payload = JSON.stringify(sessionEvent("checkout.session.completed", { payment_status: "paid", payment_intent: "pi_sig", metadata: { invoiceId } }));
    const event = await parseStripeEvent(Buffer.from(payload), sign(payload));
    expect(event.type).toBe("checkout.session.completed");
    await expect(parseStripeEvent(Buffer.from(payload), sign(payload, "whsec_other"))).rejects.toBeInstanceOf(StripeWebhookError);
    await expect(parseStripeEvent(Buffer.from(payload), undefined)).rejects.toBeInstanceOf(StripeWebhookError);
    await request(app).post("/api/webhooks/stripe").set("Content-Type", "application/json").send(payload).expect(400);
    await request(app).post("/api/webhooks/stripe").set("Content-Type", "application/json").set("stripe-signature", sign(payload)).send(payload).expect(200);
    expect((await storage.getInvoice(invoiceId))!.status).toBe("paid");
  });

  it("records a card payment at once and marks the invoice paid, only once per payment intent", async () => {
    const event = sessionEvent("checkout.session.completed", { payment_status: "paid", payment_intent: "pi_card_1", payment_method_types: ["card"], metadata: { invoiceId } });
    expect(await applyStripeEvent(event)).toMatchObject({ outcome: "recorded", invoiceId });
    expect(await applyStripeEvent(event)).toMatchObject({ outcome: "already recorded" });
    const invoice = (await storage.getInvoice(invoiceId))!;
    expect(invoice).toMatchObject({ status: "paid", amountPaid: "5500.00", balance: "0.00" });
    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentMethod: "credit_card", status: "succeeded", providerRef: "pi_card_1" });
  });

  it("holds an ACH payment as processing until Stripe says it settled, and keeps the invoice unpaid meanwhile", async () => {
    const started = sessionEvent("checkout.session.completed", { payment_status: "unpaid", payment_intent: "pi_ach_1", metadata: { invoiceId } });
    expect(await applyStripeEvent(started)).toMatchObject({ outcome: "processing" });
    let invoice = (await storage.getInvoice(invoiceId))!;
    expect(invoice).toMatchObject({ status: "sent", amountPaid: "0.00", balance: "5500.00" });
    const [pending] = await db.select().from(payments).where(eq(payments.providerRef, "pi_ach_1"));
    expect(pending).toMatchObject({ status: "processing", paymentMethod: "bank_transfer", amount: "5500.00" });

    const settled = sessionEvent("checkout.session.async_payment_succeeded", { payment_status: "paid", payment_intent: "pi_ach_1", metadata: { invoiceId } });
    expect(await applyStripeEvent(settled)).toMatchObject({ outcome: "recorded" });
    invoice = (await storage.getInvoice(invoiceId))!;
    expect(invoice).toMatchObject({ status: "paid", amountPaid: "5500.00", balance: "0.00" });
    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("succeeded");
  });

  it("marks a returned ACH payment failed without touching the invoice", async () => {
    await applyStripeEvent(sessionEvent("checkout.session.completed", { payment_status: "unpaid", payment_intent: "pi_ach_2", metadata: { invoiceId } }));
    expect(await applyStripeEvent(sessionEvent("checkout.session.async_payment_failed", { payment_status: "unpaid", payment_intent: "pi_ach_2", metadata: { invoiceId } }))).toMatchObject({ outcome: "failed" });
    const [row] = await db.select().from(payments).where(eq(payments.providerRef, "pi_ach_2"));
    expect(row.status).toBe("failed");
    expect((await storage.getInvoice(invoiceId))!).toMatchObject({ status: "sent", balance: "5500.00" });
  });

  it("stores every delivery by event id and treats a redelivery of a processed event as a no-op", async () => {
    const event = sessionEvent("checkout.session.completed", { payment_status: "paid", payment_intent: "pi_dup_1", payment_method_types: ["card"], metadata: { invoiceId } });
    const payload = JSON.stringify(event);
    const post = () => request(app).post("/api/webhooks/stripe").set("Content-Type", "application/json").set("stripe-signature", sign(payload)).send(payload);
    expect((await post().expect(200)).body).toEqual({ received: true });
    expect((await post().expect(200)).body).toEqual({ received: true, duplicate: true });
    const [stored] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, event.id));
    expect(stored).toMatchObject({ type: "checkout.session.completed", outcome: "recorded" });
    expect(stored.processedAt).not.toBeNull();
    expect((stored.payload as { id: string }).id).toBe(event.id);
    expect(await db.select().from(payments).where(eq(payments.invoiceId, invoiceId))).toHaveLength(1);
    expect((await storage.getInvoice(invoiceId))!).toMatchObject({ status: "paid", amountPaid: "5500.00" });
  });

  it("lets a redelivery retry an event whose processing failed", async () => {
    const event = sessionEvent("checkout.session.completed", { payment_status: "paid", payment_intent: "pi_retry_1", metadata: { invoiceId } });
    expect(await recordStripeEvent(event)).toBe("new");
    await markStripeEvent(event.id, { error: "database went away" });
    expect(await recordStripeEvent(event)).toBe("retry");
    await markStripeEvent(event.id, { outcome: "recorded" });
    expect(await recordStripeEvent(event)).toBe("duplicate");
    const [stored] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, event.id));
    expect(stored).toMatchObject({ outcome: "recorded", error: null });
  });

  it("ignores events it doesn't handle or can't tie to an invoice", async () => {
    expect(await applyStripeEvent({ type: "payment_intent.created", data: { object: {} } } as never)).toEqual({ handled: false });
    expect(await applyStripeEvent(sessionEvent("checkout.session.completed", { payment_status: "paid", payment_intent: "pi_x", metadata: {} }))).toMatchObject({ outcome: expect.stringContaining("ignored") });
  });
});
