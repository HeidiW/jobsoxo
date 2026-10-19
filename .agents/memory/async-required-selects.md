---
name: Async required selects
description: Preserving required form selections when asynchronously loaded Radix options are temporarily missing
---

Required, non-clearable Radix Select controls backed by asynchronous options should not accept an incidental empty-string change while those options are unavailable.

**Why:** A failed client-list request followed by a successful retry cleared the client preselected from the job even though the form was controlled. Radix can emit an empty value while its option list is temporarily absent.

**How to apply:** Ignore empty changes only where empty is not a valid user choice. Test both initial preselection and recovery from a failed options request. Do not apply this guard to optional fields that intentionally support clearing.
