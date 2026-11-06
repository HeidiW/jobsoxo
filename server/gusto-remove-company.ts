import type { Express, RequestHandler } from "express";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { gustoEmployeeMappings, gustoIntegrations, gustoPayrollRuns } from "@shared/schema";
import { gustoEnvironment } from "./gusto-client";

const removalInput = z.object({
  companyId: z.string().min(1).max(100),
  confirmRemove: z.literal(true),
}).strict();

class RemovalError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function removeDemoCompany(userId: string, body: unknown) {
  const { companyId } = removalInput.parse(body);
  if (gustoEnvironment() !== "demo") throw new RemovalError("Only demo companies can be removed here.", 409);
  await db.transaction(async tx => {
    // Same lock as connect/provision/run creation and employee mapping writes.
    // Recheck ownership and history under the lock, never trusting UI state.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gusto-company-connect'))`);
    const [integration] = await tx.select().from(gustoIntegrations)
      .where(eq(gustoIntegrations.userId, userId)).for("update");
    if (!integration || integration.userId !== userId) throw new RemovalError("No Gusto company is connected to your account.", 404);
    if (integration.companyId !== companyId) throw new RemovalError("The connected company changed. Refresh before removing it.", 409);
    if (integration.environment !== "demo" || ["demo_creating", "demo_creation_unknown"].includes(integration.state)) {
      throw new RemovalError("This connection cannot be removed while setup is unresolved or outside demo mode.", 409);
    }
    const [history] = await tx.select({ id: gustoPayrollRuns.id }).from(gustoPayrollRuns)
      .where(or(
        eq(gustoPayrollRuns.userId, userId),
        and(eq(gustoPayrollRuns.companyId, companyId), eq(gustoPayrollRuns.environment, "demo")),
      )).limit(1);
    if (history) throw new RemovalError("This company has payroll history, including draft or pending runs. Removal is blocked to preserve those records.", 409);
    // Only unlink provider mappings; local employees, timesheets, worksheets,
    // webhook audit records, and application credentials are untouched.
    await tx.delete(gustoEmployeeMappings).where(and(
      eq(gustoEmployeeMappings.companyId, companyId), eq(gustoEmployeeMappings.environment, "demo"),
    ));
    await tx.delete(gustoIntegrations).where(eq(gustoIntegrations.id, integration.id));
  });
  return { removed: true, companyId, environment: "demo", removedFrom: "jobsoxo_only" };
}

export function registerGustoRemovalRoutes(app: Express, requireAdmin: RequestHandler) {
  app.delete("/api/gusto/company", requireAdmin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.userId) return void res.status(401).json({ error: "Sign in to manage payroll." });
    if (!req.is("application/json")) return void res.status(415).json({ error: "Send removal confirmation as JSON." });
    try {
      res.json(await removeDemoCompany(req.session.userId, req.body));
    } catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ error: "Confirm removal of the selected demo company." });
      if (error instanceof RemovalError) return void res.status(error.status).json({ error: error.message });
      res.status(500).json({ error: "The demo company connection could not be removed. Refresh status before retrying." });
    }
  });
}
