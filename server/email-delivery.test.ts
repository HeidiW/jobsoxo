import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { refreshDeliveries, verifyResendSignature } from "./email-delivery";
import { explainBounce, explainFailure, shouldAdvance } from "@shared/email-delivery";

const SECRET = "whsec_" + Buffer.from("test-signing-secret-for-jobsoxo").toString("base64");
const originalKey = process.env.RESEND_API_KEY;
const originalSecret = process.env.RESEND_WEBHOOK_SECRET;

function sign(body: string, id = "msg_1", timestamp = String(Math.floor(Date.now() / 1000))) {
  const key = Buffer.from(SECRET.slice(6), "base64");
  const signature = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
}

async function makeInvoice() {
  const client = await storage.createClient({ name: "Delivery Co", email: "ap@delivery.example" });
  const invoice = await storage.createInvoice({
    clientId: client.id, invoiceNumber: `D-${Math.random().toString(36).slice(2, 8)}`, status: "draft",
    subtotal: "100", taxRate: "0", taxAmount: "0", total: "100", balance: "100", amountPaid: "0",
    issueDate: new Date("2026-11-01T00:00:00Z"), dueDate: new Date("2026-12-01T00:00:00Z"),
  });
  return { client, invoice };
}

describe("delivery explanations", () => {
  it("turns bounce details into something a person can act on", () => {
    expect(explainBounce({ type: "Permanent", subType: "General", message: "550 5.1.1 The email account that you tried to reach does not exist." }))
      .toContain("doesn't exist");
    expect(explainBounce({ type: "Permanent", subType: "Suppressed", message: "on the suppression list" })).toContain("bounced before");
    expect(explainBounce({ type: "Permanent", subType: "General", message: "550 5.7.26 Unauthenticated email is not accepted (DMARC)" })).toContain("DNS record");
    expect(explainBounce({ message: "Something odd" })).toBe('The client\'s mail server rejected it: "Something odd"');
    expect(explainBounce(undefined)).toContain("Resend → Emails");
  });

  it("explains refusals from Resend", () => {
    expect(explainFailure("reached_daily_quota")).toContain("daily sending limit");
    expect(explainFailure("The jobsoxo.com domain is not verified. Please, add and verify your domain on https://resend.com/domains")).toContain("isn't verified");
    expect(explainFailure("You can only send testing emails to your own email address")).toContain("test mode");
    expect(explainFailure("API key is invalid")).toContain("API key");
    expect(explainFailure("weird")).toBe("Resend couldn't send it: weird");
  });

  it("never lets an earlier event overwrite a later one", () => {
    expect(shouldAdvance("sent", "delivered")).toBe(true);
    expect(shouldAdvance("delayed", "delivered")).toBe(true);
    expect(shouldAdvance("delivered", "sent")).toBe(false);
    expect(shouldAdvance("delivered", "delayed")).toBe(false);
    expect(shouldAdvance("delivered", "complained")).toBe(true);
    expect(shouldAdvance("bounced", "bounced")).toBe(false);
  });
});

describe("verifyResendSignature", () => {
  it("accepts a correctly signed body and rejects tampering, wrong secrets and stale timestamps", () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const headers = sign(body);
    const h = { id: headers["svix-id"], timestamp: headers["svix-timestamp"], signature: headers["svix-signature"] };
    expect(verifyResendSignature(Buffer.from(body), h, SECRET)).toBe(true);
    expect(verifyResendSignature(Buffer.from(body + " "), h, SECRET)).toBe(false);
    expect(verifyResendSignature(Buffer.from(body), h, "whsec_" + Buffer.from("other").toString("base64"))).toBe(false);
    expect(verifyResendSignature(Buffer.from(body), { ...h, signature: `v1,bogus ${h.signature}` }, SECRET)).toBe(true);
    const old = sign(body, "msg_1", String(Math.floor(Date.now() / 1000) - 3600));
    expect(verifyResendSignature(Buffer.from(body), { id: old["svix-id"], timestamp: old["svix-timestamp"], signature: old["svix-signature"] }, SECRET)).toBe(false);
  });
});

