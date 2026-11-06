/**
 * Gmail integration.
 *
 * Supports two modes:
 * 1. Per-user OAuth — each user connects their own Gmail account via
 *    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Tokens are stored in the
 *    google_tokens DB table and refreshed automatically.
 * 2. Replit connector (legacy) — app-level shared mailbox via the Replit
 *    connector proxy (REPLIT_CONNECTORS_HOSTNAME + REPL_IDENTITY).
 */

import { storage } from "./storage";
import type { GoogleToken } from "@shared/schema";

export interface GmailMessage {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  receivedAt: Date;
  isRead: boolean;
}

// ── Shared Gmail fetch helper ──────────────────────────────────────────────────

async function fetchGmailInboxWithToken(
  token: string,
  maxResults = 50,
  labels: string[] = ["INBOX"]
): Promise<GmailMessage[]> {
  const effectiveLabels = labels.length > 0 ? labels : ["INBOX"];
  const labelParams = effectiveLabels
    .map((l) => `labelIds=${encodeURIComponent(l)}`)
    .join("&");
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${labelParams}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (listRes.status === 401 || listRes.status === 403) {
    throw new Error("Gmail token expired — please reconnect");
  }
  if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);

  const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const messageIds = listData.messages ?? [];

  const details = await Promise.all(
    messageIds.slice(0, maxResults).map(async ({ id }) => {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
            `?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) return null;
        return r.json() as Promise<{
          id: string;
          internalDate: string;
          snippet: string;
          labelIds: string[];
          payload: { headers: Array<{ name: string; value: string }> };
        }>;
      } catch {
        return null;
      }
    })
  );

  return details
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((msg) => {
      const headers: Record<string, string> = {};
      (msg.payload?.headers ?? []).forEach((h) => {
        headers[h.name.toLowerCase()] = h.value;
      });

      const fromRaw = headers["from"] ?? "";
      const emailMatch = fromRaw.match(/<([^>]+)>/);
      const senderEmail = emailMatch ? emailMatch[1] : fromRaw.trim();
      const sender =
        fromRaw.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || senderEmail;

      return {
        id: msg.id,
        subject: headers["subject"] ?? "(No subject)",
        sender: sender || senderEmail,
        senderEmail,
        snippet: msg.snippet ?? "",
        receivedAt: new Date(parseInt(msg.internalDate, 10)),
        isRead: !msg.labelIds?.includes("UNREAD"),
      };
    });
}

// ── Per-user Gmail OAuth ───────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * Build the redirect URI for per-user Gmail OAuth.
 * Must be registered in Google Cloud Console.
 */
export function getGmailCallbackUrl(baseUrl?: string): string {
  const base = (baseUrl || process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
  return `${base}/api/gmail/callback`;
}

/**
 * Build the Google OAuth authorisation URL for Gmail (per-user).
 * Requests offline access so a refresh token is returned.
 */
export function buildGmailAuthUrl(state: string, callbackUrl = getGmailCallbackUrl()): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "select_account consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorisation code for access + refresh tokens.
 */
export async function exchangeGmailCode(code: string, callbackUrl = getGmailCallbackUrl()): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  email: string | null;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null;

  // Fetch the gmail address
  let email: string | null = null;
  try {
    const infoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { email?: string };
      email = info.email ?? null;
    }
  } catch {
    // email is optional
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    email,
  };
}

/**
 * Refresh a user's access token using their stored refresh token.
 * Returns the new access token and saves it to the DB.
 */
async function refreshUserToken(token: GoogleToken): Promise<string | null> {
  if (!token.refreshToken) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}) as Record<string, unknown>);
      const errCode = (errBody as { error?: string }).error;
      if (errCode === "invalid_grant" || errCode === "token_revoked") {
        console.warn(`[gmail] Refresh token revoked for user ${token.userId} — clearing stored token`);
        await storage.deleteGoogleToken(token.userId).catch(() => {});
      } else {
        console.warn(`[gmail] Token refresh failed for user ${token.userId}: ${errCode ?? res.status}`);
      }
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await storage.saveGoogleToken(token.userId, {
      accessToken: data.access_token,
      expiresAt,
    });

    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Get a valid access token for a user, refreshing if expired.
 * Returns null if no token exists or refresh failed.
 */
export async function getUserAccessToken(userId: string): Promise<string | null> {
  const token = await storage.getGoogleToken(userId);
  if (!token) return null;

  // Token has no expiry recorded — assume it's still valid
  if (!token.expiresAt) return token.accessToken;

  // Still fresh (60-second buffer)
  if (token.expiresAt.getTime() - Date.now() > 60_000) return token.accessToken;

  // Expired — try to refresh
  if (token.refreshToken) {
    const refreshed = await refreshUserToken(token);
    // If refresh failed (returned null), refreshUserToken may have already deleted
    // the token for invalid_grant. Either way, don't send a stale token to Gmail.
    return refreshed;
  }

  // Expired with no refresh token — can't recover
  return null;
}

/**
 * Returns true if the user has a stored Gmail token.
 */
export async function isUserGmailConnected(userId: string): Promise<boolean> {
  const token = await storage.getGoogleToken(userId);
  return !!token;
}

/**
 * Returns the Gmail email address associated with the user's token, or null.
 */
export async function getUserGmailEmail(userId: string): Promise<string | null> {
  const token = await storage.getGoogleToken(userId);
  return token?.gmailEmail ?? null;
}

/**
 * Revoke a user's Google OAuth grant at the provider level, then remove
 * the token from the database. Best-effort on the revoke call — the local
 * token is always deleted regardless.
 */
export async function revokeUserGmailToken(userId: string): Promise<void> {
  const token = await storage.getGoogleToken(userId);
  if (!token) return;

  const tokenToRevoke = token.refreshToken ?? token.accessToken;
  try {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`,
      { method: "POST" }
    );
  } catch {
    // Best-effort — always delete locally even if revoke call fails
  }
  await storage.deleteGoogleToken(userId);
}

