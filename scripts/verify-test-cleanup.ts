/**
 * Run without a live app writing to this database:
 * npx tsx scripts/verify-test-cleanup.ts
 * Read-only snapshots; never deletes historical or concurrent records.
 */
import pg from "pg";
import { spawnSync } from "node:child_process";
import { deepStrictEqual } from "node:assert";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function counts() {
  const tables = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const result: Record<string, string> = {};
  for (const { tablename } of tables.rows) {
    const identifier = `"${tablename.replaceAll('"', '""')}"`;
    const count = await pool.query(`SELECT count(*)::text AS count FROM public.${identifier}`);
    result[tablename] = count.rows[0].count;
  }
  return result;
}

try {
  const baseline = await counts();
  for (let run = 1; run <= 2; run++) {
    const tests = spawnSync("npm", ["test"], { stdio: "inherit" });
    const after = await counts();
    deepStrictEqual(after, baseline, `Database row counts changed after test run ${run}`);
    console.log(`Run ${run}: all ${Object.keys(baseline).length} table counts unchanged.`);
    if (tests.status !== 0) throw new Error(`Test run ${run} failed (${tests.status})`);
  }
} finally {
  await pool.end();
}
