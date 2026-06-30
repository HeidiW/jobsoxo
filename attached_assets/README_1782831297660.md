# JobsOxo — Gmail Messages screen (Replit handoff)

Rebuild this one screen as a React page in the existing Vite + wouter + shadcn app.
The `.dc.html` files are the **visual source of truth** — match their layout, spacing,
colors, and type. Open them directly in a browser to see them render (they load
`support.js`, the small runtime included here).

## Files
- **`JobsOxo Gmail Messages.dc.html`** — the screen to build.
- **`JobsOxo Nav.dc.html`** — the shared sidebar this screen imports (`<dc-import name="JobsOxo Nav" active="inbox">`). You likely already have this as `AppShell`/`Sidebar` — reuse it; don't rebuild.
- **`support.js`** — DC runtime, only so the two files above render in a browser.
- **`JobsOxo Handoff.md`** — full app spec: theme tokens (light/dark), status colors, component map, behaviors. Read this for the design tokens.

## Route
Not in the original route map. Suggested: **`/inbox/messages`** (or fold into the
existing `/inbox`). Sidebar active item = `inbox`.

## What this screen is
A daily task list built from **new email messages** that mention or come from clients,
with an auto-generated summary. The banner is **styled to resemble a Gemini-style AI
summary** but is **not** Gemini — it does not call Gemini or any external AI. Treat the
sparkle/badge as visual styling only; the underlying feature just pulls in new inbox
messages and summarizes them. Layout:
- Topbar: breadcrumb `JobsOxo / gmail_messages`, theme toggle.
- Title "Today's tasks" + "{done} of {total} done" + Regenerate button.
- Summary banner (gradient sparkle, "Summarized from your inbox", count + timestamp, badge) — AI-summary *styling*, not an actual Gemini integration.
- Thin progress bar driven by done/total.
- Client filter chips ("All clients" + one per distinct client; active = blue fill).
- Task rows: round checkbox toggle, priority dot, action text (strike-through when done), client badge (colored), "from {sender} · "{subject}"", time (mono), Open link.

## Behaviors to preserve
- **Theme** persists in `localStorage` key `jobsoxo-theme`, applied app-wide (same as the rest of the app).
- Checking a task toggles done → strike-through + faded, updates the count and progress bar.
- Filter chips filter the list by client.
- Numbers, IDs, times, money in **IBM Plex Mono**; UI in **Inter**.
- Each task's "Open" links to the relevant screen (client detail, invoice detail, scheduling, change orders, create invoice) — wire to the matching wouter routes.

The task data in the `.dc.html` is illustrative fixture data; in the real app these
are derived from incoming inbox messages and their summaries — **not** from Gemini or
any external AI service. The Gemini-like look is purely a design choice.
