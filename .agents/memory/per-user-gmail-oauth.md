---
name: Per-user Gmail OAuth
description: Architecture and constraints for per-user Gmail OAuth (gmail.readonly scope).
---

# Per-user Gmail OAuth

## The rule
Each user connects their own Gmail via `/api/gmail/auth` → `/api/gmail/callback`. Tokens live in the `google_tokens` table (one row per user, `userId` is unique). The legacy Replit connector (shared admin mailbox) still exists in `server/gmail.ts` but is no longer the primary path.

**Why:** Replit connectors are app-level, not per-user. Per-user OAuth gives each user their own private inbox view.

## Critical setup requirement
The exact redirect URI for every host where Gmail is connected must be registered in Google Cloud Console under the OAuth client that owns `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. This includes the published host and the active Replit Preview host. Without this step, the connect attempt fails with `redirect_uri_mismatch`.

**Why:** OAuth state lives in the session on the host where the flow started. Sending a Preview connection to the published callback loses that session even if Google accepts the URI.

**How to apply:** Build the callback from the incoming request host, retain that exact URI through the token exchange, and register `{that host}/api/gmail/callback` with Google.

## Token lifecycle decisions
- `prompt=select_account consent` is forced to always show an account chooser while retaining the refresh-token consent flow, so reconnecting can replace an existing Gmail account.
- Refresh uses a 60-second buffer before expiry to avoid mid-request token failures
- Disconnect calls `https://oauth2.googleapis.com/revoke` (best-effort) before deleting local token row
- CSRF protection: random `state` stored in `req.session.gmailOAuthState`, verified on callback

## Scheduler
Daily sync loops `getUsersWithGmailTokens()` and fetches each user's inbox with their own token. No shared connector check.
