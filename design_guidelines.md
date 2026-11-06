# Design Guidelines: JobsOxo — "Ledger"

## Design Approach

**Selected Approach**: Classical / editorial system, carried over from the Conor Foy Plaster site so the product and the practice read as one brand.

**Direction**: A book, not a dashboard. Cormorant Garamond headings over Lora body on a pale blue ground, a single oxblood accent applied as **stroke rather than fill**, hairline rules carrying the structure, 4px radii, and elevation kept to a whisper. Numbers set tabular in the body face instead of a monospace.

**Rationale**: The old direction (Linear + Stripe + Notion, Inter, solid blue fills) is the default SaaS look and shares nothing with the CFP brand. A trade running twenty-year-old craft relationships reads more credibly in an editorial register — and a quiet, ruled page is *better* for dense financial data than filled cards competing for attention.

## Core Design Principles

1. **Draw with rules, not fills** — hairlines, borders and underlines define structure. Large blocks of solid color stay off the page.
2. **Color is a stroke** — the oxblood accent outlines, underlines and marks. It almost never fills.
3. **Give text room** — the spacing scale is airy by design; don't crowd the margins to fit one more row.
4. **Figures align** — anything that stands as a number sets tabular so columns of money read straight down.
5. **Weight is not emphasis** — italics and size do that work. Bold is retired.

## Typography System

**Font Stack**:
- Headings: **Cormorant Garamond** (`--font-serif`, `font-serif`, or `.font-display`)
- Body, UI, and figures: **Lora** (`--font-sans` / `font-sans`)
- `--font-mono` also resolves to Lora — **IBM Plex Mono is retired**. Money, IDs and dates get `font-feature-settings: 'tnum'` instead, applied automatically to `.font-mono`, all table cells, and anything marked `[data-tabular]`.

**Weights**: Bold is retired. Interface headings cap at **600**; `h1`/`h2` set at **400** — the bigger the text, the lighter it sets.

**Hierarchy**:
- Page Titles: `text-4xl font-normal font-serif`, tracking `-0.025em`
- Section Headers: `text-2xl font-normal font-serif`
- Card Titles: `text-lg font-semibold font-serif`
- Body Text: `text-[15px] font-normal` (Lora, line-height 1.55)
- Labels / kickers: `.kicker` — 10.5px, `tracking-[0.18em]`, uppercase, oxblood
- Table Headers: `text-[11px] tracking-[0.08em] uppercase text-muted-foreground`
- Data / Numbers: `font-mono` (Lora + tnum) — never a monospace face
- Helper Text: `text-sm text-muted-foreground`
- Emphasis inside prose: *italic*, not bold

## Color

A pale blue ground (`--background` #ebf2fa) with deep green-black ink (`--foreground` #132a13) and a single oxblood accent (`--primary` #640d14).

**The accent is mono** — there is no second brand color. Gold (#8b6740) appears only as a supporting tone in charts and badges.

**Contrast caveat**: oxblood-on-ground is tuned for icons, large text and chrome — **not body copy**. For paragraph-size text in the accent, it is already dark enough at #640d14; do not lighten it.

**Status badges** keep their hue for meaning but are pulled back into the classical palette (`--b-*-bg` / `--b-*-fg`). Oxblood/brick is reserved for money-critical states (Overdue, destructive actions) so it doesn't get spent on decoration.

**Dark mode ("Colophon")** inverts to the deep warm near-black the classical system uses for section dividers, and switches the accent to **gold** — oxblood does not hold up on a dark ground. Both modes ship; the existing toggle keeps working.

## Layout System

**Spacing**: the scale is airy (1.15× density). Tailwind units of 2, 4, 6, 8, 12, 16 as before, but prefer the larger end.
- Component padding: `p-6`
- Section spacing: `space-y-8`
- Table cell padding: `px-5 py-3.5`

**Grid Structure**: unchanged — `max-w-7xl` container, fixed `w-64` sidebar, main content offset. The restyle is a skin, not a re-layout.

## Component Library

### Buttons
- **Primary: an oxblood outline on transparent, never a solid fill.** This is the biggest departure from the old system and the one that most defines the look. See the README for the exact `button.tsx` variant change.
- Secondary: neutral outline
- Ghost: accent text, tinted hover
- Destructive: brick outline; solid fill only for a final irreversible confirm inside a dialog
- Hover/press come from the accent at reduced alpha, not a lightness jump

### Tables
- Hairline row rules, no zebra striping — the rules do that job
- Header row: letterspaced uppercase, muted, hairline beneath
- Row hover: `--rowhover`, a barely-there tint
- All cells tabular by default

### Cards
- Bordered and **unfilled** — `border border-card-border`, `rounded-md`, transparent or `--card` background
- `shadow-sm` at most; reach for a rule before a shadow
- Kicker + serif title + body

### Status Badges
- Pill or 2px-radius rectangle, `--b-*-bg` / `--b-*-fg`
- Small caps, letterspaced, 9.5–11px
- Prefer outlined badges on dense screens (tables) and tinted fills on sparse ones

### Forms
- Inputs: transparent, hairline border, oxblood caret, 2px accent `:focus-visible` ring
- Currency inputs: `$` prefix, tabular figures
- Required indicators: oxblood asterisk, not red

### Modals/Dialogs
- `--popover` surface, hairline border, `shadow-lg` (still a whisper)
- Serif title, right-aligned outlined actions

### Charts
- `--chart-1..5` = oxblood, gold, sage, slate, plum. Muted by design.
- Hairline axes and gridlines; no gloss, no gradient fills

## What was removed

- **Inter** and **IBM Plex Mono** — replaced by Lora and tabular figures
- **Solid blue primary fills** — the accent is a stroke now
- **The Smart Inbox gradient banner** (`--gem-bg`) — now a flat surface with a hairline and an oxblood ✳ mark. Classical draws with rules, not gradients.
- **Zebra striping** — hairline rules replace it
- **Heavy shadows** — elevation is a whisper
- **Bold weights** — italics and size carry emphasis

## Animation Guidelines

Unchanged and still minimal: no page transitions, 150ms opacity fades on dropdowns, 200ms scale+fade on modals, spinners for async. The old `sparklePulse` is retained but toned to a plain opacity breath — no rotation or scale.

**Critical**: avoid distracting animation in data-heavy workflows.

## Responsive Behavior

Unchanged: sidebar collapses to icons on tablet and a hamburger on mobile; tables scroll horizontally; forms go single column. Keep the airy spacing on mobile — reduce columns, not padding.
