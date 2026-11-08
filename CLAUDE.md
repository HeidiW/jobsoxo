# JobsOxo

Invoicing, job management and payroll for construction painting & decorating businesses. Users are nontechnical tradespeople. See `README.md` for the full stack and `docs/` for deeper notes (`gusto-payroll.md`, `test-database-isolation.md`, `analytics-events.md`).

## Commands

```bash
npm run dev      # Express + Vite dev server (PORT from .env; 5050 locally — macOS AirPlay holds 5000)
npm run check    # tsc typecheck
npm test         # vitest, serial (--no-file-parallelism); needs DATABASE_URL
npm run build    # production bundle → dist/index.cjs
npm run db:generate -- --name <change>   # schema change → migrations/NNNN_<change>.sql
npm run db:migrate                       # apply pending migrations
```

- No dotenv: load env with `set -a; source .env; set +a` before running. Copy `.env.example` to `.env`.
- Local Postgres 16 via Homebrew: `jobsoxo_dev` for the app, `jobsoxo_test` for tests (`DATABASE_URL=postgresql://localhost/jobsoxo_test npm test`). Build a fresh one with `createdb` + `npm run db:migrate`.
- Production (Render) runs in UTC; users are in US time zones. `vitest.config.ts` forces `TZ=America/New_York` so calendar-date bugs fail in tests — don't remove it.

## Layout

- `client/src/` — React (Wouter, TanStack Query, shadcn/Radix, Tailwind). `@/` alias.
- `server/` — Express routes, storage, provider integrations, scheduler.
- `shared/schema.ts` — Drizzle schema + Zod types, shared by both sides (`@shared/` alias).
- `JobForm` lives in `client/src/components/job-form.tsx`; import it, don't redefine it in pages.

## Hard rules — money and providers

These protect real payroll, real funds and audit history. Don't relax them without explicit approval.

- **Gusto runs payroll** (Embedded Payroll, not App Integrations): calculation, submission and employee ACH all go through Gusto inside JobsOxo. Don't build a payroll engine; JobsOxo owns time, job rates and job costing. Keep the provider behind an internal interface so it can be swapped.
- **Plaid is independent**: a bank view showing current balance and latest 10 transactions. Payroll must never require Plaid data, connection status or processor tokens; a Plaid failure must not block payroll, and Gusto readiness must not gate the bank view. Plaid work is on hold unless requested.
- **No manual substitutes for automation**: no manual balance entry, funding attestations, worksheet handoff, or marking payroll paid from a UI click. Payment status comes from the provider.
- **Demo company only.** Don't switch to live company creation or migrate an existing Gusto company without explicit approval. Never accept Gusto terms of service on the user's behalf. Successful OAuth ≠ completed migration ≠ payroll readiness — treat app auth, company creation, onboarding readiness and payroll submission as separate actions.
- Persist a creation reservation before a remote company-creation request so an ambiguous response can't trigger a duplicate.
- **Company removal is JobsOxo-only**: never delete, disassociate or revoke the company in Gusto; keep local employees and source records.
- Don't invent provider capabilities (e.g. a bank feed) or bypass provider verification — confirm against Gusto docs.
- Don't touch production data, Gusto settings, or shared company/payment-reminder settings from tests or browser checks.

## Domain rules

- **Change orders**: once an invoice is saved, any addition, removal or change to its scope/line items is a *change order* (table `change_orders`, status pending/approved/rejected), not an edit. UI copy says "Change Order". Header fixes (dates, client, tax rate, notes) can stay plain edits.
- An admin marking a change order approved is **not** client sign-off. Use pending-review wording until real client approval exists.

## Dates and time zones

- **Calendar dates** (job start/end, invoice due/issue dates) are calendar days, not instants. Date-only values serialize as UTC midnight; `new Date("2026-10-31")` formatted in local time shows Oct 30 in New York. Preserve the encoded day for display, scheduling, weekend detection and prefilled editors.
- **Real timestamps** (creation times, snooze expiry) are instants — don't reduce them to a date prefix.
- Inbox "tomorrow" snooze = next local midnight in the user's browser time zone, computed client-side and sent as an explicit instant. Never rely on server midnight.
- Don't compute day boundaries with server-local `setHours()`; the server's time zone is not the user's.
- Server-side "today" (e.g. SMS time entries) is the business day in `America/New_York`: use `businessCalendarDate()` / `calendarDay()` from `server/business-time.ts`. Time entries always store a calendar day as UTC midnight.

## Forms

