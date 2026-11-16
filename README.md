# JobsOxo

**The back office for painting and decorating contractors.**

Clients, jobs, materials, staged invoicing, online payments, scheduling, time tracking and payroll in one place. Production runs at [jobsoxo.app](https://jobsoxo.app) on Render. Accounts are invite-only.

---

## What it does

| Area | What a user gets |
|---|---|
| **Clients and jobs** | Client records, jobs with status (quoted / scheduled / in progress / completed), crew assignments, address autocomplete, documents (PDFs, photos, specs) and a per-job Billing panel. |
| **Invoices** | Draft, send, remind. Bill a job in stages: deposit, numbered progress payments, final. Approved change orders raise the contract total. Claude can draft an invoice from a PDF, image or Google Doc, and proofread it before sending. Invoice numbers are sequential per year. |
| **Online payments** | Each invoice carries a pay link. Clients pay by bank transfer (ACH, preferred) or card through Stripe Checkout; Stripe's webhook records the payment and marks the invoice processing, then paid. |
| **Materials** | Material purchases per job. Photograph a receipt and Claude reads it into line items for review and bulk save. |
| **Scheduling** | Two-week and month calendars of jobs and crews. Schedule entries (site visits, estimates, pickups, days off) go on the calendar without a job and can be turned into one later. "Get on it" to-do list with an archive. |
| **Time and payroll** | Hours per employee per job, local pay estimates, payroll worksheets, deductions, employee onboarding and direct-deposit setup (Plaid). Payroll itself runs through **Gusto Embedded**: employees are invited to Gusto, hours flow into a pay run, the run is calculated and submitted from the app. |
| **Inbox** | Per-user Gmail sync surfaces client emails as tasks (done / snooze / dismiss). Clients can reply to invoice emails. |
| **Reminders** | Overdue-invoice reminders by email (Resend) and SMS (Twilio), with delivery logs. |
| **Setup guidance** | A first-run checklist steers new accounts to add a client before jobs, invoices or scheduling. |

---

## Tech stack

### Frontend
| Library | Version | Role |
|---|---|---|
| React | 18.3 | UI |
| Vite | 7.3 | Dev server and bundler |
| TypeScript | 5.6 | Language |
| Wouter | 3.3 | Routing |
| TanStack Query | 5.60 | Server state (query keys are the API path) |
| shadcn/ui + Radix UI | — | Component primitives |
| Tailwind CSS | 3.4 | Styling |
| Framer Motion | 11 | Animation |
| Recharts | 2.15 | Dashboard charts |
| React Hook Form + Zod | 7.55 / 3.24 | Forms and validation (schemas shared with the server) |
| date-fns | 3.6 | Dates |
| jsPDF + html2canvas | 4.2 / 1.4 | Client-side invoice PDFs |
| lucide-react | 0.453 | Icons |

### Backend
| Library | Version | Role |
|---|---|---|
| Express | 4.21 | HTTP server |
| Drizzle ORM + drizzle-zod | 0.45 / 0.7 | Typed SQL and generated Zod schemas |
| PostgreSQL (pg) | 8.16 | Database driver; Postgres 16 |
| Passport.js, express-session, connect-pg-simple | 0.7 / 1.18 / 10 | Auth and Postgres-backed sessions |
| Stripe | 22 | Checkout sessions and webhook verification |
| @anthropic-ai/sdk | 1.6 | Receipt scanning, invoice drafting and proofreading |
| multer, pdf-parse | 2.2 / 2.4 | Uploads and PDF text |
| bcryptjs | 3.0 | Password hashing |
| tsx | 4.20 | TypeScript execution |

### Testing
| Library | Version | Role |
|---|---|---|
| Vitest | 4.1 | Runner (server tests roll back DB fixtures; client tests use jsdom per file) |
| Supertest | 7.2 | HTTP integration tests |

---

## External services

| Service | Purpose | Variables |
|---|---|---|
| **Stripe** | Online invoice payments (ACH + card) and the payment webhook | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **Gusto Embedded** | Payroll: company, employees, pay runs, webhooks. Live payroll and live company creation sit behind explicit switches | `GUSTO_*` (see `.env.example`) |
| **Plaid** | Employee bank accounts for direct deposit; bank transaction matching | `PLAID_ENV`, `PLAID_CLIENT_ID`, `PLAID_SECRET` |
| **Anthropic (Claude)** | Receipt scanning, invoice drafting, proofreading. Production uses OIDC federation from Render; locally an API key works | `ANTHROPIC_API_KEY` or `ANTHROPIC_FEDERATION_RULE_ID` + `ANTHROPIC_ORGANIZATION_ID` (+ the token file Render injects) |
| **Resend** | Outbound email and delivery webhook | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM` |
| **Twilio** | SMS reminders and inbound SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| **Google** | Sign-in, Gmail inbox sync, Google Docs import, address autocomplete | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY` |
| **Yahoo / Microsoft / Apple OAuth** | Optional sign-in providers | `YAHOO_*`, `MICROSOFT_*`, `APPLE_*` |

Each status endpoint (`/api/invoices/assistant/status`, `/api/materials/scan-receipt/status`, `/api/gusto/status`, `/api/plaid/status`) says whether its service is configured and, for Claude, which variable is missing.

---

## Database

One PostgreSQL database. Tables are defined in `shared/schema.ts`; changes ship as numbered migrations in `migrations/` (21 so far) and are applied with `npm run db:migrate`, which Render runs before every deploy. See [docs/database-migrations.md](docs/database-migrations.md).

| Group | Tables |
|---|---|
| Accounts | `users`, `invites`, `oauth_accounts`, `session`, `settings`, `onboarding_items` |
| Work | `clients`, `jobs`, `job_documents`, `job_materials`, `employee_assignments`, `schedule_entries`, `notes`, `note_items` |
| Billing | `invoices`, `invoice_counters`, `line_items`, `change_orders`, `payments`, `stripe_events`, `payment_discrepancies`, `email_deliveries`, `reminder_logs`, `sms_attempts` |
| People and pay | `employees`, `employee_deductions`, `time_entries`, `payroll_settings`, `payroll_worksheets`, `payroll_records`, `bank_accounts`, `plaid_transactions` |
| Gusto | `gusto_integrations`, `gusto_employee_mappings`, `gusto_payroll_runs`, `gusto_payroll_items`, `gusto_webhook_events` |
| Google | `google_tokens`, `google_docs_tokens`, `inbox_tasks` |

Dates that mean a calendar day (job start/end, schedule entries, invoice dates) are stored as UTC midnight. Bank and provider tokens are encrypted with `ENCRYPTION_KEY`.

---

## API

Every route lives under `/api` and, apart from auth, the public pay page, OAuth callbacks and provider webhooks, requires a signed-in session.

```
Auth           /api/auth/{setup-status,register,signup,login,logout,me,profile,
                         forgot-password,verify-reset-token,reset-password,providers,
                         callback-urls,google,microsoft,apple,yahoo}
Users/invites  /api/users, /api/users/:id, /api/users/:id/admin, /api/invites
Setup          /api/setup/status, /api/setup/dismiss, /api/admin/seed
Clients        /api/clients[/:id]
Jobs           /api/jobs[/:id], /:id/{documents,line-items,assignments,billing},
               /api/job-documents/:docId[/download]
Materials      /api/materials[/:id], /api/materials/bulk,
               /api/materials/scan-receipt[/status]
Line items     /api/line-items[/:id], /api/invoices/:id/line-items
Invoices       /api/invoices[/:id], /:id/{draft,send,remind,mark-paid,payments,
               change-orders,send-change-order,collections,deliveries,reminder-logs},
               /api/invoices/{parse-document,parse-google-doc,assistant,proofread},
               /api/collections
Change orders  /api/change-orders[/:id]
Payments       /api/pay/:token (public), /api/pay/:token/{checkout,verify},
               /api/webhooks/stripe, /api/payments/reconcile (admin)
Schedule       /api/schedule-entries[/:id], /:id/convert-to-job
Notes          /api/notes/current, /current/items, /current/archive,
               /api/notes/items/:id, /api/notes/archive, /api/notes/:id
Employees      /api/employees[/:id], /:id/{deductions,onboarding,send-deposit-link,
               gusto-invite,gusto-onboarding/take-over,gusto-link,everywhere},
               /api/employee-deductions/:id, /api/employee-bank-setup/:token
Time/payroll   /api/time-entries[/:id], /api/payroll-settings,
               /api/payroll-worksheets[/:id], /:id/{confirm,export},
               /api/payroll-records[/:id], /run, /mark-all-paid
Gusto          /api/gusto/{status,connect,sync,flows,webhook,bank-summary,
               funding-account,demo-company,employees/*,payroll-runs[/:id],
               payrolls/upcoming,production/*}
Plaid          /api/plaid/{status,link-token,exchange-token,bank-account,
               bank-accounts/:id,balance,transactions,sync-transactions,...}
Inbox/Gmail    /api/gmail/*, /api/inbox/*, /api/google-docs/*
Dashboard      /api/dashboard, /api/reminders/process, /api/settings,
               /api/sms/{config,attempts,inbound}, /api/webhooks/resend,
               /api/address-suggestions, /api/address-details
```

Run `grep -rhoE 'app\.(get|post|put|patch|delete)\("/api/[^"]+"' server/*.ts | sort -u` for the exact list.

---

## Pages

| Route | Page |
|---|---|
| `/` | Dashboard: outstanding, collected this month, needs attention, this week on site |
| `/clients` | Clients |
| `/jobs`, `/jobs/:id`, `/jobs/:id/line-items` | Jobs, job detail (documents, crew, materials, Billing panel), pricing |
| `/materials` | Material purchases and receipt scanning |
| `/invoices`, `/invoices/new`, `/invoices/:id`, `/invoices/:id/payment` | Invoices, builder with stage picker, detail, record payment |
| `/change-orders` | Change orders |
| `/scheduling` | Two-week and month calendars, schedule entries, "Get on it" list, jobs needing dates |
| `/payroll`, `/payroll/worksheet` | Employees, hours, Gusto payroll workspace, worksheets |
| `/inbox`, `/inbox-tasks`, `/gmail-todos` | Gmail-sourced tasks |
| `/settings` | Company, people (admins can set a member's email), reminders, payment instructions, integrations |
| `/pay/:token` | Public invoice pay page (no sign-in) |
| `/login`, `/reset-password`, `/privacy`, `/terms` | Public |

---

## Project structure

```
client/src/
  pages/            One file per route (+ *-logic.ts for pure helpers)
  components/       clients, invoices, jobs, materials, scheduling, payroll,
                    notepad, setup, inbox, settings, ui (shadcn)
  hooks/, lib/      queryClient, utils
server/
  index.ts          Entry; canonical-host redirect, sessions, scheduler
  routes.ts         Most API handlers
  storage.ts        Data access layer (IStorage)
  invoice-billing.ts, stripe-payments.ts, email.ts, email-delivery.ts
  receipt-scan.ts, invoice-assistant.ts, invoice-proofread.ts   (Claude)
  schedule-entries.ts, notes.ts, setup.ts, dashboard-reminders.ts
  gusto-*.ts        Gusto client, company, employees, payroll, production, demo
  plaid.ts, plaid-sync.ts, payroll-bank-view.ts
  gmail.ts, google-docs.ts, oauth.ts, sms.ts, scheduler.ts
  business-time.ts  Calendar-day helpers (America/New_York)
  encryption.ts, rotate-encryption-key.ts, migrate-encrypt-bank-accounts.ts
shared/
  schema.ts         Drizzle tables + Zod schemas used by both sides
  invoice-stages.ts, invoice-status.ts, payment-instructions.ts,
  pay-rates.ts, receipt-scan.ts
migrations/         Numbered SQL migrations (drizzle-kit)
docs/               database-migrations, gusto-payroll, test-database-isolation,
                    analytics-events
render.yaml         Render blueprint (build, pre-deploy migrate, env vars)
```

---

## Development

Node 20+ and PostgreSQL 16. There is no dotenv; load `.env` into the shell.

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY at minimum
set -a; source .env; set +a

createdb jobsoxo_dev
npm run db:migrate

npm run dev                     # Express + Vite on $PORT (use 5050 on macOS; AirPlay holds 5000)

# After changing shared/schema.ts
npm run db:generate -- --name <what_changed>
npm run db:migrate

npm run check                   # type-check
npm run build                   # production bundle

# Tests use a separate database and run in America/New_York
createdb jobsoxo_test && DATABASE_URL=postgresql://localhost/jobsoxo_test npm run db:migrate
DATABASE_URL=postgresql://localhost/jobsoxo_test npm test
```

### Environment variables

`.env.example` lists every variable the server reads, with comments. The ones that gate startup or a whole feature:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SECRET` | Yes | Cookie signing; production refuses to start without it |
| `ENCRYPTION_KEY` | Yes | 64 hex chars; encrypts stored bank and provider tokens. Copy exactly when moving hosts; `ENCRYPTION_KEY_PREVIOUS` supports rotation |
| `SETUP_CODE` | Production | Required to create the first admin on an empty database |
| `APP_URL` | Yes | Public base URL (`https://jobsoxo.app`). In production every other host 301s here, except webhook paths |
| `RESEND_API_KEY`, `EMAIL_FROM` | Yes | Outbound email; `EMAIL_FROM` must be on a domain verified in Resend |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | For online payments | Restricted key (Checkout Sessions + PaymentIntents write) and the signing secret of the webhook destination for `/api/webhooks/stripe` |
| `GUSTO_LIVE_PAYROLL_ENABLED`, `GUSTO_LIVE_COMPANY_CREATION_ENABLED` | Default `false` | Explicit switches for live payroll. Leave off until the Gusto production checklist is complete |
| `ANTHROPIC_*` | For Claude features | Locally `ANTHROPIC_API_KEY`; on Render, OIDC federation variables (the identity token file is injected by Render's managed OIDC) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google sign-in, Gmail, Docs | Register `<APP_URL>/api/auth/google/callback`, `<APP_URL>/api/gmail/callback` and `<APP_URL>/api/google-docs/callback` as redirect URIs for each environment |
| `TWILIO_*`, `PLAID_*`, `GOOGLE_MAPS_API_KEY`, other OAuth providers | Optional | Each feature stays off, with a clear status, until configured |

---

## Deployment

Render deploys `main` on every push using `render.yaml`: build, then `npm run db:migrate` as the pre-deploy command, then start. Webhook URLs to register with providers, all on `https://jobsoxo.app`:

| Provider | Path |
|---|---|
| Stripe | `/api/webhooks/stripe` (`checkout.session.completed`, `.async_payment_succeeded`, `.async_payment_failed`) |
| Resend | `/api/webhooks/resend` |
| Twilio inbound SMS | `/api/sms/inbound` |
| Gusto | `/api/gusto/webhook` |

DNS for `jobsoxo.app` is at Vercel and points at Render; `jobsoxo.onrender.com` and `www` redirect to the apex.

---

## Design decisions

- **Shared schema.** `shared/schema.ts` is imported by the client for types and by the server for queries. Zod schemas from `drizzle-zod` validate request bodies.
- **Thin routes, typed storage.** Database access goes through `IStorage` in `storage.ts`; feature modules (`invoice-billing.ts`, `stripe-payments.ts`, `gusto-*.ts`) hold the business rules and are tested directly.
- **Staged billing is computed, not stored twice.** A job's contract total, invoiced-to-date and remaining are derived in `invoice-billing.ts` from the job, its invoices and approved change orders; each invoice stores only its stage and basis.
- **Stripe is the ledger.** The app never marks an online payment itself. Three paths feed one idempotent handler: the signed webhook (every delivery stored by event id first, so duplicates are no-ops and failures retry), a check when the client returns from Checkout, and a nightly reconcile that lists every session from Stripe and flags any invoice where Stripe's settled total differs from the app's. Webhooks make it fast; the reconcile makes it correct.
- **Off-line payments get checked against the bank.** A check or cash payment is recorded by hand. With a bank connected through Plaid, deposits sync in and match payments by amount and date, or by hand. A hand-recorded payment with no matched deposit after ten days surfaces on the dashboard, derived from the tables rather than stored.
- **Payroll runs in Gusto.** The app holds hours and employee mappings; Gusto owns pay data, taxes and filings. Demo and production companies are separate, live actions sit behind environment switches, and payroll history is never deleted (foreign keys restrict it).
- **Calendar days, not timestamps.** Job and schedule dates are calendar days stored as UTC midnight, and the dashboard week is built from the viewer's business day in America/New_York.
- **Claude features degrade cleanly.** Receipt scanning, invoice drafting and proofreading check their status endpoint first and tell the user which credential is missing instead of failing mid-task.
- **Demo data is opt-in.** `POST /api/admin/seed` wipes and reseeds; nothing is seeded at startup.
- **Sessions in Postgres.** `connect-pg-simple` keeps users signed in across deploys.
