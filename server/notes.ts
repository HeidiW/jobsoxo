// "Get on it": the team's shared to-do list. One current note at a time;
// items are ticked off as they're done; "New note" archives the current
// list and starts a fresh one, optionally carrying unfinished items over.
// Every past note stays readable in the archive, exactly as it was left.
import type { Express } from "express";
import { z } from "zod";
import { and, asc, desc, eq, isNull, isNotNull, max, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { noteItems, notes, users } from "@shared/schema";

const MAX_ITEM = 500;
const MAX_ITEMS = 200;
const ARCHIVE_LIMIT = 100;

const newItemSchema = z.object({ text: z.string().trim().min(1, "Write something first.").max(MAX_ITEM, "Keep each item under 500 characters.") });
const updateItemSchema = z.object({
  text: z.string().trim().min(1, "Write something first.").max(MAX_ITEM, "Keep each item under 500 characters.").optional(),
  done: z.boolean().optional(),
}).refine((value) => value.text !== undefined || value.done !== undefined, { message: "Nothing to change." });
const archiveSchema = z.object({ carryOverUnfinished: z.boolean().optional() });

const personName = sql<string | null>`coalesce(${users.displayName}, ${users.username})`;

async function userIdFrom(sessionUserId: unknown): Promise<string | null> {
  return typeof sessionUserId === "string" ? (await storage.getUser(sessionUserId))?.id ?? null : null;
}

async function itemsFor(noteId: string) {
  return db
    .select({ id: noteItems.id, text: noteItems.text, done: noteItems.done, doneAt: noteItems.doneAt, position: noteItems.position, createdAt: noteItems.createdAt, doneByName: personName })
    .from(noteItems)
    .leftJoin(users, eq(users.id, noteItems.doneBy))
    .where(eq(noteItems.noteId, noteId))
    .orderBy(asc(noteItems.position), asc(noteItems.createdAt));
}

/** The current note with its items; an empty note is created the first time anyone looks. */
export async function currentNote() {
  let [note] = await db.select().from(notes).where(isNull(notes.archivedAt)).orderBy(desc(notes.createdAt)).limit(1);
  if (!note) [note] = await db.insert(notes).values({}).returning();
  return { id: note.id, createdAt: note.createdAt, items: await itemsFor(note.id) };
}

export async function archivedNotes() {
  const rows = await db
    .select({ id: notes.id, title: notes.title, createdAt: notes.createdAt, archivedAt: notes.archivedAt, archivedByName: personName })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.archivedBy))
    .where(isNotNull(notes.archivedAt))
    .orderBy(desc(notes.archivedAt))
    .limit(ARCHIVE_LIMIT);
  return Promise.all(rows.map(async (row) => ({ ...row, items: await itemsFor(row.id) })));
}

