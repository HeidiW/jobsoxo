import { useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import {
  Banknote, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert,
  CreditCard, Download, Eye, FileText, Landmark, Mail, MoreHorizontal, Plus,
  RefreshCw, Search, Trash2, X,
} from "lucide-react";
import { CollectionsView } from "@/components/invoices/CollectionsView";
import { ReconcileDialog } from "@/components/invoices/ReconcileDialog";
import type { InvoiceWithRelations } from "@/components/invoices/types";
import { invoicesToCsv } from "./invoices-export";

const PAGE_SIZE = 12;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "partial", label: "Partly paid" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "collections", label: "Collections" },
] as const;
const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", Icon: Banknote },
  { value: "check", label: "Cheque", Icon: FileText },
  { value: "bank_transfer", label: "Bank transfer", Icon: Building2 },
  { value: "credit_card", label: "Card", Icon: CreditCard },
] as const;
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-jx-surface text-jx-ink-2",
  sent: "bg-jx-blue-tint text-jx-blue-ink",
  partial: "bg-jx-gold-tint text-jx-gold-ink",
  overdue: "bg-jx-orange-tint text-jx-orange-ink",
  paid: "bg-jx-green-tint text-jx-green-ink",
};
const money = (value: string | number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(value ?? 0));
const dateLabel = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  try { return format(new Date(value), "MMM d, yyyy"); } catch { return "—"; }
};

