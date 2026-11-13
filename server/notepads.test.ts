import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { buildTestApp } from "./test-helpers";
import { db } from "./db";
import { notepadVersions } from "@shared/schema";
import { VERSION_RETENTION_DAYS } from "./notepads";

describe("Get on it notepad", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });

  const current = async () => (await request(app).get("/api/notepads/get-on-it").expect(200)).body;
  const save = (content: string, baseUpdatedAt: string | null) => request(app).put("/api/notepads/get-on-it").send({ content, baseUpdatedAt });

  it("starts blank, saves, and returns what was saved", async () => {
    const blank = await current();
    const saved = (await save("Order primer\nCall the supplier", blank.updatedAt).expect(200)).body;
    expect(saved.content).toBe("Order primer\nCall the supplier");
    expect(saved.updatedAt).not.toBeNull();
    expect((await current()).content).toBe("Order primer\nCall the supplier");
  });

  it("refuses a save made from an out-of-date copy and returns the current notes", async () => {
    const start = await current();
    const first = (await save("Mine", start.updatedAt).expect(200)).body;
    const stale = await save("Theirs", start.updatedAt).expect(409);
    expect(stale.body.error).toContain("saved the notepad while you were editing");
    expect(stale.body.current.content).toBe("Mine");
    // Choosing "keep mine" saves against the version they were shown.
    await save("Theirs", first.updatedAt).expect(200);
  });

  it("rejects unknown notepads and oversized notes", async () => {
    await request(app).get("/api/notepads/other").expect(404);
    await request(app).get("/api/notepads/other/versions").expect(404);
    const now = await current();
    await save("x".repeat(20_001), now.updatedAt).expect(400);
  });

  it("keeps the earlier notes as a version each time they change, and says how long they're kept", async () => {
    const blank = await current();
    const one = (await save("Version one", blank.updatedAt).expect(200)).body;
    // Saving identical text is a no-op: no new version, same updatedAt.
    const same = (await save("Version one", one.updatedAt).expect(200)).body;
    expect(same.updatedAt).toBe(one.updatedAt);
    const two = (await save("Version two", one.updatedAt).expect(200)).body;
    await save("Version three", two.updatedAt).expect(200);

    const history = (await request(app).get("/api/notepads/get-on-it/versions").expect(200)).body;
    expect(history.retentionDays).toBe(VERSION_RETENTION_DAYS);
    // Unauthenticated test saves have no user, so rapid saves fold into one
    // version holding the most recent earlier text.
    expect(history.versions.map((version: { content: string }) => version.content)).toEqual(["Version two"]);
    expect(history.versions[0].savedAt).toBe(one.updatedAt === two.updatedAt ? one.updatedAt : two.updatedAt);
  });

  it("prunes versions older than the retention window", async () => {
    const blank = await current();
    const one = (await save("Fresh", blank.updatedAt).expect(200)).body;
    const stale = new Date(Date.now() - (VERSION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    await db.insert(notepadVersions).values({ notepadId: "get-on-it", content: "Ancient", savedAt: stale });
    await save("Newer", one.updatedAt).expect(200);
    const rows = await db.select().from(notepadVersions).where(eq(notepadVersions.notepadId, "get-on-it"));
    expect(rows.map((row) => row.content)).not.toContain("Ancient");
    expect(rows.map((row) => row.content)).toContain("Fresh");
  });
});
