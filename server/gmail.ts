/**
 * Gmail integration via Replit Connectors.
 *
 * After the Gmail connector OAuth is completed (via proposeIntegration), Replit
 * injects REPLIT_CONNECTORS_HOSTNAME so the backend can exchange tokens through
 * the connector proxy and call the Gmail REST API.
 */

export interface GmailMessage {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  receivedAt: Date;
  isRead: boolean;
}

const CONNECTORS_HOST = process.env.REPLIT_CONNECTORS_HOSTNAME;
const REPL_IDENTITY = process.env.REPL_IDENTITY;

// ── Connector discovery ────────────────────────────────────────────────────────

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

// ── Public API ─────────────────────────────────────────────────────────────────

export async function isGmailConnected(): Promise<boolean> {
  const token = await getGmailAccessToken();
  return !!token;
}

export async function fetchGmailInbox(maxResults = 50): Promise<GmailMessage[]> {
  const token = await getGmailAccessToken();
  if (!token) throw new Error("Gmail not connected");

  // 1. List inbox message IDs
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (listRes.status === 401) throw new Error("Gmail token expired — please reconnect");
  if (!listRes.ok) throw new Error(`Gmail list failed: ${listRes.status}`);

  const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
  const messageIds = listData.messages ?? [];

  // 2. Fetch metadata for each message (parallel, capped)
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
