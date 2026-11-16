// Payments recorded by hand (a check, cash, Zelle) that the bank feed has not
// confirmed. Once a business bank account is connected, every deposit shows
// up as a Plaid transaction and gets matched to a payment, automatically when
// amount and date line up, otherwise by hand under Settings → Bank Account.
// A payment that is old enough to have cleared and still has no matched
// deposit is the one to look at: the check bounced, was never deposited, or
// was recorded against the wrong invoice. This is derived from the tables as
// they stand, not stored, so it is always current and clears itself the
// moment a deposit is matched.
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { bankAccounts, clients, invoices, payments, plaidTransactions } from "@shared/schema";

/** Days a hand-recorded payment may go unmatched before it is raised. Checks clear in about five business days. */
export const UNMATCHED_GRACE_DAYS = 10;

export interface UnmatchedPayment {
  paymentId: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string | null;
  jobId: string | null;
  amount: number;
  paymentMethod: string;
  referenceNumber: string | null;
  paymentDate: Date;
  daysUnmatched: number;
}

const METHOD_LABELS: Record<string, string> = { check: "Check", cash: "Cash", bank_transfer: "Bank transfer", credit_card: "Card", zelle: "Zelle", venmo: "Venmo" };

export function describeUnmatched(row: UnmatchedPayment): string {
  const method = METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod;
  const ref = row.referenceNumber ? ` #${row.referenceNumber}` : "";
  const amount = `$${row.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const when = row.paymentDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${method}${ref} for ${amount} recorded ${when}; no matching bank deposit after ${row.daysUnmatched} days. Match it under Settings → Bank Account.`;
}

/** True when a business bank account is connected, which is what makes "no deposit" mean something. */
export async function businessBankConnected(): Promise<boolean> {
  const [row] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.entityType, "business")).limit(1);
  return !!row;
}

export async function unmatchedManualPayments(now: Date = new Date(), graceDays = UNMATCHED_GRACE_DAYS): Promise<UnmatchedPayment[]> {
  if (!(await businessBankConnected())) return [];
  const cutoff = new Date(now.getTime() - graceDays * 86_400_000);
  const rows = await db
    .select({
      paymentId: payments.id,
      invoiceId: payments.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      clientName: clients.name,
      jobId: invoices.jobId,
      amount: payments.amount,
      paymentMethod: payments.paymentMethod,
      referenceNumber: payments.referenceNumber,
      paymentDate: payments.paymentDate,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .leftJoin(clients, eq(clients.id, invoices.clientId))
    .leftJoin(plaidTransactions, eq(plaidTransactions.matchedPaymentId, payments.id))
    .where(and(
      isNull(payments.providerRef),            // came through Stripe → Stripe vouches for it
      eq(payments.status, "succeeded"),
      lte(payments.paymentDate, cutoff),
      isNull(plaidTransactions.id),            // no deposit matched to it
      sql`${payments.amount} > 0`,
    ))
    .orderBy(payments.paymentDate);
  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
    daysUnmatched: Math.floor((now.getTime() - row.paymentDate.getTime()) / 86_400_000),
  }));
}
