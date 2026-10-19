---
name: Payroll provider scope
description: User-defined automation requirements and current Gusto-only payroll scope.
---

Payroll must execute through Gusto inside JobsOxo, including calculation, submission, and employee ACH. Plaid integration work is on hold, not to be deleted.

**Why:** The user clarified that payroll should avoid requiring multiple platforms, then explicitly chose Gusto-only implementation with Plaid deferred.

**How to apply:** Do not require Plaid bank data or processor tokens for the current payroll flow. Do not substitute manual balance entry, funding attestations, worksheet handoff, or manual payroll confirmation for the automated integration. Preserve existing data and audit history. Confirm actual Gusto capabilities and required verification rather than inventing a bank feed or bypassing provider requirements.
