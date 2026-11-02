import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

/**
 * A real database connection, but nothing it writes can be committed.
 * Drizzle's nested transactions remain savepoints inside this transaction.
 */
export async function openTestDatabase() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const database = drizzle(pool, { schema });
  const rollback = new Error("Intentional test fixture rollback");
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  let ready!: (db: Parameters<Parameters<typeof database.transaction>[0]>[0]) => void;
  let rejectReady!: (error: unknown) => void;
  const available = new Promise<Parameters<Parameters<typeof database.transaction>[0]>[0]>((resolve, reject) => {
    ready = resolve;
    rejectReady = reject;
  });
  const transaction = database.transaction(async (tx) => {
    ready(tx);
    await finished;
    throw rollback;
  }).catch((error) => {
    rejectReady(error);
    if (error !== rollback) throw error;
  });
  // Attach a handler immediately, including for connection/setup failures.
  void transaction.catch(() => {});
  try {
    const db = await available;
    return {
      db,
      async close() {
        finish();
        try {
          await transaction;
        } finally {
          await pool.end();
        }
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
