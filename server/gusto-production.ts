// Going live with Gusto: the gates that have to be open, in order, and the
// one-time creation of the real company. Creating a production company is
// deliberately hard to do by accident: GUSTO_ENV must be production, the
// GUSTO_LIVE_COMPANY_CREATION_ENABLED switch must be on, the admin types the
// legal name twice and ticks a confirmation, and a reservation row is written
// before Gusto is contacted so a crash can't create a second company.
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { employees, gustoEmployeeMappings, gustoIntegrations } from "@shared/schema";
import {
  gustoApplicationConfigured, gustoConfigured, gustoEnvironment, GustoConfigurationError, GustoProviderError,
  gustoSystemToken, liveCompanyCreationEnabled, livePayrollEnabled, provisionGustoCompany,
} from "./gusto-client";
import { COMPANY_CREATION_PENDING_STATES, gustoActor } from "./gusto-company";

export const productionCompanyInput = z.object({
  legalName: z.string().trim().min(2).max(200),
  /** Must match legalName exactly: the admin types it twice. */
  confirmLegalName: z.string().trim().min(2).max(200),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().max(254).email(),
  confirmProduction: z.literal(true),
}).strict().refine((value) => value.legalName === value.confirmLegalName, { message: "The legal name was not typed the same way twice.", path: ["confirmLegalName"] });

class ProductionConflict extends Error {}
const uncertainMessage = "Company creation may already have reached Gusto. Check the Gusto developer portal before recovery; another company will not be created automatically.";

export interface ProductionReadiness {
  environment: "demo" | "production";
  gates: {
    productionEnvironment: boolean;
    applicationCredentials: boolean;
    companyCreationEnabled: boolean;
    webhookSecret: boolean;
    livePayrollEnabled: boolean;
  };
  company: { attached: boolean; companyId: string | null; state: string | null; environment: string | null; creationPending: boolean };
  employees: { active: number; linked: number };
  /** The next thing to do, in plain words. */
  nextStep: string;
}

export async function productionReadiness(userId: string): Promise<ProductionReadiness> {
  const environment = gustoEnvironment();
  const rows = await db.select().from(gustoIntegrations);
  const row = rows.find((candidate) => candidate.userId === userId) ?? rows.find((candidate) => candidate.companyId) ?? null;
  const attached = !!(row?.companyId && row.encryptedAccessToken);
  const [active, linked] = await Promise.all([
    db.select({ id: employees.id }).from(employees).where(eq(employees.status, "active")),
    row?.companyId ? db.select({ id: gustoEmployeeMappings.id }).from(gustoEmployeeMappings).where(eq(gustoEmployeeMappings.companyId, row.companyId)) : Promise.resolve([]),
  ]);
  const gates = {
    productionEnvironment: environment === "production",
    applicationCredentials: gustoApplicationConfigured(),
    companyCreationEnabled: liveCompanyCreationEnabled(),
    webhookSecret: !!process.env.GUSTO_WEBHOOK_SECRET,
    livePayrollEnabled: livePayrollEnabled(),
  };
  const creationPending = !!row && COMPANY_CREATION_PENDING_STATES.has(row.state);
  let nextStep: string;
  if (!gates.productionEnvironment) nextStep = "Set GUSTO_ENV=production with Gusto's production client ID and secret, then redeploy. (Remove the demo company first.)";
  else if (!gates.applicationCredentials) nextStep = "Add Gusto's production client ID and secret in Render.";
  else if (creationPending) nextStep = "Company creation is unresolved. Check the Gusto developer portal before taking another action.";
  else if (!attached && row?.environment === "demo" && row.companyId) nextStep = "The demo company is still attached. Remove it, then create the real company.";
  else if (!attached && !gates.companyCreationEnabled) nextStep = "Set GUSTO_LIVE_COMPANY_CREATION_ENABLED=true in Render to unlock creating the real company, then create it below.";
  else if (!attached) nextStep = "Create the real company below with its legal name and the signatory's details.";
  else if (!gates.webhookSecret) nextStep = "Register the webhook at https://jobsoxo.app/api/gusto/webhook in Gusto and put its verification token in GUSTO_WEBHOOK_SECRET.";
  else if (!gates.livePayrollEnabled) nextStep = "Finish company onboarding, funding and employees in Gusto. Live payroll stays off until GUSTO_LIVE_PAYROLL_ENABLED=true is set for the first real run.";
  else nextStep = "Live payroll is enabled. Submit while the calculation is fresh and before Gusto's submit-by time.";
  return {
    environment, gates,
    company: { attached, companyId: row?.companyId ?? null, state: row?.state ?? null, environment: row?.environment ?? null, creationPending },
    employees: { active: active.length, linked: linked.length },
    nextStep,
  };
}

