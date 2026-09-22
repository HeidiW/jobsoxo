import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  GustoConfigurationError,
  GustoProviderError,
  gustoRequest,
  verifyGustoSignature,
} from "./gusto-client";

const originalToken = process.env.GUSTO_ACCESS_TOKEN;
const originalBaseUrl = process.env.GUSTO_API_BASE_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalToken === undefined) delete process.env.GUSTO_ACCESS_TOKEN;
  else process.env.GUSTO_ACCESS_TOKEN = originalToken;
  if (originalBaseUrl === undefined) delete process.env.GUSTO_API_BASE_URL;
  else process.env.GUSTO_API_BASE_URL = originalBaseUrl;
  delete process.env.GUSTO_WEBHOOK_SECRET;
});

describe("Gusto server client", () => {
  it("fails explicitly when credentials are missing", async () => {
    delete process.env.GUSTO_ACCESS_TOKEN;
    await expect(gustoRequest("/v1/companies")).rejects.toBeInstanceOf(GustoConfigurationError);
  });

  it("redacts provider payloads while preserving a safe error code", async () => {
    process.env.GUSTO_ACCESS_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        code: "invalid_request",
        message: "provider detail should not be sent to the browser",
        secret: "bank-account-number",
      }),
      { status: 422, headers: { "content-type": "application/json" } },
    )));

    await expect(gustoRequest("/v1/payrolls")).rejects.toMatchObject({
      status: 422,
      code: "invalid_request",
      message: "provider detail should not be sent to the browser",
    });
    try {
      await gustoRequest("/v1/payrolls");
    } catch (error) {
      expect(error).toBeInstanceOf(GustoProviderError);
      expect(JSON.stringify(error)).not.toContain("bank-account-number");
    }
  });

  it("uses the configured provider headers and idempotency key", async () => {
    process.env.GUSTO_ACCESS_TOKEN = "test-token";
    process.env.GUSTO_API_BASE_URL = "https://gusto.test/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ uuid: "payroll-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await gustoRequest("/v1/payrolls", {
      method: "POST",
      body: { check_date: "2040-01-01" },
      idempotencyKey: "run-key",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gusto.test/v1/payrolls",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ check_date: "2040-01-01" }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Idempotency-Key": "run-key",
        }),
      }),
    );
  });

  it("verifies the exact webhook bytes, including a non-canonical JSON order", () => {
    process.env.GUSTO_WEBHOOK_SECRET = "webhook-secret";
    const raw = Buffer.from('{"status":"paid","id":"evt-1"}');
    const signature = createHmac("sha256", "webhook-secret").update(raw).digest("hex");

    expect(verifyGustoSignature(raw, `sha256=${signature}`)).toBe(true);
    expect(verifyGustoSignature(Buffer.from('{"id":"evt-1","status":"paid"}'), `sha256=${signature}`)).toBe(false);
    expect(verifyGustoSignature(raw, "not-a-signature")).toBe(false);
  });
});