import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  Download,
  Eye,
  Mail,
  DollarSign,
  Trash2,
  MoreVertical,
  CheckCircle,
  Banknote,
  FileText,
  Building2,
  CreditCard,
  Bell,
  BellOff,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  RefreshCw,
  Landmark,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import type { Invoice, Client, Job } from "@shared/schema";
const BADGE: Record<string, { bg: string; fg: string }> = {
  draft:   { bg: "#eef0f3", fg: "#6b7686" },
  sent:    { bg: "#eef2fe", fg: "#2563eb" },
  paid:    { bg: "#e7f7ee", fg: "#15a35a" },
  overdue: { bg: "#fdeeec", fg: "#d23b1f" },
  partial: { bg: "#fef5e7", fg: "#b6731a" },
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", icon: Banknote },
  { value: "check", label: "Cheque", icon: FileText },
  { value: "bank_transfer", label: "Bank Transfer", icon: Building2 },
  { value: "credit_card", label: "Card", icon: CreditCard },
] as const;

interface InvoiceWithRelations extends Invoice {
  client: Client;
  job?: Job;
}

const TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "partial", label: "Partial" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
  { key: "collections", label: "Collections" },
];

const PAGE_SIZE = 12;

function fmtMoney(n: number, decimals = 0) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "MMM d"); } catch { return "—"; }
}

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
}

