import { storage } from "./storage";
import { db } from "./db";
import { invoices, clients } from "@shared/schema";
import { eq, and, sql, lte } from "drizzle-orm";

export interface EmailConfig {
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
  provider?: "resend" | "sendgrid" | "mailgun";
}

export async function sendInvoiceEmail(
  invoiceId: string,
  toEmail: string,
  config: EmailConfig
): Promise<{ success: boolean; error?: string }> {
  if (!config.apiKey) {
    console.log(`[Email] Would send invoice ${invoiceId} to ${toEmail} (no API key configured)`);
    return { success: true };
  }

  try {
    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    const client = await storage.getClient(invoice.clientId);
    const settings = await storage.getSettings();

    const subject = `Invoice ${invoice.invoiceNumber} from ${settings?.companyName || "Your Painting Company"}`;
    const body = generateInvoiceEmailBody(invoice, client, settings);

    if (config.provider === "resend" && config.apiKey) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.fromEmail || `${settings?.companyName || "Invoicing"} <noreply@resend.dev>`,
          to: [toEmail],
          subject,
          html: body,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("[Email] Resend API error:", errorData);
        return { success: false, error: `Email send failed: ${response.status}` };
      }

      return { success: true };
    }

    console.log(`[Email] Email would be sent to ${toEmail} with subject: ${subject}`);
    return { success: true };
  } catch (error) {
    console.error("[Email] Send error:", error);
    return { success: false, error: String(error) };
  }
}

export async function sendPaymentReminder(
  invoiceId: string,
  reminderNumber: number,
  config: EmailConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    const client = await storage.getClient(invoice.clientId);
    if (!client?.email) {
      console.log(`[Reminder] No email for client ${client?.name || invoice.clientId}`);
      return { success: false, error: "No client email" };
    }

    const settings = await storage.getSettings();
    const subject = getReminderSubject(invoice.invoiceNumber, reminderNumber, settings?.companyName);
    const body = generateReminderEmailBody(invoice, client, reminderNumber, settings);

    if (config.apiKey && config.provider === "resend") {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.fromEmail || `${settings?.companyName || "Invoicing"} <noreply@resend.dev>`,
          to: [client.email],
          subject,
          html: body,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("[Reminder] Resend API error:", errorData);
        return { success: false, error: `Reminder send failed: ${response.status}` };
      }
    } else {
      console.log(`[Reminder] Would send reminder ${reminderNumber} for invoice ${invoice.invoiceNumber} to ${client.email}`);
    }

    await storage.updateInvoice(invoiceId, {
      lastReminderSent: new Date().toISOString(),
      reminderCount: reminderNumber,
    });

    return { success: true };
  } catch (error) {
    console.error("[Reminder] Send error:", error);
    return { success: false, error: String(error) };
  }
}

export async function processOverdueReminders(): Promise<{
  processed: number;
  sent: number;
  errors: string[];
}> {
  const result = { processed: 0, sent: 0, errors: [] as string[] };
  
  try {
    const settings = await storage.getSettings();
    const reminderIntervals = (settings?.reminderIntervals as number[]) || [7, 14, 30];
    const emailConfig: EmailConfig = {
      apiKey: process.env.RESEND_API_KEY,
      provider: "resend",
    };

    const today = new Date();
    
    const overdueInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          sql`${invoices.status} IN ('sent', 'overdue', 'partial')`,
          sql`${invoices.balance}::numeric > 0`,
          lte(invoices.dueDate, today)
        )
      );

    for (const invoice of overdueInvoices) {
      result.processed++;
      
      const daysOverdue = Math.floor(
        (today.getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const currentReminderCount = invoice.reminderCount || 0;
      let shouldSendReminder = false;
      let reminderNumber = currentReminderCount + 1;
      
      for (let i = 0; i < reminderIntervals.length; i++) {
        if (daysOverdue >= reminderIntervals[i] && currentReminderCount <= i) {
          shouldSendReminder = true;
          reminderNumber = i + 1;
          break;
        }
      }
      
      if (shouldSendReminder) {
        const sendResult = await sendPaymentReminder(invoice.id, reminderNumber, emailConfig);
        if (sendResult.success) {
          result.sent++;
          
          if (invoice.status !== "overdue") {
            await storage.updateInvoice(invoice.id, { status: "overdue" });
          }
        } else if (sendResult.error) {
          result.errors.push(`Invoice ${invoice.invoiceNumber}: ${sendResult.error}`);
        }
      }
    }
  } catch (error) {
    console.error("[Reminders] Processing error:", error);
    result.errors.push(String(error));
  }
  
  return result;
}

