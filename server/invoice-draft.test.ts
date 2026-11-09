import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";

describe("PUT /api/invoices/:id/draft (builder autosave)", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  async function draft() {
    const client = await storage.createClient({ name: "Draft Co", email: "draft@example.com", additionalEmails: ["ap@example.com"] });
    const res = await request(app).post("/api/invoices").send({
      clientId: client.id, dueDate: "2026-12-01", taxRate: "0",
      lineItems: [{ category: "labor", description: "First pass", quantity: 1, unit: "lump", rate: 100 }],
    }).expect(201);
    return { client, invoice: res.body };
  }

  it("replaces the draft's fields and line items and recalculates totals", async () => {
    const { client, invoice } = await draft();

    const res = await request(app).put(`/api/invoices/${invoice.id}/draft`).send({
      clientId: client.id, dueDate: "2026-12-15", taxRate: "10", notes: "Updated", recipientEmails: ["ap@example.com"],
      lineItems: [
        { category: "labor", description: "Walls", quantity: 2, unit: "hours", rate: 50, status: "completed" },
        { category: "materials", description: "Paint", quantity: 1, unit: "gallon", rate: 40 },
      ],
    }).expect(200);

    expect(res.body.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(res.body.lineItems.map((i: any) => [i.description, i.amount, i.status])).toEqual([["Walls", "100.00", "completed"], ["Paint", "40.00", "pending"]]);
    expect(res.body.subtotal).toBe("140.00");
    expect(res.body.taxAmount).toBe("14.00");
    expect(res.body.total).toBe("154.00");
    expect(res.body.notes).toBe("Updated");
    expect(res.body.recipientEmails).toEqual(["ap@example.com"]);
    expect(res.body.status).toBe("draft");
  });

  it("refuses once the invoice is no longer a draft", async () => {
    const { client, invoice } = await draft();
    await storage.updateInvoice(invoice.id, { status: "sent" });

    const res = await request(app).put(`/api/invoices/${invoice.id}/draft`).send({ clientId: client.id, dueDate: "2026-12-01", taxRate: "0", lineItems: [] }).expect(409);
    expect(res.body.error).toMatch(/Only unpaid drafts/);
    expect((await storage.getInvoice(invoice.id))?.total).toBe("100.00");
  });

  it("returns 404 for an unknown invoice and 400 for an invalid body", async () => {
    const { client, invoice } = await draft();
    await request(app).put("/api/invoices/does-not-exist/draft").send({ clientId: client.id, dueDate: "2026-12-01", taxRate: "0", lineItems: [] }).expect(404);
    await request(app).put(`/api/invoices/${invoice.id}/draft`).send({ dueDate: "not a date" }).expect(400);
  });
});
