# JobsOxo — Design Handoff Spec (React + Vite + wouter + shadcn/ui)

Seven connected screens, one shared app shell, light + dark mode. The `.dc.html`
files are the **visual source of truth** — match their layout, spacing, colors, and
type. This doc maps them onto your existing React app.

---

## 1. Stack target (your current setup)

- **React + Vite + TypeScript**
- **wouter** for routing
- **TanStack Query + Drizzle** for data (keep as-is)
- **shadcn/ui** + Tailwind
- **Fonts:** Inter (UI), IBM Plex Mono (numbers, IDs, dates, money)

No framework change — these designs drop straight into the app you already have.

---

## 2. Screen → route map (wouter)

| Design file | Route | Notes |
|---|---|---|
| `JobsOxo Dashboard.dc.html` | `/` | Cashflow-first layout. Landing page. |
| `JobsOxo Clients.dc.html` | `/clients` | Table of clients. |
| `JobsOxo Client Detail.dc.html` | `/clients/:clientId` | Tabs: Invoices / Jobs / Payment history. |
| `JobsOxo Jobs.dc.html` | `/jobs` | Status filter chips. |
| `JobsOxo Job Detail.dc.html` | `/jobs/:jobId` | Tabs: Scope / Invoices / Schedule. |
| `JobsOxo Invoices.dc.html` | `/invoices` | Invoice list + status badges. |
| `JobsOxo Invoice Detail.dc.html` | `/invoices/:invoiceId` | Document + payment rail + activity. |
| `JobsOxo Create Invoice.dc.html` | `/invoices/new` | The builder. Split / Tabbed / Builder views. |
| `JobsOxo Settings.dc.html` | `/settings` | Tabs: Business / Invoice defaults / Payment methods. |

Cross-links already in the designs map 1:1 onto these routes (an invoice row →
`/invoices/:id`, a job pill → `/jobs/:id`, "View client" → `/clients/:id`). Use
wouter's `<Link href="...">` and `useRoute` / `useParams` for the dynamic segments.

---

## 3. Suggested file structure

```
src/
  App.tsx                 # wouter <Switch> with the routes above, wrapped in <AppShell>
  components/
    app-shell/
      app-shell.tsx       # Sidebar + Topbar, renders children
      sidebar.tsx         # nav items; active state via wouter useLocation()
      topbar.tsx          # breadcrumb + search + theme toggle
    invoice/
      invoice-document.tsx  # the printable invoice (shared by detail + builder preview)
      line-item-editor.tsx  # grouped sections, deposit %/fixed
    ui/                   # shadcn components (existing)
  pages/
    dashboard.tsx
    clients.tsx
    client-detail.tsx
    jobs.tsx
    job-detail.tsx
    invoices.tsx
    invoice-detail.tsx
    create-invoice.tsx
    settings.tsx
  lib/
    theme.tsx             # ThemeProvider + useTheme (light/dark, localStorage)
    theme-tokens.css      # CSS variables below
```

`<AppShell>` wraps every route once so the sidebar/topbar aren't repeated per page.
Sidebar nav order: **Dashboard, Clients, Jobs, Invoices, Change Orders, Scheduling,
Payroll, Inbox Tasks**, then **Settings** (separated). Active item = white pill +
blue icon + soft shadow; derive it from `useLocation()`.

---

## 4. Theme tokens

Define once (`:root` + `.dark`) and reference everywhere. Toggle by adding/removing
`class="dark"` on `<html>`; persist to `localStorage` key `jobsoxo-theme`. Values
below are the exact ones used in the designs.

### Light
```css
--app-bg:#f8f9fb;  --sidebar:#f3f4f6;  --border:#e4e7ec;  --panel:#ffffff;
--fg:#0f1729;      --muted:#6b7686;    --faint:#8a93a3;   --primary:#2563eb;
--soft:#eef2fe;    --track:#eef0f3;    --row-hover:#f8fafc;
```

### Dark
```css
--app-bg:#0f1729;  --sidebar:#1a2336;  --border:#243049;  --panel:#141d30;
--fg:#f1f5f9;      --muted:#9aa6bd;    --faint:#7c8aa3;   --primary:#3b82f6;
--soft:#1c2a44;    --track:#1a2336;    --row-hover:#1b2740;
```

### Status badge colors (semantic — same names both modes)
- **Paid / complete:** green — light `bg #e7f7ee / fg #15a35a`
- **Sent / scheduled / in-progress(blue):** blue — `bg #eef2fe / fg #2563eb`
- **Partial / in-progress(amber):** amber — `bg #fef5e7 / fg #b6731a`
- **Overdue:** red — `bg #fdeeec / fg #d23b1f`
- **Draft / on-hold:** gray — `bg #eef0f3 / fg #6b7686`

---

## 5. Component → shadcn map

| UI element in designs | shadcn / pattern |
|---|---|
| Sidebar | `Sidebar` (or custom) + wouter `useLocation()` for active state |
| Topbar search | `Input` with leading icon |
| Theme toggle | `Button` (icon) toggling `.dark` on `<html>`, persisted to `localStorage` |
| KPI / stat cards | `Card` |
| Tables (clients, jobs, invoices) | `Table`, rows wrapped in wouter `<Link>` |
| Status pills | `Badge` (variant per status above) |
| Detail-page tabs | `Tabs` |
| Filter chips (Jobs) | `ToggleGroup` or `Button` group |
| Forms (Settings, Create Invoice) | `Input`, `Textarea`, `Select`, `Switch`, `Label` |
| Deposit %/fixed, view switcher | `Tabs` or segmented `ToggleGroup` |
| Progress bars | `Progress` |
| Icons | `lucide-react` (designs use Feather/Lucide-style strokes) |

---

## 6. Behaviors to preserve

- **Theme** persists in `localStorage` (`jobsoxo-theme`) and applies app-wide.
- **Create Invoice**: line items grouped into collapsible **sections** with live
  subtotals; **deposit** is % *or* fixed amount (shows the equivalent %); totals =
  subtotal → tax → grand total → deposit due → balance remaining. Three layouts
  (Split / Tabbed / Builder) — ship **Split** first if you want to scope down.
- **Reference codes** (PT-01B, ID-202…) are an optional per-line field, toggled in
  Settings → Invoice defaults.
- **Numbers, IDs, dates, money** render in IBM Plex Mono.

---

## 7. Money / data notes

Demo data is illustrative. The Boulud invoice (`JOX-1042`) totals **$312,400** with a
**20% deposit ($62,480)** across four sections (Basement, Ground-floor ceilings,
Walls & trim, Exterior) — use it as the seed/fixture to verify the builder and detail
math line up.

---

*Hand this file to Replit's Agent together with the seven `.dc.html` files. Tell it:
"Rebuild these as React pages in my existing Vite + wouter + shadcn app, one route per
screen per the handoff spec, matching the designs' layout and tokens."*
