import { storage } from "./storage";
import type { GoogleDocsToken } from "@shared/schema";
import { parseDocumentText, type ParsedDocument } from "./document-parser";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_DOCS_URL = "https://docs.googleapis.com/v1/documents";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_DOCS_SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export interface GoogleDocSummary {
  id: string;
  name: string;
  modifiedTime: string | null;
  webViewLink: string | null;
}

interface GoogleDocResponse {
  title?: string;
  body?: {
    content?: GoogleDocStructuralElement[];
  };
}

interface GoogleDocStructuralElement {
  paragraph?: {
    elements?: Array<{
      textRun?: { content?: string };
    }>;
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{
        content?: GoogleDocStructuralElement[];
      }>;
    }>;
  };
}

export function getGoogleDocsCallbackUrl(): string {
  const base = (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
  return `${base}/api/google-docs/callback`;
}

export function buildGoogleDocsAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGoogleDocsCallbackUrl(),
    response_type: "code",
    scope: GOOGLE_DOCS_SCOPES,
    access_type: "offline",
    prompt: "select_account consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleDocsCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  email: string | null;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleDocsCallbackUrl(),
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Docs token exchange failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new Error("Google did not return an access token");

  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null;

  let email: string | null = null;
  try {
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (userInfoResponse.ok) {
      const userInfo = (await userInfoResponse.json()) as { email?: string };
      email = userInfo.email ?? null;
    }
  } catch {
    // The connection can still be used if the optional email lookup fails.
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
    email,
  };
}

async function refreshGoogleDocsToken(token: GoogleDocsToken): Promise<string | null> {
  if (!token.refreshToken) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (body.error === "invalid_grant" || body.error === "token_revoked") {
        await storage.deleteGoogleDocsToken(token.userId).catch(() => {});
      }
      return null;
    }

    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;
    await storage.saveGoogleDocsToken(token.userId, {
      accessToken: data.access_token,
      expiresAt,
    });
    return data.access_token;
  } catch {
    return null;
  }
}

export async function getUserGoogleDocsAccessToken(userId: string): Promise<string | null> {
  const token = await storage.getGoogleDocsToken(userId);
  if (!token) return null;
  if (!token.expiresAt || token.expiresAt.getTime() - Date.now() > 60_000) {
    return token.accessToken;
  }
  return refreshGoogleDocsToken(token);
}

export async function isUserGoogleDocsConnected(userId: string): Promise<boolean> {
  return Boolean(await storage.getGoogleDocsToken(userId));
}

export async function getUserGoogleDocsEmail(userId: string): Promise<string | null> {
  const token = await storage.getGoogleDocsToken(userId);
  return token?.googleEmail ?? null;
}

function googleApiError(response: Response, fallback: string): Error {
  if (response.status === 401 || response.status === 403) {
    return new Error("Google Docs access has expired or is unavailable. Please reconnect.");
  }
  return new Error(`${fallback}: ${response.status}`);
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function listGoogleDocs(userId: string, search = ""): Promise<GoogleDocSummary[]> {
  const accessToken = await getUserGoogleDocsAccessToken(userId);
  if (!accessToken) throw new Error("Google Docs is not connected. Please connect Google Docs first.");

  const params = new URLSearchParams({
    q: `mimeType = '${GOOGLE_DOC_MIME}' and trashed = false${search.trim() ? ` and name contains '${escapeDriveQueryValue(search.trim())}'` : ""}`,
    pageSize: "50",
    orderBy: "modifiedTime desc",
    spaces: "drive",
    fields: "files(id,name,modifiedTime,webViewLink,mimeType)",
  });
  const response = await fetch(`${GOOGLE_DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw googleApiError(response, "Could not list Google Docs");

  const data = await response.json() as {
    files?: Array<{ id?: string; name?: string; modifiedTime?: string; webViewLink?: string; mimeType?: string }>;
  };
  return (data.files ?? [])
    .filter((file) => file.id && file.name && file.mimeType === GOOGLE_DOC_MIME)
    .map((file) => ({
      id: file.id as string,
      name: file.name as string,
      modifiedTime: file.modifiedTime ?? null,
      webViewLink: file.webViewLink ?? null,
    }));
}

function extractCellText(content: GoogleDocStructuralElement[] | undefined): string {
  return extractGoogleDocText({ body: { content } }).trim().replace(/\s*\n\s*/g, " ");
}

export function extractGoogleDocText(document: GoogleDocResponse): string {
  const lines: string[] = [];
  for (const element of document.body?.content ?? []) {
    if (element.paragraph) {
      const text = (element.paragraph.elements ?? [])
        .map((part) => part.textRun?.content ?? "")
        .join("")
        .replace(/\r?\n$/, "");
      if (text.length > 0) lines.push(text);
      else if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }

    if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        const cells = (row.tableCells ?? []).map((cell) => extractCellText(cell.content));
        lines.push(cells.join("\t"));
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

export async function getGoogleDocForInvoice(
  userId: string,
  documentId: string
): Promise<{ title: string; text: string }> {
  const accessToken = await getUserGoogleDocsAccessToken(userId);
  if (!accessToken) throw new Error("Google Docs is not connected. Please connect Google Docs first.");

  const response = await fetch(`${GOOGLE_DOCS_URL}/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw googleApiError(response, "Could not read Google Doc");

  const document = await response.json() as GoogleDocResponse;
  const text = extractGoogleDocText(document);
  if (!text) throw new Error("This Google Doc is empty or contains no readable text.");
  return { title: document.title?.trim() || "Google Doc", text };
}

export function parseGoogleDocText(text: string): ParsedDocument {
  const directResult = parseDocumentText(text);
  if (directResult.lineItems.length > 0) return directResult;
  // The existing narrative parser intentionally ignores preamble text. A
  // synthetic heading lets plain Google Docs quotes use that parser while
  // preserving the table parser's first attempt above.
  return parseDocumentText(`INVOICE ITEMS\n${text}`);
}