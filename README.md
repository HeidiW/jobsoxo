# JobsOxo

**Invoicing and job management for construction painting & decorating.**

Manage clients, jobs, invoices, payroll, and scheduling in one place. Connects to Gmail to surface client emails as actionable tasks, and sends invoices and payment reminders by email and SMS.

---

## Tech Stack

### Frontend
| Library | Version | Role |
|---|---|---|
| React | 18.3 | UI framework |
| Vite | 7.3 | Dev server & bundler |
| TypeScript | 5.6 | Language |
| Wouter | 3.3 | Client-side routing |
| TanStack Query | 5.60 | Server state, caching, mutations |
| shadcn/ui + Radix UI | — | Component primitives |
| Tailwind CSS | 3.4 | Utility-first styling |
| Framer Motion | 11 | Animations |
| Recharts | 2.15 | Dashboard charts |
| React Hook Form | 7.55 | Form state management |
| Zod | 3.24 | Schema validation (shared with backend) |
| date-fns | 3.6 | Date formatting & math |
| jsPDF + html2canvas | 4.2 / 1.4 | Client-side PDF generation |
| lucide-react | 0.453 | Icons |

### Backend
| Library | Version | Role |
|---|---|---|
| Express | 4.21 | HTTP server |
| Drizzle ORM | 0.39 | Type-safe SQL query builder |
| drizzle-zod | 0.7 | Auto-generates Zod schemas from Drizzle tables |
| PostgreSQL (pg) | 8.16 | Database driver |
| Passport.js | 0.7 | Authentication middleware |
| express-session | 1.18 | Session management |
| connect-pg-simple | 10 | PostgreSQL-backed session store |
| multer | 2.2 | File upload handling (documents) |
| pdf-parse | 2.4 | Server-side PDF text extraction |
| bcryptjs | 3.0 | Password hashing |
| tsx | 4.20 | TypeScript execution in dev |

### Testing
| Library | Version | Role |
|---|---|---|
| Vitest | 4.1 | Test runner |
| Supertest | 7.2 | HTTP integration testing |

---

## External APIs

| Service | Purpose | Keys required |
|---|---|---|
| **Resend** | Send invoices and payment reminders by email | `RESEND_API_KEY` |
| **Twilio** | Send payment reminders by SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| **Google OAuth** | User sign-in via Google account | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| **Gmail API** | Per-user inbox sync — surfaces client emails as tasks | same Google credentials above |
| **Yahoo OAuth** | User sign-in via Yahoo account | `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` |
| **Microsoft OAuth** | User sign-in via Microsoft account *(not configured)* | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| **Apple OAuth** | User sign-in via Apple ID *(not configured)* | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` |

---

## Database Schema

All tables live in a single PostgreSQL database. Schema is defined in `shared/schema.ts` using Drizzle ORM, and changes ship as versioned migrations in `migrations/` (see [docs/database-migrations.md](docs/database-migrations.md)).

| Table | Description |
|---|---|
| `users` | App user accounts (username/password or OAuth) |
| `invites` | Invite codes for new user registration |
| `oauth_accounts` | Linked OAuth provider accounts per user |
| `clients` | Client contact records |
| `jobs` | Jobs linked to clients (quoted / scheduled / in_progress / completed) |
| `line_items` | Pricing line items attached to jobs or invoices |
| `invoices` | Invoices (draft / sent / paid / overdue / partial) |
| `payments` | Payment records against invoices |
| `change_orders` | Change orders attached to invoices (pending / approved / rejected) |
| `employees` | Employee records with hourly rates and positions |
| `employee_assignments` | Many-to-many: employees assigned to jobs |
| `time_entries` | Time logged by employees against jobs |
| `payroll_records` | Payroll run records per employee per period |
| `google_tokens` | Per-user Gmail OAuth tokens (access + refresh) |
| `inbox_tasks` | Cached Gmail messages surfaced as client tasks |
| `settings` | Per-user app settings (company info, reminder config, etc.) |
| `job_documents` | Files uploaded against a job (PDFs, photos, specs) |

---

## API Routes

### Authentication — `/api/auth`
```
GET  /api/auth/setup-status       First-run check (no users yet?)
POST /api/auth/register            Initial admin account creation
POST /api/auth/signup              Invite-gated signup
POST /api/auth/login               Username/password login
POST /api/auth/logout              Destroy session
GET  /api/auth/me                  Current user
POST /api/auth/forgot-password     Send reset link (Resend)
GET  /api/auth/verify-reset-token  Validate reset token
POST /api/auth/reset-password      Apply new password
GET  /api/auth/providers           Which OAuth providers are configured
GET  /api/auth/callback-urls       OAuth callback URLs (for provider setup)
GET  /api/auth/google              → Google OAuth
GET  /api/auth/google/callback
GET  /api/auth/microsoft           → Microsoft OAuth
GET  /api/auth/microsoft/callback
GET  /api/auth/apple               → Apple OAuth
POST /api/auth/apple/callback
GET  /api/auth/yahoo               → Yahoo OAuth
GET  /api/auth/yahoo/callback
```

### Clients — `/api/clients`
```
GET    /api/clients
GET    /api/clients/:id
POST   /api/clients
PATCH  /api/clients/:id
DELETE /api/clients/:id
```

### Jobs — `/api/jobs`
```
GET    /api/jobs
GET    /api/jobs/:id
POST   /api/jobs
PATCH  /api/jobs/:id
DELETE /api/jobs/:id
GET    /api/jobs/:id/documents
POST   /api/jobs/:id/documents        (multipart/form-data)
GET    /api/job-documents/:docId/download
DELETE /api/job-documents/:docId
GET    /api/jobs/:id/line-items
GET    /api/jobs/:id/assignments
PUT    /api/jobs/:id/assignments
```

### Line Items — `/api/line-items`
```
POST   /api/line-items
PATCH  /api/line-items/:id
DELETE /api/line-items/:id
POST   /api/invoices/:id/line-items
```

### Invoices — `/api/invoices`
```
GET    /api/invoices
GET    /api/invoices/:id
POST   /api/invoices
PATCH  /api/invoices/:id
DELETE /api/invoices/:id
POST   /api/invoices/parse-document    (upload PDF/image → extract line items)
POST   /api/invoices/:id/send          (email invoice via Resend)
POST   /api/invoices/:id/mark-paid
POST   /api/invoices/:id/payments      (record a payment)
GET    /api/invoices/:id/change-orders
POST   /api/invoices/:id/change-orders
POST   /api/invoices/:id/send-change-order
```

### Change Orders — `/api/change-orders`
```
GET    /api/change-orders
POST   /api/change-orders
PATCH  /api/change-orders/:id
DELETE /api/change-orders/:id
```

### Employees, Time & Payroll
```
GET    /api/employees
GET    /api/employees/:id
POST   /api/employees
PATCH  /api/employees/:id
DELETE /api/employees/:id
GET    /api/time-entries
POST   /api/time-entries
DELETE /api/time-entries/:id
GET    /api/payroll-records
POST   /api/payroll-records/run
PATCH  /api/payroll-records/:id
DELETE /api/payroll-records/:id
```

### Gmail Inbox — `/api/gmail` & `/api/inbox`
```
GET    /api/gmail/auth              Begin per-user Gmail OAuth flow
GET    /api/gmail/callback          OAuth callback → store token
GET    /api/gmail/status            Is current user's Gmail connected?
GET    /api/gmail/labels            Fetch Gmail labels for filtering
GET    /api/gmail/sync-labels       Get saved label filter config
PATCH  /api/gmail/sync-labels       Update label filter config
DELETE /api/gmail/disconnect        Revoke Gmail access

