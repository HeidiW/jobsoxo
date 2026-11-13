// "Get on it": the team's shared notepad. Anyone signed in can read and save
// it. A save carries the version it was edited from, so two people editing
// at once can't silently overwrite each other. Each save that changes the
// notes also keeps an earlier version for a while, so an accidental
// overwrite or deletion can be brought back.
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { notepads, notepadVersions, users } from "@shared/schema";

export const NOTEPAD_IDS = ["get-on-it"] as const;
const MAX_LENGTH = 20_000;
/** How long earlier versions are kept. */
export const VERSION_RETENTION_DAYS = 90;
/** Saves by the same person within this window update one version instead of adding another. */
export const VERSION_COALESCE_MS = 10 * 60 * 1000;
const VERSION_LIST_LIMIT = 50;

const saveSchema = z.object({
  content: z.string().max(MAX_LENGTH, "The notepad is full. Clear some old notes and save again."),
  /** updatedAt of the version being edited; null when it has never been saved. */
  baseUpdatedAt: z.string().datetime().nullable(),
});

async function readNotepad(id: string) {
  const [row] = await db
    .select({
      content: notepads.content,
      updatedAt: notepads.updatedAt,
      updatedByName: sql<string | null>`coalesce(${users.displayName}, ${users.username})`,
    })
    .from(notepads)
    .leftJoin(users, eq(users.id, notepads.updatedBy))
    .where(eq(notepads.id, id));
  return row ?? { content: "", updatedAt: null, updatedByName: null };
}

const sameVersion = (current: Date | null, base: string | null) =>
  current === null ? base === null : base !== null && current.getTime() === new Date(base).getTime();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Keeps the notes as they were before this save. Rapid saves by the same
 * person (autosave while typing) fold into one version so history reads as
 * sessions, not keystrokes. Old versions are pruned on the way through.
 */
async function recordVersion(tx: Tx, notepadId: string, previous: { content: string; updatedAt: Date; updatedBy: string | null } | undefined, userId: string | null, now: Date) {
  if (!previous || previous.content.trim() === "") return;
  const [latest] = await tx.select().from(notepadVersions).where(eq(notepadVersions.notepadId, notepadId)).orderBy(desc(notepadVersions.savedAt)).limit(1);
  const recentBySamePerson = latest && latest.savedBy === userId && now.getTime() - latest.savedAt.getTime() < VERSION_COALESCE_MS;
  if (recentBySamePerson) {
    await tx.update(notepadVersions).set({ content: previous.content, savedAt: previous.updatedAt }).where(eq(notepadVersions.id, latest.id));
  } else if (!latest || latest.content !== previous.content) {
    await tx.insert(notepadVersions).values({ notepadId, content: previous.content, savedAt: previous.updatedAt, savedBy: previous.updatedBy });
  }
  const cutoff = new Date(now.getTime() - VERSION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await tx.delete(notepadVersions).where(and(eq(notepadVersions.notepadId, notepadId), lt(notepadVersions.savedAt, cutoff)));
}

export async function listVersions(notepadId: string) {
  return db
    .select({
      id: notepadVersions.id,
      content: notepadVersions.content,
      savedAt: notepadVersions.savedAt,
      savedByName: sql<string | null>`coalesce(${users.displayName}, ${users.username})`,
    })
    .from(notepadVersions)
    .leftJoin(users, eq(users.id, notepadVersions.savedBy))
    .where(eq(notepadVersions.notepadId, notepadId))
    .orderBy(desc(notepadVersions.savedAt))
    .limit(VERSION_LIST_LIMIT);
}

export function registerNotepadRoutes(app: Express) {
  app.get("/api/notepads/:id", async (req, res) => {
    if (!(NOTEPAD_IDS as readonly string[]).includes(req.params.id)) return res.status(404).json({ error: "Notepad not found" });
    try {
      res.json(await readNotepad(req.params.id));
    } catch (error) {
      console.error("Get notepad error:", error);
      res.status(500).json({ error: "Failed to load the notepad" });
    }
  });

  app.get("/api/notepads/:id/versions", async (req, res) => {
    if (!(NOTEPAD_IDS as readonly string[]).includes(req.params.id)) return res.status(404).json({ error: "Notepad not found" });
    try {
      res.json({ versions: await listVersions(req.params.id), retentionDays: VERSION_RETENTION_DAYS });
    } catch (error) {
      console.error("List notepad versions error:", error);
      res.status(500).json({ error: "Failed to load earlier versions" });
    }
  });

  app.put("/api/notepads/:id", async (req, res) => {
    const id = req.params.id;
    if (!(NOTEPAD_IDS as readonly string[]).includes(id)) return res.status(404).json({ error: "Notepad not found" });
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid notepad" });
    try {
      const userId = typeof req.session?.userId === "string" ? (await storage.getUser(req.session.userId))?.id ?? null : null;
      const saved = await db.transaction(async (tx) => {
        const [current] = await tx.select({ content: notepads.content, updatedAt: notepads.updatedAt, updatedBy: notepads.updatedBy }).from(notepads).where(eq(notepads.id, id)).for("update");
        if (!sameVersion(current?.updatedAt ?? null, parsed.data.baseUpdatedAt)) return null;
        if (current && current.content === parsed.data.content) return true; // nothing changed; keep the version as is
        const now = new Date();
        await recordVersion(tx, id, current, userId, now);
        const values = { content: parsed.data.content, updatedAt: now, updatedBy: userId };
        await tx.insert(notepads).values({ id, ...values }).onConflictDoUpdate({ target: notepads.id, set: values });
        return true;
      });
      const latest = await readNotepad(id);
      if (!saved) {
        return res.status(409).json({ error: `${latest.updatedByName ?? "Someone"} saved the notepad while you were editing.`, current: latest });
      }
      res.json(latest);
    } catch (error) {
      console.error("Save notepad error:", error);
      res.status(500).json({ error: "Failed to save the notepad" });
    }
  });
}
