// Tracks whether client emails about an invoice actually arrived. Each send
// is recorded with Resend's email id; Resend's webhook (or, without one, a
// status lookup when someone views the invoice) moves it to delivered,
// bounced and so on, with a plain-language reason.
import crypto from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { emailDeliveries, type EmailDelivery } from "@shared/schema";
import {
  BOUNCED_UNKNOWN_DETAIL, COMPLAINED_DETAIL, DELAYED_DETAIL, FINAL_STATUSES, SUPPRESSED_DETAIL,
  explainBounce, explainFailure, shouldAdvance, type DeliveryStatus,
} from "@shared/email-delivery";

export type DeliveryKind = "invoice" | "change_order" | "reminder";

export type ResendSendResult = { success: true; id: string | null } | { success: false; error: string; reason: string };

/** Sends through Resend's API and turns any refusal into a reason people can act on. */
export async function postToResend(apiKey: string, payload: Record<string, unknown>): Promise<ResendSendResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: { id?: string; message?: string; name?: string } = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!response.ok) {
    const reason = body.message || body.name || text || `HTTP ${response.status}`;
    console.error("[Email] Resend refused the send:", response.status, reason);
    return { success: false, reason, error: explainFailure(reason) };
  }
  return { success: true, id: body.id ?? null };
}

export async function recordDelivery(args: {
  invoiceId: string; kind: DeliveryKind; recipients: string[]; result: ResendSendResult;
}): Promise<EmailDelivery | undefined> {
  try {
    const [row] = await db.insert(emailDeliveries).values({
      invoiceId: args.invoiceId,
      kind: args.kind,
      recipients: args.recipients,
      providerId: args.result.success ? args.result.id : null,
      status: args.result.success ? "sent" : "failed",
      detail: args.result.success ? null : args.result.error,
      providerReason: args.result.success ? null : args.result.reason,
    }).returning();
    return row;
  } catch (error) {
    // Tracking must never turn a successful send into an error.
    console.error("[Email] Couldn't record delivery:", error);
    return undefined;
  }
}

async function advance(row: EmailDelivery, status: DeliveryStatus, detail: string | null, providerReason: string | null) {
  // A status lookup can record a bounce before the webhook brings its
  // reason; let the webhook fill the reason in.
  const addsReason = row.status === status && !row.providerReason && !!providerReason;
  if (!shouldAdvance(row.status, status) && !addsReason) return row;
  const [updated] = await db.update(emailDeliveries)
    .set({ status, detail, providerReason, updatedAt: new Date() })
    .where(eq(emailDeliveries.id, row.id))
    .returning();
  return updated;
}

// ── Webhook ──────────────────────────────────────────────────────────────────

/**
 * Verifies a Resend (Svix) webhook signature: HMAC-SHA256 over
 * "<svix-id>.<svix-timestamp>.<raw body>" with the base64 secret after
 * "whsec_", compared against each "v1,<base64>" entry in svix-signature.
 */
export function verifyResendSignature(
  rawBody: Buffer, headers: { id?: string; timestamp?: string; signature?: string }, secret: string,
  now: number = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 5 * 60) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody.toString("utf8")}`).digest();
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

type ResendEvent = {
  type: string;
  data?: {
    email_id?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    failed?: { reason?: string };
  };
};

/** Applies one webhook event. Returns the updated row, or null when the email isn't one of ours. */
export async function applyResendEvent(event: ResendEvent): Promise<EmailDelivery | null> {
  const providerId = event.data?.email_id;
  if (!providerId) return null;
  const [row] = await db.select().from(emailDeliveries).where(eq(emailDeliveries.providerId, providerId));
  if (!row) return null;
  switch (event.type) {
    case "email.sent": return advance(row, "sent", null, null);
    case "email.delivered": return advance(row, "delivered", null, null);
    case "email.delivery_delayed": return advance(row, "delayed", DELAYED_DETAIL, null);
    case "email.complained": return advance(row, "complained", COMPLAINED_DETAIL, null);
    case "email.suppressed": return advance(row, "suppressed", SUPPRESSED_DETAIL, null);
    case "email.bounced": {
      const bounce = event.data?.bounce;
      const raw = [bounce?.type, bounce?.subType, bounce?.message].filter(Boolean).join(" · ") || null;
      return advance(row, "bounced", explainBounce(bounce), raw);
    }
    case "email.failed": {
      const reason = event.data?.failed?.reason;
      return advance(row, "failed", explainFailure(reason), reason ?? null);
    }
    default: return row; // opened, clicked and others don't change delivery
  }
}

// ── Status lookup (no webhook configured) ───────────────────────────────────

const LAST_EVENT_STATUS: Record<string, DeliveryStatus> = {
  sent: "sent", queued: "sent", scheduled: "sent",
  delivered: "delivered", opened: "delivered", clicked: "delivered",
  delivery_delayed: "delayed", complained: "complained",
  bounced: "bounced", failed: "failed", suppressed: "suppressed", canceled: "failed",
};
const LAST_EVENT_DETAIL: Partial<Record<DeliveryStatus, string>> = {
  delayed: DELAYED_DETAIL, complained: COMPLAINED_DETAIL, suppressed: SUPPRESSED_DETAIL,
  bounced: BOUNCED_UNKNOWN_DETAIL, failed: explainFailure(undefined),
};
const CHECK_EVERY_MS = 20_000;
const STOP_CHECKING_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Asks Resend for the latest status of unfinished emails on an invoice. The webhook gives reasons; this gives at least the outcome. */
export async function refreshDeliveries(invoiceId: string, apiKey: string | undefined, now: Date = new Date()): Promise<void> {
  if (!apiKey) return;
  const pending = await db.select().from(emailDeliveries).where(and(
    eq(emailDeliveries.invoiceId, invoiceId),
    inArray(emailDeliveries.status, ["sent", "delayed"]),
  ));
  for (const row of pending) {
    if (!row.providerId) continue;
    if (now.getTime() - row.createdAt.getTime() > STOP_CHECKING_AFTER_MS) continue;
    if (row.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < CHECK_EVERY_MS) continue;
    await db.update(emailDeliveries).set({ lastCheckedAt: now }).where(eq(emailDeliveries.id, row.id));
    try {
      const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.providerId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) continue;
      const body = await response.json() as { last_event?: string };
      const status = body.last_event ? LAST_EVENT_STATUS[body.last_event] : undefined;
      if (status) await advance(row, status, LAST_EVENT_DETAIL[status] ?? null, null);
    } catch (error) {
      console.error("[Email] Status lookup failed:", error);
    }
  }
}

export async function listDeliveries(invoiceId: string): Promise<EmailDelivery[]> {
  return db.select().from(emailDeliveries).where(eq(emailDeliveries.invoiceId, invoiceId)).orderBy(desc(emailDeliveries.createdAt));
}

/** Latest delivery per invoice, for the invoice list. */
export async function latestDeliveries(invoiceIds: string[]): Promise<Map<string, EmailDelivery>> {
  const latest = new Map<string, EmailDelivery>();
  if (invoiceIds.length === 0) return latest;
  const rows = await db.select().from(emailDeliveries)
    .where(inArray(emailDeliveries.invoiceId, invoiceIds))
    .orderBy(desc(emailDeliveries.createdAt));
  for (const row of rows) if (!latest.has(row.invoiceId)) latest.set(row.invoiceId, row);
  return latest;
}

export const isFinal = (status: string) => (FINAL_STATUSES as readonly string[]).includes(status);
