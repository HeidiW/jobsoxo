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
];

const PAGE_SIZE = 12;

function fmtMoney(n: number, decimals = 0) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return format(new Date(d), "MMM d"); } catch { return "—"; }
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
      {/* ── Quick-Pay Dialog ── */}
      <Dialog open={!!quickPayInvoice} onOpenChange={(open) => !open && setQuickPayInvoice(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Record Payment
            </DialogTitle>
          </DialogHeader>
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
          <DialogFooter>
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

            {/* Table header */}
            <div style={{ display: "flex", alignItems: "center", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" as const, color: "var(--faint)", padding: "11px 18px", background: "var(--track)", borderBottom: "1px solid var(--panel-bd)" }}>
              <span style={{ width: "104px", flexShrink: 0 }}>Invoice</span>
              <span style={{ flex: 1, minWidth: 0 }}>Client / Project</span>
              <span style={{ width: "88px", flexShrink: 0 }}>Issued</span>
              <span style={{ width: "88px", flexShrink: 0 }}>Due</span>
              <span style={{ width: "104px", textAlign: "right" as const, flexShrink: 0 }}>Amount</span>
              <span style={{ width: "92px", textAlign: "center" as const, flexShrink: 0 }}>Status</span>
              <span style={{ width: "34px", flexShrink: 0 }}></span>
            </div>

            {/* Rows */}
            {isLoading ? (
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
            )}

            {/* Footer / pagination */}
            {filteredInvoices.length > 0 && (
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
