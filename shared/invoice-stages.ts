// Staged billing: a job's scope is the contract, and an invoice can bill a
// stage of it (deposit, progress payment, final balance) instead of standing
// on its own. The printed invoice then shows the whole scope for context,
// the contract total, what has been billed and paid, and what is due now.
import { z } from "zod";

export const INVOICE_STAGES = ["standalone", "deposit", "progress", "final"] as const;
export type InvoiceStage = (typeof INVOICE_STAGES)[number];

export const INVOICE_STAGE_LABELS: Record<InvoiceStage, string> = {
  standalone: "Standard invoice",
  deposit: "Deposit",
  progress: "Progress payment",
  final: "Final invoice",
};

/** How much of the contract a deposit or progress invoice bills. */
export const stageBasisSchema = z.object({
  type: z.enum(["amount", "percent"]),
  value: z.number().finite().nonnegative(),
});
export type StageBasis = z.infer<typeof stageBasisSchema>;

export const contractScopeLineSchema = z.object({
  section: z.string().nullable(),
  description: z.string(),
  amount: z.number(),
});
export type ContractScopeLine = z.infer<typeof contractScopeLineSchema>;

export const isInvoiceStage = (value: unknown): value is InvoiceStage =>
  typeof value === "string" && (INVOICE_STAGES as readonly string[]).includes(value);

export const isStaged = (stage: string | null | undefined): stage is Exclude<InvoiceStage, "standalone"> =>
  !!stage && stage !== "standalone";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The contract as of now: the job's own line items (not the ones already attached to invoices). */
export function contractFromLineItems(items: Array<{ section?: string | null; description: string; amount: string | number }>): { scope: ContractScopeLine[]; total: number } {
  const scope = items.map((item) => ({ section: item.section ?? null, description: item.description, amount: round2(Number(item.amount) || 0) }));
  return { scope, total: round2(scope.reduce((sum, line) => sum + line.amount, 0)) };
}

/** What a stage bills, before tax. Final is whatever the earlier stages left. */
export function stageDueAmount(stage: InvoiceStage, basis: StageBasis | null | undefined, contractTotal: number, previouslyInvoiced: number): number {
  if (stage === "final") return round2(Math.max(0, contractTotal - previouslyInvoiced));
  if (stage === "deposit" || stage === "progress") {
    if (!basis) return 0;
    const raw = basis.type === "percent" ? contractTotal * (basis.value / 100) : basis.value;
    return round2(Math.max(0, Math.min(raw, Math.max(0, contractTotal - previouslyInvoiced))));
  }
  return 0;
}

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

/** The one billable line a staged invoice carries, worded the way it prints. */
export function stageLineDescription(stage: InvoiceStage, basis: StageBasis | null | undefined, contractTotal: number): string {
  const contract = `${money(contractTotal)} contract`;
  if (stage === "deposit") {
    return basis?.type === "percent" ? `Deposit (${trimPercent(basis.value)}% of ${contract})` : `Deposit on ${contract}`;
  }
  if (stage === "progress") {
    return basis?.type === "percent" ? `Progress payment (${trimPercent(basis.value)}% of ${contract})` : `Progress payment on ${contract}`;
  }
  if (stage === "final") return `Final balance on ${contract}`;
  return "";
}

const trimPercent = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ""));

/** Plain-language check the builder shows before a staged invoice is created. */
export function stageProblem(stage: InvoiceStage, basis: StageBasis | null | undefined, contractTotal: number, previouslyInvoiced: number): string | null {
  if (stage === "standalone") return null;
  if (contractTotal <= 0) return "This job has no priced line items yet. Add the scope to the job first, or send a standard invoice.";
  const remaining = round2(contractTotal - previouslyInvoiced);
  if (remaining <= 0) return `The full ${money(contractTotal)} contract has already been invoiced.`;
  if (stage === "final") return null;
  if (!basis || basis.value <= 0) return stage === "deposit" ? "Enter the deposit amount or percentage." : "Enter the progress amount or percentage.";
  const raw = basis.type === "percent" ? contractTotal * (basis.value / 100) : basis.value;
  if (raw > remaining + 0.005) return `That is more than the ${money(remaining)} left to bill on this contract.`;
  return null;
}
