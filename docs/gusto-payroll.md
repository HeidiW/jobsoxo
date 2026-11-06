# Gusto payroll and independent bank visibility

## Provider boundary

Gusto Embedded handles payroll calculation, company funding debits, and employee
ACH. JobsOxo's Plaid integration is a separate, read-only bank display. Payroll
does not call Plaid, create processor tokens, or compare a balance to the debit.
Existing Plaid data and unrelated reconciliation features remain in place.

The local worksheet and local payroll records are source/reference records,
not proof of payment. Historical confirmations remain readable; they are not
the execution path for new payroll.

## Authorization and environments

The application currently represents one business. A Gusto company is bound to
an authenticated administrator. Other administrators cannot read or submit that
administrator's runs or attach the same company to a different ownership boundary.
This is not a multi-company payroll tenancy implementation.

Use the secure integration/Secrets setup, never credentials in chat or source.
The direct-client bootstrap supports:

- `GUSTO_ENV`: `demo` (default) or `production`.
- `GUSTO_COMPANY_ID`: authorized Embedded company UUID.
- `GUSTO_ACCESS_TOKEN`: company-level access token, not a system token.
- `GUSTO_REFRESH_TOKEN`, `GUSTO_CLIENT_ID`, `GUSTO_CLIENT_SECRET`: needed for
  ongoing authorization as short-lived company tokens expire.
- `GUSTO_WEBHOOK_SECRET`: Gusto webhook subscription verification token.

The explicit **Connect Gusto company** action validates token ownership and
required scopes before persisting an encrypted access/refresh-token bundle.
Token rotation is serialized with a database row lock. API errors, setup URLs,
and payroll response bodies are not written to request logs. The encryption-key
rotation script also rotates the Gusto bundle without exposing its contents.

API calls pin Gusto's `2026-06-15` version. Demo and production hosts are separated;
arbitrary API hosts are rejected. Live payroll is disabled unless
`GUSTO_LIVE_PAYROLL_ENABLED=true` is explicitly configured after production
approval and release authorization. This also gates hosted run-payroll flows.

Standard Gusto App Integration credentials do not grant Embedded payroll
execution. Required scopes include `payrolls:read`, `payrolls:write`,
`payrolls:run`, `flows:write`, `companies:read`,
`company_onboarding_status:read`, `company_bank_accounts:read`,
`employees:read`, and `employee_payment_methods:read`.

## Setup and calculation

Gusto-hosted workflows are embedded inside JobsOxo for company onboarding,
funding setup/verification, and employee onboarding. Bank details stay in
Gusto's UI. Required Gusto verification is not bypassed or represented as a
manual funding attestation. A replacement funding account can disable the
previous default; the UI warns before opening that workflow.

Employee readiness comes from the authorized company's employee list and
Direct Deposit payment method. Initial matching requires an unambiguous email;
subsequent synchronization uses the existing provider ID. A Plaid bank link
does not establish employee readiness.

Regular payroll preparation selects exactly one unprocessed Gusto payroll with
the chosen pay period and pay date. It uses company-scoped prepare/update/
calculate/submit endpoints and compensation versions. Employees without source
rows are explicitly excluded rather than left payable by omission.

Gusto owns wage rates, taxes and deductions. JobsOxo supplies actual source
hours; estimated local gross is not silently turned into a bonus or tax
instruction. Multiple-job hour allocations and unsupported day-only conversions
fail explicitly rather than guessing. Configure actual employee compensation
and pay schedules through Gusto setup. W-2 payroll does not submit 1099 workers.

Some employee-level values, especially net pay, are nullable before processing.
The UI displays unavailable values honestly while showing Gusto's aggregate
calculation. No local tax estimate substitutes for a missing provider result.

## Submission and reconciliation

- Creating a local run and its items is transactional and idempotent.
- A provider payroll can belong to only one local run.
- A calculation's asynchronous acknowledgement does not mean it is ready.
- Submission checks current Gusto company and employee readiness, then compares
  the latest provider calculation with the calculation the admin reviewed.
  Changed amounts, employees, dates, payment methods, or blockers require review.
- A locked state transition permits only one submission claimant.
- An ambiguous submission is reconciled, never automatically submitted again.
  A stale `unprocessed` response is not sufficient evidence to retry payment.
- Signed webhooks use the exact request bytes and Gusto's official event
  envelope. Deduplication and state changes commit in one transaction.
  Events from another company/environment do not update a run.
- `processed` is not proof of employee bank settlement. `payroll.paid` reports
  that employee payments were initiated, not final bank settlement.
- Cancellation is offered only when Gusto says the payroll is cancellable.
  It is not a generic promise to reverse an ACH payment.

## Database and verification

The schema repair is additive and repeatable:
`migrations/development/gusto-only-payroll.sql`. It creates missing Gusto tables
and adds the required columns without dropping data. It is a development repair,
not a production startup or deployment-build migration. Managed production
schema changes belong to Replit Publish's schema review.

Automated tests cover authorization, encrypted token refresh, idempotency,
Plaid-outage independence, asynchronous calculation/submission, changed-review
protection, concurrent submit requests, timeout reconciliation, signed webhook
replay/ownership, redaction, hosted setup, UI confirmation, and history access.
These use simulated Gusto responses. Real Gusto sandbox certification still
requires an authorized Embedded company and is separate from these tests.

Official references:

- https://docs.gusto.com/embedded-payroll/docs/authentication-and-authorization
- https://docs.gusto.com/embedded-payroll/docs/complete-a-regular-payroll
- https://docs.gusto.com/embedded-payroll/docs/payroll-processing-request
- https://docs.gusto.com/embedded-payroll/docs/manage-company-bank-accounts
- https://docs.gusto.com/embedded-payroll/docs/flow-types
- https://docs.gusto.com/embedded-payroll/docs/webhooks
