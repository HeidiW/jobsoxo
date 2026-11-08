# Database migrations

Schema changes ship as versioned SQL migrations in `migrations/`, generated from
`shared/schema.ts` by drizzle-kit and recorded in `drizzle.__drizzle_migrations`.

| Command | What it does |
|---|---|
| `npm run db:generate -- --name <what_changed>` | Diff `shared/schema.ts` against the last snapshot and write `migrations/NNNN_<name>.sql` |
| `npm run db:migrate` | Apply any migrations the database hasn't recorded yet |
| `npm run db:baseline` | Mark `0000_baseline` as applied on a database that already has the schema (see below) |

All of them need `DATABASE_URL`.

## Changing the schema

1. Edit `shared/schema.ts`.
2. `npm run db:generate -- --name add_invoice_po_number`.
3. Read the generated SQL. drizzle-kit can emit drops or renames you didn't
   intend; for a rename it may ask whether a column was renamed or replaced.
   Edit the SQL if a change needs a data backfill or a safer order.
4. `npm run db:migrate` against your local database, then `npm test`.
5. Commit the schema change, the SQL file, and `migrations/meta/` together.

Never edit a migration that has been applied anywhere else; add a new one.
`npm run db:generate` with no schema changes should print "No schema changes";
if it doesn't, the schema and migrations have drifted.

## Fresh databases

Run `npm run db:migrate`. This is how the local test database is built:

```bash
createdb jobsoxo_test
DATABASE_URL=postgresql://localhost/jobsoxo_test npm run db:migrate
```

## Existing databases (baseline)

Databases created with `drizzle-kit push` (such as the old Replit database) or
restored from a `pg_dump` of one already have every table but no migration history.
Running `db:migrate` there would try to create tables that exist.

`npm run db:baseline` records `0000_baseline` as applied without running it. It
refuses if the database is empty, if any table or column in the baseline
snapshot is missing, or if migrations are already recorded. Extra tables are
reported and left alone.

Column-level checks don't cover types, defaults, indexes or constraints. Before
baselining a production copy, also compare it with a database built from the
migrations:

```bash
createdb jobsoxo_reference
DATABASE_URL=postgresql://localhost/jobsoxo_reference npm run db:migrate
diff <(pg_dump -s -O -x -n public "$RESTORED_URL" | grep -v '^--\|^\\\(un\)\?restrict' ) \
     <(pg_dump -s -O -x -n public jobsoxo_reference | grep -v '^--\|^\\\(un\)\?restrict')
```

Resolve any difference before baselining, either by fixing the copy or by
generating a migration that brings it in line.

## Production (Render)

Render runs `npm run db:migrate` as the pre-deploy command (see `render.yaml`),
so migrations apply before each new version starts. Don't run migrations from
server startup, and don't use `drizzle-kit push` against shared databases.

`migrations/development/` holds a hand-written development repair script. It is
not part of the migration journal and must not be run by deploys.