GET    /api/inbox/status            Inbox connection status
GET    /api/inbox/last-sync         Timestamp of last sync
GET    /api/inbox/messages          Fetch live Gmail messages (triggers sync)
GET    /api/inbox/tasks             Cached inbox tasks
POST   /api/inbox/sync              Manual sync for current user
POST   /api/inbox/sync/all          Admin: sync all connected users
PATCH  /api/inbox/tasks/:emailId/done
PATCH  /api/inbox/tasks/:emailId/dismiss
PATCH  /api/inbox/tasks/:emailId/snooze
PATCH  /api/inbox/tasks/:emailId/restore
GET    /api/inbox/tasks/hidden
DELETE /api/inbox/tasks/:emailId
DELETE /api/inbox/tasks/dismissed
DELETE /api/inbox/tasks/bulk
```

### Dashboard, Reminders & Settings
```
GET    /api/dashboard
POST   /api/reminders/process       Trigger overdue invoice reminder run
GET    /api/invites
POST   /api/invites
DELETE /api/invites/:id
GET    /api/settings
PATCH  /api/settings
GET    /api/sms/config
POST   /api/sms/inbound             Twilio inbound SMS webhook
```

---

## Pages

| Route | Page |
|---|---|
| `/` | Dashboard — revenue chart, KPI cards, recent invoices |
| `/clients` | Client list |
| `/clients/:id` | Client detail (jobs, invoices, contact info) |
| `/jobs` | Job list with status filters |
| `/jobs/:id` | Job detail |
| `/jobs/:id/line-items` | Job pricing breakdown |
| `/invoices` | Invoice list |
| `/invoices/new` | Create invoice |
| `/invoices/:id` | Invoice detail |
| `/invoices/:id/payment` | Record payment |
| `/change-orders` | Change order list |
| `/scheduling` | Team scheduling calendar |
| `/payroll` | Payroll runs and time tracking |
| `/gmail-todos` | Gmail-sourced client task list (Smart Inbox) |
| `/inbox-tasks` | Business-action inbox (dismiss / snooze / done) |
| `/settings` | Company info, reminders, integrations |
| `/login` | Sign-in (username/password or OAuth) |
| `/reset-password` | Password reset |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |

---

## Project Structure

```
/
├── client/                  # Vite + React frontend
│   └── src/
│       ├── components/      # Shared UI components (sidebar, forms, etc.)
│       ├── pages/           # One file per route
│       ├── hooks/           # Custom React hooks
│       ├── lib/             # queryClient, utils
│       └── index.css        # Design tokens + Tailwind base
├── server/                  # Express backend
│   ├── index.ts             # App entry point, startup hooks
│   ├── routes.ts            # All API route handlers (~2 000 lines)
│   ├── storage.ts           # Data access layer (IStorage interface)
│   ├── db.ts                # Drizzle + pg pool
│   ├── email.ts             # Resend email helpers
│   ├── sms.ts               # Twilio SMS helpers
│   ├── gmail.ts             # Gmail API + OAuth token management
│   ├── oauth.ts             # Passport strategy setup
│   ├── scheduler.ts         # Daily inbox auto-sync (cron-style)
│   ├── seed.ts              # Demo data seeder (runs on empty DB)
│   ├── document-parser.ts   # PDF/image → line-item extraction
│   └── static.ts            # Production static file serving
├── shared/
│   └── schema.ts            # Drizzle table definitions + Zod schemas (shared)
├── design/                  # Design reference files (.dc.html, .md)
└── drizzle.config.ts        # Drizzle Kit configuration
```

---

## Development

Requires Node 20+ and PostgreSQL 16. There's no dotenv; load `.env` into the shell first.

```bash
# Install dependencies
npm install

