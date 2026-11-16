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
- **Demo company by default.** Creating a real company exists (`server/gusto-production.ts`, `POST /api/gusto/production/company`) but only runs when `GUSTO_ENV=production` and `GUSTO_LIVE_COMPANY_CREATION_ENABLED=true`, with the legal name typed twice and a confirmation; it reserves an integration row before calling Gusto (states `company_creating` / `company_creation_unknown` / `company_creation_failed`). Never set those switches or migrate an existing Gusto company without the user's explicit approval. `GET /api/gusto/production/readiness` lists the gates and the next step; the Payroll page shows it in place of Demo tools in production, plus a notice while live payroll is off. Never accept Gusto terms of service on the user's behalf. Successful OAuth ≠ completed migration ≠ payroll readiness — treat app auth, company creation, onboarding readiness and payroll submission as separate actions.
- Persist a creation reservation before a remote company-creation request so an ambiguous response can't trigger a duplicate.
- **Company removal is JobsOxo-only**: never delete, disassociate or revoke the company in Gusto; keep local employees and source records.
- Don't invent provider capabilities (e.g. a bank feed) or bypass provider verification — confirm against Gusto docs.
- **Submit outcomes** (`server/gusto-payroll.ts`): a 4xx from Gusto's submit is a definitive refusal (nothing was paid), so the run goes to `failed` with Gusto's status, category and error key in `lastError` and must be recalculated before resubmitting. A timeout or 5xx is ambiguous and stays `submission_pending`, never retried automatically. `persistProvider` keeps a `failed` run failed until recalculation and preserves `lastError` while a run is failed or pending. Gusto's payload text is never echoed (`gusto-client.ts`), only its validated tokens. Demo companies only: `POST /api/gusto/payroll-runs/:id/reopen` hands a pending run back once Gusto shows the payroll unsubmitted. Upcoming payrolls carry Gusto's `payroll_deadline` and the UI shows "submit by".
- Don't touch production data, Gusto settings, or shared company/payment-reminder settings from tests or browser checks.

## Domain rules

- **Employee pay is a day rate** (`employees.day_rate`). Convert to hours only through `shared/pay-rates.ts` (8-hour day), which matches the Gusto import (× 8) and invite (÷ 8). Local gross figures are estimates; Gusto's calculation is the number that pays.
- **"Get on it" to-do list** (`notes` + `note_items`, `server/notes.ts`, shared by the whole team, shown on Dashboard and Scheduling): exactly one note is current (`archived_at` null; created lazily on first read). Items are added, ticked (`done`/`done_at`/`done_by`), reworded and removed one at a time, so two people editing never collide. "New note" (`POST /api/notes/current/archive`) files the current note in the archive and starts a fresh one, optionally carrying unfinished items over; an empty note is never archived. Archived notes and their items are read-only (409 on edit) and listed newest first under Archive. Migrations 0017/0018 converted the old free-text notepad and its saved versions into notes (one item per line, `[x]` lines done).
- **Schedule entries** (`schedule_entries`, `server/schedule-entries.ts`): calendar items that aren't jobs (site visit, estimate, pickup, day off) with a title, calendar date(s) as UTC midnight, optional time/client/notes. Scheduling shows them as dashed rows/chips beside jobs (2-week and month views, weekend note); the dashboard week lists them too. `POST /api/schedule-entries/:id/convert-to-job` makes a scheduled job with the same dates and links the entry (needs a client). Entries never require a client, so the "clients first" empty state only shows when there are neither jobs nor entries.
- **Clients come first.** Jobs, scheduling, materials and invoices hang off a client. Don't gate the app; guide instead: the dashboard "Set up your business" checklist (`server/setup.ts`, derived from existing counts; `settings.setup_checklist_dismissed` hides it team-wide), `NeedClientFirst` empty states on pages that need a client, and "Add a client…" inside the job form's client picker (opens `ClientForm` in place; `onSaved` selects the new client). `/clients?new=1` and `/jobs?new=1` open the forms on arrival.
- **One Gusto connection per business.** `gustoActor()` in `server/gusto-company.ts` maps every admin's payroll request to the admin row that holds the connection, so any admin can run payroll. Demo-only actions live in the Payroll page's "Demo tools" panel and never render in production.

