// Billing on the job page: the contract, how much of it has been invoiced and
// paid, what's left, and each stage invoice so far, with the next stage one
// click away. Figures come from /api/jobs/:id/billing (shared/invoice-stages.ts).
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Landmark, Plus } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InvoiceStatusBadge } from "@/components/status-badge";
import { INVOICE_STAGE_LABELS, type ContractScopeLine, type InvoiceStage } from "@shared/invoice-stages";

export interface JobBillingData {
  contractTotal: number;
  scope: ContractScopeLine[];
  invoicedToDate: number;
  paidToDate: number;
  remaining: number;
  invoices: Array<{ id: string; invoiceNumber: string; stage: string; status: string; total: number; amountPaid: number; balance: number; issueDate: string; dueDate: string }>;
}

const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

export function JobBillingPanel({ jobId }: { jobId: string }) {
  // Always fresh on arrival: invoices and payments made elsewhere change these figures.
  const query = useQuery<JobBillingData>({ queryKey: [`/api/jobs/${jobId}/billing`], staleTime: 0 });
  const data = query.data;
  if (query.isLoading) return <Card className="rounded-3xl border-jx-line bg-jx-surface shadow-none"><CardContent className="px-5 py-6 text-sm text-jx-ink-2" data-testid="job-billing-loading">Loading billing…</CardContent></Card>;
  if (query.isError || !data) return <Card className="rounded-3xl border-jx-line bg-jx-surface shadow-none"><CardContent className="px-5 py-6 text-sm text-jx-orange-ink" role="alert">Billing couldn’t be loaded. Refresh the page to try again.</CardContent></Card>;

  const hasContract = Number(data.contractTotal) > 0;
  const invoicedPct = pct(data.invoicedToDate, data.contractTotal);
  const paidPct = pct(data.paidToDate, data.contractTotal);
  const staged = (Array.isArray(data.invoices) ? data.invoices : []).filter((invoice) => invoice.stage !== "standalone");
  const hasDeposit = staged.some((invoice) => invoice.stage === "deposit");
  const fullyBilled = hasContract && data.remaining <= 0;
  const newStage = (stage: InvoiceStage) => `/invoices/new?jobId=${jobId}&stage=${stage}`;

  return (
    <Card className="rounded-3xl border-jx-line bg-jx-gold-tint shadow-none" data-testid="job-billing">
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-5 pb-2 pt-5">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg !font-bold text-jx-ink"><Landmark className="h-4 w-4" aria-hidden="true" />Billing</h2>
          <p className="mt-1 text-sm text-jx-ink-2">
            {hasContract ? <>{money(data.contractTotal)} contract from {data.scope.length} priced {data.scope.length === 1 ? "line" : "lines"}</> : "No priced line items yet, so there's no contract to bill in stages."}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {hasContract && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Contract", data.contractTotal, "stat-contract"],
                ["Invoiced", data.invoicedToDate, "stat-invoiced"],
                ["Paid", data.paidToDate, "stat-paid"],
                ["Left to bill", data.remaining, "stat-remaining"],
              ].map(([label, value, testId]) => (
                <div key={String(label)} className="rounded-2xl bg-card px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[.1em] text-jx-ink-3">{label}</p>
                  <p className="mt-0.5 font-mono text-base font-semibold tabular-nums text-jx-ink" data-testid={String(testId)}>{money(value as number)}</p>
                </div>
              ))}
            </div>
            <div aria-label={`${invoicedPct}% invoiced, ${paidPct}% paid`} className="relative h-2.5 overflow-hidden rounded-full bg-card" data-testid="billing-progress">
              <div className="absolute inset-y-0 left-0 rounded-full bg-jx-gold-ink/40" style={{ width: `${invoicedPct}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-jx-green" style={{ width: `${paidPct}%` }} />
            </div>
            <p className="-mt-2 text-xs text-jx-ink-2">{invoicedPct}% invoiced · {paidPct}% paid</p>
          </>
        )}

        {staged.length > 0 && (
          <ul className="space-y-2" data-testid="billing-stages">
            {staged.map((invoice) => (
              <li key={invoice.id} className="flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5" data-testid={`billing-stage-${invoice.id}`}>
                <Link href={invoice.status === "draft" ? `/invoices/new?draft=${invoice.id}` : `/invoices/${invoice.id}`} className="min-w-0 flex-1 text-jx-ink hover:text-jx-green-ink">
                  <span className="block text-sm font-semibold">{INVOICE_STAGE_LABELS[invoice.stage as InvoiceStage] ?? invoice.stage} <span className="font-mono text-xs font-normal text-jx-ink-2">{invoice.invoiceNumber}</span></span>
                  <span className="block text-xs text-jx-ink-2"><span className="font-mono">{money(invoice.total)}</span>{invoice.amountPaid > 0 && <> · paid <span className="font-mono">{money(invoice.amountPaid)}</span></>}</span>
                </Link>
                <InvoiceStatusBadge status={invoice.status} />
              </li>
            ))}
          </ul>
        )}

        {hasContract && !fullyBilled && (
          <div className="flex flex-wrap gap-2">
            {!hasDeposit && data.invoicedToDate === 0 && (
              <Link href={newStage("deposit")} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-jx-green px-4 text-xs font-bold text-white hover:bg-jx-green-hover" data-testid="button-bill-deposit"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Deposit invoice</Link>
            )}
            <Link href={newStage("progress")} className="inline-flex min-h-10 items-center gap-1 rounded-full border-2 border-jx-ink px-4 text-xs font-bold text-jx-ink" data-testid="button-bill-progress"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Progress payment</Link>
            <Link href={newStage("final")} className="inline-flex min-h-10 items-center gap-1 rounded-full border-2 border-jx-ink px-4 text-xs font-bold text-jx-ink" data-testid="button-bill-final"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Final invoice</Link>
          </div>
        )}
        {fullyBilled && <p className="text-sm font-semibold text-jx-green-ink" data-testid="billing-complete">The full contract has been invoiced.</p>}
      </CardContent>
    </Card>
  );
}
