---
name: JobsOxo redesign handoff
description: Staged visual redesign boundaries and conflicts between prototype examples and production behavior.
---

Apply the supplied JobsOxo redesign handoff in reviewable stages: theme tokens first, app shell second, Dashboard third, then remaining pages individually. Stop after each stage for the user's review.

**Why:** The user's uploaded handoff explicitly requests this sequence and review pauses. It targets nontechnical construction tradespeople and specifies high-fidelity visuals, not replacement business logic.

**How to apply:** Use its theme and screenshots as the visual reference, reuse existing production components and real API data, and do not import the prototype's markup, helper scripts, or sample data into the application.

The handoff places Gusto Worksheet in a **Payroll tab**, superseding the earlier sidebar-submenu interpretation. The Main Menu has nine primary destinations; Settings stays separate.

**Why:** The written design brief resolves the earlier ambiguity about what “under Payroll” means.

**How to apply:** Preserve existing worksheet permissions and legacy links when changing its navigation. Preserve both business-task and Gmail functionality when consolidating Inbox.

Prototype examples are not authorization to change financial or payment behavior.

**Why:** The handoff calls this a visual-only redesign, while sample interactions include marking payroll paid and copying a Gusto worksheet, which conflict with the user's established automated-payroll requirements.

**How to apply:** Keep existing validation, configured tax rules, and provider-driven payment statuses. Never mark payroll paid from a UI click or introduce a manual Gusto handoff; follow [payroll provider scope](payroll-provider-scope.md).
