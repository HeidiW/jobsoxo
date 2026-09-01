import { vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_URL = "http://test-app";
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
});

import "./test-helpers";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";

const USER_ID = "test-user";
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function googleResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}

function paragraph(text: string) {
  return {
    paragraph: {
      elements: [{ textRun: { content: `${text}\n` } }],
    },
  };
}

let app: Express;

beforeAll(async () => {
  app = await buildTestApp();
  if (!(await storage.getUser(USER_ID))) {
    await db.insert(users).values({
      id: USER_ID,
      username: "__test_google_docs_user__",
      password: await bcrypt.hash("Password1!", 10),
    }).onConflictDoNothing();
  }
});

beforeEach(async () => {
  await storage.deleteGoogleDocsToken(USER_ID);
  await storage.deleteGoogleToken(USER_ID);
  fetchMock.mockReset();
});

afterAll(async () => {
  await storage.deleteGoogleDocsToken(USER_ID);
  await storage.deleteGoogleToken(USER_ID);
});

describe("Google Docs OAuth routes", () => {
  it("saves Docs authorization separately without replacing Gmail authorization", async () => {
    await storage.saveGoogleToken(USER_ID, {
      accessToken: "gmail-access",
      refreshToken: "gmail-refresh",
      gmailEmail: "gmail@example.com",
    });

    const agent = request.agent(app);
    const authResponse = await agent.get("/api/google-docs/auth").expect(302);
    const authUrl = new URL(authResponse.headers.location);
    const state = authUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(authUrl.searchParams.get("scope")).toContain("documents.readonly");
    expect(authUrl.searchParams.get("scope")).not.toContain("gmail.");

    fetchMock
      .mockResolvedValueOnce(googleResponse({
        access_token: "docs-access",
        refresh_token: "docs-refresh",
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(googleResponse({ email: "docs@example.com" }));

    const callbackResponse = await agent
      .get(`/api/google-docs/callback?code=docs-code&state=${encodeURIComponent(state!)}`)
      .expect(302);

    expect(callbackResponse.headers.location)
      .toBe("http://test-app/invoices/new?google_docs_connected=1");
    expect(await storage.getGoogleDocsToken(USER_ID)).toMatchObject({
      accessToken: "docs-access",
      refreshToken: "docs-refresh",
      googleEmail: "docs@example.com",
    });
    expect(await storage.getGoogleToken(USER_ID)).toMatchObject({
      accessToken: "gmail-access",
      gmailEmail: "gmail@example.com",
    });
  });

  it("returns a clear cancellation result without creating a token", async () => {
    const agent = request.agent(app);
    const authResponse = await agent.get("/api/google-docs/auth").expect(302);
    const state = new URL(authResponse.headers.location).searchParams.get("state");

    const callbackResponse = await agent
      .get(`/api/google-docs/callback?error=access_denied&state=${encodeURIComponent(state!)}`)
      .expect(302);

    expect(callbackResponse.headers.location)
      .toBe("http://test-app/invoices/new?google_docs_error=access_denied");
    expect(await storage.getGoogleDocsToken(USER_ID)).toBeUndefined();
  });
});

describe("Google Docs invoice import routes", () => {
  it("lists available documents and parses only the selected document", async () => {
    await storage.saveGoogleDocsToken(USER_ID, {
      accessToken: "docs-access",
      refreshToken: "docs-refresh",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      googleEmail: "docs@example.com",
    });

    fetchMock.mockResolvedValueOnce(googleResponse({
      files: [{
        id: "doc-1",
        name: "Kitchen estimate",
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: "2026-08-30T12:00:00.000Z",
        webViewLink: "https://docs.google.com/document/d/doc-1/edit",
      }],
    }));

    const documentsResponse = await request(app)
      .get("/api/google-docs/documents")
      .expect(200);
    expect(documentsResponse.body).toEqual([expect.objectContaining({
      id: "doc-1",
      name: "Kitchen estimate",
    })]);

    fetchMock.mockResolvedValueOnce(googleResponse({
      title: "Kitchen estimate",
      body: {
        content: [
          paragraph("INVOICE ITEMS"),
          paragraph("Kitchen walls $1,250"),
          paragraph("Tax: 8%"),
        ],
      },
    }));

    const parseResponse = await request(app)
      .post("/api/invoices/parse-google-doc")
      .send({ documentId: "doc-1" })
      .expect(200);

    expect(parseResponse.body.sourceTitle).toBe("Kitchen estimate");
    expect(parseResponse.body.lineItems).toEqual([
      expect.objectContaining({ description: "Kitchen walls", amount: 1250 }),
    ]);
    expect(parseResponse.body.taxRate).toBe(8);
    expect(fetchMock.mock.calls[1][0]).toContain("/documents/doc-1");
  });

  it("rejects an empty document id before calling Google", async () => {
    await request(app)
      .post("/api/invoices/parse-google-doc")
      .send({ documentId: "" })
      .expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});