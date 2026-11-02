import { beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { storage } from "./storage";
import { openTestDatabase } from "./test-database";

let suiteClientId: string;
let failedClientId: string;
let failedJobId: string;
let failedMaterialId: string;

beforeAll(async () => {
  suiteClientId = (await storage.createClient({ name: `Suite fixture ${randomUUID()}` })).id;
});

it.fails("rolls back fixtures even when an assertion fails after creation", async () => {
  failedClientId = (await storage.createClient({ name: `Failure fixture ${randomUUID()}` })).id;
  failedJobId = (await storage.createJob({ clientId: failedClientId, title: "Failed test job" })).id;
  failedMaterialId = (await storage.createJobMaterial({
    name: "Unassigned failure fixture", quantity: "1", unit: "each",
    price: "1", purchaseDate: new Date(),
  })).id;
  expect(true).toBe(false);
});

it("removes failed-test records but preserves suite-owned fixtures", async () => {
  expect(await storage.getClient(failedClientId)).toBeUndefined();
  expect(await storage.getJob(failedJobId)).toBeUndefined();
  expect((await storage.getJobMaterials()).some(row => row.id === failedMaterialId)).toBe(false);
  expect(await storage.getClient(suiteClientId)).toBeDefined();
});

it.fails("recovers from a database error as well as assertion failures", async () => {
  await db.execute(sql`SELECT 1 / 0`);
});

it("can query after a database error", async () => {
  expect(await storage.getClient(suiteClientId)).toBeDefined();
});

it("never exposes fixtures to another connection, including nested transaction writes", async () => {
  const isolated = await openTestDatabase();
  let id = "";
  try {
    const { clients } = await import("@shared/schema");
    const [client] = await isolated.db.transaction(tx =>
      tx.insert(clients).values({ name: `Nested fixture ${randomUUID()}` }).returning());
    id = client.id;
    expect(await storage.getClient(id)).toBeUndefined();
  } finally {
    await isolated.close();
  }
  expect(await storage.getClient(id)).toBeUndefined();
});
