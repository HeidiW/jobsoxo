import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildAdminTestApp, buildTestApp } from "./test-helpers";
import { storage, formatInvoiceNumber } from "./storage";
import { businessDay } from "./business-time";

const year = businessDay().slice(0, 4);

describe("invoice numbering", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  it("formats as PREFIX-YYYY-NNNN with a four-digit sequence that grows if needed", () => {
    expect(formatInvoiceNumber("JBX", 2026, 1)).toBe("JBX-2026-0001");
    expect(formatInvoiceNumber("JBX", 2026, 450)).toBe("JBX-2026-0450");
    expect(formatInvoiceNumber("JBX", 2027, 12345)).toBe("JBX-2027-12345");
  });

  it("hands out consecutive numbers for the current year and never reuses one", async () => {
    await storage.updateSettings({ invoicePrefix: "JBX" });
    const client = await storage.createClient({ name: "Numbering Co" });
    const create = () => request(app).post("/api/invoices").send({
      clientId: client.id, dueDate: "2026-12-01", taxRate: "0",
      lineItems: [{ category: "labor", description: "Work", quantity: 1, unit: "lump", rate: 100 }],
    }).expect(201);

    const first = (await create()).body;
    const second = (await create()).body;
    expect(first.invoiceNumber).toBe(`JBX-${year}-0001`);
    expect(second.invoiceNumber).toBe(`JBX-${year}-0002`);

    await request(app).delete(`/api/invoices/${second.id}`).expect(204);
    expect((await create()).body.invoiceNumber).toBe(`JBX-${year}-0003`);
  });

  it("continues the sequence when the prefix changes", async () => {
    await storage.updateSettings({ invoicePrefix: "INV" });
    expect(await storage.getNextInvoiceNumber()).toBe(`INV-${year}-0001`);
    await storage.updateSettings({ invoicePrefix: "JBX" });
    expect(await storage.getNextInvoiceNumber()).toBe(`JBX-${year}-0002`);
  });

  it("treats the 'start numbering at' setting as a floor, not a reset", async () => {
    await storage.updateSettings({ invoicePrefix: "JBX", invoiceNextNumber: 450 });
    expect(await storage.getNextInvoiceNumber()).toBe(`JBX-${year}-0450`);
    expect(await storage.getNextInvoiceNumber()).toBe(`JBX-${year}-0451`);

    // Lowering the floor below the counter changes nothing.
    await storage.updateSettings({ invoiceNextNumber: 10 });
    expect(await storage.getNextInvoiceNumber()).toBe(`JBX-${year}-0452`);
  });

  it("can preview the next number without taking it", async () => {
    await storage.updateSettings({ invoicePrefix: "JBX", invoiceNextNumber: null });
    expect(await storage.peekNextInvoiceNumber()).toBe(`JBX-${year}-0001`);
    expect(await storage.peekNextInvoiceNumber()).toBe(`JBX-${year}-0001`);
    expect(await storage.getNextInvoiceNumber()).toBe(`JBX-${year}-0001`);
    expect(await storage.peekNextInvoiceNumber()).toBe(`JBX-${year}-0002`);

    const settings = await request(app).get("/api/settings").expect(200);
    expect(settings.body.nextInvoiceNumber).toBe(`JBX-${year}-0002`);
  });

  it("rejects a non-positive starting number", async () => {
    const admin = await buildAdminTestApp();
    await request(admin).patch("/api/settings").send({ invoiceNextNumber: 0 }).expect(400);
    await request(admin).patch("/api/settings").send({ invoiceNextNumber: 450 }).expect(200);
    expect((await storage.getSettings())?.invoiceNextNumber).toBe(450);
  });

  it("derives the prefix from the company name unless one was hand-chosen", async () => {
    const admin = await buildAdminTestApp();
    await storage.updateSettings({ invoicePrefix: "INV", companyName: null });

    await request(admin).patch("/api/settings").send({ companyName: "Conor Foy Plaster", invoicePrefix: "INV" }).expect(200);
    expect((await storage.getSettings())?.invoicePrefix).toBe("CFP");

    await request(admin).patch("/api/settings").send({ companyName: "Conor Foy Plaster & Paint", invoicePrefix: "CFP" }).expect(200);
    expect((await storage.getSettings())?.invoicePrefix).toBe("CFPP");

    await request(admin).patch("/api/settings").send({ companyName: "Another Name", invoicePrefix: "JBX" }).expect(200);
    expect((await storage.getSettings())?.invoicePrefix).toBe("JBX");
  });
});
