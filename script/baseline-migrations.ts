import { createHash } from "crypto";
import { readFile } from "fs/promises";
import pg from "pg";

// Marks the baseline migration as already applied on a database whose schema
// was created by `drizzle-kit push` (e.g. a restored Replit dump), so
// `npm run db:migrate` only runs migrations made after the baseline.
// Refuses unless every table and column in the baseline snapshot exists.

const BASELINE_TAG = "0000_baseline";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const journal = JSON.parse(await readFile("migrations/meta/_journal.json", "utf-8"));
  const entry = journal.entries[0];
  if (entry?.tag !== BASELINE_TAG) throw new Error(`First journal entry is not ${BASELINE_TAG}`);
  const sqlText = await readFile(`migrations/${BASELINE_TAG}.sql`, "utf-8");
  // Same hash the drizzle migrator records.
  const hash = createHash("sha256").update(sqlText).digest("hex");
  const snapshot = JSON.parse(await readFile("migrations/meta/0000_snapshot.json", "utf-8"));

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    );
    if (rows.length === 0) {
      throw new Error("Database has no tables. Run `npm run db:migrate` instead of baselining.");
    }
    const actual = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
      actual.get(r.table_name)!.add(r.column_name);
    }

    const missing: string[] = [];
    for (const table of Object.values<any>(snapshot.tables)) {
      const columns = actual.get(table.name);
      if (!columns) { missing.push(`table ${table.name}`); continue; }
      for (const column of Object.keys(table.columns)) {
        if (!columns.has(column)) missing.push(`column ${table.name}.${column}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Database does not match the baseline; not marking it applied. Missing:\n  ${missing.join("\n  ")}`);
    }
    const expected = new Set(Object.values<any>(snapshot.tables).map((t) => t.name));
    const extra = Array.from(actual.keys()).filter((t) => !expected.has(t));
    if (extra.length > 0) console.warn(`Tables not in the schema (left untouched): ${extra.join(", ")}`);

    await client.query("BEGIN");
    // Same DDL the drizzle migrator uses.
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );
    const applied = await client.query('select count(*)::int as n from "drizzle"."__drizzle_migrations"');
    if (applied.rows[0].n > 0) {
      await client.query("ROLLBACK");
      console.log("Migrations are already recorded on this database; nothing to do.");
      return;
    }
    await client.query(
      'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
      [hash, entry.when],
    );
    await client.query("COMMIT");
    console.log(`Marked ${BASELINE_TAG} as applied.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
