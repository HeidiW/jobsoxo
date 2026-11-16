import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { scheduleEntriesByDay } from "./schedule-entries";

describe("schedule entries", () => {
  let app: Express;
  beforeAll(async () => { app = await buildTestApp(); });

  const add = (body: Record<string, unknown>) => request(app).post("/api/schedule-entries").send(body);

  it("adds a calendar item with only a name and a date, keeping the day as entered", async () => {
    const created = (await add({ title: "Estimate at 42 Elm St", date: "2030-03-04", startTime: "09:30", notes: "Ask for Dana" }).expect(201)).body;
    expect(created).toMatchObject({ title: "Estimate at 42 Elm St", startTime: "09:30", notes: "Ask for Dana", clientId: null, jobId: null, clientName: null, jobTitle: null, endDate: null });
    expect(String(created.date)).toMatch(/^2030-03-04T00:00:00/);
    const listed = (await request(app).get("/api/schedule-entries?from=2030-03-02&to=2030-03-08").expect(200)).body;
    expect(listed.map((row: { id: string }) => row.id)).toContain(created.id);
    const outside = (await request(app).get("/api/schedule-entries?from=2030-03-09&to=2030-03-15").expect(200)).body;
    expect(outside.map((row: { id: string }) => row.id)).not.toContain(created.id);
    await add({ title: "", date: "2030-03-04" }).expect(400);
    await add({ title: "Bad time", date: "2030-03-04", startTime: "9:30am" }).expect(400);
    await add({ title: "Backwards", date: "2030-03-04", endDate: "2030-03-01" }).expect(400);
    await request(app).get("/api/schedule-entries?from=March").expect(400);
  });

  it("spans several days, names its client, and can be changed or removed", async () => {
    const client = await storage.createClient({ name: "Entry Client", email: "entry@example.test" } as never);
    const created = (await add({ title: "Scaffold up", date: "2030-04-01", endDate: "2030-04-03", clientId: client.id }).expect(201)).body;
    expect(created.clientName).toBe("Entry Client");
    // Overlaps the window even though it starts before it.
    const listed = (await request(app).get("/api/schedule-entries?from=2030-04-03&to=2030-04-10").expect(200)).body;
    expect(listed.map((row: { id: string }) => row.id)).toContain(created.id);
    const updated = (await request(app).patch(`/api/schedule-entries/${created.id}`).send({ title: "Scaffold up and sheet", date: "2030-04-02", endDate: null, clientId: null }).expect(200)).body;
    expect(updated).toMatchObject({ title: "Scaffold up and sheet", endDate: null, clientId: null, clientName: null });
    await add({ title: "Ghost client", date: "2030-04-01", clientId: "missing" }).expect(400);
    await request(app).delete(`/api/schedule-entries/${created.id}`).expect(204);
    await request(app).delete(`/api/schedule-entries/${created.id}`).expect(404);
  });

  it("turns an entry into a scheduled job with the same dates, and links rather than duplicates", async () => {
    const client = await storage.createClient({ name: "Convert Client", email: "convert@example.test" } as never);
    const entry = (await add({ title: "Repaint lobby", date: "2030-05-06", endDate: "2030-05-08", notes: "Two coats" }).expect(201)).body;
    const noClient = await request(app).post(`/api/schedule-entries/${entry.id}/convert-to-job`).send({}).expect(400);
    expect(noClient.body.error).toContain("Pick the client");
    const converted = (await request(app).post(`/api/schedule-entries/${entry.id}/convert-to-job`).send({ clientId: client.id }).expect(201)).body;
    expect(converted.job).toMatchObject({ title: "Repaint lobby", description: "Two coats", status: "scheduled", clientId: client.id });
    expect(String(converted.job.startDate)).toMatch(/^2030-05-06/);
    expect(String(converted.job.endDate)).toMatch(/^2030-05-08/);
    expect(converted.entry).toMatchObject({ jobId: converted.job.id, jobTitle: "Repaint lobby", clientId: client.id });
    await request(app).post(`/api/schedule-entries/${entry.id}/convert-to-job`).send({ clientId: client.id }).expect(409);
    expect((await storage.getJob(converted.job.id))?.title).toBe("Repaint lobby");
  });

  it("groups entries by day for the dashboard week", async () => {
    await add({ title: "Site visit", date: "2030-06-10", startTime: "08:00" }).expect(201);
    await add({ title: "Paint run", date: "2030-06-09", endDate: "2030-06-11" }).expect(201);
    const byDay = await scheduleEntriesByDay(["2030-06-09", "2030-06-10", "2030-06-11", "2030-06-12"]);
    expect(byDay.get("2030-06-09")!.map((row) => row.title)).toEqual(["Paint run"]);
    expect(byDay.get("2030-06-10")!.map((row) => row.title).sort()).toEqual(["Paint run", "Site visit"]);
    expect(byDay.get("2030-06-12")).toEqual([]);
  });
});
