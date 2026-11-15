// "Set up your business": the dashboard checklist for a new account. Each
// step is derived from what already exists (company details, clients, jobs,
// invoices), so there is nothing to keep in sync; the only stored state is
// whether an admin dismissed the card for the whole team.
import type { Express, NextFunction, Request, Response } from "express";
import { storage } from "./storage";

export interface SetupStatus {
  companyDetails: boolean;
  clients: number;
  jobs: number;
  invoices: number;
  dismissed: boolean;
  /** Every step done; the card hides itself without needing a dismissal. */
  complete: boolean;
}

export async function setupStatus(): Promise<SetupStatus> {
  const [settings, clients, jobs, invoices] = await Promise.all([
    storage.getSettings(), storage.getClients(), storage.getJobs(), storage.getInvoices(),
  ]);
  const companyDetails = !!(settings?.companyName?.trim() && settings?.companyEmail?.trim());
  const status = {
    companyDetails,
    clients: clients.length,
    jobs: jobs.length,
    invoices: invoices.length,
    dismissed: settings?.setupChecklistDismissed ?? false,
  };
  return { ...status, complete: companyDetails && clients.length > 0 && jobs.length > 0 && invoices.length > 0 };
}

export function registerSetupRoutes(app: Express, requireAdmin: (req: Request, res: Response, next: NextFunction) => void) {
  app.get("/api/setup/status", async (_req, res) => {
    try {
      res.json(await setupStatus());
    } catch (error) {
      console.error("Setup status error:", error);
      res.status(500).json({ error: "Failed to load setup status" });
    }
  });

  app.post("/api/setup/dismiss", requireAdmin, async (_req, res) => {
    try {
      await storage.updateSettings({ setupChecklistDismissed: true });
      res.json(await setupStatus());
    } catch (error) {
      console.error("Dismiss setup checklist error:", error);
      res.status(500).json({ error: "Failed to dismiss the checklist" });
    }
  });
}
