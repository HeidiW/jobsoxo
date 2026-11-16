// Staged billing on the server: what a job's contract is worth, what has
// already been invoiced and paid against it, and the snapshot a deposit,
// progress or final invoice carries. See @jobsoxo/staged-billing.
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "./db";
import { changeOrders, invoices, jobs, lineItems } from "@shared/schema";
import {
  contractFromLineItems, stageDueAmount, stageLineDescription, stageProblem, type ContractScopeLine, type InvoiceStage, type StageBasis,
} from "@jobsoxo/staged-billing";

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface JobBilling {
  contractTotal: number;
  /** Where the contract total came from: the job's agreed total, or the sum of its priced lines. */
  contractSource: "job_total" | "lines" | "none";
  /** Sum of the job's priced lines, shown alongside when it differs from the agreed total. */
  linesTotal: number;
  /** Job total or priced lines, before change orders. */
  baseTotal: number;
  /** Approved change orders on this job's stage invoices; already included in contractTotal and scope. */
  changeOrdersTotal: number;
  scope: ContractScopeLine[];
  /** Totals of this job's other invoices that have gone out (drafts don't count). */
  invoicedToDate: number;
  paidToDate: number;
  remaining: number;
  invoices: Array<{ id: string; invoiceNumber: string; stage: string; stageNumber: number | null; status: string; total: number; amountPaid: number; balance: number; issueDate: Date; dueDate: Date }>;
  /** What the next progress payment on this job would be called: 1, 2, 3… */
  nextProgressNumber: number;
}

/** The job's own scope lines: items attached to the job but not to any invoice. */
export async function jobScope(jobId: string) {
  const rows = await db.select().from(lineItems).where(and(eq(lineItems.jobId, jobId), isNull(lineItems.invoiceId)));
  return contractFromLineItems(rows);
}

export async function jobBilling(jobId: string, excludeInvoiceId?: string): Promise<JobBilling> {
  const [{ scope, total: linesTotal }, rows, [job]] = await Promise.all([
    jobScope(jobId),
    db.select().from(invoices).where(excludeInvoiceId ? and(eq(invoices.jobId, jobId), ne(invoices.id, excludeInvoiceId)) : eq(invoices.jobId, jobId)),
    db.select({ estimatedTotal: jobs.estimatedTotal }).from(jobs).where(eq(jobs.id, jobId)),
  ]);
  const jobTotal = round2(Number(job?.estimatedTotal) || 0);
  const baseTotal = jobTotal > 0 ? jobTotal : linesTotal;
  // Approved change orders on the job's stage invoices extend the contract.
  // (Change orders on a standard invoice are billed on that invoice, as before.)
  const stagedIds = rows.filter((row) => row.stage !== "standalone").map((row) => row.id);
  const approved = stagedIds.length
    ? (await db.select().from(changeOrders).where(and(inArray(changeOrders.invoiceId, stagedIds), eq(changeOrders.status, "approved"))))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    : [];
  const changeOrderLines: ContractScopeLine[] = approved.map((order) => ({ section: "Approved change orders", description: order.description, amount: round2(Number(order.amount) || 0) }));
  const changeOrdersTotal = round2(changeOrderLines.reduce((sum, line) => sum + line.amount, 0));
  const total = round2(baseTotal + changeOrdersTotal);
  const sent = rows.filter((row) => row.status !== "draft");
  const invoicedToDate = round2(sent.reduce((sum, row) => sum + Number(row.total), 0));
  const paidToDate = round2(sent.reduce((sum, row) => sum + Number(row.amountPaid), 0));
  return {
    contractTotal: total,
    contractSource: jobTotal > 0 ? "job_total" : linesTotal > 0 ? "lines" : "none",
    linesTotal,
    baseTotal,
    changeOrdersTotal,
    scope: [...scope, ...changeOrderLines],
    invoicedToDate,
    paidToDate,
    remaining: round2(Math.max(0, total - invoicedToDate)),
    nextProgressNumber: rows.filter((row) => row.stage === "progress").length + 1,
    invoices: rows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((row) => ({
        id: row.id, invoiceNumber: row.invoiceNumber, stage: row.stage, stageNumber: row.stageNumber, status: row.status,
        total: Number(row.total), amountPaid: Number(row.amountPaid), balance: Number(row.balance), issueDate: row.issueDate, dueDate: row.dueDate,
      })),
  };
}

export interface StageSnapshot {
  stageNumber: number | null;
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
  const stageNumber = stage === "progress" ? billing.nextProgressNumber : null;
  return {
    stageNumber,
    contractScope: billing.scope,
    contractTotal: billing.contractTotal.toFixed(2),
    previouslyInvoiced: billing.invoicedToDate.toFixed(2),
    previouslyPaid: billing.paidToDate.toFixed(2),
    due,
    lineItem: {
      category: "other", description: stageLineDescription(stage, basis, billing.contractTotal, billing.scope, stageNumber),
      quantity: "1", unit: "lump", rate: due.toFixed(2), amount: due.toFixed(2), section: null, refs: null, status: "pending", isChangeOrder: false, changeOrderReason: null,
    },
  };
}
