import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import twilio from "twilio";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { normalizePhone, parseHoursMessage, twimlReply } from "./sms";

// ── Pure function tests ───────────────────────────────────────────────────────

describe("normalizePhone", () => {
  it("prefixes 10-digit number with +1", () => {
    expect(normalizePhone("2025551234")).toBe("+12025551234");
  });

  it("prefixes 11-digit number starting with 1 with +", () => {
    expect(normalizePhone("12025551234")).toBe("+12025551234");
  });

  it("strips formatting from E.164 number", () => {
    expect(normalizePhone("+1 (202) 555-1234")).toBe("+12025551234");
  });

  it("returns digits only for short/unknown numbers", () => {
    expect(normalizePhone("555")).toBe("555");
  });
});

describe("parseHoursMessage", () => {
  it("parses integer hours", () => {
    const result = parseHoursMessage("8");
    expect(result).toEqual({ hours: 8, description: "", jobRef: null });
  });

  it("parses decimal hours", () => {
    const result = parseHoursMessage("7.5");
    expect(result).toEqual({ hours: 7.5, description: "", jobRef: null });
  });

  it("parses hours with 'h' suffix", () => {
    const result = parseHoursMessage("6h painting");
    expect(result).toEqual({ hours: 6, description: "painting", jobRef: null });
  });

  it("parses hours with 'hrs' suffix", () => {
    const result = parseHoursMessage("4hrs kitchen");
    expect(result).toEqual({ hours: 4, description: "kitchen", jobRef: null });
  });

  it("parses hours with description", () => {
    const result = parseHoursMessage("8 painting upstairs");
    expect(result).toEqual({ hours: 8, description: "painting upstairs", jobRef: null });
  });

  it("returns null for 0 hours", () => {
    expect(parseHoursMessage("0")).toBeNull();
  });

  it("returns null for hours > 24", () => {
    expect(parseHoursMessage("25")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseHoursMessage("hello")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseHoursMessage("")).toBeNull();
  });

  it("accepts exactly 24 hours", () => {
    const result = parseHoursMessage("24");
    expect(result).toEqual({ hours: 24, description: "", jobRef: null });
  });

  it("extracts numeric job reference", () => {
    const result = parseHoursMessage("8 painting job:42");
    expect(result).toEqual({ hours: 8, description: "painting", jobRef: "42" });
  });

  it("extracts named job reference", () => {
    const result = parseHoursMessage("6 job:kitchen");
    expect(result).toEqual({ hours: 6, description: "", jobRef: "kitchen" });
  });

  it("strips job tag from description when job tag appears mid-message", () => {
    const result = parseHoursMessage("8 drywall job:42 sanding");
    expect(result).toEqual({ hours: 8, description: "drywall sanding", jobRef: "42" });
  });

  it("is case-insensitive for job tag", () => {
    const result = parseHoursMessage("8 Job:Bath");
    expect(result).toEqual({ hours: 8, description: "", jobRef: "Bath" });
  });
});

describe("twimlReply", () => {
  it("wraps message in TwiML Response/Message tags", () => {
    const xml = twimlReply("Hello");
    expect(xml).toContain("<Response><Message>Hello</Message></Response>");
  });

  it("escapes HTML entities in message", () => {
    const xml = twimlReply("a & b < c > d");
    expect(xml).toContain("a &amp; b &lt; c &gt; d");
  });
});

// ── SMS webhook integration tests ─────────────────────────────────────────────

describe("POST /api/sms/inbound — auth", () => {
  let app: Express;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.TWILIO_AUTH_TOKEN;
    } else {
      process.env.TWILIO_AUTH_TOKEN = originalToken;
    }
  });

  it("returns 403 when TWILIO_AUTH_TOKEN is not configured", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;

    const res = await request(app)
      .post("/api/sms/inbound")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("From=%2B12025551234&Body=8")
      .expect(403);

    expect(res.text).toContain("<Response>");
    expect(res.text).toContain("Service not configured");
  });

  it("returns 403 when X-Twilio-Signature is missing or invalid", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test-token";

    const res = await request(app)
      .post("/api/sms/inbound")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("From=%2B12025551234&Body=8")
      .expect(403);

    expect(res.text).toContain("<Response>");
    expect(res.text).toContain("Forbidden");
  });

  it("does not create a time entry when signature is invalid", async () => {
    process.env.TWILIO_AUTH_TOKEN = "test-token";

    const before = await request(app).get("/api/time-entries");

    await request(app)
      .post("/api/sms/inbound")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("From=%2B12025551234&Body=8")
      .expect(403);

    const after = await request(app).get("/api/time-entries");
    expect(after.body.length).toBe(before.body.length);
  });

  it("accepts a request with a valid Twilio signature", async () => {
    const token = "test-valid-token";
    process.env.TWILIO_AUTH_TOKEN = token;

    const body = { From: "+12025559999", Body: "HELP" };
    const host = "localhost:5000";
    const url = `http://${host}/api/sms/inbound`;
    const sig = twilio.getExpectedTwilioSignature(token, url, body);

    const params = new URLSearchParams(body).toString();

    const res = await request(app)
      .post("/api/sms/inbound")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("X-Twilio-Signature", sig)
      .set("Host", host)
      .send(params)
      .expect(200);

    expect(res.type).toMatch(/xml/);
    expect(res.text).toContain("<Response>");
  });
});

