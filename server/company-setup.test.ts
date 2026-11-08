import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildAdminTestApp } from "./test-helpers";
import { storage } from "./storage";
import { missingCompanyFields } from "@shared/company-setup";

const complete = {
  companyName: "Northstar Finish Co.",
  companyEmail: "office@example.test",
  companyPhone: "(212) 555-0100",
  companyAddress: "18 Orchard Street",
  taxRate: "0",
  invoicePrefix: "INV",
  invoiceTerms: "Due within 30 days.",
};

describe("missingCompanyFields", () => {
  it("lists blank and invalid required fields in display order", () => {
    expect(missingCompanyFields(complete)).toEqual([]);
    expect(missingCompanyFields({ ...complete, companyName: "  ", companyAddress: null, taxRate: "abc" }))
      .toEqual(["companyName", "companyAddress", "taxRate"]);
    expect(missingCompanyFields(undefined)).toHaveLength(7);
  });

  it("accepts a 0% tax rate but not one outside 0–100", () => {
    expect(missingCompanyFields({ ...complete, taxRate: 0 })).toEqual([]);
    expect(missingCompanyFields({ ...complete, taxRate: "101" })).toEqual(["taxRate"]);
    expect(missingCompanyFields({ ...complete, taxRate: "-1" })).toEqual(["taxRate"]);
  });
});

describe("PATCH /api/settings required fields", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildAdminTestApp();
  });

  it("rejects clearing a required field", async () => {
    await storage.updateSettings(complete);

    const res = await request(app).patch("/api/settings").send({ ...complete, companyName: "", invoiceTerms: "  " }).expect(400);

    expect(res.body.error).toBe("Company name, Invoice terms are required");
    expect(res.body.fields).toEqual(["companyName", "invoiceTerms"]);
    expect((await storage.getSettings())?.companyName).toBe("Northstar Finish Co.");
  });

  it("still allows partial saves that don't touch company fields", async () => {
    await storage.updateSettings(complete);

    await request(app).patch("/api/settings").send({ collectionsEnabled: false }).expect(200);

    expect((await storage.getSettings())?.collectionsEnabled).toBe(false);
  });

  it("saves a complete company", async () => {
    await request(app).patch("/api/settings").send({ ...complete, taxRate: 8.875 }).expect(200);
    expect(missingCompanyFields(await storage.getSettings())).toEqual([]);
  });
});
