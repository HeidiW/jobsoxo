// Company settings a business must fill in before using JobsOxo. Shared so the
// server rejects clearing them and the client knows when setup is unfinished.

export const REQUIRED_COMPANY_FIELDS = [
  "companyName",
  "companyEmail",
  "companyPhone",
  "companyAddress",
  "taxRate",
  "invoicePrefix",
  "invoiceTerms",
] as const;

export type RequiredCompanyField = (typeof REQUIRED_COMPANY_FIELDS)[number];

export const COMPANY_FIELD_LABELS: Record<RequiredCompanyField, string> = {
  companyName: "Company name",
  companyEmail: "Email",
  companyPhone: "Phone",
  companyAddress: "Address",
  taxRate: "Tax rate",
  invoicePrefix: "Invoice prefix",
  invoiceTerms: "Invoice terms",
};

/** Whether a single required field has a usable value. Tax rate may be 0. */
export function isCompanyFieldFilled(field: RequiredCompanyField, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  if (field === "taxRate") {
    const rate = Number(text);
    return Number.isFinite(rate) && rate >= 0 && rate <= 100;
  }
  return true;
}

/** Required fields that are missing or invalid, in display order. */
export function missingCompanyFields(
  settings: Partial<Record<RequiredCompanyField, unknown>> | null | undefined,
): RequiredCompanyField[] {
  return REQUIRED_COMPANY_FIELDS.filter((field) => !isCompanyFieldFilled(field, settings?.[field]));
}