describe("invoice email delivery tracking", () => {
  let app: Express;
  let resendResponse: () => Response;
  let lookups: string[];

  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    lookups = [];
    resendResponse = () => Response.json({ id: "re_email_1" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "https://api.resend.com/emails") return resendResponse();
      if (url.startsWith("https://api.resend.com/emails/")) {
        lookups.push(url);
        return Response.json({ id: url.split("/").pop(), last_event: "bounced" });
      }
      return new Response("not found", { status: 404 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET; else process.env.RESEND_WEBHOOK_SECRET = originalSecret;
  });

  it("records a send, then shows the bounce and its reason from the webhook", async () => {
    const { invoice } = await makeInvoice();
    await request(app).post(`/api/invoices/${invoice.id}/send`).expect(200);
    let rows = (await request(app).get(`/api/invoices/${invoice.id}/deliveries`).expect(200)).body;
    // The status lookup ran (no webhook yet) and found a bounce without a reason.
    expect(lookups).toEqual(["https://api.resend.com/emails/re_email_1"]);
    expect(rows[0]).toMatchObject({ kind: "invoice", recipients: ["ap@delivery.example"], providerId: "re_email_1", status: "bounced" });

    const body = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "re_email_1", bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 user unknown" } },
    });
    expect(rows[0].detail).toContain("Resend → Emails");
    // The webhook then brings the server's reason, which replaces the generic one.
    await request(app).post("/api/webhooks/resend").set(sign(body)).set("Content-Type", "application/json").send(body).expect(200);
    rows = (await request(app).get(`/api/invoices/${invoice.id}/deliveries`).expect(200)).body;
    expect(rows[0]).toMatchObject({ status: "bounced", providerReason: "Permanent · General · 550 5.1.1 user unknown" });
    expect(rows[0].detail).toContain("doesn't exist");
  });

  it("fills in the bounce reason when the webhook arrives first", async () => {
    const { invoice } = await makeInvoice();
    await request(app).post(`/api/invoices/${invoice.id}/send`).expect(200);
    const body = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "re_email_1", bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 user unknown" } },
    });
    await request(app).post("/api/webhooks/resend").set(sign(body)).set("Content-Type", "application/json").send(body).expect(200);
    const rows = (await request(app).get(`/api/invoices/${invoice.id}/deliveries`).expect(200)).body;
    expect(lookups).toEqual([]); // final already, nothing to look up
    expect(rows[0]).toMatchObject({ status: "bounced", providerReason: "Permanent · General · 550 5.1.1 user unknown" });
    expect(rows[0].detail).toContain("doesn't exist");

    const list = (await request(app).get("/api/invoices").expect(200)).body;
    expect(list.find((row: any) => row.id === invoice.id).lastEmail).toMatchObject({ kind: "invoice", status: "bounced" });
  });

  it("records an immediate refusal with Resend's reason and doesn't mark the invoice sent", async () => {
    const { invoice } = await makeInvoice();
    resendResponse = () => Response.json({ statusCode: 403, name: "validation_error", message: "The jobsoxo.com domain is not verified." }, { status: 403 });
    const res = await request(app).post(`/api/invoices/${invoice.id}/send`).expect(502);
    expect(res.body.error).toContain("isn't verified");
    expect((await storage.getInvoice(invoice.id))?.status).toBe("draft");
    const rows = (await request(app).get(`/api/invoices/${invoice.id}/deliveries`).expect(200)).body;
    expect(rows[0]).toMatchObject({ status: "failed", providerId: null, providerReason: "The jobsoxo.com domain is not verified." });
  });

  it("rejects unsigned webhooks and ignores emails that aren't ours", async () => {
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "someone-else" } });
    await request(app).post("/api/webhooks/resend").set("Content-Type", "application/json").send(body).expect(401);
    await request(app).post("/api/webhooks/resend").set(sign(body)).set("Content-Type", "application/json").send(body).expect(200);
    delete process.env.RESEND_WEBHOOK_SECRET;
    await request(app).post("/api/webhooks/resend").set(sign(body)).set("Content-Type", "application/json").send(body).expect(503);
  });

  it("checks Resend at most every 20 seconds per email", async () => {
    const { invoice } = await makeInvoice();
    await request(app).post(`/api/invoices/${invoice.id}/send`).expect(200);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      lookups.push(url);
      return Response.json({ last_event: "sent" });
    }));
    const now = new Date();
    await refreshDeliveries(invoice.id, "re_test", now);
    await refreshDeliveries(invoice.id, "re_test", new Date(now.getTime() + 5_000));
    expect(lookups).toHaveLength(1);
    await refreshDeliveries(invoice.id, "re_test", new Date(now.getTime() + 25_000));
    expect(lookups).toHaveLength(2);
  });
});
