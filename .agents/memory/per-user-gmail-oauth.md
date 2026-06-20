---
name: Per-user Gmail OAuth
description: Architecture decisions and constraints for the per-user Gmail OAuth (gmail.readonly scope) implementation.
---

# Per-user Gmail OAuth

## The rule
Each user connects their own Gmail account independently via `/api/gmail/auth` → `/api/gmail/callback`. Tokens are stored in the `google_tokens` DB table (one row per user, `userId` is unique). The Replit connector (shared admin mailbox) still exists in `server/gmail.ts` as legacy code but is no longer the primary path.

**Why:** Users can't integrate through Replit connectors individually — that's an app-level credential. Per-user OAuth stores each user's access + refresh token independently.

## Key constraint
The redirect URI `{APP_URL}/api/gmail/callback` MUST be registered in Google Cloud Console under the same OAuth client that owns `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Without this, Google returns `redirect_uri_mismatch`. This is a one-time manual step.

**How to apply:** Whenever helping the user debug OAuth failures, check this first.

## Token lifecycle
- `buildGmailAuthUrl(state)` — generates consent URL with `access_type=offline&prompt=consent` (forces refresh token)
- `exchangeGmailCode(code)` — exchanges auth code for tokens, fetches Gmail email via userinfo
- `getUserAccessToken(userId)` — returns valid token, refreshes via refresh_token if expired (60s buffer)
- `refreshUserToken(token)` — POSTs to `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`
- CSRF protection: random `state` stored in `req.session.gmailOAuthState`, verified in callback, then deleted

## Scheduler
`server/scheduler.ts` now loops `getUsersWithGmailTokens()` and calls `fetchUserGmailInbox(userId)` per user. No more shared connector check.

## Files changed
- `shared/schema.ts` — `googleTokens` table
- `server/storage.ts` — `getGoogleToken`, `saveGoogleToken`, `deleteGoogleToken`, `getUsersWithGmailTokens`
- `server/gmail.ts` — `buildGmailAuthUrl`, `exchangeGmailCode`, `getUserAccessToken`, `fetchUserGmailInbox`, `isUserGmailConnected`, `getUserGmailEmail`
- `server/routes.ts` — `GET /api/gmail/auth`, `GET /api/gmail/callback`, `GET /api/gmail/status`, `DELETE /api/gmail/disconnect`; `/api/inbox/messages` + `/api/inbox/sync` no longer `requireAdmin`
- `server/scheduler.ts` — per-user sync loop
- `server/index.ts` — added `gmailOAuthState?: string` to SessionData
- `client/src/pages/inbox-tasks.tsx` — "Connect Gmail" navigates to `/api/gmail/auth`; handles `?gmail_connected=1` and `?gmail_error=...` params on return; all users can connect (not admin-only)
