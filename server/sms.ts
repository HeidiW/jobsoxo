import { storage } from "./storage";

export interface SmsConfig {
  accountSid?: string;
  authToken?: string;
  fromPhone?: string;
}

const DEFAULT_REMINDER_MESSAGES: Record<number, (params: { clientName: string; invoiceNumber: string; balance: string; daysOverdue: number; companyName: string }) => string> = {
  1: ({ clientName, invoiceNumber, balance, companyName }) =>
    `Hi ${clientName}, a friendly reminder that invoice ${invoiceNumber} for ${balance} is past due. Please contact ${companyName} if you have any questions.`,
  2: ({ clientName, invoiceNumber, balance, daysOverdue, companyName }) =>
    `${clientName}, invoice ${invoiceNumber} for ${balance} is now ${daysOverdue} days overdue. Please remit payment at your earliest convenience. Contact ${companyName} with questions.`,
  3: ({ clientName, invoiceNumber, balance, daysOverdue, companyName }) =>
    `FINAL NOTICE: ${clientName}, invoice ${invoiceNumber} for ${balance} is ${daysOverdue} days past due. Immediate payment is required. Contact ${companyName} to avoid further action.`,
};

export async function sendSmsReminder(
  invoiceId: string,
  stage: number,
  config: SmsConfig,
  customBody?: string
): Promise<{ success: boolean; error?: string }> {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return { success: false, error: "Invoice not found" };

  const client = await storage.getClient(invoice.clientId);
  if (!client?.phone) {
    return { success: false, error: "No phone number on client record" };
  }

  const settings = await storage.getSettings();
  const companyName = settings?.companyName || "Your Company";
  const balance = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(invoice.balance));
  const daysOverdue = Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24));

  const messageBody = customBody
    ? customBody
        .replace(/\{\{clientName\}\}/g, client.name)
        .replace(/\{\{invoiceNumber\}\}/g, invoice.invoiceNumber)
        .replace(/\{\{balance\}\}/g, balance)
        .replace(/\{\{daysOverdue\}\}/g, String(daysOverdue))
        .replace(/\{\{companyName\}\}/g, companyName)
    : (DEFAULT_REMINDER_MESSAGES[stage] || DEFAULT_REMINDER_MESSAGES[3])({
        clientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        balance,
        daysOverdue,
        companyName,
      });

  const toPhone = normalizePhone(client.phone);

  if (!config.accountSid || !config.authToken || !config.fromPhone) {
    console.log(`[SMS Reminder] Would send stage-${stage} SMS to ${toPhone}: ${messageBody}`);
    return { success: true };
  }

  try {
    const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: config.fromPhone,
          To: toPhone,
          Body: messageBody,
        }).toString(),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[SMS Reminder] Twilio error:", errText);
      return { success: false, error: `Twilio error ${response.status}: ${errText}` };
    }

    return { success: true };
  } catch (err) {
    console.error("[SMS Reminder] Send error:", err);
    return { success: false, error: String(err) };
  }
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return `+${digits}`;
  return digits;
}

