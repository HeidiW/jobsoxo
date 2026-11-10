import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { buildReceiptSystemPrompt, isReceiptMediaType, receiptScanErrorMessage, ReceiptScanError } from "./receipt-scan";
import { reviewItemsFromScan, reviewTotal, totalMismatchNote, type ReceiptScan } from "@shared/receipt-scan";
import type { Settings } from "@shared/schema";
import { storage } from "./storage";

const mocks = vi.hoisted(() => ({ configured: true, scanReceipt: vi.fn() }));
vi.mock("./invoice-assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./invoice-assistant")>();
  return { ...actual, invoiceAssistantConfigured: () => mocks.configured };
});
vi.mock("./receipt-scan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./receipt-scan")>();
  return { ...actual, scanReceipt: mocks.scanReceipt };
});

const scan: ReceiptScan = {
  isReceipt: true,
  vendor: "Sherwin-Williams",
  purchaseDate: "2026-11-07",
  items: [
    { name: "ProMar 200 eggshell", description: "Extra white, 1 gal", quantity: 3, unit: "each", price: 134.97 },
    { name: "Painter's tape", description: null, quantity: 2, unit: "each", price: 13.5 },
    { name: "", description: null, quantity: 1, unit: "each", price: 5 },
    { name: "Mystery", description: null, quantity: 0, unit: "each", price: 5 },
    { name: "Refund", description: null, quantity: 1, unit: "each", price: -4 },
  ],
  tax: 9.65,
  total: 158.12,
  warnings: [],
};

describe("receipt review helpers", () => {
  it("turns scanned lines into editable strings and drops unusable ones", () => {
    const items = reviewItemsFromScan(scan);
    expect(items.map((item) => item.name)).toEqual(["ProMar 200 eggshell", "Painter's tape"]);
    expect(items[0]).toMatchObject({ include: true, quantity: "3", unit: "each", price: "134.97", description: "Extra white, 1 gal" });
    expect(items[1].description).toBe("");
    expect(reviewItemsFromScan({ ...scan, items: [{ name: "Caulk", description: null, quantity: 2.5, unit: "oz", price: 3 }] })[0].quantity).toBe("2.50");
  });

  it("sums only the kept items", () => {
    const items = reviewItemsFromScan(scan);
    expect(reviewTotal(items)).toBeCloseTo(148.47, 2);
    expect(reviewTotal([{ ...items[0], include: false }, items[1]])).toBeCloseTo(13.5, 2);
  });

  it("warns when the lines don't add up to the receipt total before tax", () => {
    const items = reviewItemsFromScan(scan);
    expect(totalMismatchNote(scan, items)).toBeNull();
    expect(totalMismatchNote(scan, items.slice(1))).toContain("add up to $13.50, but the receipt total before tax is $148.47");
    expect(totalMismatchNote({ total: null, tax: null }, items)).toBeNull();
  });
});

describe("receipt scanner", () => {
  it("accepts photos and PDFs only", () => {
    expect(isReceiptMediaType("image/jpeg")).toBe(true);
    expect(isReceiptMediaType("application/pdf")).toBe(true);
    expect(isReceiptMediaType("text/html")).toBe(false);
  });

  it("tells the model how to read a receipt and who the buyer is", () => {
    const prompt = buildReceiptSystemPrompt({ companyName: "Conor Foy Plaster" } as Settings);
    expect(prompt).toContain("Skip lines that are not goods");
    expect(prompt).toContain("never invent one");
    expect(prompt).toContain("The business is Conor Foy Plaster; it is the buyer");
    expect(buildReceiptSystemPrompt(undefined)).not.toContain("The business is");
  });

  it("explains failures in plain words", () => {
    expect(receiptScanErrorMessage(new ReceiptScanError("Custom"))).toBe("Custom");
    expect(receiptScanErrorMessage(new Error("boom"))).toBe("The receipt reader hit a problem. Try again.");
  });
});

describe("receipt routes", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(() => { mocks.configured = true; mocks.scanReceipt.mockReset(); });

  it("reports whether scanning is available", async () => {
    expect((await request(app).get("/api/materials/scan-receipt/status").expect(200)).body).toEqual({ available: true });
    mocks.configured = false;
    expect((await request(app).get("/api/materials/scan-receipt/status").expect(200)).body).toEqual({ available: false });
  });

  it("scans an uploaded photo and returns the proposal", async () => {
    mocks.scanReceipt.mockResolvedValue(scan);
    const res = await request(app).post("/api/materials/scan-receipt").attach("receipt", Buffer.from("fake-jpeg"), { filename: "receipt.jpg", contentType: "image/jpeg" }).expect(200);
    expect(res.body.vendor).toBe("Sherwin-Williams");
    expect(res.body.items).toHaveLength(5);
    expect(mocks.scanReceipt.mock.calls[0][0]).toMatchObject({ mediaType: "image/jpeg" });
  });

  it("rejects missing, wrong-type files and an unconfigured server", async () => {
    await request(app).post("/api/materials/scan-receipt").expect(400);
    await request(app).post("/api/materials/scan-receipt").attach("receipt", Buffer.from("x"), { filename: "notes.txt", contentType: "text/plain" }).expect(415);
    expect(mocks.scanReceipt).not.toHaveBeenCalled();
    mocks.configured = false;
    const res = await request(app).post("/api/materials/scan-receipt").attach("receipt", Buffer.from("x"), { filename: "r.jpg", contentType: "image/jpeg" }).expect(503);
    expect(res.body.error).toMatch(/isn't set up/);
  });

  it("passes reader failures on as a 502 with the plain explanation", async () => {
    mocks.scanReceipt.mockRejectedValue(new ReceiptScanError("The receipt reader returned something unexpected."));
    const res = await request(app).post("/api/materials/scan-receipt").attach("receipt", Buffer.from("x"), { filename: "r.png", contentType: "image/png" }).expect(502);
    expect(res.body.error).toContain("something unexpected");
  });

  it("saves a reviewed batch in one request and checks the job exists", async () => {
    const client = await storage.createClient({ name: "Receipt Client", email: "receipt@example.com" } as never);
    const job = await storage.createJob({ clientId: client.id, title: "Receipt job", status: "in_progress" } as never);
    const materials = [
      { jobId: job.id, name: "ProMar 200 eggshell", description: "1 gal", purchaseDate: "2026-11-07", vendor: "Sherwin-Williams", quantity: "3", unit: "each", price: "134.97" },
      { jobId: job.id, name: "Painter's tape", description: null, purchaseDate: "2026-11-07", vendor: "Sherwin-Williams", quantity: "2", unit: "each", price: "13.50" },
    ];
    const res = await request(app).post("/api/materials/bulk").send({ materials }).expect(201);
    expect(res.body).toHaveLength(2);
    expect(await storage.getJobMaterialTotal(job.id)).toBe("148.47");

    await request(app).post("/api/materials/bulk").send({ materials: [] }).expect(400);
    await request(app).post("/api/materials/bulk").send({ materials: [{ ...materials[0], jobId: "missing-job" }] }).expect(400);
    await request(app).post("/api/materials/bulk").send({ materials: [{ ...materials[0], quantity: "0" }] }).expect(400);
    expect(await storage.getJobMaterialTotal(job.id)).toBe("148.47");
  });
});
