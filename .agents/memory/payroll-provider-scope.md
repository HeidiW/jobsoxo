---
name: Payroll provider scope
description: Separate responsibilities for Gusto payroll and the independent Plaid bank view.
---

Payroll must execute through Gusto inside JobsOxo, including calculation, submission, and employee ACH. Plaid is a separate integration for a bank view showing the current balance and latest 10 transactions; it is not a payroll dependency.

**Why:** The user explicitly corrected the conflation of the two integrations: Gusto is for payroll; Plaid is for bank visibility. Earlier descriptions of a combined processor-token workflow do not represent the intended product boundary.

**How to apply:** Do not require Plaid bank data, connection status, or processor tokens for payroll. A Plaid failure must not prevent Gusto payroll, and Gusto readiness must not gate the Plaid bank view. Prioritize Gusto implementation while Plaid work remains on hold unless separately requested. Do not substitute manual balance entry, funding attestations, worksheet handoff, or manual payroll confirmation for automation. Preserve existing data and audit history. Confirm actual Gusto capabilities and required verification rather than inventing a bank feed or bypassing provider requirements.

The user confirmed their Gusto developer application is **Embedded Payroll**, not App Integrations.

**Why:** Embedded company creation and migration have different authorization requirements. Gusto documents OAuth for connecting an existing Gusto company as part of migration to Embedded Payroll; a new partner-managed company receives company tokens during creation.

**How to apply:** Establish whether the target is a new demo company or an existing company before choosing onboarding. Never automatically migrate an existing company or accept its terms of service on the user's behalf. Do not equate successful OAuth authorization with completed migration or payroll readiness.
