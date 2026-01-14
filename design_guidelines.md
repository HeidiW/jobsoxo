# Design Guidelines: Construction Invoicing & Payroll Application

## Design Approach

**Selected Approach**: Design System - Modern SaaS Utility
**Inspiration**: Linear (data clarity) + Stripe Dashboard (financial trust) + Notion (content organization)
**Rationale**: This is a utility-focused, data-intensive application requiring efficient workflows, clear information hierarchy, and professional credibility for financial transactions.

## Core Design Principles

1. **Clarity Over Decoration**: Every element serves a functional purpose
2. **Scannable Data**: Tables and forms optimized for quick information retrieval
3. **Trust Through Simplicity**: Clean, professional aesthetic appropriate for financial data
4. **Workflow Efficiency**: Minimize clicks, maximize contextual information

## Typography System

**Font Stack**: 
- Primary: Inter (Google Fonts) - body text, UI elements, data tables
- Monospace: 'IBM Plex Mono' (Google Fonts) - invoice numbers, monetary values, IDs

**Hierarchy**:
- Page Titles: text-3xl font-semibold (Dashboard, Invoices, Clients, etc.)
- Section Headers: text-xl font-semibold
- Card Titles: text-lg font-medium
- Body Text: text-base font-normal
- Labels: text-sm font-medium uppercase tracking-wide
- Table Headers: text-sm font-semibold
- Data/Numbers: text-base font-mono (financial figures, dates, IDs)
- Helper Text: text-sm text-muted

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16 for consistency
- Component padding: p-4, p-6
- Section spacing: space-y-6, space-y-8
- Card spacing: p-6
- Form fields: space-y-4
- Table cell padding: px-4 py-3

**Grid Structure**:
- Main container: max-w-7xl mx-auto px-4
- Sidebar navigation: Fixed left sidebar (w-64), main content area with ml-64
- Dashboard cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
- Form layouts: Single column max-w-2xl for focused data entry

## Application Structure

### Navigation
**Sidebar Navigation** (Fixed left, full height):
- Company logo/name at top
- Primary sections: Dashboard, Clients, Jobs, Invoices, Scheduling, Payroll, Settings
- Active state: Subtle background highlight with border accent
- Icons: Heroicons (outline for inactive, solid for active)

**Top Bar**:
- Right-aligned: User profile dropdown, notifications bell icon
- Search bar for global search (invoices, clients, jobs)
- Breadcrumb navigation below for context

### Dashboard Layout
**Metrics Cards** (4 cards in grid):
- Outstanding Invoices (total amount)
- This Month Revenue
- Active Jobs
- Upcoming Deadlines
- Each card: Icon, large number (text-3xl font-bold font-mono), label, trend indicator

**Recent Activity Section**:
- Two-column layout: Recent Invoices (left) + Upcoming Jobs (right)
- Compact table view with key details, "View All" links

### Client Management
**Client List View**:
- Search and filter bar at top
- Data table: Client Name, Contact, Active Jobs, Outstanding Balance, Last Invoice Date, Actions
- Row hover state for interactivity
- Action buttons: Edit, View Details, Create Invoice

**Client Detail View**:
- Header card: Client info, contact details, total revenue, outstanding balance
- Tabs: Jobs, Invoices, Payment History
- Timeline view of all interactions

### Job & Invoice Creation Forms
**Multi-step Form Pattern**:
- Progress indicator at top (Step 1 of 3)
- Each section in well-defined card containers
- Required fields with asterisk, validation messages inline

**Itemized Breakdown Builder**:
- Add line item button (+ Materials, + Labor, + Square Footage)
- Dynamic table with: Item Description, Quantity, Unit, Rate, Amount
- Inline editing, delete row button
- Running total sidebar (Subtotal, Tax, Total) sticky on right

### Invoice Display
**Professional Invoice Layout**:
- Header: Company details (left), Invoice # and Date (right)
- Client details section
- Itemized table with clear borders and zebra striping
- Totals section: well-aligned on right
- Payment terms and notes at bottom
- Action buttons: Download PDF, Send Email, Mark as Paid, Record Payment

### Scheduling Calendar
**Calendar View**:
- FullCalendar integration with month/week/day views
- Job blocks: Show client name, job type, assigned employee
- Drag-and-drop for rescheduling
- Side panel: Filters (by employee, job status, client)

### Payroll Management
**Employee Table**:
- Employee Name, Hours This Period, Hourly Rate, Total Pay, Status
- Quick entry row at top for logging hours
- Export payroll report button

## Component Library

### Tables
- Bordered style with rounded corners
- Header row with bold text and subtle background
- Zebra striping for body rows (alternate subtle background)
- Hover state on rows
- Action column with icon buttons (Edit, Delete, View)
- Pagination at bottom

### Forms
- Grouped fieldsets with labels
- Input fields: Full-width within container, clear borders, focus ring
- Select dropdowns: Chevron icon, native styling
- Date pickers: Calendar popup aligned to input
- Currency inputs: Dollar sign prefix, monospace font
- Required field indicators: Red asterisk

### Buttons
- Primary: Solid fill for main actions (Create Invoice, Send Email, Save)
- Secondary: Outlined for secondary actions (Cancel, Download)
- Destructive: For delete/remove actions
- Icon buttons: For table actions, minimal padding
- Sizes: sm for tables/compact areas, base for forms, lg for primary CTAs

### Cards
- Rounded corners (rounded-lg)
- Subtle border, slight shadow
- Padding: p-6
- Header section with title and optional action button

### Modals/Dialogs
- Centered overlay with backdrop
- Max width based on content (max-w-md for confirmations, max-w-2xl for forms)
- Header with title and close X button
- Footer with action buttons (right-aligned)

### Status Badges
- Pill-shaped with small padding
- Invoice statuses: Draft, Sent, Paid, Overdue, Partial
- Job statuses: Quoted, Scheduled, In Progress, Completed
- Semantic styling per status type

### Alerts/Notifications
- Toast notifications for actions (top-right)
- Inline alerts for form errors (above form)
- Success/Error/Warning/Info variants

## Data Visualization

**Invoice Status Overview**:
- Simple bar chart showing payment status breakdown
- Donut chart for revenue by job type

**Keep minimal** - only where it aids decision-making

## Responsive Behavior

- Sidebar: Collapses to icon-only on tablet, hamburger menu on mobile
- Tables: Horizontal scroll on mobile, card view for key tables
- Forms: Single column throughout
- Dashboard: Stack cards vertically on mobile

## Animation Guidelines

**Minimal, purposeful motion**:
- Page transitions: None
- Dropdown menus: Simple opacity fade (150ms)
- Modal entrance: Subtle scale and fade (200ms)
- Table row actions: Instant, no animation
- Loading states: Spinner for async operations

**Critical**: Avoid distracting animations in data-heavy workflows