- Required, non-clearable Radix `Select`s with async options can emit `""` while options are missing. Ignore that empty change (only where empty isn't a valid choice) so a preselected value survives a failed-then-retried load. Test both preselection and failed-load recovery.

## Database and schema

- Schema source of truth is `shared/schema.ts`. Every schema change ships with a generated migration: edit the schema, `npm run db:generate -- --name <change>`, review the SQL (drizzle-kit can emit unintended drops/renames), apply locally, and commit schema + SQL + `migrations/meta/` together. Never edit an applied migration. Full guide: `docs/database-migrations.md`.
- Existing push-created databases (e.g. a restored dump of the old Replit database) get `npm run db:baseline`, not `db:migrate`. It refuses if the schema doesn't match the baseline.
- Don't run migrations from server startup; on Render they run as the pre-deploy command.
- Don't use `drizzle-kit push` against shared databases; it bypasses migrations and `--force` can approve truncation.
- `migrations/development/*.sql` are hand-written dev-only repairs outside the journal; never run them from a deploy build or server startup.
- Keep historical sample data unless the user approves removing it.

## Testing

- DB tests run inside a rollback-only transaction (`server/test-database-setup.ts` mocks `./db`; each test gets a savepoint). Use that default for new suites, including direct SQL and API tests. Don't depend on writes from earlier tests. Never clean up by name prefix or ID ranges.
- Concurrency tests (e.g. simultaneous payroll submissions) need independent connections — a shared transaction changes lock semantics. Opt out of rollback only for these, and clean up only the IDs the fixture created, in a failure-safe way.
- New React component tests must start with `// @vitest-environment jsdom`; `environmentMatchGlobs` in `vitest.config.ts` isn't applied by this Vitest version. Don't change the global environment — server tests run in Node.
- Provider HTTP mocks: match by URL and method, not ordered one-shot responses (company/onboarding/funding lookups run concurrently). Override only the endpoint under test; assert the specific error and that no submission request was made.
- Browser checks of company settings and payment reminders are view/draft-only; test save/failure paths with mocked requests in component tests.
- Mobile overflow: assert both document scroll width and viewport width ≤ the emulated width, check the document root (not just body/wrapper), and keep wide ledgers scrolling inside their own container with a local positioning context. No global overflow suppression.
- Headless CDP: enable `Emulation.setFocusEmulationEnabled`, verify `document.hasFocus()`, and blur/refocus before testing focus-dependent UI.
- If interactive or visual checks can't be run, say so explicitly rather than implying they passed.

## Integrations

- **Gmail**: per-user OAuth via `/api/gmail/auth` → `/api/gmail/callback`, `gmail.readonly`, tokens in `google_tokens` (one row per user). Build the callback from the incoming request host and register `{host}/api/gmail/callback` in Google Cloud Console for every host, or the flow fails with `redirect_uri_mismatch`. Forced `prompt=select_account consent`; 60s refresh buffer; disconnect revokes (best-effort) then deletes the row; CSRF `state` in `req.session.gmailOAuthState`. This is the only Gmail path; the old Replit shared-mailbox connector and `/api/inbox/connect`/`/api/inbox/disconnect` were removed.
- **Google Places**: called only from the server; `GOOGLE_MAPS_API_KEY` stays secret. Key needs Places API (New), API restriction only — no HTTP-referrer restriction (causes `API_KEY_HTTP_REFERRER_BLOCKED`).
- **First-time setup**: `/api/auth/register` creates the admin only on an empty database and requires `SETUP_CODE` (`server/setup-code.ts`). Production without it refuses setup. OAuth sign-in never creates accounts (`findOAuthUser` in `server/oauth.ts`); new people join by invite.
- **Sessions**: stored in Postgres via `connect-pg-simple` (the `session` table is defined in `shared/schema.ts` and created by migrations; don't enable `createTableIfMissing`). In production the cookie is `Secure` and the server refuses to start without `SESSION_SECRET`.
- **Encryption**: bank-account data is encrypted with `ENCRYPTION_KEY` (64 hex chars); rotate with `server/rotate-encryption-key.ts` using `ENCRYPTION_KEY_PREVIOUS`. When moving hosts, copy the production key exactly and verify existing data decrypts before cutover.
- Others: Microsoft/Apple/Yahoo OAuth, Resend, Twilio, Stripe. Uploaded job documents are stored in Postgres. See `.env.example` for every variable the server reads.

## Hosting

Production runs on Render, defined by `render.yaml`: the `jobsoxo` web service (https://jobsoxo.onrender.com) and the `jobsoxo-db` Postgres 16 database, both in `virginia`. Render deploys `main` on each push and runs `npm run db:migrate` before starting the new version. Run one instance only: the inbox, Plaid and reminder schedulers run in-process. Replit has been retired.

- New environments need `SETUP_CODE` (generated by the Blueprint) to create the first admin.
- Twilio's incoming-SMS webhook is set on the account's Messaging Service: `<APP_URL>/api/sms/inbound`, POST.

## Redesign

Apply the redesign handoff in stages — theme tokens, app shell, Dashboard, then each page — and stop for review after each. It is visual-only: reuse production components and real API data; don't import prototype markup, scripts or sample data, and don't adopt prototype interactions that change payroll or payment behavior. Gusto Worksheet sits in a **Payroll tab**; the main menu has nine destinations, with Settings separate. Preserve worksheet permissions, legacy links, and both business-task and Gmail functions in Inbox. Fix conflicting legacy styles (display-font weight, outlined default button) per page rather than changing shared defaults.