# Configure: copy and fill in (DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY at minimum)
cp .env.example .env
set -a; source .env; set +a

# Create the database schema
createdb jobsoxo_dev
npm run db:migrate

# Start dev server (Express + Vite on $PORT; use 5050 on macOS, where AirPlay holds 5000)
npm run dev

# After changing shared/schema.ts, generate a migration and apply it
npm run db:generate -- --name <what_changed>
npm run db:migrate

# Type-check
npm run check

# Run tests (against a separate database built with db:migrate; tests run in America/New_York)
DATABASE_URL=postgresql://localhost/jobsoxo_test npm test
```

### Environment variables

The main variables are below; `.env.example` lists every one the server reads (including Gusto, Plaid, Stripe, Apple and Google Maps).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Secret for express-session cookie signing (server won't start in production without it) |
| `ENCRYPTION_KEY` | Yes | 64 hex chars; encrypts stored bank and provider tokens. Production key must be copied exactly when moving hosts |
| `RESEND_API_KEY` | Yes | Resend API key for sending emails |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio account SID for SMS |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Yes | Twilio outbound phone number |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID (sign-in + Gmail) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `APP_URL` | Yes | Public base URL (e.g. `https://yourapp.replit.app`) |
| `YAHOO_CLIENT_ID` | Optional | Yahoo OAuth client ID |
| `YAHOO_CLIENT_SECRET` | Optional | Yahoo OAuth client secret |
| `MICROSOFT_CLIENT_ID` | Optional | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | Optional | Microsoft OAuth client secret |
| `INBOX_SYNC_HOUR` | Optional | Hour (0–23) for daily Gmail auto-sync (default: `8`) |

---

### Google Docs OAuth configuration

Google Docs uses the same Google OAuth client as Gmail. The application
constructs one canonical redirect URI from `APP_URL`:

```text
<APP_URL>/api/google-docs/callback
```

Before connecting a document, complete this checklist for every environment:

1. Set `APP_URL` to that environment's public application URL, including the
   `https://` scheme. Do not use a localhost URL or a Replit preview URL for a
   published deployment.
2. In Google Cloud Console, open **APIs & Services → Credentials**, select the
   OAuth 2.0 Client ID used by `GOOGLE_CLIENT_ID`, and add the exact URI
   `<APP_URL>/api/google-docs/callback` under **Authorized redirect URIs**.
3. Register the development and published values separately when they have
   different public hosts. For example:
   `https://your-dev-host.replit.dev/api/google-docs/callback` and
   `https://yourapp.replit.app/api/google-docs/callback`.
4. Keep `APP_URL` and the registered host in sync after changing domains.
   Trailing slashes on `APP_URL` are normalized by the application, but the
   callback path and host must still match exactly.

If `APP_URL` is missing, malformed, or includes a query string/hash, Google
Docs connection stops with a configuration message instead of sending an
invalid OAuth request.

---

## Key Design Decisions

- **Shared schema** — `shared/schema.ts` is imported by both the frontend (for TypeScript types) and the backend (for Drizzle queries). A single source of truth for all data shapes.
- **Thin routes, typed storage** — all DB access goes through `IStorage` in `storage.ts`. Routes stay thin; business logic stays in the storage layer.
- **Per-user Gmail OAuth** — each user connects their own Gmail account. Tokens are stored in `google_tokens` and refreshed automatically.
- **Demo data** — `seed.ts` inserts demo clients, jobs, invoices, and employees, but only when an admin calls `POST /api/admin/seed`, which **wipes existing data first**. Nothing is seeded on startup.
- **PDF generation** — invoices are rendered to PDF client-side using jsPDF + html2canvas, keeping the server stateless.
- **Session storage** — sessions use `connect-pg-simple` to persist in PostgreSQL, so restarts don't log users out.
