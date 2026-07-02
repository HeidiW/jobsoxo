---
name: Change order definition
description: Domain rule — any modification to a saved/existing invoice is called a change order, not an edit
---

# Change orders are the result of modifying an existing invoice

In the construction painting & decorating domain, once an invoice exists:
- Any addition, removal, or modification to its scope/line items is formally called a **change order**
- The output document produced by that change is a change order, not an "edited invoice"

**Why:** This is industry standard in construction — the original invoice represents the agreed contract price; any deviation from it must be documented as a change order so both parties have a clear audit trail of what changed and why.

**How to apply:**
- UI copy should say "Change Order" (not "Edit invoice" or "Add line item") when the intent is modifying an existing, saved invoice
- Adding a new line item to a saved invoice = creating a change order line item
- The change-orders table and workflow (status: pending/approved/rejected) is the correct path for post-save modifications
- Direct header field edits (dates, client, tax rate, notes) are metadata fixes and may remain as plain edits — the change order concept applies primarily to scope/line item changes
