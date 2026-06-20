---
name: Per-user Gmail OAuth
description: Architecture and constraints for per-user Gmail OAuth (gmail.readonly scope).
---

# Per-user Gmail OAuth

## The rule
Each user connects their own Gmail via `/api/gmail/auth` → `/api/gmail/callback`. Tokens live in the `google_tokens` table (one row per user, `userId` is unique). The legacy Replit connector (shared admin mailbox) still exists in `server/gmail.ts` but is no longer the primary path.

**Why:** Replit connectors are app-level, not per-user. Per-user OAuth gives each user their own private inbox view.

## Critical setup requirement
The redirect URI `{APP_URL}/api/gmail/callback` MUST be registered in Google Cloud Console under the OAuth client that owns `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Without this step, every connect attempt fails with `redirect_uri_mismatch`. This is a one-time manual step the app owner must do.

**How to apply:** Debug OAuth failures here first.

## Token lifecycle decisions
- `prompt=consent` is forced to always get a refresh token (Google only returns refresh tokens on first consent without this)
- Refresh uses a 60-second buffer before expiry to avoid mid-request token failures
- Disconnect calls `https://oauth2.googleapis.com/revoke` (best-effort) before deleting local token row
- CSRF protection: random `state` stored in `req.session.gmailOAuthState`, verified on callback

## Scheduler
Daily sync loops `getUsersWithGmailTokens()` and fetches each user's inbox with their own token. No shared connector check.
