// "Get on it": the team's shared to-do list. Items can carry a calendar day,
// which places them on the dashboard week and the Scheduling calendar.
import type { Express } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, or, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { todos, users } from "@shared/schema";

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-09");
const createTodoSchema = z.object({
  text: z.string().trim().min(1, "Write what needs doing").max(300, "Keep it under 300 characters"),
  dueDate: dayString.nullable().optional(),
});
const updateTodoSchema = z.object({
  text: createTodoSchema.shape.text.optional(),
  dueDate: dayString.nullable().optional(),
  done: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Nothing to change");

/** Finished items stay visible (struck through) for a day so a tick can be undone. */
const KEEP_DONE_MS = 24 * 60 * 60 * 1000;

async function sessionUserId(userId: unknown): Promise<string | null> {
  if (typeof userId !== "string") return null;
  return (await storage.getUser(userId))?.id ?? null;
}

export function registerTodoRoutes(app: Express) {
  app.get("/api/todos", async (_req, res) => {
    try {
      const doneSince = new Date(Date.now() - KEEP_DONE_MS);
      const rows = await db
        .select({
          id: todos.id, text: todos.text, dueDate: todos.dueDate, done: todos.done,
          doneAt: todos.doneAt, createdAt: todos.createdAt, createdBy: todos.createdBy,
          createdByName: sql<string | null>`coalesce(${users.displayName}, ${users.username})`,
        })
        .from(todos)
        .leftJoin(users, eq(users.id, todos.createdBy))
        .where(or(eq(todos.done, false), gte(todos.doneAt, doneSince)))
        .orderBy(asc(todos.done), sql`${todos.dueDate} asc nulls last`, desc(todos.createdAt));
      res.json(rows);
    } catch (error) {
      console.error("Get todos error:", error);
      res.status(500).json({ error: "Failed to load the to-do list" });
    }
  });

  app.post("/api/todos", async (req, res) => {
    const parsed = createTodoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid to-do" });
    try {
      const [row] = await db.insert(todos).values({
        text: parsed.data.text,
        dueDate: parsed.data.dueDate ?? null,
        createdBy: await sessionUserId(req.session?.userId),
      }).returning();
      res.status(201).json(row);
    } catch (error) {
      console.error("Create todo error:", error);
      res.status(500).json({ error: "Failed to add the to-do" });
    }
  });

  app.patch("/api/todos/:id", async (req, res) => {
    const parsed = updateTodoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid change" });
    try {
      const changes: Partial<typeof todos.$inferInsert> = {};
      if (parsed.data.text !== undefined) changes.text = parsed.data.text;
      if (parsed.data.dueDate !== undefined) changes.dueDate = parsed.data.dueDate;
      if (parsed.data.done !== undefined) {
        changes.done = parsed.data.done;
        changes.doneAt = parsed.data.done ? new Date() : null;
        changes.doneBy = parsed.data.done ? await sessionUserId(req.session?.userId) : null;
      }
      const [row] = await db.update(todos).set(changes).where(eq(todos.id, req.params.id)).returning();
      if (!row) return res.status(404).json({ error: "To-do not found" });
      res.json(row);
    } catch (error) {
      console.error("Update todo error:", error);
      res.status(500).json({ error: "Failed to update the to-do" });
    }
  });

  app.delete("/api/todos/:id", async (req, res) => {
    try {
      const [row] = await db.delete(todos).where(and(eq(todos.id, req.params.id))).returning({ id: todos.id });
      if (!row) return res.status(404).json({ error: "To-do not found" });
      res.status(204).end();
    } catch (error) {
      console.error("Delete todo error:", error);
      res.status(500).json({ error: "Failed to delete the to-do" });
    }
  });
}
