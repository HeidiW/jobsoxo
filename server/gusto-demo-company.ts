import type { Express, RequestHandler } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { gustoIntegrations } from "@shared/schema";
import {
  gustoApplicationConfigured, gustoConfigured, gustoEnvironment, gustoDemoSystemToken,
  provisionGustoDemoCompany, GustoConfigurationError, GustoProviderError,
} from "./gusto-client";

export const demoCompanyInput = z.object({
  companyName: z.string().trim().min(2).max(200),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254).email(),
  confirmDemo: z.literal(true),
}).strict();

const pendingStates = new Set(["demo_creating", "demo_creation_unknown"]);
const uncertainMessage = "Demo company creation may already have reached Gusto. Check the Gusto developer portal before recovery; another company will not be created automatically.";
class DemoConflict extends Error {}

export async function demoCompanySetup(userId: string) {
  // This app represents one business: another admin must not provision a
  // second company merely because authorization is owned by a different user.
  const rows = await db.select().from(gustoIntegrations);
  const existing = rows.find(row => row.companyId || row.encryptedAccessToken || pendingStates.has(row.state));
  const own = rows.find(row => row.userId === userId);
  const clientConfigured = gustoApplicationConfigured();
  return {
    clientConfigured,
    canCreateDemoCompany: gustoEnvironment() === "demo" && clientConfigured && !gustoConfigured() && !existing,
    creationState: existing && pendingStates.has(existing.state) ? existing.state : own?.state ?? null,
    error: existing && pendingStates.has(existing.state) ? uncertainMessage
      : existing && existing.userId !== userId ? "A Gusto company is already connected by another administrator."
      : own?.state === "demo_creation_failed" ? own.lastError : null,
  };
}

export async function createDemoCompany(userId: string, raw: unknown) {
  const input = demoCompanyInput.parse(raw);
  if (gustoEnvironment() !== "demo") throw new GustoConfigurationError("Demo company creation is disabled in production.");
  if (!gustoApplicationConfigured()) throw new GustoConfigurationError("Gusto developer client ID and secret are not configured.");
  if (gustoConfigured()) throw new DemoConflict("Company credentials already exist. Connect that company instead of creating another.");

  // Commit a reservation BEFORE contacting Gusto. A crash or ambiguous response
  // must not roll back the reservation and allow a duplicate remote company.
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gusto-company-connect'))`);
    const rows = await tx.select().from(gustoIntegrations);
    if (rows.some(row => row.companyId || row.encryptedAccessToken)) {
      throw new DemoConflict("A company is already connected. Another demo company will not be created.");
    }
    if (rows.some(row => pendingStates.has(row.state))) throw new DemoConflict(uncertainMessage);
    await tx.insert(gustoIntegrations).values({
      userId, environment: "demo", state: "demo_creating",
    }).onConflictDoUpdate({ target: gustoIntegrations.userId, set: {
      environment: "demo", state: "demo_creating", lastError: null, updatedAt: new Date(),
    } });
  });

  let creationRequested = false;
  try {
    const systemToken = await gustoDemoSystemToken();
    creationRequested = true;
    const company = await provisionGustoDemoCompany(systemToken, input);
    await db.update(gustoIntegrations).set({
      ...company, state: "connected", fundingStatus: "not_connected",
      lastError: null, updatedAt: new Date(),
    }).where(eq(gustoIntegrations.userId, userId));
    // Never return tokens or automatically submit payroll, accept TOS, or
    // complete onboarding. Readiness sync is a separate, retryable read.
    return { companyId: company.companyId, environment: "demo", state: "connected" };
  } catch (error) {
    const rejected = error instanceof GustoProviderError && [400, 401, 403, 404, 422, 429].includes(error.status);
    const uncertain = creationRequested && !rejected;
    const message = uncertain ? uncertainMessage
      : error instanceof GustoProviderError && [401, 403].includes(error.status)
        ? "Gusto rejected the developer credentials or application permissions. Verify these are Embedded Payroll demo credentials."
        : "Gusto did not create the demo company. Check the application credentials and entered company details before retrying.";
    await db.update(gustoIntegrations).set({
      state: uncertain ? "demo_creation_unknown" : "demo_creation_failed", lastError: message, updatedAt: new Date(),
    }).where(eq(gustoIntegrations.userId, userId));
    throw new GustoProviderError(message, uncertain ? 409 : 502, uncertain ? "creation_unknown" : "creation_rejected");
  }
}

export function registerGustoDemoRoutes(app: Express, requireAdmin: RequestHandler) {
  app.post("/api/gusto/demo-company", requireAdmin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.userId) return void res.status(401).json({ error: "Sign in to manage payroll." });
    if (!req.is("application/json")) return void res.status(415).json({ error: "Send demo setup as JSON." });
    try {
      res.status(201).json(await createDemoCompany(req.session.userId, req.body));
    } catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ error: "Enter a company name, administrator name and valid email, and confirm demo setup.", code: "invalid_input" });
      if (error instanceof DemoConflict) return void res.status(409).json({ error: error.message, code: "setup_conflict" });
      if (error instanceof GustoConfigurationError) return void res.status(503).json({ error: error.message, code: "not_configured" });
      if (error instanceof GustoProviderError) return void res.status(error.status).json({ error: error.message, code: error.code });
      res.status(500).json({ error: "Demo company setup could not finish. Refresh status before taking another action." });
    }
  });
}