/**
 * Fetch all Gmail labels available to the connected user.
 * Returns system labels (INBOX, SENT, etc.) and user-created labels.
 */
export async function fetchGmailLabelsForUser(userId: string): Promise<
  Array<{ id: string; name: string; type: string }>
> {
  const accessToken = await getUserAccessToken(userId);
  if (!accessToken) throw new Error("Gmail not connected");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Gmail token expired — please reconnect");
    }
    throw new Error(`Failed to fetch labels: ${res.status}`);
  }
  const data = (await res.json()) as {
    labels?: Array<{ id: string; name: string; type: string }>;
  };
  const labels = data.labels ?? [];
  // Sort: user labels first (custom ones the user wants to pick), then system
  return labels.sort((a, b) => {
    if (a.type !== b.type) return a.type === "user" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Fetch inbox messages for a specific user using their stored token,
 * respecting their configured label filter.
 */
export async function fetchUserGmailInbox(userId: string, maxResults = 50): Promise<GmailMessage[]> {
  const accessToken = await getUserAccessToken(userId);
  if (!accessToken) throw new Error("Gmail not connected");
  const labels = await storage.getSyncLabels(userId);
  return fetchGmailInboxWithToken(accessToken, maxResults, labels.length > 0 ? labels : ["INBOX"]);
}

// ── Replit connector (legacy shared mailbox) ────────────────────────────────

const CONNECTORS_HOST = process.env.REPLIT_CONNECTORS_HOSTNAME;
const REPL_IDENTITY = process.env.REPL_IDENTITY;

async function getGmailConnection(): Promise<{ id: string } | null> {
  if (!CONNECTORS_HOST || !REPL_IDENTITY) return null;

  try {
    const res = await fetch(`https://${CONNECTORS_HOST}/api/v2/connections`, {
      headers: { "X-Replit-Identity": REPL_IDENTITY },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      connections?: Array<{ id: string; connectorConfigId?: string; displayName?: string }>;
    };

    const list = data.connections ?? (Array.isArray(data) ? (data as any[]) : []);
    const conn = list.find(
      (c) =>
        c.connectorConfigId?.includes("google-mail") ||
        c.displayName?.toLowerCase().includes("gmail")
    );
    return conn ?? null;
  } catch {
    return null;
  }
}

async function getGmailAccessToken(): Promise<string | null> {
  if (!CONNECTORS_HOST || !REPL_IDENTITY) return null;

  const conn = await getGmailConnection();
  if (!conn) return null;

  try {
    const res = await fetch(
      `https://${CONNECTORS_HOST}/api/v2/connection/${conn.id}/token`,
      { headers: { "X-Replit-Identity": REPL_IDENTITY } }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as { access_token?: string; token?: string };
    return data.access_token ?? data.token ?? null;
  } catch {
    return null;
  }
}

export async function isGmailConnected(): Promise<boolean> {
  const token = await getGmailAccessToken();
  return !!token;
}

export async function getGmailConnectionId(): Promise<string | null> {
  const conn = await getGmailConnection();
  return conn?.id ?? null;
}

export async function revokeGmailConnection(): Promise<boolean> {
  if (!CONNECTORS_HOST || !REPL_IDENTITY) return false;

  const conn = await getGmailConnection();
  if (!conn) return true;

  try {
    const res = await fetch(
      `https://${CONNECTORS_HOST}/api/v2/connection/${conn.id}`,
      {
        method: "DELETE",
        headers: { "X-Replit-Identity": REPL_IDENTITY },
      }
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export function getGmailOAuthUrl(): string | null {
  if (!CONNECTORS_HOST || !REPL_IDENTITY) return null;
  return (
    `https://${CONNECTORS_HOST}/api/v2/authorize` +
    `?connectorConfigId=ccfg_google-mail_B959E7249792448ABBA58D46AF` +
    `&replIdentity=${encodeURIComponent(REPL_IDENTITY)}`
  );
}

export async function fetchGmailInbox(maxResults = 50): Promise<GmailMessage[]> {
  const token = await getGmailAccessToken();
  if (!token) throw new Error("Gmail not connected");
  return fetchGmailInboxWithToken(token, maxResults);
}
