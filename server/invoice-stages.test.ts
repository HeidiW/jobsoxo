import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { contractFromLineItems, stageDueAmount, stageLineDescription, stageProblem } from "@shared/invoice-stages";
import { stagedContextHtml } from "./email";

describe("stage helpers", () => {
  const scope = contractFromLineItems([
    { section: "Walls and Stairway", description: "Protect, prep, prime and paint", amount: "5200" },
    { section: "Skim and Paint", description: "Levelling skim and Super Flat finish", amount: "6000.00" },
  ]);

  it("sums the job's scope into the contract", () => {
    expect(scope.total).toBe(11200);
    expect(scope.scope[1]).toEqual({ section: "Skim and Paint", description: "Levelling skim and Super Flat finish", amount: 6000 });
  });

  it("bills a deposit by amount or percent, never more than what's left, and the final bills the rest", () => {
    expect(stageDueAmount("deposit", { type: "amount", value: 5500 }, 11200, 0)).toBe(5500);
    expect(stageDueAmount("deposit", { type: "percent", value: 50 }, 11200, 0)).toBe(5600);
    expect(stageDueAmount("progress", { type: "amount", value: 9000 }, 11200, 5500)).toBe(5700);
    expect(stageDueAmount("final", null, 11200, 5500)).toBe(5700);
    expect(stageDueAmount("final", null, 11200, 11200)).toBe(0);
    expect(stageDueAmount("standalone", null, 11200, 0)).toBe(0);
  });

  it("words the billable line the way it prints", () => {
    expect(stageLineDescription("deposit", { type: "amount", value: 5500 }, 11200)).toBe("Deposit on $11,200.00 contract");
    expect(stageLineDescription("deposit", { type: "percent", value: 50 }, 11200)).toBe("Deposit (50% of $11,200.00 contract)");
    expect(stageLineDescription("final", null, 11200)).toBe("Final balance on $11,200.00 contract");
  });

  it("explains what's wrong before a staged invoice is created", () => {
    expect(stageProblem("deposit", { type: "amount", value: 5500 }, 0, 0)).toContain("no priced line items");
    expect(stageProblem("deposit", { type: "amount", value: 0 }, 11200, 0)).toContain("Enter the deposit");
    expect(stageProblem("deposit", { type: "amount", value: 12000 }, 11200, 0)).toContain("more than the $11,200.00 left");
    expect(stageProblem("final", null, 11200, 11200)).toContain("already been invoiced");
    expect(stageProblem("final", null, 11200, 5500)).toBeNull();
    expect(stageProblem("standalone", null, 0, 0)).toBeNull();
  });

  it("adds the contract context to the invoice email only for staged invoices", () => {
    expect(stagedContextHtml({ stage: "standalone" })).toBe("");
    const html = stagedContextHtml({ stage: "final", contractTotal: "11200.00", previouslyInvoiced: "5500.00", previouslyPaid: "5500.00" });
    expect(html).toContain("Final invoice</strong> on a $11,200.00 contract");
    expect(html).toContain("Paid to date:</strong> $5,500.00");
  });
});