function generateInvoiceEmailBody(
  invoice: any,
  client: any,
  settings: any
): string {
  const companyName = settings?.companyName || "Your Painting Company";
  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
    .invoice-details { background: #f7f7f7; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .amount { font-size: 24px; font-weight: bold; color: #333; }
    .due-date { color: #666; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
    .btn { display: inline-block; padding: 12px 24px; background: #333; color: #fff; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${companyName}</h1>
    </div>
    
    <p>Hi ${client?.name || "Valued Client"},</p>
    
    <p>Please find your invoice attached below.</p>
    
    <div class="invoice-details">
      <p><strong>Invoice #:</strong> ${invoice.invoiceNumber}</p>
      <p><strong>Amount Due:</strong> <span class="amount">${formatCurrency(invoice.balance)}</span></p>
      <p class="due-date"><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>
    </div>
    
    ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ""}
    
    <p>Thank you for your business!</p>
    
    <div class="footer">
      <p>${companyName}</p>
      ${settings?.companyEmail ? `<p>Email: ${settings.companyEmail}</p>` : ""}
      ${settings?.companyPhone ? `<p>Phone: ${settings.companyPhone}</p>` : ""}
    </div>
  </div>
</body>
</html>
`;
}

function getReminderSubject(invoiceNumber: string, reminderNumber: number, companyName?: string): string {
  const company = companyName || "Your Painting Company";
  switch (reminderNumber) {
    case 1:
      return `Friendly Reminder: Invoice ${invoiceNumber} is Past Due - ${company}`;
    case 2:
      return `Second Notice: Invoice ${invoiceNumber} Payment Overdue - ${company}`;
    case 3:
      return `Final Notice: Invoice ${invoiceNumber} Requires Immediate Attention - ${company}`;
    default:
      return `Payment Reminder: Invoice ${invoiceNumber} - ${company}`;
  }
}

function generateReminderEmailBody(
  invoice: any,
  client: any,
  reminderNumber: number,
  settings: any
): string {
  const companyName = settings?.companyName || "Your Painting Company";
  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  const daysOverdue = Math.floor(
    (new Date().getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  const urgencyText = {
    1: "This is a friendly reminder that your invoice is now past due.",
    2: "We have not yet received payment for the below invoice. Please remit payment at your earliest convenience.",
    3: "This is our final notice regarding your overdue invoice. Immediate payment is required to avoid further action.",
  }[reminderNumber] || "Your invoice is past due. Please remit payment.";

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #dc3545; padding-bottom: 20px; margin-bottom: 20px; }
    .invoice-details { background: #fff3f3; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #dc3545; }
    .amount { font-size: 24px; font-weight: bold; color: #dc3545; }
    .overdue { color: #dc3545; font-weight: bold; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Payment Reminder</h1>
      <p>${companyName}</p>
    </div>
    
    <p>Dear ${client?.name || "Valued Client"},</p>
    
    <p>${urgencyText}</p>
    
    <div class="invoice-details">
      <p><strong>Invoice #:</strong> ${invoice.invoiceNumber}</p>
      <p><strong>Amount Due:</strong> <span class="amount">${formatCurrency(invoice.balance)}</span></p>
      <p><strong>Original Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>
      <p class="overdue"><strong>Days Overdue:</strong> ${daysOverdue} days</p>
    </div>
    
    <p>If you have already sent payment, please disregard this notice. If you have any questions regarding this invoice, please contact us.</p>
    
    <p>Thank you for your prompt attention to this matter.</p>
    
    <div class="footer">
      <p>${companyName}</p>
      ${settings?.companyEmail ? `<p>Email: ${settings.companyEmail}</p>` : ""}
      ${settings?.companyPhone ? `<p>Phone: ${settings.companyPhone}</p>` : ""}
    </div>
  </div>
</body>
</html>
`;
}
