import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import twilio from "twilio";
import { buildTestApp } from "./test-helpers";
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
    expect(result).toEqual({ hours: 8, description: "" });
  });

  it("parses decimal hours", () => {
    const result = parseHoursMessage("7.5");
    expect(result).toEqual({ hours: 7.5, description: "" });
  });

  it("parses hours with 'h' suffix", () => {
    const result = parseHoursMessage("6h painting");
    expect(result).toEqual({ hours: 6, description: "painting" });
  });

  it("parses hours with 'hrs' suffix", () => {
    const result = parseHoursMessage("4hrs kitchen");
    expect(result).toEqual({ hours: 4, description: "kitchen" });
  });

  it("parses hours with description", () => {
    const result = parseHoursMessage("8 painting upstairs");
    expect(result).toEqual({ hours: 8, description: "painting upstairs" });
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
    expect(result).toEqual({ hours: 24, description: "" });
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