function ReconcileDialog({ open, onClose, invoices }: { open: boolean; onClose: () => void; invoices: InvoiceWithRelations[] }) {
  const { toast } = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: transactions, isLoading, error, refetch } = useQuery<PlaidTransaction[]>({
    queryKey: ["/api/plaid/transactions"],
    enabled: open,
    queryFn: async () => {
      const res = await fetch("/api/plaid/transactions", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed to fetch"); }
      return res.json();
    },
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async ({ invoiceId, amount, transactionId, date }: { invoiceId: string; amount: number; transactionId: string; date: string }) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/mark-paid`, {
        paymentMethod: "bank_transfer",
        paymentDate: new Date(date + "T12:00:00").toISOString(),
        referenceNumber: transactionId,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      setConfirming(null);
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Payment confirmed", description: "Invoice marked as paid from bank transaction." });
      refetch();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to confirm payment", description: err.message, variant: "destructive" });
    },
  });

  const openInvoices = invoices.filter(inv => inv.status !== "paid" && inv.status !== "draft");

  // In Plaid, negative amounts = money flowing INTO the account (deposits/incoming payments).
  // Positive amounts = money flowing OUT (purchases/expenses). We want incoming payments only.
  const matches: ReconcileMatch[] = [];
  const usedInvoiceIds = new Set<string>();
  const usedTxIds = new Set<string>();
  if (transactions) {
    for (const tx of transactions) {
      if (tx.amount >= 0) continue; // Skip outflows — only match incoming deposits
      const inboundAmount = Math.abs(tx.amount); // The actual deposit amount (positive)
      for (const inv of openInvoices) {
        if (usedInvoiceIds.has(inv.id) || usedTxIds.has(tx.transactionId)) continue;
        const balance = Number(inv.balance);
        if (Math.abs(inboundAmount - balance) <= 1.0) {
          matches.push({ transaction: { ...tx, amount: inboundAmount }, invoice: inv });
          usedInvoiceIds.add(inv.id);
          usedTxIds.add(tx.transactionId);
          break; // Each transaction matches at most one invoice
        }
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Reconcile Payments
          </DialogTitle>
          <p className="text-sm text-muted-foreground">Last 30 days of bank transactions matched to open invoices (±$1 tolerance)</p>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Fetching transactions…
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 rounded-md border border-dashed p-4 m-4 text-sm">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Unable to fetch transactions</p>
                <p className="text-muted-foreground mt-1">{(error as Error).message}</p>
                {(error as Error).message.includes("not configured") && (
                  <p className="text-muted-foreground mt-1">Add your <code className="rounded bg-muted px-1 text-xs font-mono">PLAID_CLIENT_ID</code> and <code className="rounded bg-muted px-1 text-xs font-mono">PLAID_SECRET</code> secrets, then connect a bank account in Settings.</p>
                )}
              </div>
            </div>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground text-sm px-6">
              <CheckCircle className="h-10 w-10 text-muted-foreground/40" />
              <p className="font-medium text-foreground">No matches found</p>
              <p>No bank transactions in the last 30 days matched any open invoice balances within ±$1.</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {matches.map(({ transaction, invoice }) => (
                <div
                  key={transaction.transactionId + invoice.id}
                  className="rounded-lg border p-4 space-y-3"
                  data-testid={`reconcile-match-${transaction.transactionId}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-muted-foreground">{format(new Date(transaction.date + "T12:00:00"), "MMM d, yyyy")}</span>
                        <span>·</span>
                        <span className="truncate">{transaction.merchantName || transaction.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{transaction.name}</div>
                    </div>
                    <span className="font-mono font-semibold text-green-700 dark:text-green-400 shrink-0">
                      ${transaction.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Matches invoice</span>
                    <span className="font-mono font-medium">{invoice.invoiceNumber}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{invoice.client?.name}</span>
                    <span className="font-mono font-semibold">${Number(invoice.balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <Button
                    size="sm"
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    disabled={confirmPaymentMutation.isPending && confirming === transaction.transactionId}
                    onClick={() => {
                      setConfirming(transaction.transactionId);
                      confirmPaymentMutation.mutate({
                        invoiceId: invoice.id,
                        amount: transaction.amount,
                        transactionId: transaction.transactionId,
                        date: transaction.date,
                      });
                    }}
                    data-testid={`button-confirm-reconcile-${transaction.transactionId}`}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {confirmPaymentMutation.isPending && confirming === transaction.transactionId
                      ? "Confirming…"
                      : "Confirm as payment"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose} data-testid="button-close-reconcile">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CollectionsEntry = {
  id: string;
  invoiceNumber: string;
  status: string;
  balance: string;
  dueDate: string;
  lastReminderSent: string | null;
  reminderCount: number;
  remindersPaused: boolean;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  jobTitle: string | null;
  daysOverdue: number;
  currentStage: number;
  nextActionDate: string | null;
};

function CollectionsView() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"daysOverdue" | "balance" | "clientName">("daysOverdue");

  const { data: entries = [], isLoading, refetch } = useQuery<CollectionsEntry[]>({
    queryKey: ["/api/collections"],
    queryFn: async () => {
      const res = await fetch("/api/collections");
      if (!res.ok) throw new Error("Failed to fetch collections");
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      const res = await apiRequest("PATCH", `/api/invoices/${id}/collections`, { remindersPaused: paused });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => { refetch(); queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reminders/process");
      return res.json();
    },
    onSuccess: (data: any) => {
      refetch();
      toast({ title: "Reminders processed", description: `${data.sent ?? 0} sent, ${data.processed ?? 0} checked` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const fmtBalance = (b: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(b));

  const filteredEntries = entries
    .filter((e) => stageFilter === "all" || String(e.currentStage) === stageFilter)
    .sort((a, b) => {
      if (sortBy === "daysOverdue") return b.daysOverdue - a.daysOverdue;
      if (sortBy === "balance") return Number(b.balance) - Number(a.balance);
      return (a.clientName ?? "").localeCompare(b.clientName ?? "");
    });

  return (
    <div style={{ padding: "0" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--panel-bd)", background: "var(--track)", flexWrap: "wrap" as const, gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" as const }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Bell style={{ width: 15, height: 15, color: "var(--faint)" }} />
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: ".04em" }}>
              {filteredEntries.length}/{entries.length} invoice{entries.length !== 1 ? "s" : ""}
            </span>
          </div>
          {/* Stage filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            {[
              { key: "all", label: "All stages" },
              { key: "0", label: "Stage 0" },
              { key: "1", label: "Stage 1" },
              { key: "2", label: "Stage 2" },
              { key: "3", label: "Stage 3" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setStageFilter(opt.key)}
                style={{
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  fontSize: "11.5px", fontWeight: 600, padding: "4px 9px", borderRadius: "6px",
                  background: stageFilter === opt.key ? "var(--jox-primary)" : "var(--track)",
                  color: stageFilter === opt.key ? "#fff" : "var(--faint)",
                }}
                data-testid={`filter-stage-${opt.key}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Sort */}
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ fontSize: "11px", color: "var(--faint)", fontWeight: 600 }}>Sort:</span>
            {([["daysOverdue", "Days overdue"], ["balance", "Balance"], ["clientName", "Client"]] as const).map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setSortBy(k)}
                style={{
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  fontSize: "11.5px", fontWeight: 600, padding: "4px 9px", borderRadius: "6px",
                  background: sortBy === k ? "var(--jox-primary)" : "var(--track)",
                  color: sortBy === k ? "#fff" : "var(--faint)",
                }}
                data-testid={`sort-${k}`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => processMutation.mutate()}
          disabled={processMutation.isPending}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "8px", padding: "7px 13px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", opacity: processMutation.isPending ? 0.6 : 1 }}
          data-testid="button-process-reminders"
        >
          {processMutation.isPending ? "Sending…" : "Run Reminders Now"}
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--faint)", fontSize: "13px" }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: "56px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "10px" }}>✅</div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>No overdue invoices</div>
          <div style={{ fontSize: "13px", color: "var(--faint)" }}>All invoices are up to date.</div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--faint)", fontSize: "13px" }}>No invoices match the current filter.</div>
      ) : (
        <>
          {/* Table header */}
          <div style={{ display: "flex", alignItems: "center", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" as const, color: "var(--faint)", padding: "11px 18px", background: "var(--track)", borderBottom: "1px solid var(--panel-bd)" }}>
            <span style={{ width: "104px", flexShrink: 0 }}>Invoice</span>
            <span style={{ flex: 1, minWidth: 0 }}>Client</span>
            <span style={{ width: "72px", flexShrink: 0, textAlign: "center" as const }}>Overdue</span>
            <span style={{ width: "64px", flexShrink: 0, textAlign: "center" as const }}>Stage</span>
            <span style={{ width: "96px", flexShrink: 0, textAlign: "right" as const }}>Balance</span>
            <span style={{ width: "88px", flexShrink: 0 }}>Last Contact</span>
            <span style={{ width: "88px", flexShrink: 0 }}>Next Action</span>
            <span style={{ width: "80px", flexShrink: 0, textAlign: "center" as const }}>Status</span>
            <span style={{ width: "40px", flexShrink: 0 }}></span>
          </div>

          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="rowhover"
              style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: "1px solid var(--panel-bd)", cursor: "pointer" }}
              onClick={() => setLocation(`/invoices/${entry.id}`)}
              data-testid={`row-collections-${entry.id}`}
            >
              <span style={{ width: "104px", flexShrink: 0, fontFamily: "monospace", fontSize: "13px", fontWeight: 600 }}>{entry.invoiceNumber}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: "13px" }}>
                {entry.clientName ?? "—"}
                {entry.jobTitle && <span style={{ color: "var(--faint)", marginLeft: "6px", fontSize: "12px" }}>{entry.jobTitle}</span>}
              </span>
              <span style={{ width: "72px", flexShrink: 0, textAlign: "center" as const, fontSize: "13px", fontWeight: 600, color: entry.daysOverdue > 30 ? "#dc2626" : entry.daysOverdue > 14 ? "#ea580c" : "inherit" }}>
                {entry.daysOverdue}d
              </span>
              <span style={{ width: "64px", flexShrink: 0, textAlign: "center" as const, fontSize: "12px" }}>
                {entry.currentStage === 0 ? "—" : `${entry.currentStage}/3`}
              </span>
              <span style={{ width: "96px", flexShrink: 0, textAlign: "right" as const, fontFamily: "monospace", fontSize: "13px", fontWeight: 600, color: "#dc2626" }}>
                {fmtBalance(entry.balance)}
              </span>
              <span style={{ width: "88px", flexShrink: 0, fontSize: "12px", color: "var(--faint)", paddingLeft: "4px" }} data-testid={`text-last-contact-${entry.id}`}>
                {entry.lastReminderSent ? format(new Date(entry.lastReminderSent), "MMM d") : "—"}
              </span>
              <span style={{ width: "88px", flexShrink: 0, fontSize: "12px", color: "var(--faint)", paddingLeft: "4px" }}>
                {entry.nextActionDate ? format(new Date(entry.nextActionDate), "MMM d") : entry.reminderCount >= 3 ? "Complete" : "—"}
              </span>
              <span style={{ width: "88px", flexShrink: 0, textAlign: "center" as const }}>
                {entry.remindersPaused ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600, color: "var(--faint)", background: "var(--track)", borderRadius: "5px", padding: "2px 8px" }}>
                    <BellOff style={{ width: 11, height: 11 }} /> Paused
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600, color: "#15a35a", background: "rgba(21,163,90,.1)", borderRadius: "5px", padding: "2px 8px" }}>
                    <Bell style={{ width: 11, height: 11 }} /> Active
                  </span>
                )}
              </span>
              <span style={{ width: "40px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleMutation.mutate({ id: entry.id, paused: !entry.remindersPaused }); }}
                  disabled={toggleMutation.isPending}
                  title={entry.remindersPaused ? "Resume reminders" : "Pause reminders"}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "4px", color: "var(--faint)" }}
                  data-testid={`button-toggle-collections-${entry.id}`}
                >
                  {entry.remindersPaused
                    ? <PlayCircle style={{ width: 15, height: 15 }} />
                    : <PauseCircle style={{ width: 15, height: 15 }} />}
                </button>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function Invoices() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [quickPayInvoice, setQuickPayInvoice] = useState<InvoiceWithRelations | null>(null);
  const [quickPayMethod, setQuickPayMethod] = useState<string>("cash");
  const [quickPayDate, setQuickPayDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [deleteInvoiceId, setDeleteInvoiceId] = useState<string | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);

  const { data: invoices, isLoading } = useQuery<InvoiceWithRelations[]>({
    queryKey: ["/api/invoices"],
  });

  const sendInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/send`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice sent", description: "The invoice has been sent to the client." });
    },
    onError: (error: Error) => {
      toast({ title: "Error sending invoice", description: error.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ invoiceId, paymentMethod, paymentDate }: { invoiceId: string; paymentMethod: string; paymentDate: string }) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/mark-paid`, {
        paymentMethod,
        paymentDate: new Date(paymentDate).toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setQuickPayInvoice(null);
      toast({ title: "Payment recorded", description: "Invoice marked as paid and payment logged." });
    },
    onError: (error: Error) => {
      toast({ title: "Error recording payment", description: error.message, variant: "destructive" });
    },
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      await apiRequest("DELETE", `/api/invoices/${invoiceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setDeleteInvoiceId(null);
      toast({ title: "Invoice deleted", description: "The invoice has been permanently deleted." });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting invoice", description: error.message, variant: "destructive" });
    },
  });

  const openQuickPay = (invoice: InvoiceWithRelations) => {
    setQuickPayInvoice(invoice);
    setQuickPayMethod("cash");
    setQuickPayDate(format(new Date(), "yyyy-MM-dd"));
  };

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const stats = (() => {
    if (!invoices) return { outstanding: 0, overdue: 0, paidThisMonth: 0, drafts: 0 };
    let outstanding = 0, overdue = 0, paidThisMonth = 0, drafts = 0;
    for (const inv of invoices) {
      const bal = Number(inv.balance ?? 0);
      if (inv.status === "draft") {
        drafts += Number(inv.total ?? 0);
      } else if (inv.status === "overdue") {
        overdue += bal;
        outstanding += bal;
      } else if (inv.status === "sent" || inv.status === "partial") {
        outstanding += bal;
      } else if (inv.status === "paid" && inv.paymentDate) {
        const pd = new Date(inv.paymentDate);
        if (pd.getMonth() === thisMonth && pd.getFullYear() === thisYear) {
          paidThisMonth += Number(inv.total ?? 0);
        }
      }
    }
    return { outstanding, overdue, paidThisMonth, drafts };
  })();

  const countByStatus = (s: string) => {
    if (s === "collections") return null;
    if (!invoices) return 0;
    if (s === "all") return invoices.length;
    return invoices.filter(i => i.status === s).length;
  };

  const filteredInvoices = (invoices ?? []).filter((inv) => {
    const matchesSearch =
      inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (inv.client?.name ?? "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const safePageNum = Math.min(page, totalPages);
  const pageInvoices = filteredInvoices.slice((safePageNum - 1) * PAGE_SIZE, safePageNum * PAGE_SIZE);

  const handleTabClick = (key: string) => {
    setStatusFilter(key);
    setPage(1);
  };

  const formatCurrency = (amount: string | number | null | undefined) => {
    if (!amount) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(amount));
  };

  return (
    <>
      {/* ── Reconcile Dialog ── */}
      <ReconcileDialog open={showReconcile} onClose={() => setShowReconcile(false)} invoices={invoices ?? []} />

      {/* ── Quick-Pay Dialog ── */}
      <Dialog open={!!quickPayInvoice} onOpenChange={(open) => !open && setQuickPayInvoice(null)}>
        <DialogContent className="sm:max-w-sm !flex flex-col max-h-[90dvh] overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Record Payment
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0">
          {quickPayInvoice && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice</span>
                  <span className="font-mono font-medium">{quickPayInvoice.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Client</span>
                  <span className="font-medium">{quickPayInvoice.client?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount due</span>
                  <span className="font-mono font-semibold text-green-700 dark:text-green-400">{formatCurrency(quickPayInvoice.balance)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>How was payment received?</Label>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQuickPayMethod(value)}
                      data-testid={`button-pay-method-${value}`}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        quickPayMethod === value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input bg-background hover:bg-accent"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-pay-date">Payment date</Label>
                <Input
                  id="quick-pay-date"
                  type="date"
                  value={quickPayDate}
                  onChange={(e) => setQuickPayDate(e.target.value)}
                  data-testid="input-quick-pay-date"
                />
              </div>
            </div>
          )}
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setQuickPayInvoice(null)} data-testid="button-cancel-quick-pay">Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={markPaidMutation.isPending}
              onClick={() => quickPayInvoice && markPaidMutation.mutate({ invoiceId: quickPayInvoice.id, paymentMethod: quickPayMethod, paymentDate: quickPayDate })}
              data-testid="button-confirm-quick-pay"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {markPaidMutation.isPending ? "Saving…" : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ── */}
      <AlertDialog open={!!deleteInvoiceId} onOpenChange={(o) => { if (!o) setDeleteInvoiceId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the invoice and all its line items. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-invoice">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteInvoiceId && deleteInvoiceMutation.mutate(deleteInvoiceId)}
              disabled={deleteInvoiceMutation.isPending}
              data-testid="button-confirm-delete-invoice"
            >
              {deleteInvoiceMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Page body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px 40px" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>

          {/* ── Title row ── */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-.02em" }}>Invoices</h2>
              <p style={{ margin: "5px 0 0", fontSize: "13.5px", color: "var(--faint)" }}>
                {invoices ? `${invoices.length} invoice${invoices.length !== 1 ? "s" : ""} total` : "Loading…"}
              </p>
            </div>
            <div style={{ display: "flex", gap: "9px" }}>
              <button
                style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--panel-bd)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                <Download style={{ width: "15px", height: "15px" }} />
                Export
              </button>
              <button
                onClick={() => setShowReconcile(true)}
                style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--panel-bd)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                data-testid="button-reconcile-payments"
              >
                <Landmark style={{ width: "15px", height: "15px" }} />
                Reconcile
              </button>
              <button
                onClick={() => setLocation("/invoices/new")}
                style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 16px", fontSize: "13.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(37,99,235,.3)", textDecoration: "none" }}
                data-testid="button-create-invoice"
              >
                <Plus style={{ width: "16px", height: "16px" }} />
                Create Invoice
              </button>
            </div>
          </div>

          {/* ── Stat strip ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "20px" }}>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Outstanding</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-outstanding">{fmtMoney(stats.outstanding)}</div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Overdue</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px", color: stats.overdue > 0 ? "#d23b1f" : undefined }} data-testid="stat-overdue">{fmtMoney(stats.overdue)}</div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Paid this month</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px", color: "#15a35a" }} data-testid="stat-paid-month">{fmtMoney(stats.paidThisMonth)}</div>
            </div>
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Drafts</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-drafts">{fmtMoney(stats.drafts)}</div>
            </div>
          </div>

          {/* ── Table card ── */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>

            {/* Filter tabs row */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "12px 16px", borderBottom: "1px solid var(--panel-bd)", flexWrap: "wrap" as const }}>
              {TABS.map((tab) => {
                const active = statusFilter === tab.key;
                const count = countByStatus(tab.key);
                return (
                  <button
                    key={tab.key}
                    onClick={() => handleTabClick(tab.key)}
                    data-testid={`tab-${tab.key}`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "6px",
                      border: "none", cursor: "pointer", fontFamily: "inherit",
                      fontSize: "13px", fontWeight: 600, padding: "7px 13px", borderRadius: "8px",
                      background: active ? "var(--jox-primary)" : "transparent",
                      color: active ? "#fff" : "var(--faint)",
                    }}
                  >
                    {tab.label}
                    {count !== null && (
                      <span
                        className="font-mono"
                        style={{
                          fontSize: "11px", fontWeight: 600, padding: "0 6px", borderRadius: "5px",
                          background: active ? "rgba(255,255,255,.22)" : "var(--track)",
                          color: active ? "#fff" : "var(--faint)",
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "7px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--track)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "6px 11px" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input
                    type="text"
                    placeholder="Search invoices, clients…"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                    style={{ border: "none", background: "transparent", fontSize: "12.5px", color: "var(--fg)", outline: "none", width: "180px", fontFamily: "inherit" }}
                    data-testid="input-search-invoices"
                  />
                </div>
              </div>
            </div>

            {/* Collections view */}
            {statusFilter === "collections" && <CollectionsView />}

            {/* Table header */}
            {statusFilter !== "collections" && <div style={{ display: "flex", alignItems: "center", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" as const, color: "var(--faint)", padding: "11px 18px", background: "var(--track)", borderBottom: "1px solid var(--panel-bd)" }}>
              <span style={{ width: "104px", flexShrink: 0 }}>Invoice</span>
              <span style={{ flex: 1, minWidth: 0 }}>Client / Project</span>
              <span style={{ width: "88px", flexShrink: 0 }}>Issued</span>
              <span style={{ width: "88px", flexShrink: 0 }}>Due</span>
              <span style={{ width: "104px", textAlign: "right" as const, flexShrink: 0 }}>Amount</span>
              <span style={{ width: "92px", textAlign: "center" as const, flexShrink: 0 }}>Status</span>
              <span style={{ width: "34px", flexShrink: 0 }}></span>
            </div>}

            {/* Rows */}
            {statusFilter !== "collections" && (isLoading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--faint)", fontSize: "13px" }}>Loading invoices…</div>
            ) : pageInvoices.length === 0 ? (
              <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                <div style={{ fontSize: "32px", marginBottom: "10px" }}>📄</div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>
                  {searchQuery || statusFilter !== "all" ? "No matching invoices" : "No invoices yet"}
                </div>
                <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>
                  {searchQuery || statusFilter !== "all" ? "Try a different filter" : "Create your first invoice to get started"}
                </div>
                {!searchQuery && statusFilter === "all" && (
                  <button
                    onClick={() => setLocation("/invoices/new")}
                    style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    data-testid="button-create-first-invoice"
                  >
                    <Plus style={{ width: "15px", height: "15px" }} /> Create Invoice
                  </button>
                )}
              </div>
            ) : (
              pageInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="rowhover"
                  style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: "1px solid var(--panel-bd)", cursor: "pointer" }}
                  data-testid={`row-invoice-${invoice.id}`}
                >
                  {/* Invoice # */}
                  <Link
                    href={`/invoices/${invoice.id}`}
                    style={{ display: "contents", textDecoration: "none", color: "inherit" }}
                    data-testid={`link-invoice-${invoice.id}`}
                  >
                    <span
                      className="font-mono"
                      style={{ width: "104px", flexShrink: 0, fontSize: "12.5px", fontWeight: 600, color: "var(--jox-primary)" }}
                    >
                      {invoice.invoiceNumber}
                    </span>

                    {/* Client / Project */}
                    <div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {invoice.client?.name || "—"}
                      </div>
                      {invoice.job && (
                        <div style={{ fontSize: "11.5px", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {invoice.job.title}
                        </div>
                      )}
                    </div>

                    {/* Issued */}
                    <span className="font-mono" style={{ width: "88px", flexShrink: 0, fontSize: "12px", color: "var(--faint)" }}>
                      {fmtDate(invoice.issueDate)}
                    </span>

                    {/* Due */}
                    <span className="font-mono" style={{ width: "88px", flexShrink: 0, fontSize: "12px", color: "var(--faint)" }}>
                      {fmtDate(invoice.dueDate)}
                    </span>

                    {/* Amount */}
                    <span className="font-mono" style={{ width: "104px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600 }}>
                      {fmtMoney(Number(invoice.total ?? 0))}
                    </span>
                  </Link>

                  {/* Status badge */}
                  <span style={{ width: "92px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                    <span style={{
                      fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px",
                      textTransform: "capitalize" as const,
                      background: BADGE[invoice.status]?.bg ?? "#eef0f3",
                      color: BADGE[invoice.status]?.fg ?? "#6b7686",
                    }}>
                      {invoice.status}
                    </span>
                  </span>

                  {/* Actions */}
                  <span style={{ width: "34px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "4px", display: "flex" }}
                          data-testid={`button-invoice-actions-${invoice.id}`}
                        >
                          <MoreVertical style={{ width: "16px", height: "16px" }} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={4}>
                        <DropdownMenuItem asChild>
                          <Link href={`/invoices/${invoice.id}`} data-testid={`button-view-invoice-${invoice.id}`}>
                            <Eye className="h-4 w-4 mr-2" />View
                          </Link>
                        </DropdownMenuItem>
                        {invoice.status !== "paid" && (
                          <>
                            <DropdownMenuItem onClick={() => sendInvoiceMutation.mutate(invoice.id)} disabled={sendInvoiceMutation.isPending} data-testid={`button-send-invoice-${invoice.id}`}>
                              <Mail className="h-4 w-4 mr-2" />Send to Client
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openQuickPay(invoice)} data-testid={`button-mark-paid-${invoice.id}`}>
                              <CheckCircle className="h-4 w-4 mr-2" />Mark as Paid
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/invoices/${invoice.id}/payment`} data-testid={`button-record-payment-${invoice.id}`}>
                                <DollarSign className="h-4 w-4 mr-2" />Record Partial Payment
                              </Link>
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link href={`/invoices/${invoice.id}?autoDownload=1`} data-testid={`button-download-invoice-${invoice.id}`}>
                            <Download className="h-4 w-4 mr-2" />Download PDF
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteInvoiceId(invoice.id)}
                          data-testid={`button-delete-invoice-${invoice.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              ))
            ))}

            {/* Footer / pagination */}
            {statusFilter !== "collections" && filteredInvoices.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px" }}>
                <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                  Showing {Math.min((safePageNum - 1) * PAGE_SIZE + 1, filteredInvoices.length)}–{Math.min(safePageNum * PAGE_SIZE, filteredInvoices.length)} of {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePageNum <= 1}
                    style={{ border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--faint)", borderRadius: "7px", padding: "6px 12px", fontSize: "12.5px", fontWeight: 600, cursor: safePageNum <= 1 ? "default" : "pointer", fontFamily: "inherit", opacity: safePageNum <= 1 ? 0.4 : 1 }}
                    data-testid="button-prev-page"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePageNum >= totalPages}
                    style={{ border: "1px solid var(--jox-primary)", background: "var(--jox-primary)", color: "#fff", borderRadius: "7px", padding: "6px 12px", fontSize: "12.5px", fontWeight: 600, cursor: safePageNum >= totalPages ? "default" : "pointer", fontFamily: "inherit", opacity: safePageNum >= totalPages ? 0.5 : 1 }}
                    data-testid="button-next-page"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