// ── SMS webhook business logic tests ─────────────────────────────────────────

const SMS_TOKEN = "sms-biz-test-token";
const SMS_HOST = "localhost:5000";
const SMS_URL = `http://${SMS_HOST}/api/sms/inbound`;

function signedSmsRequest(app: Express, from: string, body: string) {
  const fields = { From: from, Body: body };
  const sig = twilio.getExpectedTwilioSignature(SMS_TOKEN, SMS_URL, fields);
  const params = new URLSearchParams(fields).toString();
  return request(app)
    .post("/api/sms/inbound")
    .set("Content-Type", "application/x-www-form-urlencoded")
    .set("X-Twilio-Signature", sig)
    .set("Host", SMS_HOST)
    .send(params);
}

describe("POST /api/sms/inbound — HELP command", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = SMS_TOKEN;
    app = await buildTestApp();
  });

  afterEach(() => {
    process.env.TWILIO_AUTH_TOKEN = SMS_TOKEN;
  });

  it("replies with usage instructions for HELP", async () => {
    const res = await signedSmsRequest(app, "+12025550001", "HELP").expect(200);
    expect(res.type).toMatch(/xml/);
    expect(res.text).toContain("time log");
    expect(res.text).toContain("Max 24h");
  });

  it("replies with usage instructions for ?", async () => {
    const res = await signedSmsRequest(app, "+12025550001", "?").expect(200);
    expect(res.text).toContain("time log");
  });
});

describe("POST /api/sms/inbound — unknown number", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = SMS_TOKEN;
    app = await buildTestApp();
  });

  it("tells unregistered numbers they aren't linked", async () => {
    const res = await signedSmsRequest(app, "+19995550000", "8").expect(200);
    expect(res.text).toContain("isn");
    expect(res.text).toContain("linked");
  });
});

describe("POST /api/sms/inbound — inactive employee", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = SMS_TOKEN;
    app = await buildTestApp();
  });

  it("tells inactive employees their account is inactive", async () => {
    await storage.createEmployee({
      name: "Inactive SMS User",
      phone: "+13335550100",
      dayRate: "200",
      status: "inactive",
    });

    const res = await signedSmsRequest(app, "+13335550100", "8").expect(200);
    expect(res.text).toContain("inactive");
  });
});

describe("POST /api/sms/inbound — valid hours", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = SMS_TOKEN;
    app = await buildTestApp();
  });

  it("logs hours and replies with a confirmation", async () => {
    await storage.createEmployee({
      name: "Active SMS Worker",
      phone: "+14445550200",
      dayRate: "200",
      status: "active",
    });

    const res = await signedSmsRequest(app, "+14445550200", "6 painting").expect(200);
    expect(res.text).toContain("Logged 6h");
    expect(res.text).toContain("Total today");
  });

  it("includes the description in the time entry", async () => {
    await storage.createEmployee({
      name: "Desc SMS Worker",
      phone: "+14445550201",
      dayRate: "200",
      status: "active",
    });

    await signedSmsRequest(app, "+14445550201", "3 tiling bathroom").expect(200);

    const allEmployees = await storage.getEmployees();
    const emp = allEmployees.find((e) => e.phone === "+14445550201");
    const entries = await storage.getTimeEntriesByEmployee(emp!.id);
    const latest = entries[entries.length - 1];
    expect(latest.description).toContain("tiling bathroom");
    expect(latest.description).toContain("via SMS");
  });

  it("replies with error for unrecognised message format", async () => {
    await storage.createEmployee({
      name: "Format SMS Worker",
      phone: "+14445550202",
      dayRate: "200",
      status: "active",
    });

    const res = await signedSmsRequest(app, "+14445550202", "hello world").expect(200);
    expect(res.text).toContain("Couldn");
  });
});

describe("POST /api/sms/inbound — daily cap exceeded", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = SMS_TOKEN;
    app = await buildTestApp();
  });

  it("rejects hours that would push the daily total past 24h", async () => {
    const emp = await storage.createEmployee({
      name: "Cap SMS Worker",
      phone: "+15555550300",
      dayRate: "200",
      status: "active",
    });

    await storage.createTimeEntry({
      employeeId: emp.id,
      jobId: null,
      date: new Date(),
      hoursWorked: "20",
      description: "earlier shift (via SMS)",
    });

    const res = await signedSmsRequest(app, "+15555550300", "8").expect(200);
    expect(res.text).toContain("already have");
    expect(res.text).toContain("exceed 24h");
  });

  it("allows hours that keep the daily total at exactly 24h", async () => {
    const emp = await storage.createEmployee({
      name: "Cap Exact SMS Worker",
      phone: "+15555550301",
      dayRate: "200",
      status: "active",
    });

    await storage.createTimeEntry({
      employeeId: emp.id,
      jobId: null,
      date: new Date(),
      hoursWorked: "16",
      description: "earlier shift (via SMS)",
    });

    const res = await signedSmsRequest(app, "+15555550301", "8").expect(200);
    expect(res.text).toContain("Logged 8h");
    expect(res.text).toContain("Total today: 24");
  });
});
