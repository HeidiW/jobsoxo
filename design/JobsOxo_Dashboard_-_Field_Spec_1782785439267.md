# JobsOxo — Dashboard: Field Spec

A complete breakdown of `JobsOxo Dashboard.dc.html` → route `/`.
The **Cashflow-first** layout: money up top, then what needs action, then the week
ahead. Every value below is **derived from your data** — none should be hand-entered.
Mock numbers are shown as examples.

The screen is read-only except for the theme toggle and the action buttons/links.
All numbers, IDs, and money render in **IBM Plex Mono**.

---

## 0. Topbar

| Element | Type | Behavior |
|---|---|---|
| Sidebar toggle | icon button | Collapse/expand the sidebar (UI only). |
| Breadcrumb | text | "JobsOxo / Dashboard". |
| Search | input (icon) | Global search over invoices + clients. Stub for now. |
| Theme toggle | icon button | Light/dark; persists to `localStorage` (`jobsoxo-theme`). |

Greeting line: **"Good morning, {firstName}"** — time-of-day aware (morning /
afternoon / evening) + the signed-in user's first name.

---

## 1. Hero — Total Outstanding (blue card)

The headline cashflow number and its breakdown.

| Field | Type | Source / formula | Example |
|---|---|---|---|
| Total outstanding | money | `Σ balance of all invoices where status ∈ {sent, partial, overdue}` | $128,400 |
| Sub-caption | text | `"across {n} open invoices · {m} clients"` — counts of those invoices and their distinct clients | "across 9 open invoices · 4 clients" |
| Overdue | money | `Σ balance where status = overdue` (due date < today) | $18,600 |
| Due soon | money | `Σ balance where status = sent AND due date within next N days` (e.g. 30) | $94,000 |
| Draft | money | `Σ total where status = draft` | $15,800 |

**Actions**

| Button | Behavior |
|---|---|
| Send reminders | Bulk-email reminders for all overdue / due-soon invoices. |
| New invoice | → `/invoices/new`. |

---

## 2. Right column — secondary KPIs

| Card | Field | Source / formula | Example |
|---|---|---|---|
| Collected this month | amount | `Σ payments received where date in current month` | $86,250 |
| | delta | `% change vs same metric last month`; ▲ green / ▼ red | ▲ 18% |
| Active jobs | count | `count(jobs where status = "in progress")` | 7 |
| | sub-caption | `"· {crews} crews · {hours} hrs logged today"` from scheduling/payroll | "4 crews · 38 hrs logged today" |

---

## 3. Needs attention

A prioritized list of invoices that are overdue or due today — the daily "chase
money" worklist. Sort: most overdue first, then due-today.

**Card header**
- Title "Needs attention" + red dot.
- Caption: `"{n} invoices past due or due today"`.
- **View all →** link → `/invoices` (filtered to overdue/due).

**Each row**

| Field | Type | Source / formula | Example |
|---|---|---|---|
| Client / project + invoice # | text + mono | from the invoice | "The Vale Hotel — Lobby · JOX-1041" |
| Status line | text (colored) | overdue → "{d} days overdue" (red); partial → "Balance due today · partially paid" (amber); upcoming deposit → "Deposit due in {d} days" (gray) | "12 days overdue" |
| Amount | money | the **outstanding balance** for that invoice | $18,600 |
| Remind | button | Sends a payment reminder for that invoice. | — |
| Row click | link | → `/invoices/:id` (the row body, excluding the Remind button). | — |

> Edge case: when nothing is overdue, show an empty state ("You're all caught up")
> rather than an empty card.

---

## 4. This week on site

A 5-column Mon–Fri strip of scheduled crews — a glance at the week's field work.

**Card header**
- Title "This week on site".
- **Scheduling →** link → `/scheduling` (or `#` until that screen exists).

**Each day column**

| Field | Type | Source / formula | Example |
|---|---|---|---|
| Day label | text | weekday + date | "MON 2" |
| Job pill(s) | chip | each scheduled job that day; color-coded by job/crew | "Boulud · Basement" |
| Crew size | text | `"Crew of {n}"` for that assignment | "Crew of 4" |
| Empty day | muted text | "No jobs" when nothing is scheduled | — |
| Pill click | link | → `/jobs/:id` | — |

Pill colors are semantic per job (blue / green / purple…), matching the status
palette in the handoff spec. A day can hold more than one pill.

---

## 5. Data dependencies (summary)

The Dashboard reads from four sources; everything is computed, nothing stored:

- **Invoices** — status, total, balance, due date, client → hero, Needs attention.
- **Payments** — amount, date → Collected this month (+ MoM delta).
- **Jobs** — status, crew → Active jobs.
- **Scheduling** — assignments by day → This week on site.

```ts
interface DashboardData {
  outstanding: { total: number; invoiceCount: number; clientCount: number;
                 overdue: number; dueSoon: number; draft: number };
  collectedThisMonth: { amount: number; momDeltaPct: number };
  activeJobs: { count: number; crews: number; hoursToday: number };
  needsAttention: Array<{
    invoiceId: string; client: string; project?: string;
    reason: "overdue" | "due-today" | "deposit-due";
    detail: string;            // "12 days overdue"
    balance: number;
  }>;
  week: Array<{
    date: string; weekday: string;
    jobs: Array<{ jobId: string; label: string; crewSize: number; color: string }>;
  }>;
}
```

> Recommended: compute this in one server query / selector so the hero, KPIs, and
> lists never disagree. Money formats with the account currency; counts and money use
> IBM Plex Mono.

---

## 6. States to handle

- **Loading:** skeletons for the hero number, KPI cards, and list rows.
- **Empty:** no open invoices → hero shows `$0` + "Nothing outstanding"; Needs
  attention shows the caught-up state; week strip shows all "No jobs".
- **Error:** card-level retry rather than a full-page failure.

---

*Pairs with `JobsOxo Handoff.md` and the Create Invoice field spec. The
`JobsOxo Dashboard.dc.html` file is the visual reference for layout, spacing, and the
exact colors described here.*
