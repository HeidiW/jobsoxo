// Staged billing on the server: what a job's contract is worth, what has
// already been invoiced and paid against it, and the snapshot a deposit,
// progress or final invoice carries. See shared/invoice-stages.ts.
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "./db";
import { invoices, lineItems } from "@shared/schema";
import {
  contractFromLineItems, stageDueAmount, stageLineDescription, stageProblem, type ContractScopeLine, type InvoiceStage, type StageBasis,
} from "@shared/invoice-stages";

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface JobBilling {
  contractTotal: number;
  scope: ContractScopeLine[];
  /** Totals of this job's other invoices that have gone out (drafts don't count). */
  invoicedToDate: number;
  paidToDate: number;
  remaining: number;
  invoices: Array<{ id: string; invoiceNumber: string; stage: string; status: string; total: number; amountPaid: number; balance: number; issueDate: Date; dueDate: Date }>;
}

/** The job's own scope lines: items attached to the job but not to any invoice. */
export async function jobScope(jobId: string) {
  const rows = await db.select().from(lineItems).where(and(eq(lineItems.jobId, jobId), isNull(lineItems.invoiceId)));
  return contractFromLineItems(rows);
}

export async function jobBilling(jobId: string, excludeInvoiceId?: string): Promise<JobBilling> {
  const [{ scope, total }, rows] = await Promise.all([
    jobScope(jobId),
    db.select().from(invoices).where(excludeInvoiceId ? and(eq(invoices.jobId, jobId), ne(invoices.id, excludeInvoiceId)) : eq(invoices.jobId, jobId)),
  ]);
  const sent = rows.filter((row) => row.status !== "draft");
  const invoicedToDate = round2(sent.reduce((sum, row) => sum + Number(row.total), 0));
  const paidToDate = round2(sent.reduce((sum, row) => sum + Number(row.amountPaid), 0));
  return {
    contractTotal: total,
    scope,
    invoicedToDate,
    paidToDate,
    remaining: round2(Math.max(0, total - invoicedToDate)),
    invoices: rows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => ({
        id: row.id, invoiceNumber: row.invoiceNumber, stage: row.stage, status: row.status,
        total: Number(row.total), amountPaid: Number(row.amountPaid), balance: Number(row.balance), issueDate: row.issueDate, dueDate: row.dueDate,
      })),
  };
}

export interface StageSnapshot {
  contractScope: ContractScopeLine[];
  contractTotal: string;
  previouslyInvoiced: string;
  previouslyPaid: string;
  /** The single billable line the invoice carries. */
  lineItem: { category: string; description: string; quantity: string; unit: string; rate: string; amount: string; section: null; refs: null; status: "pending"; isChangeOrder: boolean; changeOrderReason: null };
  due: number;
}

export class StageError extends Error {}

/** Everything a staged invoice stores, computed from the job as it stands right now. */
export async function stageSnapshot(jobId: string, stage: Exclude<InvoiceStage, "standalone">, basis: StageBasis | null | undefined, excludeInvoiceId?: string): Promise<StageSnapshot> {
  const billing = await jobBilling(jobId, excludeInvoiceId);
  // Same plain-language checks the builder shows, so the server never says less than the form did.
  const problem = stageProblem(stage, basis, billing.contractTotal, billing.invoicedToDate, billing.scope);
  if (problem) throw new StageError(problem);
  const due = stageDueAmount(stage, basis, billing.contractTotal, billing.invoicedToDate, billing.scope);
  if (due <= 0) throw new StageError("Nothing is left to bill for this stage.");
  return {
    contractScope: billing.scope,
    contractTotal: billing.contractTotal.toFixed(2),
    previouslyInvoiced: billing.invoicedToDate.toFixed(2),
    previouslyPaid: billing.paidToDate.toFixed(2),
    due,
    lineItem: {
      category: "other", description: stageLineDescription(stage, basis, billing.contractTotal, billing.scope),
      quantity: "1", unit: "lump", rate: due.toFixed(2), amount: due.toFixed(2), section: null, refs: null, status: "pending", isChangeOrder: false, changeOrderReason: null,
    },
  };
}
