// "Get on it": the team's shared notepad. Anyone signed in can read and save
// it. A save carries the version it was edited from, so two people editing
// at once can't silently overwrite each other.
import type { Express } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { notepads, users } from "@shared/schema";

export const NOTEPAD_IDS = ["get-on-it"] as const;
const MAX_LENGTH = 20_000;

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

  app.put("/api/notepads/:id", async (req, res) => {
    const id = req.params.id;
    if (!(NOTEPAD_IDS as readonly string[]).includes(id)) return res.status(404).json({ error: "Notepad not found" });
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid notepad" });
    try {
      const userId = typeof req.session?.userId === "string" ? (await storage.getUser(req.session.userId))?.id ?? null : null;
      const saved = await db.transaction(async (tx) => {
        const [current] = await tx.select({ updatedAt: notepads.updatedAt }).from(notepads).where(eq(notepads.id, id)).for("update");
        if (!sameVersion(current?.updatedAt ?? null, parsed.data.baseUpdatedAt)) return null;
        const values = { content: parsed.data.content, updatedAt: new Date(), updatedBy: userId };
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
