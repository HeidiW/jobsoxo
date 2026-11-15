import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp, buildAdminTestApp } from "./test-helpers";
import { storage } from "./storage";

describe("Set up your business checklist", () => {
  let app: Express;
  let admin: Express;
  beforeAll(async () => { app = await buildTestApp(); admin = await buildAdminTestApp(); });

  it("derives each step from what exists and marks the whole thing complete only when all are done", async () => {
    const before = (await request(app).get("/api/setup/status").expect(200)).body;
    expect(before).toMatchObject({ dismissed: false, complete: false });
    expect(before.clients).toBeTypeOf("number");

    await storage.updateSettings({ companyName: "Conor Foy Plaster", companyEmail: "office@example.test" });
    const client = await storage.createClient({ name: "Setup Client", email: "setup@example.test" } as never);
    const job = await storage.createJob({ clientId: client.id, title: "Setup job", status: "quoted" } as never);
    const mid = (await request(app).get("/api/setup/status").expect(200)).body;
    expect(mid.companyDetails).toBe(true);
    expect(mid.clients).toBeGreaterThan(0);
    expect(mid.jobs).toBeGreaterThan(0);
    expect(mid.complete).toBe(mid.invoices > 0);

    await storage.createInvoice({ clientId: client.id, jobId: job.id, invoiceNumber: `SETUP-${Date.now()}`, status: "draft", issueDate: new Date(), dueDate: new Date(), subtotal: "0", taxRate: "0", taxAmount: "0", total: "0", amountPaid: "0", balance: "0" } as never);
    const after = (await request(app).get("/api/setup/status").expect(200)).body;
    expect(after.complete).toBe(true);
  });

  it("lets an admin hide the checklist for everyone, and nobody else", async () => {
    await request(app).post("/api/setup/dismiss").expect(403);
    const dismissed = (await request(admin).post("/api/setup/dismiss").expect(200)).body;
    expect(dismissed.dismissed).toBe(true);
    expect((await request(app).get("/api/setup/status")).body.dismissed).toBe(true);
  });
});
