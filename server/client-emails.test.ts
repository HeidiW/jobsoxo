import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { sendPaymentReminder } from "./email";
import { clientEmailOptions, dedupeEmails, invoiceRecipients } from "@shared/client-emails";

const originalKey = process.env.RESEND_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  vi.unstubAllGlobals();
});

/** Stubs Resend and returns the `to` list of each email sent. */
function captureResend() {
  const sent: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://api.resend.com/emails") sent.push(JSON.parse(String(init?.body)).to);
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  }));
  process.env.RESEND_API_KEY = "re_test";
  return sent;
}

async function makeInvoice(clientId: string, recipientEmails: string[] | null) {
  return storage.createInvoice({
    clientId, invoiceNumber: `INV-${Math.random().toString(36).slice(2, 8)}`, status: "sent",
    subtotal: "100", taxRate: "0", taxAmount: "0", total: "100", balance: "100", amountPaid: "0",
    issueDate: new Date("2026-10-01T00:00:00Z"), dueDate: new Date("2026-10-31T00:00:00Z"), recipientEmails,
  });
}

describe("client email helpers", () => {
  it("dedupes case-insensitively, keeping the first spelling", () => {
    expect(dedupeEmails([" AP@Co.com ", "ap@co.com", "", null, "pm@co.com"])).toEqual(["AP@Co.com", "pm@co.com"]);
  });

  it("lists the primary email first", () => {
    expect(clientEmailOptions({ email: "main@co.com", additionalEmails: ["ap@co.com", "MAIN@co.com"] })).toEqual(["main@co.com", "ap@co.com"]);
    expect(clientEmailOptions({ email: null, additionalEmails: ["ap@co.com"] })).toEqual(["ap@co.com"]);
  });

  it("uses the invoice's recipients, or the primary email for older invoices", () => {
    const client = { email: "main@co.com", additionalEmails: ["ap@co.com"] };
    expect(invoiceRecipients({ recipientEmails: ["ap@co.com"] }, client)).toEqual(["ap@co.com"]);
    expect(invoiceRecipients({ recipientEmails: null }, client)).toEqual(["main@co.com"]);
    expect(invoiceRecipients({ recipientEmails: [] }, { email: null })).toEqual([]);
  });
});

describe("client and invoice email routes", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  it("saves additional client emails, rejecting invalid ones and dropping duplicates", async () => {
    await request(app).post("/api/clients").send({ name: "Bad Co", additionalEmails: ["not-an-email"] }).expect(400);

    const res = await request(app).post("/api/clients")
      .send({ name: "Northline", email: "main@northline.test", additionalEmails: ["ap@northline.test", "AP@northline.test"] })
      .expect(201);
    expect(res.body.additionalEmails).toEqual(["ap@northline.test"]);
  });

  it("stores the chosen recipients on a new invoice", async () => {
    const client = await storage.createClient({ name: "Northline", email: "main@northline.test", additionalEmails: ["ap@northline.test"] });

    const res = await request(app).post("/api/invoices").send({
      clientId: client.id, dueDate: "2026-12-01", taxRate: "0", recipientEmails: ["main@northline.test", "ap@northline.test"],
      lineItems: [{ category: "labor", description: "Walls", quantity: 1, unit: "lump", rate: 100 }],
    }).expect(201);

    expect((await storage.getInvoice(res.body.id))?.recipientEmails).toEqual(["main@northline.test", "ap@northline.test"]);
  });

  it("sends the invoice and change orders to every recipient", async () => {
    const sent = captureResend();
    const client = await storage.createClient({ name: "Northline", email: "main@northline.test", additionalEmails: ["ap@northline.test"] });
    const invoice = await makeInvoice(client.id, ["main@northline.test", "ap@northline.test"]);

    await request(app).post(`/api/invoices/${invoice.id}/send`).expect(200);
    const co = await request(app).post(`/api/invoices/${invoice.id}/send-change-order`).expect(200);

    expect(sent).toEqual([["main@northline.test", "ap@northline.test"], ["main@northline.test", "ap@northline.test"]]);
    expect(co.body.sentTo).toEqual(["main@northline.test", "ap@northline.test"]);
  });

  it("keeps sending older invoices to the primary email", async () => {
    const sent = captureResend();
    const client = await storage.createClient({ name: "Legacy Co", email: "main@legacy.test", additionalEmails: ["ap@legacy.test"] });
    const invoice = await makeInvoice(client.id, null);

    await request(app).post(`/api/invoices/${invoice.id}/send`).expect(200);

    expect(sent).toEqual([["main@legacy.test"]]);
  });

  it("sends payment reminders to the invoice's recipients", async () => {
    const sent = captureResend();
    const client = await storage.createClient({ name: "Northline", email: "main@northline.test" });
    const invoice = await makeInvoice(client.id, ["ap@northline.test", "pm@northline.test"]);

    const result = await sendPaymentReminder(invoice.id, 1, { apiKey: "re_test", provider: "resend" });

    expect(result.success).toBe(true);
    expect(sent).toEqual([["ap@northline.test", "pm@northline.test"]]);
  });
});