export function registerNoteRoutes(app: Express) {
  app.get("/api/notes/current", async (_req, res) => {
    try {
      res.json(await currentNote());
    } catch (error) {
      console.error("Get current note error:", error);
      res.status(500).json({ error: "The list couldn't be loaded" });
    }
  });

  app.get("/api/notes/archive", async (_req, res) => {
    try {
      res.json({ notes: await archivedNotes() });
    } catch (error) {
      console.error("Get note archive error:", error);
      res.status(500).json({ error: "The archive couldn't be loaded" });
    }
  });

  app.post("/api/notes/current/items", async (req, res) => {
    const parsed = newItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid item" });
    try {
      const userId = await userIdFrom(req.session?.userId);
      const note = await currentNote();
      if (note.items.length >= MAX_ITEMS) return res.status(400).json({ error: "This note is full. Start a new note and carry the unfinished items over." });
      const [{ last }] = await db.select({ last: max(noteItems.position) }).from(noteItems).where(eq(noteItems.noteId, note.id));
      const [item] = await db.insert(noteItems).values({ noteId: note.id, text: parsed.data.text, position: (last ?? -1) + 1, createdBy: userId }).returning();
      res.status(201).json({ ...item, doneByName: null });
    } catch (error) {
      console.error("Add note item error:", error);
      res.status(500).json({ error: "The item couldn't be added" });
    }
  });

  app.patch("/api/notes/items/:id", async (req, res) => {
    const parsed = updateItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid change" });
    try {
      const [item] = await db.select({ item: noteItems, archivedAt: notes.archivedAt }).from(noteItems).innerJoin(notes, eq(notes.id, noteItems.noteId)).where(eq(noteItems.id, req.params.id));
      if (!item) return res.status(404).json({ error: "Item not found" });
      // The archive is a record of what was done; it isn't edited.
      if (item.archivedAt) return res.status(409).json({ error: "This note is archived. Start a new note to make changes." });
      const userId = await userIdFrom(req.session?.userId);
      const set: Partial<typeof noteItems.$inferInsert> = {};
      if (parsed.data.text !== undefined) set.text = parsed.data.text;
      if (parsed.data.done !== undefined) {
        set.done = parsed.data.done;
        set.doneAt = parsed.data.done ? new Date() : null;
        set.doneBy = parsed.data.done ? userId : null;
      }
      await db.update(noteItems).set(set).where(eq(noteItems.id, req.params.id));
      const [updated] = await db
        .select({ id: noteItems.id, text: noteItems.text, done: noteItems.done, doneAt: noteItems.doneAt, position: noteItems.position, createdAt: noteItems.createdAt, doneByName: personName })
        .from(noteItems).leftJoin(users, eq(users.id, noteItems.doneBy)).where(eq(noteItems.id, req.params.id));
      res.json(updated);
    } catch (error) {
      console.error("Update note item error:", error);
      res.status(500).json({ error: "The item couldn't be updated" });
    }
  });

  app.delete("/api/notes/items/:id", async (req, res) => {
    try {
      const [item] = await db.select({ id: noteItems.id, archivedAt: notes.archivedAt }).from(noteItems).innerJoin(notes, eq(notes.id, noteItems.noteId)).where(eq(noteItems.id, req.params.id));
      if (!item) return res.status(404).json({ error: "Item not found" });
      if (item.archivedAt) return res.status(409).json({ error: "This note is archived. Start a new note to make changes." });
      await db.delete(noteItems).where(eq(noteItems.id, req.params.id));
      res.status(204).send();
    } catch (error) {
      console.error("Delete note item error:", error);
      res.status(500).json({ error: "The item couldn't be removed" });
    }
  });

  // "New note": file the current list in the archive and start fresh.
  app.post("/api/notes/current/archive", async (req, res) => {
    const parsed = archiveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid request" });
    try {
      const userId = await userIdFrom(req.session?.userId);
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(notes).where(isNull(notes.archivedAt)).orderBy(desc(notes.createdAt)).limit(1).for("update");
        if (!current) return { archived: false };
        const items = await tx.select().from(noteItems).where(eq(noteItems.noteId, current.id)).orderBy(asc(noteItems.position));
        if (items.length === 0) return { archived: false };
        const now = new Date();
        await tx.update(notes).set({ archivedAt: now, archivedBy: userId, title: current.title ?? `${items.filter((item) => item.done).length} of ${items.length} done` }).where(eq(notes.id, current.id));
        const [fresh] = await tx.insert(notes).values({ createdBy: userId }).returning();
        const carried = parsed.data.carryOverUnfinished ? items.filter((item) => !item.done) : [];
        if (carried.length) {
          await tx.insert(noteItems).values(carried.map((item, position) => ({ noteId: fresh.id, text: item.text, position, createdBy: userId })));
        }
        return { archived: true, carried: carried.length };
      });
      res.json({ ...result, current: await currentNote() });
    } catch (error) {
      console.error("Archive note error:", error);
      res.status(500).json({ error: "The note couldn't be archived" });
    }
  });

  // Keep an archived-note read handy for deep links from the archive panel.
  app.get("/api/notes/:id", async (req, res) => {
    try {
      const [note] = await db.select().from(notes).where(and(eq(notes.id, req.params.id), isNotNull(notes.archivedAt)));
      if (!note) return res.status(404).json({ error: "Note not found" });
      res.json({ ...note, items: await itemsFor(note.id) });
    } catch (error) {
      console.error("Get note error:", error);
      res.status(500).json({ error: "The note couldn't be loaded" });
    }
  });
}
