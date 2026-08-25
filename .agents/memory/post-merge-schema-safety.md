---
name: Post-merge schema safety
description: Non-interactive database schema synchronization after task merges
---

Post-merge schema synchronization must remain non-interactive without automatically approving data-loss operations.

**Why:** Drizzle can prompt to truncate populated tables when adding a constraint. The merge runner has closed stdin, so leaving the prompt unattended can hang until the setup timeout; using `--force` could approve destructive truncation.

**How to apply:** Feed the safe “No, add the constraint without truncating the table” response to the schema push, and give the setup script enough time for dependency installation and database introspection.