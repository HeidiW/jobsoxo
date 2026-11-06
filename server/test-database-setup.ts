import { afterAll, afterEach, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { openTestDatabase } from "./test-database";

const state = vi.hoisted(() => ({
  database: undefined as Awaited<ReturnType<typeof openTestDatabase>> | undefined,
  savepoint: false,
}));

// Lazy: pure unit tests and browser tests never open a database connection.
// This also covers direct db inserts, not just calls through storage.
vi.mock("./db", async () => {
  const { openTestDatabase } = await import("./test-database");
  state.database = await openTestDatabase();
  return { db: state.database.db };
});

beforeEach(async () => {
  if (!state.database) return;
  await state.database.db.execute(sql`SAVEPOINT test_fixture`);
  state.savepoint = true;
});

afterEach(async () => {
  if (!state.savepoint || !state.database) return;
  try {
    // Runs on assertion failures too, and recovers from PostgreSQL errors.
    await state.database.db.execute(sql`ROLLBACK TO SAVEPOINT test_fixture`);
    await state.database.db.execute(sql`RELEASE SAVEPOINT test_fixture`);
  } finally {
    state.savepoint = false;
  }
});

afterAll(async () => {
  // Includes beforeAll fixtures and failures during setup/teardown.
  await state.database?.close();
});