export async function createProductionCompany(userId: string, raw: unknown) {
  const input = productionCompanyInput.parse(raw);
  if (gustoEnvironment() !== "production") throw new GustoConfigurationError("Set GUSTO_ENV=production before creating a real company.");
  if (!liveCompanyCreationEnabled()) throw new GustoConfigurationError("Creating a real company is switched off. Set GUSTO_LIVE_COMPANY_CREATION_ENABLED=true to allow it.");
  if (!gustoApplicationConfigured()) throw new GustoConfigurationError("Gusto production client ID and secret are not configured.");
  if (gustoConfigured()) throw new ProductionConflict("Company credentials already exist. Connect that company instead of creating another.");

  // Reserve before contacting Gusto: an ambiguous response must never lead to a second company.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gusto-company-connect'))`);
    const rows = await tx.select().from(gustoIntegrations);
    if (rows.some((row) => row.companyId || row.encryptedAccessToken)) throw new ProductionConflict("A company is already connected. Remove the demo company first; another company will not be created.");
    if (rows.some((row) => COMPANY_CREATION_PENDING_STATES.has(row.state))) throw new ProductionConflict(uncertainMessage);
    await tx.insert(gustoIntegrations).values({ userId, environment: "production", state: "company_creating" })
      .onConflictDoUpdate({ target: gustoIntegrations.userId, set: { environment: "production", state: "company_creating", lastError: null, updatedAt: new Date() } });
  });

  let creationRequested = false;
  try {
    const systemToken = await gustoSystemToken();
    creationRequested = true;
    const company = await provisionGustoCompany(systemToken, { companyName: input.legalName, firstName: input.firstName, lastName: input.lastName, email: input.email });
    await db.update(gustoIntegrations).set({ ...company, state: "connected", fundingStatus: "not_connected", lastError: null, updatedAt: new Date() })
      .where(eq(gustoIntegrations.userId, userId));
    // Never returns tokens, accepts terms, or completes onboarding: those are the signatory's, in Gusto's screens.
    return { companyId: company.companyId, environment: "production", state: "connected" };
  } catch (error) {
    const rejected = error instanceof GustoProviderError && [400, 401, 403, 404, 422, 429].includes(error.status);
    const uncertain = creationRequested && !rejected;
    const message = uncertain ? uncertainMessage
      : error instanceof GustoProviderError && [401, 403].includes(error.status)
        ? "Gusto rejected the production credentials or the app isn't approved for production yet."
        : "Gusto did not create the company. Check the production credentials and the details entered before retrying.";
    await db.update(gustoIntegrations).set({ state: uncertain ? "company_creation_unknown" : "company_creation_failed", lastError: message, updatedAt: new Date() })
      .where(eq(gustoIntegrations.userId, userId));
    throw new GustoProviderError(message, uncertain ? 409 : 502, uncertain ? "creation_unknown" : "creation_rejected");
  }
}

export function registerGustoProductionRoutes(app: Express, requireAdmin: RequestHandler) {
  app.get("/api/gusto/production/readiness", requireAdmin, async (req, res) => {
    try {
      res.json(await productionReadiness(await gustoActor(req.session.userId!)));
    } catch (error) {
      console.error("Gusto production readiness error:", error);
      res.status(500).json({ error: "Production readiness could not be loaded." });
    }
  });

  app.post("/api/gusto/production/company", requireAdmin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.is("application/json")) return void res.status(415).json({ error: "Send company details as JSON." });
    try {
      res.status(201).json(await createProductionCompany(await gustoActor(req.session.userId!), req.body));
    } catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ error: error.issues[0]?.message ?? "Enter the legal name twice, the signatory's name and a valid email, and confirm.", code: "invalid_input" });
      if (error instanceof ProductionConflict) return void res.status(409).json({ error: error.message, code: "setup_conflict" });
      if (error instanceof GustoConfigurationError) return void res.status(503).json({ error: error.message, code: "not_configured" });
      if (error instanceof GustoProviderError) return void res.status(error.status).json({ error: error.message, code: error.code });
      console.error("Create production company error:", error);
      res.status(500).json({ error: "Company creation could not finish. Refresh status before taking another action." });
    }
  });
}
