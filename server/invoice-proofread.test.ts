import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { buildProofreadSystemPrompt, describeFields } from "./invoice-proofread";
import { applyIssue, tidyText, usableIssues, type ProofreadIssue } from "@shared/invoice-proofread";
import type { Settings } from "@shared/schema";

const mocks = vi.hoisted(() => ({ configured: true, proofreadFields: vi.fn() }));
vi.mock("./invoice-assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./invoice-assistant")>();
  return { ...actual, invoiceAssistantConfigured: () => mocks.configured };
});
vi.mock("./invoice-proofread", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./invoice-proofread")>();
  return { ...actual, proofreadFields: mocks.proofreadFields };
});

const fields = [
  { id: "item:1", label: "Line item", text: "Prep and paint kichen walls" },
  { id: "notes", label: "Notes", text: "thanks for your business" },
];

describe("tidyText", () => {
  it("fixes spacing, punctuation runs and the first letter without touching words", () => {
    expect(tidyText("  prep walls ,two coats   eggshell .")).toBe("Prep walls, two coats eggshell.");
    expect(tidyText("walls,ceiling;trim")).toBe("Walls, ceiling; trim");
    expect(tidyText("Done!!  Really??")).toBe("Done! Really?");
    expect(tidyText("Two coats.. then trim....")).toBe("Two coats. then trim...");
    expect(tidyText("Wait... what")).toBe("Wait... what");
    expect(tidyText("2.5 gal primer, $45.00 each")).toBe("2.5 gal primer, $45.00 each");
    expect(tidyText("")).toBe("");
  });
});

describe("usableIssues", () => {
  const issues: ProofreadIssue[] = [
    { fieldId: "item:1", kind: "spelling", original: "kichen", replacement: "kitchen", note: "Misspelled" },
    { fieldId: "item:1", kind: "spelling", original: "kichen", replacement: "Kitchen", note: "dup" },
    { fieldId: "item:1", kind: "spelling", original: "wals", replacement: "walls", note: "not in text" },
    { fieldId: "notes", kind: "capitalization", original: "thanks", replacement: "Thanks", note: "Starts a sentence" },
    { fieldId: "notes", kind: "punctuation", original: "business", replacement: "business", note: "no-op" },
    { fieldId: "missing", kind: "spelling", original: "x", replacement: "y", note: "unknown field" },
  ];

  it("drops issues that can't be applied, duplicates and kept words", () => {
    expect(usableIssues(issues, fields, []).map((issue) => issue.original)).toEqual(["kichen", "thanks"]);
    expect(usableIssues(issues, fields, ["Kichen"]).map((issue) => issue.original)).toEqual(["thanks"]);
  });

  it("applies a fix to the first occurrence only", () => {
    expect(applyIssue("Prep and paint kichen walls", issues[0])).toBe("Prep and paint kitchen walls");
    expect(applyIssue("a a", { ...issues[0], original: "a", replacement: "b" })).toBe("b a");
  });
});

describe("proofread prompt", () => {
  it("tells the model what not to flag and names the company", () => {
    const prompt = buildProofreadSystemPrompt({ companyName: "Conor Foy Plaster" } as Settings);
    expect(prompt).toContain("Do not report: trade terms");
    expect(prompt).toContain("The business is Conor Foy Plaster");
    expect(buildProofreadSystemPrompt(undefined)).not.toContain("The business is");
  });

  it("lays fields out with their ids and includes the keep list", () => {
    const text = describeFields(fields, ["Sherwin-Williams"]);
    expect(text).toContain('<field id="item:1" label="Line item">Prep and paint kichen walls</field>');
    expect(text).toContain('Keep list (never flag these): "Sherwin-Williams"');
    expect(describeFields(fields, [])).not.toContain("Keep list");
  });
});

describe("POST /api/invoices/proofread", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(() => { mocks.configured = true; mocks.proofreadFields.mockReset(); });

  it("returns the issues and passes the keep list and settings through", async () => {
    mocks.proofreadFields.mockResolvedValue([{ fieldId: "item:1", kind: "spelling", original: "kichen", replacement: "kitchen", note: "Misspelled" }]);
    const res = await request(app).post("/api/invoices/proofread").send({ fields, ignore: ["eggshell"] }).expect(200);
    expect(res.body.issues).toHaveLength(1);
    const [calledFields, calledIgnore, calledSettings] = mocks.proofreadFields.mock.calls[0];
    expect(calledFields).toEqual(fields);
    expect(calledIgnore).toEqual(["eggshell"]);
    expect(calledSettings === undefined || typeof calledSettings === "object").toBe(true);
  });

  it("is 503 without a key, 400 on a bad body and 502 when the model call fails", async () => {
    mocks.configured = false;
    await request(app).post("/api/invoices/proofread").send({ fields }).expect(503);
    mocks.configured = true;
    await request(app).post("/api/invoices/proofread").send({ fields: "nope" }).expect(400);
    mocks.proofreadFields.mockRejectedValue(new Error("down"));
    const res = await request(app).post("/api/invoices/proofread").send({ fields }).expect(502);
    expect(res.body.error).toContain("proofreader");
  });
});
