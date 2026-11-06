/**
 * Route-level coverage for the Gmail account lifecycle used by Gmail Todos.
 *
 * Google OAuth is exercised through the real route and Gmail integration code;
 * only Google's HTTP responses are stubbed so these tests do not require a
 * browser, a real Google account, or external network access.
 */

import { vi } from "vitest";

// Keep OAuth redirects deterministic before the imported route module reads them.
vi.hoisted(() => {
  process.env.APP_URL = "http://test-app";
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
});

import "./test-helpers";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";
import bcrypt from "bcryptjs";

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

function task(emailId: string) {
  return {
    userId: USER_ID,
    emailId,
    subject: `Cached task ${emailId}`,
    sender: "Client Example",
    senderEmail: "client@example.com",
    snippet: "A cached Gmail task",
    receivedAt: new Date("2026-08-22T12:00:00.000Z"),
    isRead: false,
    isDone: false,
  };
}

function locationOf(response: request.Response): URL {
  return new URL(response.headers.location);
}

let app: Express;

beforeAll(async () => {
  app = await buildTestApp();

  if (!(await storage.getUser(USER_ID))) {
    await db.insert(users).values({
      id: USER_ID,
      username: "__test_gmail_user__",
      password: await bcrypt.hash("Password1!", 10),
    }).onConflictDoNothing();
  }
});

beforeEach(async () => {
  await storage.deleteGoogleToken(USER_ID);
  await storage.deleteUserInboxTasks(USER_ID);
  fetchMock.mockReset();
});

afterAll(async () => {
  await storage.deleteGoogleToken(USER_ID);
  await storage.deleteUserInboxTasks(USER_ID);
});

describe("DELETE /api/gmail/disconnect", () => {
  it("revokes the account and clears all cached inbox tasks", async () => {
    await storage.saveGoogleToken(USER_ID, {
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      gmailEmail: "old-account@example.com",
    });
    await storage.upsertInboxTask(task("disconnect-active"));
    await storage.upsertInboxTask(task("disconnect-hidden"));
    await storage.dismissInboxTask(USER_ID, "disconnect-hidden");

    fetchMock.mockResolvedValue(googleResponse({}));

    const response = await request(app)
      .delete("/api/gmail/disconnect")
      .expect(200);

    expect(response.body).toEqual({ disconnected: true });
    expect(await storage.getGoogleToken(USER_ID)).toBeUndefined();
    expect(await storage.getInboxTasks(USER_ID)).toEqual([]);
    expect(await storage.getHiddenInboxTasks(USER_ID)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke?token=old-refresh-token",
      { method: "POST" },
    );
  });
});

describe("Gmail OAuth account switching", () => {
  it("disconnects the old account, saves the replacement, and returns to Gmail Todos", async () => {
    await storage.saveGoogleToken(USER_ID, {
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      gmailEmail: "old-account@example.com",
    });
    await storage.upsertInboxTask(task("switch-old-task"));
    fetchMock.mockResolvedValue(googleResponse({}));

    const agent = request.agent(app);
    await agent.delete("/api/gmail/disconnect").expect(200);
    expect(await storage.getGoogleToken(USER_ID)).toBeUndefined();
    expect(await storage.getInboxTasks(USER_ID)).toEqual([]);

    const authResponse = await agent
      .get("/api/gmail/auth?returnTo=/gmail-todos")
      .expect(302);
    const authLocation = locationOf(authResponse);
    const state = authLocation.searchParams.get("state");
    expect(authLocation.origin).toBe("https://accounts.google.com");
    expect(authLocation.pathname).toBe("/o/oauth2/v2/auth");
    expect(authLocation.searchParams.get("prompt")).toBe("select_account consent");
    expect(authLocation.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/gmail\/callback$/);
    expect(state).toBeTruthy();

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(googleResponse({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(googleResponse({ email: "new-account@example.com" }));

    const callbackResponse = await agent
      .get(`/api/gmail/callback?code=replacement-code&state=${encodeURIComponent(state!)}`)
      .expect(302);

    expect(callbackResponse.headers.location)
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gmail-todos\?gmail_connected=1$/);
    expect(await storage.getGoogleToken(USER_ID)).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      gmailEmail: "new-account@example.com",
    });
    expect(await storage.getInboxTasks(USER_ID)).toEqual([]);
  });
});

describe("Gmail OAuth failures", () => {
  it("returns a clear cancellation error and removes cached tasks", async () => {
    const agent = request.agent(app);
    const authResponse = await agent
      .get("/api/gmail/auth?returnTo=/gmail-todos")
      .expect(302);
    const state = locationOf(authResponse).searchParams.get("state");
    await storage.upsertInboxTask(task("cancelled-stale-task"));

    const response = await agent
      .get(`/api/gmail/callback?error=access_denied&state=${encodeURIComponent(state!)}`)
      .expect(302);

    expect(response.headers.location)
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gmail-todos\?gmail_error=access_denied$/);
    expect(await storage.getInboxTasks(USER_ID)).toEqual([]);
  });

  it("does not clear tasks when the OAuth error callback has no valid state", async () => {
    const agent = request.agent(app);
    const authResponse = await agent
      .get("/api/gmail/auth?returnTo=/gmail-todos")
      .expect(302);
    const state = locationOf(authResponse).searchParams.get("state");
    await storage.upsertInboxTask(task("invalid-state-stale-task"));

    const missingStateResponse = await agent
      .get("/api/gmail/callback?error=access_denied")
      .expect(302);
    expect(missingStateResponse.headers.location)
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gmail-todos\?gmail_error=invalid_state$/);
    expect(await storage.getInboxTasks(USER_ID)).toHaveLength(1);

    const mismatchedStateResponse = await agent
      .get("/api/gmail/callback?error=access_denied&state=not-the-oauth-state")
      .expect(302);
    expect(mismatchedStateResponse.headers.location)
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gmail-todos\?gmail_error=invalid_state$/);
    expect(await storage.getInboxTasks(USER_ID)).toHaveLength(1);

    // Rejected callbacks do not consume the original state.
    const validStateResponse = await agent
      .get(`/api/gmail/callback?error=access_denied&state=${encodeURIComponent(state!)}`)
      .expect(302);
    expect(validStateResponse.headers.location)
      .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gmail-todos\?gmail_error=access_denied$/);
    expect(await storage.getInboxTasks(USER_ID)).toEqual([]);
  });

  it("returns the provider failure and removes cached tasks when code exchange fails", async () => {
    const agent = request.agent(app);
    const authResponse = await agent
      .get("/api/gmail/auth?returnTo=/gmail-todos")
      .expect(302);
    const state = locationOf(authResponse).searchParams.get("state");
    await storage.upsertInboxTask(task("failed-stale-task"));

    fetchMock.mockResolvedValue(googleResponse("invalid authorization code", false, 400));

    const response = await agent
      .get(`/api/gmail/callback?code=bad-code&state=${encodeURIComponent(state!)}`)
      .expect(302);
    const error = new URL(response.headers.location).searchParams.get("gmail_error");

    expect(error).toContain("Token exchange failed: 400");
    expect(error).toContain("invalid authorization code");
    expect(await storage.getInboxTasks(USER_ID)).toEqual([]);
  });
});