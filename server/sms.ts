import { storage } from "./storage";

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return `+${digits}`;
  return digits;
}

export function parseHoursMessage(body: string): { hours: number; description: string } | null {
  const trimmed = body.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:h(?:ours?|rs?)?)?\s*(.*)/i);
  if (!match) return null;
  const hours = parseFloat(match[1]);
  if (isNaN(hours) || hours <= 0 || hours > 24) return null;
  const description = (match[2] || "").trim();
  return { hours, description };
}

export function twimlReply(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

export async function handleInboundSms(from: string, body: string): Promise<string> {
  const normalizedFrom = normalizePhone(from);
  const upperBody = body.trim().toUpperCase();

  if (upperBody === "HELP" || upperBody === "?") {
    return twimlReply(
      "JobsOxo time log:\n• Text hours: 8 or 7.5 or 6.5 painting\n• Adds today's hours to your account\n• Max 24h per day"
    );
  }

  const allEmployees = await storage.getEmployees();
  const employee = allEmployees.find((e) => {
    if (!e.phone) return false;
    return normalizePhone(e.phone) === normalizedFrom;
  });

  if (!employee) {
    return twimlReply(
      "Your number isn't linked to an employee account. Ask your manager to add it in JobsOxo."
    );
  }

  if (employee.status === "inactive") {
    return twimlReply(
      `Hi ${employee.name}, your account is currently inactive. Contact your manager for access.`
    );
  }

  const parsed = parseHoursMessage(body.trim());
  if (!parsed) {
    return twimlReply("Couldn't read that. Try: 8 or 7.5 or 6 painting kitchen");
  }

  const { hours, description } = parsed;

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
    return twimlReply(
      `Can't log ${hours}h — you already have ${existingHours.toFixed(1)}h logged today (total would exceed 24h).`
    );
  }

  const entryDescription = [description, "(via SMS)"].filter(Boolean).join(" ").trim();
  const entry: import("@shared/schema").InsertTimeEntry = {
    employeeId: employee.id,
    jobId: null,
    date: now,
    hoursWorked: String(hours),
    description: entryDescription || "(via SMS)",
  };
  await storage.createTimeEntry(entry);

  const dayName = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const totalStr = newTotal % 1 === 0 ? String(newTotal) : newTotal.toFixed(1);
  return twimlReply(
    `✓ Logged ${hours}h for ${dayName}. Total today: ${totalStr}h. Reply HELP for tips.`
  );
}
