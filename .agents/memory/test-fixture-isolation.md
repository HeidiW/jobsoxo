---
name: Test fixture isolation
description: Why normal tests use rollback isolation but database concurrency tests require owned-ID cleanup.
---

Default to rollback-only database fixtures, including for direct SQL and API tests.
Keep historical sample data unless the user separately approves its removal.

**Why:** Normal verification previously accumulated sample jobs and clients in
the shared application database. Deleting only parent clients misses unassigned
materials, and cleanup placed after assertions does not run when assertions fail.

**How to apply:** Use the default test isolation for new suites. Do not rely on
writes from preceding tests. Never clean up using name prefixes or global ID
differences.

Tests of simultaneous database transactions must retain independent connections
and explicitly clean up only IDs owned by their fixtures.

**Why:** Sharing one rollback transaction changes row-lock semantics: simultaneous
payroll submissions can both claim a run, and nested savepoints can interfere.
Serializing those tests would hide the concurrency behavior they need to verify.

**How to apply:** Treat isolation opt-outs as exceptional, require failure-safe
owned-ID cleanup, and include them in repeated full-suite row-count verification.