export function parseHoursMessage(body: string): { hours: number; description: string; jobRef: string | null } | null {
  const trimmed = body.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:h(?:ours?|rs?)?)?\s*(.*)/i);
  if (!match) return null;
  const hours = parseFloat(match[1]);
  if (isNaN(hours) || hours <= 0 || hours > 24) return null;

  let rest = (match[2] || "").trim();
  let jobRef: string | null = null;

  const jobMatch = rest.match(/\bjob:(\S+)/i);
  if (jobMatch) {
    jobRef = jobMatch[1];
    rest = rest.replace(jobMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  const description = rest.trim();
  return { hours, description, jobRef };
}

export function twimlReply(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

async function logAttempt(params: {
  fromPhone: string;
  body: string;
  status: string;
  employeeId?: string | null;
  employeeName?: string | null;
  hoursRequested?: number | null;
  replyMessage?: string | null;
}): Promise<void> {
  try {
    await storage.createSmsAttempt({
      fromPhone: params.fromPhone,
      body: params.body,
      status: params.status,
      employeeId: params.employeeId ?? null,
      employeeName: params.employeeName ?? null,
      hoursRequested: params.hoursRequested != null ? String(params.hoursRequested) : null,
      replyMessage: params.replyMessage ?? null,
    });
  } catch (err) {
    console.error("Failed to log SMS attempt:", err);
  }
}

export async function handleInboundSms(from: string, body: string): Promise<string> {
  const normalizedFrom = normalizePhone(from);
  const upperBody = body.trim().toUpperCase();

  if (upperBody === "HELP" || upperBody === "?") {
    const reply = twimlReply(
      "JobsOxo time log:\n• Text hours: 8 or 7.5 or 6.5 painting\n• Tag a job: 8 painting job:42 or job:kitchen\n• Adds today's hours to your account\n• Max 24h per day"
    );
    await logAttempt({ fromPhone: normalizedFrom, body, status: "help", replyMessage: null });
    return reply;
  }

  const allEmployees = await storage.getEmployees();
  const employee = allEmployees.find((e) => {
    if (!e.phone) return false;
    return normalizePhone(e.phone) === normalizedFrom;
  });

  if (!employee) {
    const reply = twimlReply(
      "Your number isn't linked to an employee account. Ask your manager to add it in JobsOxo."
    );
    await logAttempt({ fromPhone: normalizedFrom, body, status: "unknown_number", replyMessage: reply });
    return reply;
  }

  if (employee.status === "inactive") {
    const reply = twimlReply(
      `Hi ${employee.name}, your account is currently inactive. Contact your manager for access.`
    );
    await logAttempt({ fromPhone: normalizedFrom, body, status: "inactive_employee", employeeId: employee.id, employeeName: employee.name, replyMessage: reply });
    return reply;
  }

  const parsed = parseHoursMessage(body.trim());
  if (!parsed) {
    const reply = twimlReply("Couldn't read that. Try: 8 or 7.5 or 6 painting kitchen");
    await logAttempt({ fromPhone: normalizedFrom, body, status: "parse_error", employeeId: employee.id, employeeName: employee.name, replyMessage: reply });
    return reply;
  }

  const { hours, description, jobRef } = parsed;

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const entries = await storage.getTimeEntriesByEmployee(employee.id);
  const sameDayEntries = entries.filter((e) => {
    const d = new Date(e.date);
    return d >= dayStart && d <= dayEnd;
  });
  const existingHours = sameDayEntries.reduce((sum, e) => sum + parseFloat(e.hoursWorked), 0);
  const newTotal = existingHours + hours;

  if (newTotal > 24) {
    const reply = twimlReply(
      `Can't log ${hours}h — you already have ${existingHours.toFixed(1)}h logged today (total would exceed 24h).`
    );
    await logAttempt({ fromPhone: normalizedFrom, body, status: "over_cap", employeeId: employee.id, employeeName: employee.name, hoursRequested: hours, replyMessage: reply });
    return reply;
  }

  const assignedJobs = await storage.getJobsByEmployee(employee.id);
  const activeJobs = assignedJobs.filter((j) => j.status === "in_progress" || j.status === "scheduled");

  let resolvedJobId: string | null = null;
  let resolvedJobName: string | null = null;

  if (jobRef) {
    const byId = assignedJobs.find((j) => j.id === jobRef);
    if (byId) {
      resolvedJobId = byId.id;
      resolvedJobName = byId.title;
    } else {
      const lowerRef = jobRef.toLowerCase();
      const byName = assignedJobs.find((j) => j.title.toLowerCase().includes(lowerRef));
      if (byName) {
        resolvedJobId = byName.id;
        resolvedJobName = byName.title;
      } else {
        return twimlReply(
          `Couldn't find a job matching "${jobRef}" assigned to you. Check with your manager or omit the job tag.`
        );
      }
    }
  } else if (activeJobs.length === 1) {
    resolvedJobId = activeJobs[0].id;
    resolvedJobName = activeJobs[0].title;
  }

  const entryDescription = [description, "(via SMS)"].filter(Boolean).join(" ").trim();
  const entry: import("@shared/schema").InsertTimeEntry = {
    employeeId: employee.id,
    jobId: resolvedJobId,
    date: now,
    hoursWorked: String(hours),
    description: entryDescription || "(via SMS)",
    source: "sms",
  };
  await storage.createTimeEntry(entry);

  const dayName = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const totalStr = newTotal % 1 === 0 ? String(newTotal) : newTotal.toFixed(1);
  const jobLine = resolvedJobName ? ` on "${resolvedJobName}"` : "";
  const reply = twimlReply(
    `✓ Logged ${hours}h${jobLine} for ${dayName}. Total today: ${totalStr}h. Reply HELP for tips.`
  );
  await logAttempt({ fromPhone: normalizedFrom, body, status: "ok", employeeId: employee.id, employeeName: employee.name, hoursRequested: hours, replyMessage: reply });
  return reply;
}
