import { storage } from "./storage";
import { db } from "./db";
import { invoices, clients, jobs } from "@shared/schema";
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

    let jobReferenceCodes: { label: string; code: string }[] = [];
    if (invoice.jobId) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, invoice.jobId));
      if (job?.referenceCodes) {
        jobReferenceCodes = (job.referenceCodes as { label: string; code: string }[]).filter((c) => c.code?.trim());
      }
    }

    const subject = `Invoice ${invoice.invoiceNumber} from ${settings?.companyName || "Your Painting Company"}`;
    const body = generateInvoiceEmailBody(invoice, client, settings, jobReferenceCodes);

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
    const subject = getReminderSubject(invoice.invoiceNumber, reminderNumber, settings?.companyName ?? undefined);
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
      lastReminderSent: new Date(),
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
  settings: any,
  referenceCodes: { label: string; code: string }[] = []
): string {
  const companyName = settings?.companyName || "Your Painting Company";
  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount));
  };

  const referenceCodesHtml = referenceCodes.length > 0
    ? referenceCodes.map((c) => `<p style="margin:4px 0;font-size:13px;"><strong>${c.label}:</strong> <span style="font-family:monospace;">${c.code}</span></p>`).join("")
    : "";

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
      ${referenceCodesHtml}
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

export async function sendPasswordResetEmail(
  toEmail: string,
  username: string,
  resetLink: string,
  config: EmailConfig
): Promise<{ success: boolean; error?: string }> {
  const subject = "Reset your JobsOxo password";
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:#2563eb;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">JobsOxo — Password Reset</h1>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">Hi <strong>${username}</strong>,</p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;">We received a request to reset your password. Click the button below to choose a new one. This link expires in <strong>1 hour</strong>.</p>
      <a href="${resetLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">Reset Password</a>
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;word-break:break-all;">Or copy this link: ${resetLink}</p>
    </div>
  </div>
</body>
</html>`;

  if (!config.apiKey) {
    console.log(`[Email] Password reset link for ${toEmail}: ${resetLink}`);
    return { success: true };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "JobsOxo <noreply@resend.dev>",
        to: [toEmail],
        subject,
        html,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Email failed: ${response.status} ${err}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function sendChangeOrderEmail(
  invoiceId: string,
  toEmail: string,
  config: EmailConfig
): Promise<{ success: boolean; error?: string }> {
  if (!config.apiKey) {
    console.log(`[Email] Would send change order for ${invoiceId} to ${toEmail} (no API key)`);
    return { success: true };
  }

  try {
    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return { success: false, error: "Invoice not found" };

    const client = await storage.getClient(invoice.clientId);
    const settings = await storage.getSettings();
    const { db } = await import("./db");
    const { lineItems, jobs } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const allLineItems = await db.select().from(lineItems).where(eq(lineItems.invoiceId, invoiceId));
    const changeOrders = allLineItems.filter((li) => li.isChangeOrder);

    const job = invoice.jobId
      ? (await db.select().from(jobs).where(eq(jobs.id, invoice.jobId)))[0] ?? null
      : null;

    const companyName = settings?.companyName || "Your Painting Company";
    const companyAddress = settings?.companyAddress || "";
    const companyPhone = settings?.companyPhone || "";
    const companyEmail = settings?.companyEmail || "";

    const clientAddrParts = [client?.address, client?.city, client?.state, client?.zipCode].filter(Boolean);
    const clientAddr = clientAddrParts.join(", ");

    const fmtCurrency = (n: string | number | null | undefined) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(n ?? 0));

    const total = changeOrders.reduce((s, co) => s + Number(co.amount), 0);

    const itemRows = changeOrders.map((co, i) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;color:#888;font-size:12px;text-align:center;vertical-align:top;">${i + 1}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top;">
          ${co.description}
          ${co.changeOrderReason ? `<br><span style="font-size:11px;color:#888;font-style:italic;">Reason: ${co.changeOrderReason}</span>` : ""}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #eee;font-size:13px;font-weight:600;text-align:right;white-space:nowrap;vertical-align:top;">${fmtCurrency(co.amount)}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e4e4e7;">

  <!-- Header -->
  <tr>
    <td style="background:#1a1a1a;padding:28px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="color:#fff;font-size:18px;font-weight:700;">${companyName}</div>
            ${companyAddress ? `<div style="color:#aaa;font-size:12px;margin-top:2px;">${companyAddress}</div>` : ""}
            ${companyPhone ? `<div style="color:#aaa;font-size:12px;">${companyPhone}</div>` : ""}
            ${companyEmail ? `<div style="color:#aaa;font-size:12px;">${companyEmail}</div>` : ""}
          </td>
          <td align="right">
            <div style="color:#fff;font-size:24px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">Change Order</div>
            <div style="color:#aaa;font-size:12px;margin-top:4px;">Ref: ${invoice.invoiceNumber}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Info boxes -->
  <tr>
    <td style="padding:24px 36px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="48%" style="border:1px solid #e4e4e7;border-radius:4px;padding:14px 16px;vertical-align:top;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:6px;">Presented To</div>
            <div style="font-size:14px;font-weight:700;">${client?.name ?? ""}</div>
            ${clientAddr ? `<div style="font-size:12px;color:#555;margin-top:2px;">${clientAddr}</div>` : ""}
            ${client?.email ? `<div style="font-size:12px;color:#555;">${client.email}</div>` : ""}
          </td>
          <td width="4%"></td>
          <td width="48%" style="border:1px solid #e4e4e7;border-radius:4px;padding:14px 16px;vertical-align:top;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:6px;">Project</div>
            ${job?.title ? `<div style="font-size:14px;font-weight:700;">${job.title}</div>` : ""}
            ${job?.address ? `<div style="font-size:12px;color:#555;margin-top:2px;">${job.address}</div>` : ""}
            ${(() => {
              const codes = ((job?.referenceCodes ?? []) as { label: string; code: string }[]).filter((c) => c.code?.trim());
              return codes.map((c) => `<div style="font-size:11px;color:#555;margin-top:3px;"><strong>${c.label}:</strong> <span style="font-family:monospace;">${c.code}</span></div>`).join("");
            })()}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Items table -->
  <tr>
    <td style="padding:24px 36px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:4px;overflow:hidden;">
        <tr style="background:#1a1a1a;">
          <th style="padding:10px 14px;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:0.6px;text-align:center;width:40px;">#</th>
          <th style="padding:10px 14px;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:0.6px;text-align:left;">Description</th>
          <th style="padding:10px 14px;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:0.6px;text-align:right;width:120px;">Amount</th>
        </tr>
        ${itemRows}
      </table>
    </td>
  </tr>

  <!-- Total -->
  <tr>
    <td style="padding:0 36px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="right">
            <table cellpadding="0" cellspacing="0">
              <tr style="background:#1a1a1a;">
                <td style="padding:12px 20px;color:#fff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;">Outstanding Total</td>
                <td style="padding:12px 20px;color:#fff;font-size:15px;font-weight:800;text-align:right;white-space:nowrap;">${fmtCurrency(total)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:20px 36px 28px;border-top:1px solid #eee;">
      <p style="margin:0;font-size:11px;color:#888;line-height:1.6;">
        This change order amends the original contract and is subject to acceptance by all parties.<br>
        Please reply to this email to confirm acceptance.
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    const subject = `Change Order — ${invoice.invoiceNumber} | ${companyName}`;

    if (config.provider === "resend" && config.apiKey) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.fromEmail || `${companyName} <noreply@resend.dev>`,
          to: [toEmail],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("[ChangeOrder] Resend error:", err);
        return { success: false, error: `Email failed: ${response.status}` };
      }

      return { success: true };
    }

    console.log(`[ChangeOrder] Would send to ${toEmail}: ${subject}`);
    return { success: true };
  } catch (error) {
    console.error("[ChangeOrder] Send error:", error);
    return { success: false, error: String(error) };
  }
}
