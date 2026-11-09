import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { lineItemProgress, lineItemProgressSummary } from "@shared/line-item-status";

describe("line item work status", () => {
  let app: Express;
  let invoiceId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  async function invoiceWithItem() {
    const client = await storage.createClient({ name: "Status Co", email: "status@example.com" });
    const res = await request(app).post("/api/invoices").send({
      clientId: client.id, dueDate: "2026-12-01", taxRate: "0",
      lineItems: [{ category: "labor", description: "Prep walls", quantity: 1, unit: "lump", rate: 100 }],
    }).expect(201);
    invoiceId = res.body.id;
    const detail = await request(app).get(`/api/invoices/${invoiceId}`).expect(200);
    return detail.body.lineItems[0];
  }

  it("starts every line item as pending", async () => {
    const item = await invoiceWithItem();
    expect(item.status).toBe("pending");
  });

  it("changes status by hand without touching the amounts", async () => {
    const item = await invoiceWithItem();

    const res = await request(app).patch(`/api/line-items/${item.id}`).send({ status: "in_progress" }).expect(200);
    expect(res.body).toMatchObject({ status: "in_progress", amount: item.amount, description: "Prep walls" });

    await request(app).patch(`/api/line-items/${item.id}`).send({ status: "completed" }).expect(200);
    const detail = await request(app).get(`/api/invoices/${invoiceId}`).expect(200);
    expect(detail.body.lineItems[0].status).toBe("completed");
    expect(detail.body.total).toBe("100.00");
  });

  it("rejects a status it doesn't know", async () => {
    const item = await invoiceWithItem();
    await request(app).patch(`/api/line-items/${item.id}`).send({ status: "done" }).expect(400);
    expect((await storage.getLineItem(item.id))?.status).toBe("pending");
  });
});

describe("lineItemProgress", () => {
  it("counts statuses, treating unknown as pending", () => {
    const items = [{ status: "completed" }, { status: "completed" }, { status: "in_progress" }, { status: null }, { status: "odd" }];
    expect(lineItemProgress(items)).toEqual({ pending: 2, in_progress: 1, completed: 2, total: 5 });
    expect(lineItemProgressSummary(items)).toBe("2 of 5 completed · 1 in progress");
    expect(lineItemProgressSummary([{ status: "completed" }])).toBe("1 of 1 completed");
    expect(lineItemProgressSummary([])).toBe("No line items");
  });
});
