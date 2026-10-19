import type { RequestHandler } from "express";
import { storage } from "./storage";
import { sendPaymentReminder } from "./email";

// An explicit follow-up must not re-send the invoice through /send: that
// action changes its status and would reset a partially paid invoice.
export const sendDashboardReminder: RequestHandler = async (req, res) => {
  try {
    const invoice = await storage.getInvoice(req.params.id);
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (!["sent", "partial", "overdue"].includes(invoice.status) || Number(invoice.balance) <= 0) {
      res.status(409).json({ error: "Only outstanding, issued invoices can receive a reminder" });
      return;
    }
    if (invoice.remindersPaused) {
      res.status(409).json({ error: "Reminders are paused for this invoice" });
      return;
    }
    const client = await storage.getClient(invoice.clientId);
    if (!client?.email) {
      res.status(400).json({ error: "Client has no email address on file" });
      return;
    }
    // The existing mail helper supports a dry-run fallback. Never report that
    // fallback as an actual delivery from this user-facing action.
    if (!process.env.RESEND_API_KEY) {
      res.status(503).json({ error: "Email service is not configured" });
      return;
    }
    const settings = await storage.getSettings();
    const stage = Math.max(1, invoice.reminderCount ?? 0);
    const tone = settings?.reminderTones?.find((item) => item.stage === stage);
    const result = await sendPaymentReminder(
      invoice.id,
      stage,
      { apiKey: process.env.RESEND_API_KEY, provider: "resend" },
      tone,
    );
    await storage.insertReminderLog({
      invoiceId: invoice.id,
      channel: "email",
      stage,
      success: result.success,
      errorMessage: result.error ?? null,
    });
    if (!result.success) {
      res.status(502).json({ error: "Reminder delivery failed. Check the invoice reminder log." });
      return;
    }
    // Explicit reminders are logged without advancing automated reminder
    // stages or changing any financial fields, status, or balance.
    res.json({ success: true });
  } catch (error) {
    console.error("Dashboard reminder error:", error);
    res.status(500).json({ error: "Could not send the reminder" });
  }
};
