// Default invoice prefix from the company name: the initials of its real
// words. "Conor Foy Plaster" → CFP, "Crystal Grove LLP" → CG, "Jobsoxo" → JOB.

export const FALLBACK_INVOICE_PREFIX = "INV";

const SKIP = new Set([
  "the", "and", "of", "a", "an", "for", "at", "by", "in", "on", "to",
  "llc", "llp", "inc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "pllc", "pc", "lp", "gmbh",
]);

export function invoicePrefixFromCompanyName(name: string | null | undefined): string {
  const words = (name ?? "")
    .replace(/[&+]/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !SKIP.has(word.toLowerCase()));
  const useful = meaningful.length > 0 ? meaningful : words;
  if (useful.length === 0) return FALLBACK_INVOICE_PREFIX;
  if (useful.length === 1) return useful[0].slice(0, 3).toUpperCase();
  return useful.slice(0, 4).map((word) => word[0]).join("").toUpperCase();
}

/** True when the prefix is the generic default or one derived from a company name, i.e. not hand-chosen. */
export function isDerivedInvoicePrefix(prefix: string | null | undefined, ...companyNames: Array<string | null | undefined>): boolean {
  const current = (prefix ?? "").trim().toUpperCase();
  if (!current || current === FALLBACK_INVOICE_PREFIX) return true;
  return companyNames.some((name) => name && invoicePrefixFromCompanyName(name) === current);
}
