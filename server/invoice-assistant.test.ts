import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { buildMessages, buildSystemPrompt, describeInvoice } from "./invoice-assistant";
import type { Settings } from "@shared/schema";

const mocks = vi.hoisted(() => ({
  configured: true,
  runAssistantTurn: vi.fn(),
}));
vi.mock("./invoice-assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./invoice-assistant")>();
  return {
    ...actual,
    invoiceAssistantConfigured: () => mocks.configured,
    runAssistantTurn: mocks.runAssistantTurn,
  };
});

const invoice = {
  invoiceNumber: "CFP-2026-0003", clientName: "Maple Street Homes", jobName: "Unit 4 repaint",
  issueDate: "2026-11-08", dueDate: "2026-12-08", taxRate: "0", notes: "", termsAndConditions: "Net 30",
  lineItems: [
    { section: "Kitchen", category: "labor", description: "Prep and two coats", quantity: 1, unit: "lump", rate: 850, amount: 850, status: "completed" },
    { section: null, category: "materials", description: "Paint", quantity: 4, unit: "each", rate: 45, amount: 180, status: "pending" },
  ],
};

// supertest doesn't parse text/event-stream; collect the raw body.
const collect = (res: any, callback: (err: null, body: string) => void) => {
  let data = "";
  res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
  res.on("end", () => callback(null, data));
};

describe("invoiceAssistantConfigured", () => {
  it("accepts an API key, an auth token, or a complete OIDC federation setup", async () => {
    const { invoiceAssistantConfigured } = await vi.importActual<typeof import("./invoice-assistant")>("./invoice-assistant");
    expect(invoiceAssistantConfigured({})).toBe(false);
    expect(invoiceAssistantConfigured({ ANTHROPIC_API_KEY: "k" })).toBe(true);
    expect(invoiceAssistantConfigured({ ANTHROPIC_AUTH_TOKEN: "t" })).toBe(true);
    const federation = { ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1", ANTHROPIC_ORGANIZATION_ID: "org_1" };
    expect(invoiceAssistantConfigured(federation)).toBe(false);
    expect(invoiceAssistantConfigured({ ...federation, ANTHROPIC_IDENTITY_TOKEN_FILE: "/var/run/token" })).toBe(true);
    expect(invoiceAssistantConfigured({ ...federation, ANTHROPIC_IDENTITY_TOKEN: "jwt" })).toBe(true);
    expect(invoiceAssistantConfigured({ ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1", ANTHROPIC_IDENTITY_TOKEN: "jwt" })).toBe(false);
  });
});

describe("invoice assistant prompt", () => {
  it("names the company and its usual terms in the system prompt", () => {
    const prompt = buildSystemPrompt({ companyName: "Conor Foy Plaster", invoiceTerms: "Due on receipt" } as Settings);
    expect(prompt).toContain("helping Conor Foy Plaster");
    expect(prompt).toContain("usual payment terms: Due on receipt");
    expect(buildSystemPrompt(undefined)).toContain("this painting and decorating business");
  });

  it("describes the live invoice with sections, amounts and statuses", () => {
    const text = describeInvoice(invoice);
    expect(text).toContain("Client: Maple Street Homes");
    expect(text).toContain("1. [Kitchen] Prep and two coats — 1 lump × $850.00 = $850.00 (labor, completed)");
    expect(text).toContain("2. [General] Paint — 4 each × $45.00 = $180.00 (materials, pending)");
    expect(text).toContain("subtotal $1030.00");
    expect(describeInvoice({ ...invoice, lineItems: [] })).toContain("(no line items yet)");
    expect(text).toContain("Scope of work: (none)");
  });

  it("attaches the invoice to the last user message and keeps tool results", () => {
    const messages = buildMessages([
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      { role: "assistant", content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "tu_1", name: "propose_invoice_changes", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "The person applied this proposal to the invoice." }, { type: "text", text: "Thanks" }] },
    ], invoice);
    expect(messages).toHaveLength(3);
    const last = messages[2].content as Array<{ type: string; text?: string }>;
    expect(last[0].type).toBe("tool_result");
    expect(last[1]).toEqual({ type: "text", text: "Thanks" });
    expect(last[2].text).toContain("<current_invoice>");
    expect(last[2].text).toContain("Client: Maple Street Homes");
    // Earlier turns are untouched.
    expect(messages[0].content).toEqual([{ type: "text", text: "Hi" }]);
    expect(() => buildMessages([{ role: "user", content: [{ type: "text", text: "Hi" }] }, { role: "assistant", content: [{ type: "text", text: "Yo" }] }], invoice)).toThrow(/end with the person's message/);
  });
});

describe("POST /api/invoices/assistant", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });
  beforeEach(() => { mocks.configured = true; mocks.runAssistantTurn.mockReset(); });

  it("reports whether the assistant is set up", async () => {
    expect((await request(app).get("/api/invoices/assistant/status").expect(200)).body).toEqual({ available: true });
    mocks.configured = false;
    expect((await request(app).get("/api/invoices/assistant/status").expect(200)).body).toEqual({ available: false });
    await request(app).post("/api/invoices/assistant").send({ messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }], invoice }).expect(503);
  });

  it("rejects a malformed conversation", async () => {
    await request(app).post("/api/invoices/assistant").send({ messages: [], invoice }).expect(400);
    await request(app).post("/api/invoices/assistant").send({ messages: [{ role: "assistant", content: [{ type: "text", text: "?" }] }], invoice }).expect(400);
    await request(app).post("/api/invoices/assistant").send({ messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }], invoice: { lineItems: "nope" } }).expect(400);
    expect(mocks.runAssistantTurn).not.toHaveBeenCalled();
  });

  it("streams the turn's events and passes the company settings along", async () => {
    mocks.runAssistantTurn.mockImplementation(async (_args: unknown, emit: (e: unknown) => void) => {
      emit({ type: "text", text: "Here's a " });
      emit({ type: "text", text: "suggestion." });
      emit({ type: "proposal", id: "tu_9", input: { summary: "Add paint", lineItems: null, notes: null, termsAndConditions: null, dueDate: null, taxRate: null } });
      emit({ type: "done", content: [{ type: "text", text: "Here's a suggestion." }], stopReason: "end_turn" });
    });
    const res = await request(app).post("/api/invoices/assistant")
      .send({ messages: [{ role: "user", content: [{ type: "text", text: "What should I add?" }] }], invoice })
      .buffer(true).parse(collect).expect(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = (res.body as string).split("\n\n").filter(Boolean).map((frame) => JSON.parse(frame.replace(/^data: /, "")));
    expect(events.map((e) => e.type)).toEqual(["text", "text", "proposal", "done"]);
    expect(events[2].id).toBe("tu_9");

    const args = mocks.runAssistantTurn.mock.calls[0][0];
    expect(args.history[0].content[0].text).toBe("What should I add?");
    expect(args.invoice.clientName).toBe("Maple Street Homes");
    expect(args).toHaveProperty("settings");
  });

  it("turns a failure into an error event instead of a broken stream", async () => {
    mocks.runAssistantTurn.mockRejectedValue(new Error("boom"));
    const res = await request(app).post("/api/invoices/assistant")
      .send({ messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }], invoice })
      .buffer(true).parse(collect).expect(200);
    expect(res.body).toContain('"type":"error"');
    expect(res.body).toContain("Something went wrong");
  });
});