- **Staged billing** (`shared/invoice-stages.ts`, `server/invoice-billing.ts`): a job's own line items (jobId set, invoiceId null) are its contract. An invoice has a `stage`: `standalone` (bills its line items, as before), `deposit` (amount or percent of the contract), `progress`, or `final` (whatever earlier non-draft invoices left). Staged invoices carry exactly one billable line the server computes; the browser's lines are ignored. `contract_scope`, `contract_total`, `previously_invoiced`, `previously_paid` are snapshots taken at create/draft-save and printed as "Pricing covers" plus a due-now block (`staged-billing.tsx`) in the builder preview, the invoice document, the pay page and the email. A stage never bills past what's left; `GET /api/jobs/:id/billing` reports the contract and what's been billed, and feeds the job page's Billing panel (`job-billing-panel.tsx`, with `/invoices/new?jobId=…&stage=…` shortcuts). `progress` can be billed by amount, percent of contract, or `{type:"lines", percents}` (percent complete per scope line, prefilled from each line's work status): it bills work completed to date minus what was invoiced before, so a deposit is credited automatically. `stageProblem()` is the single source of the plain-language refusals on both sides. The contract total is the job's agreed total (`jobs.estimated_total`) when set, otherwise the sum of its priced lines; the builder's "Job total" field saves to the job so every stage and the Billing panel agree. Progress payments are numbered per job (`stage_number`, fixed at creation) and print as "Progress payment 2". Approved change orders on a job's stage invoices don't change that invoice's own total (`recalcInvoiceTotals` skips them for staged invoices); they extend the contract (`changeOrdersTotal`, listed in scope under "Approved change orders") and the next progress or final invoice bills them. Change orders on a standard invoice still add to that invoice.
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
- **Email** (Resend): every send goes through `server/email.ts` and uses `fromHeader()`, so the sender is `EMAIL_FROM` (a domain verified in Resend). Without it, mail comes from `noreply@resend.dev`, which only reaches the Resend account owner. Client emails about an invoice (invoice, change order, reminder) go through `postToResend` and are recorded in `email_deliveries` (`server/email-delivery.ts`); Resend's signed webhook (`/api/webhooks/resend`, `RESEND_WEBHOOK_SECRET`) moves them to delivered/bounced/failed with a plain-language reason, and `GET /api/invoices/:id/deliveries` falls back to Resend's status lookup. Recording failures never fail a send.
- **Invoice assistant** (Claude, `server/invoice-assistant.ts`): a chat panel in the invoice builder. The browser keeps the conversation and sends the live invoice each turn; the model only *proposes* changes through one strict tool and the person applies them — it never writes to the database. Needs Claude credentials: production uses OIDC workload identity federation (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, identity token); locally `ANTHROPIC_API_KEY` works. `invoiceAssistantConfigured()` mirrors the SDK's resolution; without credentials the panel says so. Keep the system prompt stable (it's cached) and put per-turn state in the user message.
- **Proofread gate** (`server/invoice-proofread.ts`, `shared/invoice-proofread.ts`): Send and Save draft in the builder first tidy text mechanically (`tidyText`), then ask Claude for exact spelling/punctuation fixes; every issue must be fixed or kept as written before the invoice goes out. 503 without the key (builder skips the AI pass); other failures are non-blocking with a toast. Don't flag trade terms, brands or names.
- **Receipt scanner** (`server/receipt-scan.ts`, `shared/receipt-scan.ts`): `POST /api/materials/scan-receipt` takes a photo or PDF (multipart `receipt`, 10 MB) and has Claude return vendor, date and line items as structured JSON. It saves nothing; the browser's review dialog (`receipt-scan-dialog.tsx`) lets the person edit, drop and add lines, then saves the kept ones in one transaction via `POST /api/materials/bulk`. Uses the same credentials check as the invoice assistant; 503 without them.
- **Online payments** (Stripe, `server/stripe-payments.ts`): clients reach `/pay/:token` (public, tokenized; no sign-in) from the "Pay online" button in the invoice email and reminders, and the URL is printed in the invoice's "How to pay" block. Checkout offers ACH debit first (flat fee) then card. Stripe is the source of truth and three paths feed the same `applyCheckoutOutcome` (idempotent on `provider_ref`, the payment intent): the signed webhook `POST /api/webhooks/stripe` (`STRIPE_WEBHOOK_SECRET`, events `checkout.session.completed` / `async_payment_succeeded` / `async_payment_failed`; every delivery is stored in `stripe_events` by Stripe's id before it is applied, so a redelivery of a processed event is a no-op and one whose processing failed is retried); the pay page's return check `POST /api/pay/:token/verify` with the `session_id` from the success URL; and the nightly `reconcileWithStripe` (`server/stripe-reconcile.ts`, 4 AM, `STRIPE_RECONCILE_HOUR`; admins can run it at `POST /api/payments/reconcile`), which lists every Checkout session of the last 90 days from Stripe, applies it, and writes `payment_discrepancies` where Stripe's settled total for an invoice differs from the app's online payments; open ones show first in the dashboard's needs-attention list (reason `payment-mismatch`) until a later sweep finds them equal. Cards settle at once; an ACH debit is a `payments` row with `status = processing` (not counted toward the invoice, shown as "Processing") until it settles. Payments taken off-line (check, cash, Zelle) are recorded by hand on the invoice; with a business bank connected (Plaid), deposits sync to `plaid_transactions` and match a payment automatically (amount ±$1, date ±5 days) or by hand in Settings. `server/bank-match.ts` lists hand-recorded payments older than `UNMATCHED_GRACE_DAYS` (10) with no matched deposit; the dashboard shows them (reason `unmatched-deposit`) with a Match deposit link. Derived, not stored. "How to pay" text is `settings.payment_instructions`, defaulting to `shared/payment-instructions.ts` (ACH preferred).
- Others: Microsoft/Apple/Yahoo OAuth, Resend, Twilio, Stripe. Uploaded job documents are stored in Postgres. See `.env.example` for every variable the server reads.

## Hosting

Production runs on Render, defined by `render.yaml`: the `jobsoxo` web service (https://jobsoxo.onrender.com) and the `jobsoxo-db` Postgres 16 database, both in `virginia`. Render deploys `main` on each push and runs `npm run db:migrate` before starting the new version. Run one instance only: the inbox, Plaid and reminder schedulers run in-process. Replit has been retired.

- New environments need `SETUP_CODE` (generated by the Blueprint) to create the first admin.
- Twilio's incoming-SMS webhook is set on the account's Messaging Service: `<APP_URL>/api/sms/inbound`, POST.

## Redesign

Apply the redesign handoff in stages — theme tokens, app shell, Dashboard, then each page — and stop for review after each. It is visual-only: reuse production components and real API data; don't import prototype markup, scripts or sample data, and don't adopt prototype interactions that change payroll or payment behavior. Gusto Worksheet sits in a **Payroll tab**; the main menu has nine destinations, with Settings separate. Preserve worksheet permissions, legacy links, and both business-task and Gmail functions in Inbox. Fix conflicting legacy styles (display-font weight, outlined default button) per page rather than changing shared defaults.
