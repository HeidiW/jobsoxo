# Database fixture ownership

`npm test` uses the existing PostgreSQL database and schema. It does not reset,
truncate, replace, or remove historical sample records.

The Vitest setup lazily substitutes `server/db.ts` with a real Drizzle transaction:

- `beforeAll` fixtures belong to the file's outer rollback-only transaction.
- Each test's writes (including direct SQL, HTTP routes, unassigned materials,
  and changes to shared settings) belong to a savepoint rolled back in `afterEach`.
- The outer transaction is rolled back in `afterAll`, including setup failures.
  A disconnected database connection also rolls back uncommitted work.
- App connections cannot see the uncommitted fixtures.
- Tests must not depend on a previous test's writes, run concurrent tests on this
  single connection, or execute raw transaction-control SQL.
- Normal application database initialization and storage code are unchanged.

## Audit

The material-total route test previously leaked a client, two jobs, and materials
(including an unassigned material, which deleting a client would not remove).
Other route fixtures included employees, payroll worksheets/records, time entries,
admin users, and inbox tasks. SMS tests also wrote employees, time entries and
attempt logs. All now use rollback isolation, as do bank, Gmail, Google Docs and
crew-list tests, including their direct database writes.

`server/gusto-routes.test.ts` explicitly opts out: its simultaneous requests must
use independent connections to test actual locking and transaction boundaries.
It tracks newly created user/employee IDs and webhook IDs. Payroll cleanup queries
by those owned user IDs so an assertion failure before the HTTP response is
recorded cannot orphan a run. Never replace this with deletion by name prefix or
a database-wide before/after ID difference; those can capture unrelated data.

## Verification

Run `npx tsx scripts/verify-test-cleanup.ts` while no other process is writing to
the database. It snapshots every public table's row count, runs the complete test
suite twice, and requires each count to match the baseline after each run. It
does not perform cleanup itself. Concurrent app writes can cause a legitimate
count mismatch; investigate rather than deleting the difference.

`server/test-database.test.ts` also deliberately fails assertions and SQL to
exercise automatic cleanup and checks fixture invisibility across connections.

Historical fixtures remain untouched. Removing them requires separate approval
and a reviewed list of exact records and dependencies.
