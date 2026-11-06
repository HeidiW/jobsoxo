# JobsOxo — handoff from claude.ai (Nov 6, 2026)

Context carried over from a claude.ai chat so a Claude Code session can pick up where it left off. Put this file in the repo root and tell Claude Code: "Read HANDOFF.md and .agents/memory/MEMORY.md first."

## Where the project stands
- Stack: React + Vite client, Express server (TypeScript, tsx), Drizzle ORM on Postgres 16, Vitest tests, `npm run check` for typecheck.
- Currently runs only on Replit. Planned hosting: Render. Database: considering Supabase Postgres.
- Integrations: Gusto **Embedded Payroll** (demo company only so far), Plaid (separate bank view, not a payroll dependency), Google/Microsoft/Apple OAuth, per-user Gmail OAuth, Resend, Twilio, Stripe, Cloudflare R2.
- Existing agent memory lives in `.agents/memory/` — it records product decisions (payroll scope, change orders, schema safety, date handling). Treat it as authoritative and port it into `CLAUDE.md`. *(Done: ported into `CLAUDE.md` and `.agents/memory/` removed on Nov 6, 2026; the original files are in git history.)*

## Decisions and open questions from this chat

### Payroll provider (Check vs. Salsa vs. Gusto Embedded)
- Staying on Gusto Embedded for now; the integration is already built against a demo company.
- Check: deepest embedded API, trades customers (e.g. Housecall Pro), takes on credit/fraud risk; heavier front-end build; quote-based platform fee + per-employee usage.
- Salsa: fastest launch via Salsa Express pre-built UI; revenue-share pricing suits pre-revenue stage; smaller company (Series A).
- Before switching or scaling, ask every provider about: certified payroll / prevailing wage, union rates, multiple rates by job and trade, NY PFML, and early-stage minimum commitments.
- Don't build a payroll engine in-house. JobsOxo should own time, job rates, and job costing; the provider handles tax filing and money movement. Keep the provider behind an internal interface so it can be swapped.

### Moving from Replit to Claude Code + Render
Replit-specific pieces found in the repo:
1. `server/gmail.ts` has a Replit connector-proxy path (`REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`). Per-user Gmail OAuth also exists — confirm which path is actually used and remove the Replit one.
2. `.replit` provides Postgres 16 (`DATABASE_URL`), secrets, autoscale deploy (`npm run build` → `node dist/index.cjs`), and the test/typecheck workflows.
3. `scripts/post-merge.sh` runs `drizzle-kit push` after merges. Switch production to `drizzle-kit generate` + versioned migrations.
4. `vite.config.ts` loads three `@replit/vite-plugin-*` plugins only when `REPL_ID` is set — safe to remove.

Migration order:
1. Get the app running locally (local Postgres, `.env.example`), with Replit still live.
2. Write `CLAUDE.md` from `.agents/memory/`.
3. Remove the Replit Gmail connector path; confirm per-user Gmail OAuth works off Replit (Google Cloud project, registered callback URIs).
4. Move to versioned migrations.
5. `pg_dump` the Replit database, restore into the new Postgres, and test against a copy.
6. Copy every secret deliberately — especially the bank-account encryption key; verify existing encrypted data still decrypts before cutover.
7. Deploy to Render, cut over, keep Replit as a fallback for a couple of weeks.

## Suggested first prompt in Claude Code
> Read HANDOFF.md and .agents/memory/. Then get the app running locally against a local Postgres, run `npm test` and `npm run check`, and report what fails. Don't touch production data or Gusto settings.
