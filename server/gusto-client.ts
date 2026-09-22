import { timingSafeEqual, createHmac } from "node:crypto";

export class GustoConfigurationError extends Error {}
export class GustoProviderError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 502, code = "provider_error") {
    super(message); this.status = status; this.code = code;
  }
}

function config() {
  const token = process.env.GUSTO_ACCESS_TOKEN;
  const baseUrl = (process.env.GUSTO_API_BASE_URL || "https://api.gusto.com").replace(/\/$/, "");
  if (!token) throw new GustoConfigurationError("Gusto is not configured. Add GUSTO_ACCESS_TOKEN.");
  return { token, baseUrl };
}

export async function gustoRequest<T>(path: string, options: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const { token, baseUrl } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GUSTO_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Gusto-API-Version": process.env.GUSTO_API_VERSION || "2024-04-01",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok) {
      const providerCode = typeof data?.code === "string" ? data.code : "provider_error";
      throw new GustoProviderError(
        typeof data?.message === "string" ? data.message : `Gusto request failed (${response.status})`,
        response.status, providerCode,
      );
    }
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