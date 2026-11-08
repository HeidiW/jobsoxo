import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildAdminTestApp } from "./test-helpers";
import { storage } from "./storage";
import { sendPasswordResetEmail } from "./email";

const RESET_LINK = "https://jobsoxo.onrender.com/reset-password?token=secret-token";
const originalEnv = process.env.NODE_ENV;
const originalKey = process.env.RESEND_API_KEY;

const resendRejects = () =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"message":"The jobsoxo.com domain is not verified"}', { status: 403 })));
const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((args) => args.join(" ")).join("\n");

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("email failure logging", () => {
  it("logs Resend's rejection with a masked address and no link", async () => {
    resendRejects();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendPasswordResetEmail("heidi@jobsoxo.com", "heidi@jobsoxo.com", RESET_LINK, { apiKey: "re_test" });

    expect(result.success).toBe(false);
    const output = logged(error);
    expect(output).toContain("[Email] Password reset to h***@jobsoxo.com failed: Resend 403");
    expect(output).toContain("domain is not verified");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("heidi@jobsoxo.com");
  });

  it("never logs the reset link in production without an API key", async () => {
    process.env.NODE_ENV = "production";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendPasswordResetEmail("heidi@jobsoxo.com", "heidi@jobsoxo.com", RESET_LINK, {});

    expect(result).toEqual({ success: false, error: "Email is not configured" });
    expect(logged(error)).toContain("RESEND_API_KEY is not set");
    expect(logged(log) + logged(error)).not.toContain("secret-token");
  });

  it("still logs the link locally without an API key", async () => {
    process.env.NODE_ENV = "development";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await sendPasswordResetEmail("heidi@jobsoxo.com", "heidi@jobsoxo.com", RESET_LINK, {});

    expect(result.success).toBe(true);
    expect(logged(log)).toContain("secret-token");
  });
});

describe("POST /api/employees/:id/send-deposit-link", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildAdminTestApp();
  });

  it("tells the admin when the setup email couldn't be sent", async () => {
    process.env.RESEND_API_KEY = "re_test";
    resendRejects();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const employee = await storage.createEmployee({ name: "Deposit Worker", email: "worker@example.com", dayRate: "200", status: "active" });

    const res = await request(app).post(`/api/employees/${employee.id}/send-deposit-link`).send({}).expect(502);

    expect(res.body.error).toMatch(/couldn't be sent/);
  });
});
