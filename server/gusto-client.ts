import { timingSafeEqual, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { gustoIntegrations } from "@shared/schema";
import { encrypt, decrypt } from "./encryption";

export class GustoConfigurationError extends Error {}
export class GustoProviderError extends Error {
  status: number;
  code: string;
  /** The field Gusto rejected, when it names one (never its value). */
  field?: string;
  constructor(message: string, status = 502, code = "provider_error", field?: string) {
    super(message); this.status = status; this.code = code; this.field = field;
  }
}

export function gustoEnvironment(): "demo" | "production" {
  const environment = process.env.GUSTO_ENV || "demo";
  if (!["demo", "production"].includes(environment)) throw new GustoConfigurationError("GUSTO_ENV must be demo or production.");
  return environment as "demo" | "production";
}

function baseUrl() {
  const expected = gustoEnvironment() === "demo" ? "https://api.gusto-demo.com" : "https://api.gusto.com";
  const value = (process.env.GUSTO_API_BASE_URL || expected).replace(/\/$/, "");
  if (value !== expected && !(process.env.NODE_ENV === "test" && value === "https://gusto.test")) {
    throw new GustoConfigurationError("Gusto API URL does not match the selected environment.");
  }
  return value;
}

export function gustoConfigured() {
  return !!(process.env.GUSTO_ACCESS_TOKEN && process.env.GUSTO_COMPANY_ID);
}

export function gustoApplicationConfigured() {
  return !!(process.env.GUSTO_CLIENT_ID && process.env.GUSTO_CLIENT_SECRET);
}

export async function gustoDemoSystemToken(): Promise<string> {
  if (gustoEnvironment() !== "demo") throw new GustoConfigurationError("Demo company creation is disabled in production.");
  if (!gustoApplicationConfigured()) throw new GustoConfigurationError("Gusto developer client ID and secret are not configured.");
  const result = await send<any>("/oauth/token", undefined, {
    method: "POST",
    body: { client_id: process.env.GUSTO_CLIENT_ID, client_secret: process.env.GUSTO_CLIENT_SECRET, grant_type: "system_access" },
  });
  if (typeof result?.access_token !== "string" || !result.access_token) {
    throw new GustoProviderError("Gusto returned an invalid system authorization.", 502, "invalid_response");
  }
  return result.access_token;
}

export async function provisionGustoDemoCompany(systemToken: string, input: {
  companyName: string; firstName: string; lastName: string; email: string;
}) {
  if (gustoEnvironment() !== "demo") throw new GustoConfigurationError("Demo company creation is disabled in production.");
  const result = await send<any>("/v1/partner_managed_companies", systemToken, {
    method: "POST",
    body: {
      user: { first_name: input.firstName, last_name: input.lastName, email: input.email },
      company: { name: input.companyName },
    },
  });
  if (typeof result?.access_token !== "string" || !result.access_token ||
      typeof result?.refresh_token !== "string" || !result.refresh_token ||
      typeof result?.company_uuid !== "string" || !/^[0-9a-f-]{36}$/i.test(result.company_uuid) ||
      !Number.isFinite(result?.expires_in) || result.expires_in <= 0) {
    throw new GustoProviderError("Gusto returned incomplete company authorization. Do not create another company.", 502, "invalid_response");
  }
  return {
    companyId: result.company_uuid as string,
    encryptedAccessToken: encrypt(JSON.stringify({
      accessToken: result.access_token, refreshToken: result.refresh_token,
      expiresAt: Date.now() + result.expires_in * 1000,
    } satisfies Credentials)),
  };
}

type Credentials = { accessToken: string; refreshToken?: string; expiresAt?: number };

function parseCredentials(encrypted: string): Credentials {
  const result = JSON.parse(decrypt(encrypted));
  if (!result.accessToken) throw new GustoConfigurationError("Reconnect the Gusto company.");
  return result;
}

// This bootstrap is used only by the explicit admin Connect action. Once bound,
// every payroll call uses that admin's encrypted, company-scoped credentials.
export function bootstrapGustoCredentials(): string {
  if (!gustoConfigured()) throw new GustoConfigurationError("Gusto company credentials are not configured.");
  return encrypt(JSON.stringify({
    accessToken: process.env.GUSTO_ACCESS_TOKEN!,
    refreshToken: process.env.GUSTO_REFRESH_TOKEN,
  } satisfies Credentials));
}

async function accessToken(userId?: string, rejectedToken?: string): Promise<string> {
  if (!userId) {
    // Bootstrap introspection and isolated client tests only.
    if (!process.env.GUSTO_ACCESS_TOKEN) throw new GustoConfigurationError("Gusto company credentials are not configured.");
    return process.env.GUSTO_ACCESS_TOKEN;
  }
  // The DB row lock serializes refresh-token rotation across server processes.
  return db.transaction(async (tx) => {
    const [integration] = await tx.select().from(gustoIntegrations).where(eq(gustoIntegrations.userId, userId)).for("update");
    if (!integration?.encryptedAccessToken || integration.environment !== gustoEnvironment()) {
      throw new GustoConfigurationError("Connect an authorized Gusto company for this environment.");
    }
    const credentials = parseCredentials(integration.encryptedAccessToken);
    if (rejectedToken && rejectedToken !== credentials.accessToken) return credentials.accessToken;
    const expired = credentials.expiresAt !== undefined && credentials.expiresAt <= Date.now() + 60_000;
    if (!rejectedToken && !expired) return credentials.accessToken;
    if (!credentials.refreshToken || !process.env.GUSTO_CLIENT_ID || !process.env.GUSTO_CLIENT_SECRET) {
      throw new GustoConfigurationError("Gusto authorization expired. Reconnect with refresh-capable Embedded credentials.");
    }
    const refreshed = await send<any>("/oauth/token", undefined, {
      method: "POST",
      body: {
        client_id: process.env.GUSTO_CLIENT_ID, client_secret: process.env.GUSTO_CLIENT_SECRET,
        grant_type: "refresh_token", refresh_token: credentials.refreshToken,
      },
    });
    if (!refreshed?.access_token || !refreshed?.refresh_token || !Number.isFinite(refreshed.expires_in)) {
      throw new GustoProviderError("Gusto returned an invalid authorization response.", 502, "invalid_response");
    }
    await tx.update(gustoIntegrations).set({
      encryptedAccessToken: encrypt(JSON.stringify({
        accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
      } satisfies Credentials)), updatedAt: new Date(),
    }).where(eq(gustoIntegrations.id, integration.id));
    return refreshed.access_token;
  });
}

type RequestOptions = { method?: string; body?: unknown; idempotencyKey?: string; userId?: string };

export async function gustoRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await accessToken(options.userId);
  try {
    return await send<T>(path, token, options);
  } catch (error) {
    // A rejected (401) request has not been authorized to mutate anything.
    // Never replay timeouts, 5xxs, or any ambiguous money-moving request.
    if (!(error instanceof GustoProviderError) || error.status !== 401 || !options.userId) throw error;
    return send<T>(path, await accessToken(options.userId, token), options);
  }
}

