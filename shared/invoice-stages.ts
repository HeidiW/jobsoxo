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

/**
 * How much of the contract a deposit or progress invoice bills:
 * - amount: a dollar figure
 * - percent: a share of the contract total
 * - lines: percent complete to date for each scope line, in scope order; the
 *   invoice bills the value of work completed so far minus what was invoiced
 *   before (standard progress billing, so a deposit is credited automatically).
 */
export const stageBasisSchema = z.union([
  z.object({ type: z.enum(["amount", "percent"]), value: z.number().finite().nonnegative() }),
  z.object({ type: z.literal("lines"), percents: z.array(z.number().finite().min(0).max(100)).max(500) }),
]);
export type StageBasis = z.infer<typeof stageBasisSchema>;

export const contractScopeLineSchema = z.object({
  section: z.string().nullable(),
  description: z.string(),
  amount: z.number(),
  /** Work status on the job line when the snapshot was taken; a hint for percent complete. */
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
});
export type ContractScopeLine = z.infer<typeof contractScopeLineSchema>;

export const isInvoiceStage = (value: unknown): value is InvoiceStage =>
  typeof value === "string" && (INVOICE_STAGES as readonly string[]).includes(value);

export const isStaged = (stage: string | null | undefined): stage is Exclude<InvoiceStage, "standalone"> =>
  !!stage && stage !== "standalone";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The contract as of now: the job's own line items (not the ones already attached to invoices). */
export function contractFromLineItems(items: Array<{ section?: string | null; description: string; amount: string | number; status?: string | null }>): { scope: ContractScopeLine[]; total: number } {
  const scope: ContractScopeLine[] = items.map((item) => {
    const status = item.status === "pending" || item.status === "in_progress" || item.status === "completed" ? item.status : undefined;
    return { section: item.section ?? null, description: item.description, amount: round2(Number(item.amount) || 0), ...(status ? { status } : {}) };
  });
  return { scope, total: round2(scope.reduce((sum, line) => sum + line.amount, 0)) };
}

/** Starting percentages for a per-line progress invoice, read from each line's work status. */
export function suggestedPercents(scope: ContractScopeLine[]): number[] {
  return scope.map((line) => (line.status === "completed" ? 100 : line.status === "in_progress" ? 50 : 0));
}

/** Dollar value of work completed to date under a per-line basis. */
export function completedToDate(scope: ContractScopeLine[], percents: number[]): number {
  return round2(scope.reduce((sum, line, index) => sum + line.amount * (Math.min(100, Math.max(0, percents[index] ?? 0)) / 100), 0));
}

/** Overall percent complete implied by per-line percentages, weighted by price. */
export function overallPercent(scope: ContractScopeLine[], percents: number[], contractTotal: number): number {
  return contractTotal > 0 ? Math.round((completedToDate(scope, percents) / contractTotal) * 1000) / 10 : 0;
}

/** What a stage bills, before tax. Final is whatever the earlier stages left. */
export function stageDueAmount(stage: InvoiceStage, basis: StageBasis | null | undefined, contractTotal: number, previouslyInvoiced: number, scope: ContractScopeLine[] = []): number {
  const remaining = Math.max(0, contractTotal - previouslyInvoiced);
  if (stage === "final") return round2(remaining);
  if (stage === "deposit" || stage === "progress") {
    if (!basis) return 0;
    const raw = basis.type === "lines"
      ? completedToDate(scope, basis.percents) - previouslyInvoiced
      : basis.type === "percent" ? contractTotal * (basis.value / 100) : basis.value;
    return round2(Math.max(0, Math.min(raw, remaining)));
  }
  return 0;
}

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const trimPercent = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, ""));

/** The one billable line a staged invoice carries, worded the way it prints. */
export function stageLineDescription(stage: InvoiceStage, basis: StageBasis | null | undefined, contractTotal: number, scope: ContractScopeLine[] = []): string {
  const contract = `${money(contractTotal)} contract`;
  if (stage === "deposit") {
    return basis?.type === "percent" ? `Deposit (${trimPercent(basis.value)}% of ${contract})` : `Deposit on ${contract}`;
  }
  if (stage === "progress") {
    if (basis?.type === "lines") return `Progress payment (work ${trimPercent(overallPercent(scope, basis.percents, contractTotal))}% complete on ${contract})`;
    return basis?.type === "percent" ? `Progress payment (${trimPercent(basis.value)}% of ${contract})` : `Progress payment on ${contract}`;
  }
  if (stage === "final") return `Final balance on ${contract}`;
  return "";
}

/** Plain-language check the builder shows before a staged invoice is created. */
export function stageProblem(stage: InvoiceStage, basis: StageBasis | null | undefined, contractTotal: number, previouslyInvoiced: number, scope: ContractScopeLine[] = []): string | null {
  if (stage === "standalone") return null;
  if (contractTotal <= 0) return "This job has no priced line items yet. Add the scope to the job first, or send a standard invoice.";
  const remaining = round2(contractTotal - previouslyInvoiced);
  if (remaining <= 0) return `The full ${money(contractTotal)} contract has already been invoiced.`;
  if (stage === "final") return null;
  if (!basis) return stage === "deposit" ? "Enter the deposit amount or percentage." : "Enter how much of the work to bill.";
  if (basis.type === "lines") {
    const completed = completedToDate(scope, basis.percents);
    if (completed <= 0) return "Mark how far along each line is to bill the work completed so far.";
    if (completed <= previouslyInvoiced + 0.005) return `Work completed to date (${money(completed)}) is already covered by the ${money(previouslyInvoiced)} invoiced before. Raise the percentages or wait until more is done.`;
    return null;
  }
  if (basis.value <= 0) return stage === "deposit" ? "Enter the deposit amount or percentage." : "Enter the progress amount or percentage.";
  const raw = basis.type === "percent" ? contractTotal * (basis.value / 100) : basis.value;
  if (raw > remaining + 0.005) return `That is more than the ${money(remaining)} left to bill on this contract.`;
  return null;
}
