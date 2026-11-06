import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { getBalance } from "./plaid";
import { syncPlaidTransactionsForUser } from "./plaid-sync";

// Read-only bank display. This route has no Gusto setup/readiness dependency
// and is never called from payroll preparation or submission.
export function registerPayrollBankView(app: Express, requireAdmin: RequestHandler) {
  const handler: RequestHandler = async (req, res) => {
    try {
      const account = await storage.getBusinessBankAccount(req.session.userId!);
      if (!account) return res.json({ connected: false, transactions: [] });
      const balance = await getBalance(account.plaidAccessToken);
      await syncPlaidTransactionsForUser(req.session.userId!);
      const transactions = await storage.getPlaidTransactions(req.session.userId!, 10);
      res.json({
        connected: true, institutionName: account.institutionName, accountName: account.accountName,
        accountMask: account.accountMask, accountType: account.accountType,
        current: balance.current, available: balance.available, refreshedAt: new Date().toISOString(),
        transactions: transactions.slice(0, 10).map(tx => ({ id: tx.id, date: tx.date, amount: tx.amount, name: tx.name, pending: tx.pending })),
      });
    } catch {
      res.status(502).json({ error: "The Plaid bank view is temporarily unavailable. This does not prevent Gusto payroll." });
    }
  };
  app.get("/api/plaid/bank-summary", requireAdmin, handler);
  app.get("/api/gusto/bank-summary", requireAdmin, handler); // Existing clients.
}
