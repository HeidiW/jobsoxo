import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";

describe("Get on it notepad", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });

  it("starts blank, saves, and returns what was saved", async () => {
    const blank = (await request(app).get("/api/notepads/get-on-it").expect(200)).body;
    const saved = (await request(app).put("/api/notepads/get-on-it")
      .send({ content: "Order primer\nCall the supplier", baseUpdatedAt: blank.updatedAt }).expect(200)).body;
    expect(saved.content).toBe("Order primer\nCall the supplier");
    expect(saved.updatedAt).not.toBeNull();
    expect((await request(app).get("/api/notepads/get-on-it")).body.content).toBe("Order primer\nCall the supplier");
  });

  it("refuses a save made from an out-of-date copy and returns the current notes", async () => {
    const start = (await request(app).get("/api/notepads/get-on-it")).body;
    const first = (await request(app).put("/api/notepads/get-on-it").send({ content: "Mine", baseUpdatedAt: start.updatedAt }).expect(200)).body;
    const stale = await request(app).put("/api/notepads/get-on-it").send({ content: "Theirs", baseUpdatedAt: start.updatedAt }).expect(409);
    expect(stale.body.error).toContain("saved the notepad while you were editing");
    expect(stale.body.current.content).toBe("Mine");
    // Choosing "keep mine" saves against the version they were shown.
    await request(app).put("/api/notepads/get-on-it").send({ content: "Theirs", baseUpdatedAt: first.updatedAt }).expect(200);
  });

  it("rejects unknown notepads and oversized notes", async () => {
    await request(app).get("/api/notepads/other").expect(404);
    const current = (await request(app).get("/api/notepads/get-on-it")).body;
    await request(app).put("/api/notepads/get-on-it").send({ content: "x".repeat(20_001), baseUpdatedAt: current.updatedAt }).expect(400);
  });
});