async function send<T>(path: string, token: string | undefined, options: RequestOptions): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new GustoConfigurationError("Invalid Gusto API path.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GUSTO_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method: options.method || "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Gusto-API-Version": "2026-06-15",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok) {
      const code = data?.errors?.[0]?.category ?? data?.code;
      const providerCode = typeof code === "string" && /^[a-z_]{1,60}$/.test(code) ? code : "provider_error";
      const errorKey = data?.errors?.[0]?.error_key;
      const field = typeof errorKey === "string" && /^[a-z0-9_.]{1,60}$/.test(errorKey) ? errorKey : undefined;
      throw new GustoProviderError(
        `Gusto request was not accepted (${response.status}). Check company setup and payroll readiness.`,
        response.status, providerCode, field,
      );
    }
    if (raw && data === null) throw new GustoProviderError("Gusto returned an invalid response.", 502, "invalid_response");
    return data as T;
  } catch (error: any) {
    if (error instanceof GustoProviderError || error instanceof GustoConfigurationError) throw error;
    if (error?.name === "AbortError") throw new GustoProviderError("Gusto request timed out", 504, "timeout");
    throw new GustoProviderError("Gusto request failed", 502, "provider_unavailable");
  } finally { clearTimeout(timeout); }
}

export function verifyGustoSignature(raw: string | Buffer, signature: string | undefined): boolean {
  const secret = process.env.GUSTO_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const actual = Buffer.from(signature.replace(/^sha256=/, ""));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}