describe("staged invoices", () => {
  let app: Express;
  let clientId: string;
  let jobId: string;
  beforeAll(async () => {
    app = await buildTestApp();
    const client = await storage.createClient({ name: "Ramp Contractors", email: "ted@example.test" } as never);
    clientId = client.id;
    const job = await storage.createJob({ clientId, title: "33 Covert Street", status: "scheduled" } as never);
    jobId = job.id;
    await storage.createLineItem({ jobId, category: "labor", description: "Walls and Stairway: protect, prep, prime and paint", quantity: "1", unit: "lump", rate: "5200", amount: "5200", section: "Walls and Stairway" } as never);
    await storage.createLineItem({ jobId, category: "labor", description: "Skim and Paint: levelling skim and Super Flat finish", quantity: "1", unit: "lump", rate: "6000", amount: "6000", section: "Skim and Paint" } as never);
  });

  const base = () => ({ clientId, jobId, taxRate: "0", dueDate: "2026-12-02", notes: "", termsAndConditions: "", recipientEmails: [], lineItems: [] });

  it("reports the job's contract and what's been billed", async () => {
    const billing = (await request(app).get(`/api/jobs/${jobId}/billing`).expect(200)).body;
    expect(billing).toMatchObject({ contractTotal: 11200, invoicedToDate: 0, paidToDate: 0, remaining: 11200 });
    expect(billing.scope).toHaveLength(2);
    await request(app).get("/api/jobs/missing/billing").expect(404);
  });

  it("creates a deposit from the contract, then a final for the remainder, refusing to over-bill", async () => {
    const deposit = (await request(app).post("/api/invoices").send({ ...base(), stage: "deposit", stageBasis: { type: "amount", value: 5500 },
      // Whatever the browser sends as lines is ignored for a staged invoice.
      lineItems: [{ category: "labor", description: "Made up", quantity: 1, unit: "lump", rate: 999 }] }).expect(201)).body;
    expect(deposit).toMatchObject({ stage: "deposit", stageBasis: { type: "amount", value: 5500 }, contractTotal: "11200.00", previouslyInvoiced: "0.00", total: "5500.00", balance: "5500.00" });
    expect(deposit.contractScope).toHaveLength(2);
    const depositDetail = (await request(app).get(`/api/invoices/${deposit.id}`).expect(200)).body;
    expect(depositDetail.lineItems).toHaveLength(1);
    expect(depositDetail.lineItems[0]).toMatchObject({ description: "Deposit on $11,200.00 contract", amount: "5500.00", unit: "lump" });

    // Drafts don't count as billed; once sent they do.
    expect((await request(app).get(`/api/jobs/${jobId}/billing`)).body.invoicedToDate).toBe(0);
    await storage.updateInvoice(deposit.id, { status: "sent" });
    await storage.updateInvoice(deposit.id, { amountPaid: "5500.00", balance: "0.00", status: "paid" });
    const billing = (await request(app).get(`/api/jobs/${jobId}/billing`)).body;
    expect(billing).toMatchObject({ invoicedToDate: 5500, paidToDate: 5500, remaining: 5700 });

    const tooMuch = await request(app).post("/api/invoices").send({ ...base(), stage: "deposit", stageBasis: { type: "amount", value: 6000 } }).expect(201);
    // A stage never bills past what's left on the contract.
    expect(tooMuch.body.total).toBe("5700.00");
    await storage.updateInvoice(tooMuch.body.id, { status: "sent" });

    const nothingLeft = await request(app).post("/api/invoices").send({ ...base(), stage: "final" }).expect(400);
    expect(nothingLeft.body.error).toContain("already been invoiced");
  });

  it("bills the final balance after a sent deposit and snapshots what was paid", async () => {
    const client = await storage.createClient({ name: "Second Client", email: "second@example.test" } as never);
    const job = await storage.createJob({ clientId: client.id, title: "Second job", status: "scheduled" } as never);
    await storage.createLineItem({ jobId: job.id, category: "labor", description: "Ceilings", quantity: "1", unit: "lump", rate: "4000", amount: "4000" } as never);
    const payload = { ...base(), clientId: client.id, jobId: job.id };
    const deposit = (await request(app).post("/api/invoices").send({ ...payload, stage: "deposit", stageBasis: { type: "percent", value: 25 } }).expect(201)).body;
    expect(deposit.total).toBe("1000.00");
    await storage.updateInvoice(deposit.id, { status: "partial", amountPaid: "600.00", balance: "400.00" });
    const final = (await request(app).post("/api/invoices").send({ ...payload, stage: "final" }).expect(201)).body;
    expect(final).toMatchObject({ stage: "final", stageBasis: null, contractTotal: "4000.00", previouslyInvoiced: "1000.00", previouslyPaid: "600.00", total: "3000.00" });
  });

  it("needs a job with a priced scope, and leaves standard invoices exactly as before", async () => {
    const noJob = await request(app).post("/api/invoices").send({ ...base(), jobId: null, stage: "deposit", stageBasis: { type: "amount", value: 100 } }).expect(400);
    expect(noJob.body.error).toContain("Choose the job");
    const emptyJob = await storage.createJob({ clientId, title: "Unpriced job", status: "quoted" } as never);
    const unpriced = await request(app).post("/api/invoices").send({ ...base(), jobId: emptyJob.id, stage: "deposit", stageBasis: { type: "amount", value: 100 } }).expect(400);
    expect(unpriced.body.error).toContain("no priced line items");

    const plain = (await request(app).post("/api/invoices").send({ ...base(), jobId: emptyJob.id, lineItems: [{ category: "labor", description: "Touch-ups", quantity: 2, unit: "hours", rate: 50 }] }).expect(201)).body;
    expect(plain).toMatchObject({ stage: "standalone", stageBasis: null, contractScope: null, contractTotal: null, total: "100.00" });
  });

  it("re-snapshots a staged draft when it's saved again", async () => {
    const client = await storage.createClient({ name: "Draft Client", email: "draft@example.test" } as never);
    const job = await storage.createJob({ clientId: client.id, title: "Draft job", status: "scheduled" } as never);
    await storage.createLineItem({ jobId: job.id, category: "labor", description: "Trim", quantity: "1", unit: "lump", rate: "2000", amount: "2000" } as never);
    const payload = { ...base(), clientId: client.id, jobId: job.id };
    const draft = (await request(app).post("/api/invoices").send({ ...payload, stage: "deposit", stageBasis: { type: "percent", value: 10 } }).expect(201)).body;
    expect(draft.total).toBe("200.00");
    const saved = (await request(app).put(`/api/invoices/${draft.id}/draft`).send({ ...payload, stage: "deposit", stageBasis: { type: "percent", value: 50 } }).expect(200)).body;
    expect(saved.total).toBe("1000.00");
    expect(saved.lineItems).toHaveLength(1);
    expect(saved.lineItems[0].description).toBe("Deposit (50% of $2,000.00 contract)");
    const back = (await request(app).put(`/api/invoices/${draft.id}/draft`).send({ ...payload, stage: "standalone", lineItems: [{ category: "labor", description: "Trim only", quantity: 1, unit: "lump", rate: 300 }] }).expect(200)).body;
    expect(back).toMatchObject({ stage: "standalone", contractTotal: null, total: "300.00" });
  });
});
