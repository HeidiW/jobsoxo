// "How to pay": the short block printed on invoices, emails and the pay page.
// Businesses can write their own in Settings; otherwise this default says
// what we want clients to do, which is pay by bank transfer through the link.
export function defaultPaymentInstructions(companyName?: string | null): string {
  const payee = companyName?.trim() || "us";
  return [
    "Bank transfer (ACH) is preferred and carries no fee: use the Pay online link and choose your bank.",
    "Cards are accepted through the same link.",
    `Checks payable to ${payee}.`,
  ].join("\n");
}

export function paymentInstructionsFor(settings: { paymentInstructions?: string | null; companyName?: string | null } | null | undefined): string {
  const custom = settings?.paymentInstructions?.trim();
  return custom || defaultPaymentInstructions(settings?.companyName);
}
