import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { buildTestApp } from "./test-helpers";
import { db } from "./db";

describe("Get on it to-dos", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });

  it("adds team to-dos with or without a day and lists open ones, dated first", async () => {
    const later = (await request(app).post("/api/todos").send({ text: "  Call the supplier  " }).expect(201)).body;
    const dated = (await request(app).post("/api/todos").send({ text: "Order primer", dueDate: "2026-11-10" }).expect(201)).body;
    expect(later).toMatchObject({ text: "Call the supplier", dueDate: null, done: false });
    expect(dated.dueDate).toBe("2026-11-10");

    const list = (await request(app).get("/api/todos").expect(200)).body as Array<{ id: string }>;
    const ids = list.map((row) => row.id);
    expect(ids.indexOf(dated.id)).toBeLessThan(ids.indexOf(later.id));
  });

  it("rejects empty text and malformed days", async () => {
    await request(app).post("/api/todos").send({ text: "   " }).expect(400);
    await request(app).post("/api/todos").send({ text: "Paint", dueDate: "11/10/2026" }).expect(400);
    await request(app).patch("/api/todos/whatever").send({}).expect(400);
  });

  it("ticks off, reopens, moves and deletes a to-do", async () => {
    const todo = (await request(app).post("/api/todos").send({ text: "Pick up ladders" }).expect(201)).body;
    const done = (await request(app).patch(`/api/todos/${todo.id}`).send({ done: true }).expect(200)).body;
    expect(done.done).toBe(true);
    expect(done.doneAt).not.toBeNull();
    // Finished items stay listed for a day so a tick can be undone.
    expect((await request(app).get("/api/todos")).body.find((row: any) => row.id === todo.id)?.done).toBe(true);

    const reopened = (await request(app).patch(`/api/todos/${todo.id}`).send({ done: false, dueDate: "2026-11-12" }).expect(200)).body;
    expect(reopened).toMatchObject({ done: false, doneAt: null, dueDate: "2026-11-12" });

    await request(app).delete(`/api/todos/${todo.id}`).expect(204);
    await request(app).delete(`/api/todos/${todo.id}`).expect(404);
    await request(app).patch(`/api/todos/${todo.id}`).send({ done: true }).expect(404);
  });

  it("drops finished items from the list after a day", async () => {
    const todo = (await request(app).post("/api/todos").send({ text: "Old job" }).expect(201)).body;
    await request(app).patch(`/api/todos/${todo.id}`).send({ done: true }).expect(200);
    await db.execute(sql`update todos set done_at = now() - interval '2 days' where id = ${todo.id}`);
    expect((await request(app).get("/api/todos")).body.some((row: any) => row.id === todo.id)).toBe(false);
  });
});
