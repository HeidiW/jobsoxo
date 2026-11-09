import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";

describe("dashboard week uses the viewer's calendar day", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });
  afterEach(() => { vi.useRealTimers(); });

  async function jobOn(start: string, end: string | null) {
    const client = await storage.createClient({ name: "Week Co" });
    return storage.createJob({
      clientId: client.id, title: `Job ${start}`, status: "scheduled",
      startDate: new Date(`${start}T00:00:00Z`), endDate: end ? new Date(`${end}T00:00:00Z`) : null,
    } as any);
  }

  it("builds Monday to Friday from ?today and marks that day", async () => {
    const job = await jobOn("2026-11-10", "2026-11-11");
    const { body } = await request(app).get("/api/dashboard?today=2026-11-09").expect(200);
    expect(body.week.map((day: any) => day.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(body.week.map((day: any) => day.dayNum)).toEqual([9, 10, 11, 12, 13]);
    expect(body.week.find((day: any) => day.isToday).date).toBe("2026-11-09");
    const daysWithJob = body.week.filter((day: any) => day.jobs.some((j: any) => j.jobId === job.id)).map((day: any) => day.date);
    expect(daysWithJob).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("stays on Monday at 9 pm New York even though it's already Tuesday in UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T02:00:00Z")); // Mon Nov 9, 9 pm EST
    const { body } = await request(app).get("/api/dashboard").expect(200); // no ?today: business day fallback
    expect(body.week.find((day: any) => day.isToday).date).toBe("2026-11-09");
  });

  it("falls back to the business day for a bad ?today and moves to the next week on Monday", async () => {
    const bad = (await request(app).get("/api/dashboard?today=not-a-date").expect(200)).body;
    expect(bad.week).toHaveLength(5);
    const next = (await request(app).get("/api/dashboard?today=2026-11-16").expect(200)).body;
    expect(next.week[0].date).toBe("2026-11-16");
  });

  it("counts an invoice due on the viewer's today as due today", async () => {
    const client = await storage.createClient({ name: "Due Co" });
    const invoice = await storage.createInvoice({
      clientId: client.id, invoiceNumber: `DUE-${Math.random().toString(36).slice(2, 7)}`, status: "sent",
      subtotal: "100", taxRate: "0", taxAmount: "0", total: "100", balance: "100", amountPaid: "0",
      issueDate: new Date("2026-11-01T00:00:00Z"), dueDate: new Date("2026-11-09T00:00:00Z"),
    });
    const today = (await request(app).get("/api/dashboard?today=2026-11-09").expect(200)).body;
    expect(today.needsAttention.find((item: any) => item.invoiceId === invoice.id)?.reason).toBe("due-today");
    const tomorrow = (await request(app).get("/api/dashboard?today=2026-11-10").expect(200)).body;
    expect(tomorrow.needsAttention.find((item: any) => item.invoiceId === invoice.id)).toBeUndefined();
  });
});
