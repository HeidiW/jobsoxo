// Schedule entries: calendar items that aren't jobs. Anyone signed in can
// add, change and remove them. An entry can be turned into a job once there
// is a client to bill it to; the entry is then linked, not duplicated.
import type { Express } from "express";
import { z } from "zod";
import { and, asc, eq, gte, inArray, lte, or, isNull } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { clients, insertScheduleEntrySchema, jobs, scheduleEntries } from "@shared/schema";
import { calendarDay } from "./business-time";

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

async function withNames(rows: Array<typeof scheduleEntries.$inferSelect>) {
  const clientIds = [...new Set(rows.map((row) => row.clientId).filter((id): id is string => !!id))];
  const jobIds = [...new Set(rows.map((row) => row.jobId).filter((id): id is string => !!id))];
  const [clientRows, jobRows] = await Promise.all([
    clientIds.length ? db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, clientIds)) : [],
    jobIds.length ? db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(inArray(jobs.id, jobIds)) : [],
  ]);
  const clientName = new Map(clientRows.map((row) => [row.id, row.name]));
  const jobTitle = new Map(jobRows.map((row) => [row.id, row.title]));
  return rows.map((row) => ({ ...row, clientName: row.clientId ? clientName.get(row.clientId) ?? null : null, jobTitle: row.jobId ? jobTitle.get(row.jobId) ?? null : null }));
}

export async function listScheduleEntries(from?: string, to?: string) {
  const conditions = [];
  if (to) conditions.push(lte(scheduleEntries.date, toDate(to)));
  if (from) conditions.push(or(gte(scheduleEntries.date, toDate(from)), and(isNull(scheduleEntries.endDate), gte(scheduleEntries.date, toDate(from))), gte(scheduleEntries.endDate, toDate(from)))!);
  const rows = await db.select().from(scheduleEntries).where(conditions.length ? and(...conditions) : undefined).orderBy(asc(scheduleEntries.date), asc(scheduleEntries.startTime), asc(scheduleEntries.createdAt));
  return withNames(rows);
}

function valuesFrom(input: z.infer<typeof insertScheduleEntrySchema>) {
  return {
    title: input.title,
    date: toDate(input.date),
    endDate: input.endDate ? toDate(input.endDate) : null,
    startTime: input.startTime ?? null,
    notes: input.notes?.trim() || null,
    clientId: input.clientId || null,
    jobId: input.jobId || null,
  };
}

export function registerScheduleEntryRoutes(app: Express) {
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

  app.get("/api/schedule-entries", async (req, res) => {
    const range = z.object({ from: day, to: day }).safeParse(req.query);
    if (!range.success) return res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
    try {
      res.json(await listScheduleEntries(range.data.from, range.data.to));
    } catch (error) {
      console.error("List schedule entries error:", error);
      res.status(500).json({ error: "The schedule couldn't be loaded" });
    }
  });

  app.post("/api/schedule-entries", async (req, res) => {
    const parsed = insertScheduleEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" });
    try {
      if (parsed.data.clientId && !(await storage.getClient(parsed.data.clientId))) return res.status(400).json({ error: "Client not found" });
      if (parsed.data.jobId && !(await storage.getJob(parsed.data.jobId))) return res.status(400).json({ error: "Job not found" });
      const userId = typeof req.session?.userId === "string" ? (await storage.getUser(req.session.userId))?.id ?? null : null;
      const [created] = await db.insert(scheduleEntries).values({ ...valuesFrom(parsed.data), createdBy: userId }).returning();
      res.status(201).json((await withNames([created]))[0]);
    } catch (error) {
      console.error("Create schedule entry error:", error);
      res.status(500).json({ error: "The entry couldn't be added" });
    }
  });

  app.patch("/api/schedule-entries/:id", async (req, res) => {
    const parsed = insertScheduleEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" });
    try {
      const [existing] = await db.select().from(scheduleEntries).where(eq(scheduleEntries.id, req.params.id));
      if (!existing) return res.status(404).json({ error: "Entry not found" });
      if (parsed.data.clientId && !(await storage.getClient(parsed.data.clientId))) return res.status(400).json({ error: "Client not found" });
      if (parsed.data.jobId && !(await storage.getJob(parsed.data.jobId))) return res.status(400).json({ error: "Job not found" });
      const [updated] = await db.update(scheduleEntries).set(valuesFrom(parsed.data)).where(eq(scheduleEntries.id, existing.id)).returning();
      res.json((await withNames([updated]))[0]);
    } catch (error) {
      console.error("Update schedule entry error:", error);
      res.status(500).json({ error: "The entry couldn't be saved" });
    }
  });

  app.delete("/api/schedule-entries/:id", async (req, res) => {
    try {
      const [existing] = await db.select({ id: scheduleEntries.id }).from(scheduleEntries).where(eq(scheduleEntries.id, req.params.id));
      if (!existing) return res.status(404).json({ error: "Entry not found" });
      await db.delete(scheduleEntries).where(eq(scheduleEntries.id, existing.id));
      res.status(204).send();
    } catch (error) {
      console.error("Delete schedule entry error:", error);
      res.status(500).json({ error: "The entry couldn't be removed" });
    }
  });

  // Promote an entry to a job: same dates and title, the client it names, and
  // a scheduled status so it stays on the calendar. The entry stays, linked.
  app.post("/api/schedule-entries/:id/convert-to-job", async (req, res) => {
    const body = z.object({ clientId: z.string().optional() }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Invalid request" });
    try {
      const [entry] = await db.select().from(scheduleEntries).where(eq(scheduleEntries.id, req.params.id));
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      if (entry.jobId) return res.status(409).json({ error: "This entry is already a job." });
      const clientId = body.data.clientId || entry.clientId;
      if (!clientId) return res.status(400).json({ error: "Pick the client this job is for." });
      if (!(await storage.getClient(clientId))) return res.status(400).json({ error: "Client not found" });
      const job = await storage.createJob({
        clientId, title: entry.title, description: entry.notes ?? null, status: "scheduled",
        startDate: entry.date, endDate: entry.endDate ?? entry.date,
      } as never);
      const [updated] = await db.update(scheduleEntries).set({ jobId: job.id, clientId }).where(eq(scheduleEntries.id, entry.id)).returning();
      res.status(201).json({ job, entry: (await withNames([updated]))[0] });
    } catch (error) {
      console.error("Convert schedule entry error:", error);
      res.status(500).json({ error: "The entry couldn't be turned into a job" });
    }
  });
}

/** Entries overlapping a calendar-day range, keyed by day, for the dashboard week. */
export async function scheduleEntriesByDay(days: string[]) {
  if (days.length === 0) return new Map<string, Array<{ id: string; title: string; startTime: string | null }>>();
  const rows = await listScheduleEntries(days[0], days[days.length - 1]);
  const byDay = new Map<string, Array<{ id: string; title: string; startTime: string | null }>>();
  for (const date of days) {
    byDay.set(date, rows
      .filter((row) => calendarDay(row.date) <= date && calendarDay(row.endDate ?? row.date) >= date)
      .map((row) => ({ id: row.id, title: row.title, startTime: row.startTime })));
  }
  return byDay;
}
