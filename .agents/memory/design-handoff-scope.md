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

During staged page redesigns, resolve conflicting legacy visual defaults locally rather than changing shared defaults for every page.

**Why:** The supplied design expects bold display headings and solid primary actions, but the existing display-font utility forces regular weight and the shared default button is outlined. Changing these globally would restyle pages before their review stage.

**How to apply:** Explicitly set the redesigned page's heading weight and primary button fill, check their computed appearance in the browser, and leave shared defaults unchanged until a separately approved global cleanup.

Do not describe an admin's change-order status update as a client's digital sign-off.

**Why:** The handoff's sign-off wording assumes a client approval flow. The existing admin actions alone do not establish that a client received or approved the change; copying that wording would imply an audit trail that does not exist.

**How to apply:** Preserve admin approval actions and make their invoice effect clear. Use pending-review wording until actual client approval is implemented, and keep client sign-off separate from an admin marking an order approved.
