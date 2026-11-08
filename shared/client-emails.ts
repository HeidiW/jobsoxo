import { z } from "zod";

// Clients are usually companies with several contacts. A client has a primary
// email plus additional ones; each invoice records which of them it goes to.

export const MAX_EMAILS = 20;

/** A list of distinct, valid email addresses (case-insensitive). */
export const emailListSchema = z
  .array(z.string().trim().email("Enter a valid email"))
  .max(MAX_EMAILS, `Up to ${MAX_EMAILS} email addresses`)
  .transform(dedupeEmails);

/** Trims, drops blanks and removes case-insensitive duplicates, keeping the first spelling. */
export function dedupeEmails(emails: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const email = raw?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(email);
  }
  return result;
}

type ClientEmails = { email?: string | null; additionalEmails?: readonly string[] | null };

/** Every address on file for a client, primary first. */
export function clientEmailOptions(client: ClientEmails | null | undefined): string[] {
  if (!client) return [];
  return dedupeEmails([client.email, ...(client.additionalEmails ?? [])]);
}

/**
 * Who an invoice's emails (the invoice, reminders, change orders) go to: the
 * recipients chosen on the invoice, or the client's primary email for invoices
 * created before recipients were recorded.
 */
export function invoiceRecipients(
  invoice: { recipientEmails?: readonly string[] | null },
  client: ClientEmails | null | undefined,
): string[] {
  const chosen = dedupeEmails(invoice.recipientEmails ?? []);
  if (chosen.length > 0) return chosen;
  return client?.email?.trim() ? [client.email.trim()] : [];
}
