import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, AlertTriangle, CheckCircle, Landmark, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import type { InvoiceWithRelations } from "./types";

interface PlaidTransaction {
  transactionId: string;
  date: string;
  amount: number;
  name: string;
  merchantName?: string;
}
interface ReconcileMatch {
  transaction: PlaidTransaction;
  invoice: InvoiceWithRelations;
  ambiguous: boolean;
}
interface TransactionResponse {
  connected: boolean;
  ready: boolean;
  transactions: PlaidTransaction[];
  reason?: "no_account" | "not_configured" | "product_not_ready";
}

export function ReconcileDialog({
  open,
  onClose,
  invoices,
}: {
  open: boolean;
  onClose: () => void;
  invoices: InvoiceWithRelations[];
}) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);
  const { data: txData, isLoading, error, refetch } = useQuery<TransactionResponse>({
    queryKey: ["/api/plaid/transactions"],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch("/api/plaid/transactions", { credentials: "include" });
      if (!res.ok) {
        const responseError = await res.json();
        throw new Error(responseError.error || "Failed to fetch");
      }
      return res.json();
    },
  });
  const confirmPaymentMutation = useMutation({
    mutationFn: async ({ invoiceId, transactionId, date }: { invoiceId: string; amount: number; transactionId: string; date: string }) => {
      const response = await apiRequest("POST", `/api/invoices/${invoiceId}/mark-paid`, {
        paymentMethod: "bank_transfer",
        paymentDate: new Date(date + "T12:00:00").toISOString(),
        referenceNumber: transactionId,
      });
      return response.json();
    },
    onSuccess: () => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      trackEvent("payment_recorded", { method: "bank_transfer", source: "reconciliation" });
      toast({ title: "Payment confirmed", description: "Invoice marked as paid from bank transaction." });
      void refetch();
    },
    onError: (err: Error) => toast({ title: "Failed to confirm payment", description: err.message, variant: "destructive" }),
  });

  const openInvoices = invoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "draft");
  type Candidate = { tx: PlaidTransaction; inboundAmount: number; inv: InvoiceWithRelations; delta: number };
  const candidates: Candidate[] = [];
  const txCandidateCount = new Map<string, number>();
  if (txData?.transactions) {
    for (const tx of txData.transactions) {
      if (tx.amount >= 0) continue;
      const inboundAmount = Math.abs(tx.amount);
      for (const inv of openInvoices) {
        const delta = Math.abs(inboundAmount - Number(inv.balance));
        if (delta <= 1) {
          candidates.push({ tx, inboundAmount, inv, delta });
          txCandidateCount.set(tx.transactionId, (txCandidateCount.get(tx.transactionId) ?? 0) + 1);
        }
      }
    }
  }
  candidates.sort((a, b) => {
    if (a.delta !== b.delta) return a.delta - b.delta;
    const dateA = a.inv.dueDate ? new Date(a.inv.dueDate).getTime() : 0;
    const dateB = b.inv.dueDate ? new Date(b.inv.dueDate).getTime() : 0;
    if (dateA !== dateB) return dateA - dateB;
    return (a.inv.invoiceNumber ?? "").localeCompare(b.inv.invoiceNumber ?? "");
  });
  const matches: ReconcileMatch[] = [];
  const usedInvoiceIds = new Set<string>();
  const usedTxIds = new Set<string>();
  for (const { tx, inboundAmount, inv } of candidates) {
    if (usedTxIds.has(tx.transactionId) || usedInvoiceIds.has(inv.id)) continue;
    matches.push({
      transaction: { ...tx, amount: inboundAmount },
      invoice: inv,
      ambiguous: (txCandidateCount.get(tx.transactionId) ?? 0) > 1,
    });
    usedInvoiceIds.add(inv.id);
    usedTxIds.add(tx.transactionId);
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" />Reconcile Payments</DialogTitle>
          <p className="text-sm text-muted-foreground">Last 30 days of bank transactions matched to open invoices (±$1 tolerance)</p>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Fetching transactions…</div>
          ) : error ? (
            <div className="m-4 flex items-start gap-3 rounded-md border border-dashed p-4 text-sm" role="alert">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div><p className="font-medium">Unable to fetch transactions</p><p className="mt-1 text-muted-foreground">{(error as Error).message}</p></div>
            </div>
          ) : !txData?.connected ? (
            <div className="m-4 flex items-start gap-3 rounded-md border border-dashed p-4 text-sm" data-testid="reconcile-no-account">
              <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div><p className="font-medium text-foreground">No bank account connected</p><p className="mt-1 text-muted-foreground"><a href="/settings" className="font-medium text-primary hover:underline">Connect a bank account in Settings</a> to enable payment reconciliation.</p></div>
            </div>
          ) : !txData.ready ? (
            <div className="m-4 flex items-start gap-3 rounded-md border border-dashed p-4 text-sm" data-testid="reconcile-syncing">
              <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">Transactions syncing</p>
                <p className="mt-1 text-muted-foreground">Your bank is still preparing transaction data. This usually takes a moment — close and reopen to retry.</p>
                <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => void refetch()} data-testid="button-retry-transactions">Retry now</button>
              </div>
            </div>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground" data-testid="reconcile-no-matches">
              <CheckCircle className="h-10 w-10 text-muted-foreground/40" />
              <p className="font-medium text-foreground">No matches found</p>
              <p>No bank transactions in the last 30 days matched any open invoice balances within ±$1.</p>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {matches.map(({ transaction, invoice, ambiguous }) => (
                <div key={transaction.transactionId + invoice.id} className={`space-y-3 rounded-lg border p-4${ambiguous ? " border-amber-400 dark:border-amber-500" : ""}`} data-testid={`reconcile-match-${transaction.transactionId}`}>
                  {ambiguous && <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300" data-testid={`warning-ambiguous-${transaction.transactionId}`}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>This transaction amount matched multiple open invoices. The closest match is shown — verify before confirming.</span></div>}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium"><span className="text-muted-foreground">{format(new Date(transaction.date + "T12:00:00"), "MMM d, yyyy")}</span><span>·</span><span className="truncate">{transaction.merchantName || transaction.name}</span></div>
                      <div className="truncate text-xs text-muted-foreground">{transaction.name}</div>
                    </div>
                    <span className="shrink-0 font-mono font-semibold text-green-700 dark:text-green-400">${transaction.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Matches invoice</span><span className="font-mono font-medium">{invoice.invoiceNumber}</span><span className="text-muted-foreground">·</span><span>{invoice.client?.name}</span>
                    <span className="font-mono font-semibold">${Number(invoice.balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <Button size="sm" className="w-full bg-green-600 text-white hover:bg-green-700" disabled={confirmPaymentMutation.isPending && confirming === transaction.transactionId}
                    onClick={() => {
                      setConfirming(transaction.transactionId);
                      confirmPaymentMutation.mutate({ invoiceId: invoice.id, amount: transaction.amount, transactionId: transaction.transactionId, date: transaction.date });
                    }} data-testid={`button-confirm-reconcile-${transaction.transactionId}`}>
                    <CheckCircle className="mr-2 h-4 w-4" />{confirmPaymentMutation.isPending && confirming === transaction.transactionId ? "Confirming…" : "Confirm as payment"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0"><Button variant="outline" onClick={onClose} data-testid="button-close-reconcile">Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