export default function Invoices() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [quickPayInvoice, setQuickPayInvoice] = useState<InvoiceWithRelations | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("cash");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showReconcile, setShowReconcile] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const {
    data: invoices,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<InvoiceWithRelations[]>({ queryKey: ["/api/invoices"] });
  const rows = invoices ?? [];
  const sendMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/invoices/${id}/send`)).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice sent", description: "The invoice has been sent to the client." });
    },
    onError: (error: Error) => toast({ title: "Error sending invoice", description: error.message, variant: "destructive" }),
  });
  const paidMutation = useMutation({
    mutationFn: async ({ id, method, date }: { id: string; method: string; date: string }) =>
      (await apiRequest("POST", `/api/invoices/${id}/mark-paid`, {
        paymentMethod: method,
        paymentDate: new Date(date).toISOString(),
      })).json(),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setQuickPayInvoice(null);
      trackEvent("payment_recorded", { method: variables.method, source: "invoice_list" });
      toast({ title: "Payment recorded", description: "Invoice marked as paid and payment logged." });
    },
    onError: (error: Error) => toast({ title: "Error recording payment", description: error.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/invoices/${id}`); },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setDeleteId(null);
      toast({ title: "Invoice deleted", description: "The invoice has been permanently deleted." });
    },
    onError: (error: Error) => toast({ title: "Error deleting invoice", description: error.message, variant: "destructive" }),
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((invoice) => {
      const matchesText = !term || [invoice.invoiceNumber, invoice.client?.name, invoice.job?.title]
        .some((part) => String(part ?? "").toLowerCase().includes(term));
      return matchesText && (filter === "all" || invoice.status === filter);
    });
  }, [rows, search, filter]);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const now = new Date();
  const stats = rows.reduce((totals, invoice) => {
    const balance = Number(invoice.balance ?? 0);
    if (invoice.status === "draft") totals.drafts += Number(invoice.total ?? 0);
    else if (invoice.status === "overdue") {
      totals.overdue += balance;
      totals.outstanding += balance;
    } else if (invoice.status === "sent" || invoice.status === "partial") totals.outstanding += balance;
    else if (invoice.status === "paid" && invoice.paymentDate) {
      const paidDate = new Date(invoice.paymentDate);
      if (paidDate.getMonth() === now.getMonth() && paidDate.getFullYear() === now.getFullYear()) {
        totals.paidThisMonth += Number(invoice.total ?? 0);
      }
    }
    return totals;
  }, { outstanding: 0, overdue: 0, paidThisMonth: 0, drafts: 0 });

  function chooseFilter(nextFilter: string) {
    setFilter(nextFilter);
    setPage(1);
  }
  function exportCsv() {
    const csv = invoicesToCsv(visible.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      client: invoice.client?.name,
      job: invoice.job?.title,
      issued: dateLabel(invoice.issueDate),
      due: dateLabel(invoice.dueDate),
      status: invoice.status,
      total: Number(invoice.total ?? 0).toFixed(2),
      balance: Number(invoice.balance ?? 0).toFixed(2),
    })));
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jobsoxo-invoices.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <>
      <ReconcileDialog open={showReconcile} onClose={() => setShowReconcile(false)} invoices={rows} />
      <Dialog open={!!quickPayInvoice} onOpenChange={(open) => { if (!open) setQuickPayInvoice(null); }}>
        <DialogContent className="max-h-[90dvh] !flex flex-col overflow-hidden rounded-3xl sm:max-w-md">
          <DialogHeader><DialogTitle className="font-display text-2xl !font-bold text-jx-ink">Record payment</DialogTitle></DialogHeader>
          {quickPayInvoice && (
            <div className="space-y-5 overflow-y-auto py-1">
              <div className="space-y-2 rounded-2xl bg-jx-surface p-4 text-sm">
                <p className="flex justify-between gap-4"><span className="text-jx-ink-2">Invoice</span><span className="font-mono">{quickPayInvoice.invoiceNumber}</span></p>
                <p className="flex justify-between gap-4"><span className="text-jx-ink-2">Client</span><span>{quickPayInvoice.client?.name}</span></p>
                <p className="flex justify-between gap-4"><span className="text-jx-ink-2">Amount due</span><span className="font-mono font-semibold">{money(quickPayInvoice.balance)}</span></p>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">How was payment received?</legend>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.map(({ value, label, Icon }) => (
                    <button type="button" key={value} onClick={() => setPaymentMethod(value)} aria-pressed={paymentMethod === value}
                      data-testid={`button-pay-method-${value}`}
                      className={`flex min-h-11 items-center gap-2 rounded-xl border-2 px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-jx-green ${paymentMethod === value ? "border-jx-green bg-jx-green-tint text-jx-green-ink" : "border-jx-line hover:border-jx-green"}`}>
                      <Icon className="h-4 w-4" />{label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="quick-pay-date">Payment date</Label>
                <Input id="quick-pay-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} data-testid="input-quick-pay-date" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickPayInvoice(null)} data-testid="button-cancel-quick-pay">Cancel</Button>
            <Button className="rounded-full bg-jx-green text-white hover:bg-jx-green-hover" disabled={paidMutation.isPending}
              onClick={() => quickPayInvoice && paidMutation.mutate({ id: quickPayInvoice.id, method: paymentMethod, date: paymentDate })}
              data-testid="button-confirm-quick-pay">
              <CheckCircle2 className="mr-2 h-4 w-4" />{paidMutation.isPending ? "Saving…" : "Confirm payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl !font-bold">Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes the invoice and all its line items. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-invoice">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate(deleteId)} data-testid="button-confirm-delete-invoice">
              {deleteMutation.isPending ? "Deleting…" : "Delete invoice"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="min-h-[100dvh] px-4 pb-12 pt-7 sm:px-7 sm:pt-9 xl:px-10">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-7">
          <header className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="font-display text-[54px] !font-bold leading-[.95] tracking-[-.055em] text-jx-ink sm:text-[64px]">Invoices</h1>
              <p className="mt-3 text-[15px] text-jx-ink-2 sm:text-[17px]" data-testid="text-invoices-subtitle">
                {isError ? "Invoice totals are unavailable" : isLoading ? "Loading invoice totals" : (
                  <>{rows.length} {rows.length === 1 ? "invoice" : "invoices"} · <span className="font-mono">{money(stats.outstanding)}</span> outstanding · <span className="font-mono text-jx-orange-ink">{money(stats.overdue)}</span> overdue</>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={exportCsv} disabled={isLoading || isError}
                className="min-h-12 rounded-full border-2 border-jx-ink px-5 font-semibold" data-testid="button-export-invoices">
                <Download className="h-4 w-4" />Export
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowReconcile(true)}
                className="min-h-12 rounded-full border-2 border-jx-ink px-5 font-semibold" data-testid="button-reconcile-payments">
                <Landmark className="h-4 w-4" />Reconcile
              </Button>
              <Button type="button" onClick={() => setLocation("/invoices/new")}
                className="min-h-12 rounded-full bg-jx-green px-6 text-xs font-bold tracking-[.08em] text-white hover:bg-jx-green-hover sm:text-sm"
                data-testid="button-create-invoice"><Plus className="h-4 w-4" strokeWidth={2.5} />NEW INVOICE</Button>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Invoice totals">
            {[
              ["Outstanding", stats.outstanding, "text-jx-ink"],
              ["Overdue", stats.overdue, "text-jx-orange-ink"],
              ["Paid this month", stats.paidThisMonth, "text-jx-green-ink"],
              ["Drafts", stats.drafts, "text-jx-ink"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-2xl bg-jx-surface px-4 py-4 sm:px-5">
                <div className="text-[11px] font-bold uppercase tracking-[.08em] text-jx-ink-3">{label}</div>
                <div className={`mt-2 font-mono text-xl font-semibold tabular-nums sm:text-[25px] ${color}`}
                  data-testid={label === "Paid this month" ? "stat-paid-month" : `stat-${String(label).toLowerCase().replaceAll(" ", "-")}`}>
                  {isError || isLoading ? "—" : money(Number(value))}
                </div>
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3 xl:flex-row xl:items-center" aria-label="Filter invoices">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Invoice status">
              {FILTERS.map(({ key, label }) => {
                const selected = filter === key;
                const count = key === "collections" ? null : key === "all" ? rows.length : rows.filter((invoice) => invoice.status === key).length;
                return (
                  <button type="button" key={key} onClick={() => chooseFilter(key)} aria-pressed={selected} data-testid={`tab-${key}`}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jx-green focus-visible:ring-offset-2 sm:px-[18px] ${selected ? "border-jx-green bg-jx-green text-white" : "border-jx-ink-3 bg-card text-jx-ink hover:border-jx-green"}`}>
                    {label}<span className={`font-mono text-xs tabular-nums ${selected ? "text-white/80" : "text-jx-ink-3"}`}>{isError || isLoading ? "—" : count}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex h-11 min-w-0 items-center gap-2.5 rounded-full border-2 border-transparent bg-jx-surface px-4 focus-within:border-jx-green xl:ml-auto xl:w-[310px]">
              <Search className="h-4 w-4 shrink-0 text-jx-ink-3" aria-hidden="true" />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                placeholder="Search invoices, clients, jobs" aria-label="Search invoices"
                className="min-w-0 flex-1 bg-transparent text-sm text-jx-ink outline-none placeholder:text-jx-ink-3" data-testid="input-search-invoices" />
              {search && <button type="button" aria-label="Clear search" onClick={() => { setSearch(""); setPage(1); }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-jx-ink-3 hover:bg-card hover:text-jx-ink"><X className="h-4 w-4" /></button>}
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl bg-jx-surface p-2.5 sm:p-3" aria-label="Invoices table" data-testid="invoices-table">
            {filter === "collections" ? <CollectionsView /> : isLoading ? (
              <div className="my-2 flex min-h-[280px] flex-col justify-center gap-3 rounded-2xl bg-card p-5" aria-label="Loading invoices" data-testid="invoices-loading">
                {[0, 1, 2].map((item) => <div key={item} className="flex h-12 items-center gap-4 rounded-xl bg-jx-surface px-4">
                  <div className="h-4 w-24 animate-pulse rounded bg-jx-line" /><div className="h-4 w-32 animate-pulse rounded bg-jx-line" /><div className="h-4 flex-1 animate-pulse rounded bg-jx-line" />
                </div>)}
              </div>
            ) : isError ? (
              <div className="my-2 flex min-h-64 flex-col items-center justify-center rounded-2xl bg-card px-6 text-center" role="alert" data-testid="invoices-error">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-jx-gold-tint text-jx-gold-ink"><CircleAlert className="h-6 w-6" /></div>
                <h2 className="font-display text-xl !font-bold text-jx-ink">Invoices didn’t load</h2>
                <p className="mt-1 max-w-sm text-sm text-jx-ink-2">Your invoice balances are not available right now. Check your connection and try again.</p>
                <Button type="button" variant="outline" onClick={() => { void refetch(); }} disabled={isFetching}
                  className="mt-5 min-h-11 rounded-full border-2 border-jx-ink px-5 font-semibold" data-testid="button-retry-invoices">
                  {isFetching ? "Trying again…" : "Retry"}
                </Button>
              </div>
            ) : pageRows.length === 0 ? (
              <div className="my-2 flex min-h-[300px] flex-col items-center justify-center rounded-2xl bg-card px-6 py-10 text-center" data-testid="invoices-empty">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink">
                  {search || filter !== "all" ? <Search className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                </div>
                <h2 className="font-display text-2xl !font-bold text-jx-ink">{rows.length === 0 ? "No invoices yet" : "No matching invoices"}</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-jx-ink-2">{rows.length === 0 ? "Create an invoice to keep the work and the amount due together." : "Try another status, client, job, or invoice number."}</p>
                {rows.length === 0 && <Button onClick={() => setLocation("/invoices/new")} className="mt-5 min-h-12 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover" data-testid="button-create-first-invoice"><Plus className="h-4 w-4" />New invoice</Button>}
                {rows.length > 0 && (search || filter !== "all") && <Button variant="outline" onClick={() => { setSearch(""); chooseFilter("all"); }} className="mt-5 min-h-11 rounded-full border-2 border-jx-ink px-5 font-semibold">Clear filters</Button>}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <div className="min-w-[1280px]">
                    <div data-testid="invoices-table-header" className="grid h-[52px] grid-cols-[140px_minmax(190px,1fr)_minmax(170px,1fr)_120px_120px_130px_130px_130px_48px] items-center gap-3 border-2 border-transparent px-[18px] text-xs font-semibold uppercase tracking-[.06em] text-jx-ink-3">
                      <span>Invoice</span><span>Client</span><span>Job</span><span>Issued</span><span>Due</span><span>Status</span><span className="text-right">Total</span><span className="text-right">Balance</span><span className="relative"><span className="sr-only">Actions</span></span>
                    </div>
                    {pageRows.map((invoice) => {
                      const overdue = invoice.status === "overdue";
                      return (
                        <div key={invoice.id} role="link" tabIndex={0} aria-label={`Open invoice ${invoice.invoiceNumber}`}
                          onClick={() => setLocation(`/invoices/${invoice.id}`)}
                          onKeyDown={(event) => {
                            if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
                              event.preventDefault();
                              setLocation(`/invoices/${invoice.id}`);
                            }
                          }}
                          className="group mb-2 grid min-h-[76px] cursor-pointer grid-cols-[140px_minmax(190px,1fr)_minmax(170px,1fr)_120px_120px_130px_130px_130px_48px] items-center gap-3 rounded-2xl border-2 border-transparent bg-card px-[18px] py-3 transition-colors hover:border-jx-green focus-visible:border-jx-green focus-visible:outline-none motion-reduce:transition-none"
                          data-testid={`row-invoice-${invoice.id}`}>
                          <div className="min-w-0"><Link href={`/invoices/${invoice.id}`} onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
                            className="truncate font-mono text-[13px] font-semibold text-jx-green-ink hover:underline" data-testid={`link-invoice-${invoice.id}`}>{invoice.invoiceNumber}</Link></div>
                          <div className="truncate text-sm font-semibold text-jx-ink">{invoice.client?.name || "—"}</div>
                          <div className="truncate text-sm text-jx-ink-2">{invoice.job?.title || "—"}</div>
                          <span className="font-mono text-xs text-jx-ink-2">{dateLabel(invoice.issueDate)}</span>
                          <span className={`font-mono text-xs ${overdue ? "font-semibold text-jx-orange-ink" : "text-jx-ink-2"}`} data-overdue={overdue || undefined}>{dateLabel(invoice.dueDate)}</span>
                          <span><span className={`inline-flex min-h-7 items-center rounded-full px-3 text-xs font-semibold ${STATUS_STYLES[invoice.status] ?? STATUS_STYLES.draft}`}>{invoice.status === "partial" ? "Partly paid" : invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}</span></span>
                          <span className="text-right font-mono text-[15px] font-medium tabular-nums text-jx-ink">{money(invoice.total)}</span>
                          <span className="text-right font-mono text-[15px] font-medium tabular-nums text-jx-ink">{money(invoice.balance)}</span>
                          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${invoice.invoiceNumber}`}
                                className="h-10 w-10 rounded-full text-jx-ink-3 hover:bg-jx-green-tint hover:text-jx-green-ink" data-testid={`button-invoice-actions-${invoice.id}`}><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" sideOffset={6} className="w-52 rounded-2xl p-1.5">
                                <DropdownMenuItem asChild data-testid={`button-view-invoice-${invoice.id}`}><Link href={`/invoices/${invoice.id}`} className="cursor-pointer rounded-xl"><Eye className="mr-2 h-4 w-4" />View invoice</Link></DropdownMenuItem>
                                {invoice.status !== "paid" && <>
                                  <DropdownMenuItem onSelect={() => sendMutation.mutate(invoice.id)} disabled={sendMutation.isPending} data-testid={`button-send-invoice-${invoice.id}`} className="rounded-xl"><Mail className="mr-2 h-4 w-4" />Send to client</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => { setQuickPayInvoice(invoice); setPaymentMethod("cash"); setPaymentDate(format(new Date(), "yyyy-MM-dd")); }} data-testid={`button-mark-paid-${invoice.id}`} className="rounded-xl"><Check className="mr-2 h-4 w-4" />Mark as paid</DropdownMenuItem>
                                  <DropdownMenuItem asChild data-testid={`button-record-payment-${invoice.id}`}><Link href={`/invoices/${invoice.id}/payment`} className="cursor-pointer rounded-xl"><CreditCard className="mr-2 h-4 w-4" />Record partial payment</Link></DropdownMenuItem>
                                </>}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild data-testid={`button-download-invoice-${invoice.id}`}><Link href={`/invoices/${invoice.id}?autoDownload=1`} className="cursor-pointer rounded-xl"><Download className="mr-2 h-4 w-4" />Download PDF</Link></DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => setDeleteId(invoice.id)} className="rounded-xl text-destructive focus:text-destructive" data-testid={`button-delete-invoice-${invoice.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-3 text-sm text-jx-ink-2">
                  <span data-testid="text-visible-invoice-count">Showing <span className="font-semibold text-jx-ink">{Math.min((safePage - 1) * PAGE_SIZE + 1, visible.length)}–{Math.min(safePage * PAGE_SIZE, visible.length)}</span> of {visible.length} invoices</span>
                  <div className="flex items-center gap-2">
                    {isFetching && <span className="inline-flex items-center gap-1.5 text-xs text-jx-ink-3" role="status"><RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />Refreshing</span>}
                    <Button type="button" variant="outline" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}
                      className="min-h-10 rounded-full border border-jx-line px-4 font-semibold" data-testid="button-prev-page"><ChevronLeft className="h-4 w-4" />Previous</Button>
                    <Button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages}
                      className="min-h-10 rounded-full bg-jx-green px-4 font-semibold text-white hover:bg-jx-green-hover" data-testid="button-next-page">Next<ChevronRight className="h-4 w-4" /></Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
