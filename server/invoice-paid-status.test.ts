import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import request from "supertest";
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { db } from "./db";
import { statusForBalance } from "./routes";

describe("statusForBalance", () => {
  it("is paid only when money has come in and covers the total", () => {
    expect(statusForBalance("sent", 0, 100)).toBe("paid");
    expect(statusForBalance("sent", 25, 75)).toBe("sent");
    expect(statusForBalance("paid", 25, 75)).toBe("partial");
    expect(statusForBalance("draft", 0, 0)).toBe("draft");
    expect(statusForBalance("sent", 0, 0)).toBe("sent");
    expect(statusForBalance("paid", 0, 0)).toBe("draft");
    expect(statusForBalance("partial", 50, 0)).toBe("draft");
  });
});

describe("invoice paid status", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });

  const zeroDraft = async () => {
    const client = await storage.createClient({ name: "Zero Co" });
    const res = await request(app).post("/api/invoices").send({
      clientId: client.id, dueDate: "2026-12-08", taxRate: "0", send: false,
      lineItems: [{ category: "labor", description: "Section placeholder", quantity: 1, unit: "lump", rate: 0 }],
    });
    return { client, res };
  };

  it("keeps a $0 draft as a draft through autosave, so it stays editable", async () => {
    const { client, res } = await zeroDraft();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    await request(app).put(`/api/invoices/${res.body.id}/draft`).send({
      clientId: client.id, dueDate: "2026-12-08", taxRate: "0",
      lineItems: [{ category: "labor", description: "Still empty", quantity: 1, unit: "lump", rate: 0 }],
    }).expect(200);
    expect((await storage.getInvoice(res.body.id))?.status).toBe("draft");
  });

  it("does not mark a priced invoice paid until a payment covers it", async () => {
    const client = await storage.createClient({ name: "Priced Co" });
    const created = await request(app).post("/api/invoices").send({
      clientId: client.id, dueDate: "2026-12-08", taxRate: "0",
      lineItems: [{ category: "labor", description: "Walls", quantity: 1, unit: "lump", rate: 200 }],
    }).expect(201);
    const id = created.body.id;
    await request(app).post(`/api/invoices/${id}/payments`).send({ invoiceId: id, amount: "50", paymentDate: "2026-11-09", paymentMethod: "cash" });
    const partial = await storage.getInvoice(id);
    expect(Number(partial?.amountPaid)).toBe(50);
    expect(partial?.status).toBe("partial");
    await request(app).post(`/api/invoices/${id}/payments`).send({ invoiceId: id, amount: "150", paymentDate: "2026-11-09", paymentMethod: "cash" });
    expect((await storage.getInvoice(id))?.status).toBe("paid");
  });

  it("repair migration un-pays invoices with no payments and leaves real ones alone", async () => {
    const client = await storage.createClient({ name: "Repair Co" });
    const bogus = await storage.createInvoice({ clientId: client.id, invoiceNumber: "R-1", dueDate: new Date("2026-12-08"), status: "paid", subtotal: "0", total: "0", balance: "0", amountPaid: "0" } as any);
    const real = await storage.createInvoice({ clientId: client.id, invoiceNumber: "R-2", dueDate: new Date("2026-12-08"), status: "paid", subtotal: "100", total: "100", balance: "0", amountPaid: "100" } as any);
    await db.execute(sql.raw(fs.readFileSync("migrations/0007_repair_unpaid_paid_invoices.sql", "utf8")));
    expect((await storage.getInvoice(bogus.id))?.status).toBe("draft");
    expect((await storage.getInvoice(real.id))?.status).toBe("paid");
  });
});
