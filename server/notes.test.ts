import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";

describe("Get on it to-do list", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });

  const current = async () => (await request(app).get("/api/notes/current").expect(200)).body;
  const add = (text: unknown) => request(app).post("/api/notes/current/items").send({ text });

  it("starts with an empty current note and adds items in order", async () => {
    const note = await current();
    expect(note.id).toBeTruthy();
    expect(note.items).toEqual([]);
    const first = (await add("Order primer").expect(201)).body;
    const second = (await add("  Call the supplier  ").expect(201)).body;
    expect(second.text).toBe("Call the supplier");
    const after = await current();
    expect(after.items.map((item: { text: string; done: boolean; position: number }) => [item.text, item.done, item.position])).toEqual([["Order primer", false, 0], ["Call the supplier", false, 1]]);
    expect(first.position).toBe(0);
    await add("   ").expect(400);
    await add("x".repeat(501)).expect(400);
  });

  it("ticks items off, reopens them, edits the wording and removes them", async () => {
    const item = (await add("Pick up drop cloths").expect(201)).body;
    const done = (await request(app).patch(`/api/notes/items/${item.id}`).send({ done: true }).expect(200)).body;
    expect(done.done).toBe(true);
    expect(done.doneAt).not.toBeNull();
    const reopened = (await request(app).patch(`/api/notes/items/${item.id}`).send({ done: false }).expect(200)).body;
    expect(reopened).toMatchObject({ done: false, doneAt: null });
    const renamed = (await request(app).patch(`/api/notes/items/${item.id}`).send({ text: "Pick up 3 drop cloths" }).expect(200)).body;
    expect(renamed.text).toBe("Pick up 3 drop cloths");
    await request(app).patch(`/api/notes/items/${item.id}`).send({}).expect(400);
    await request(app).delete(`/api/notes/items/${item.id}`).expect(204);
    await request(app).delete(`/api/notes/items/${item.id}`).expect(404);
    expect((await current()).items.find((row: { id: string }) => row.id === item.id)).toBeUndefined();
  });

  it("files the current note in the archive on New note, carrying unfinished items over when asked", async () => {
    const before = await current();
    for (const row of before.items) await request(app).delete(`/api/notes/items/${row.id}`).expect(204);
    const a = (await add("Done thing").expect(201)).body;
    await add("Still to do").expect(201);
    await request(app).patch(`/api/notes/items/${a.id}`).send({ done: true }).expect(200);

    const filed = (await request(app).post("/api/notes/current/archive").send({ carryOverUnfinished: true }).expect(200)).body;
    expect(filed).toMatchObject({ archived: true, carried: 1 });
    expect(filed.current.items.map((row: { text: string; done: boolean }) => [row.text, row.done])).toEqual([["Still to do", false]]);
    expect(filed.current.id).not.toBe(before.id);

    const archive = (await request(app).get("/api/notes/archive").expect(200)).body;
    const past = archive.notes.find((note: { id: string }) => note.id === before.id);
    expect(past.title).toBe("1 of 2 done");
    expect(past.archivedAt).not.toBeNull();
    expect(past.items.map((row: { text: string; done: boolean }) => [row.text, row.done])).toEqual([["Done thing", true], ["Still to do", false]]);
    // The archive is a record: its items can't be changed or removed.
    await request(app).patch(`/api/notes/items/${past.items[1].id}`).send({ done: true }).expect(409);
    await request(app).delete(`/api/notes/items/${past.items[1].id}`).expect(409);
    expect((await request(app).get(`/api/notes/${before.id}`).expect(200)).body.items).toHaveLength(2);

    // Starting new with nothing carried leaves a blank page; an empty note isn't archived.
    const second = (await request(app).post("/api/notes/current/archive").send({ carryOverUnfinished: false }).expect(200)).body;
    expect(second.archived).toBe(true);
    expect(second.current.items).toEqual([]);
    const third = (await request(app).post("/api/notes/current/archive").send({}).expect(200)).body;
    expect(third.archived).toBe(false);
    expect(third.current.id).toBe(second.current.id);
  });
});
