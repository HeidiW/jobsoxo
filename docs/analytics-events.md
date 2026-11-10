# JobsOxo Google Analytics events

JobsOxo uses Google Analytics 4 for custom events. The tracker is loaded only
when `VITE_GA_MEASUREMENT_ID` is configured. Event payloads intentionally use
workflow metadata only; they do not include customer names, email addresses,
invoice numbers, document content, account IDs, or financial amounts.

## Invoices and payments

| Event | Properties | Description |
| --- | --- | --- |
| `invoice_created` | `delivery`, `import_source`, `item_count` | A draft was created or an invoice was sent successfully |
| `invoice_import_applied` | `source`, `item_count` | A user applied reviewed PDF or Google Doc items to the invoice builder |
| `payment_recorded` | `method`, `source` | A payment was recorded from the invoice list or reconciliation workflow |

## Jobs and materials

| Event | Properties | Description |
| --- | --- | --- |
| `job_saved` | `action`, `status` | A job was created or updated successfully |
| `job_deleted` | None | A job was deleted successfully |
| `material_saved` | `action`, `count` | A material was created or updated successfully; `action: "scanned"` with `count` when saved from a receipt scan |
| `receipt_scanned` | `items`, `isReceipt` | Claude read an uploaded receipt (before the person reviewed or saved anything) |
| `material_deleted` | None | A material was deleted successfully |

## Account connections

| Event | Properties | Description |
| --- | --- | --- |
| `gmail_connected` | `location` | Gmail OAuth returned successfully |
| `gmail_disconnected` | `action`, `location` | Gmail was disconnected, including before an account switch |
| `google_docs_connected` | `location` | Google Docs OAuth returned successfully |

## Useful questions

- How many invoices are created as drafts versus sent directly?
- Which invoice import source leads to the most completed imports?
- How often are recorded payments coming from reconciliation versus the invoice list?