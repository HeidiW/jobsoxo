import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, isThisMonth } from "date-fns";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Clock3, FileText, Plus, RotateCw, Trash2, X } from "lucide-react";
import type { ChangeOrder } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangeOrderFormDialog } from "@/components/change-orders/change-order-form-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CHANGE_ORDER_FILTERS, changeOrderAmountText, filterChangeOrders, formatChangeOrderNumber,
  formatMoney, formatSignedMoney, invalidateChangeOrderEffects, sumChangeOrderCents,
  type ChangeOrderFilter, type ChangeOrderStatus, type EnrichedChangeOrder,
} from "./change-orders-logic";

const STATUS_STYLE: Record<ChangeOrderStatus, string> = {
  draft: "bg-jx-surface text-jx-ink-2",
  pending: "bg-jx-orange-tint text-jx-orange-ink",
  approved: "bg-jx-green-tint text-jx-green-ink",
  rejected: "bg-[#f8e7e1] text-[#9b3f29]",
  invoiced: "bg-jx-blue-tint text-jx-blue-ink",
};
const STATUS_LABEL: Record<ChangeOrderStatus, string> = {
  draft: "Draft", pending: "Pending review", approved: "Approved", rejected: "Rejected", invoiced: "Invoiced",
};
function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : format(date, "MMM d, yyyy");
}

function SkeletonCard() {
  return <div aria-hidden="true" className="min-h-[270px] animate-pulse rounded-[26px] bg-jx-surface p-6">
    <div className="h-4 w-1/3 rounded bg-card/80" /><div className="mt-8 h-7 w-3/4 rounded bg-card/80" />
    <div className="mt-3 h-4 w-1/2 rounded bg-card/70" /><div className="mt-8 h-16 rounded-2xl bg-card/70" />
  </div>;
}

function signedStyle(amount: string | number) {
  const numeric = Number(amount);
  return numeric > 0 ? "text-jx-green-ink" : numeric < 0 ? "text-jx-orange-ink" : "text-jx-ink-2";
}

export default function ChangeOrders() {
  const { toast } = useToast();
  const [activeFilter, setActiveFilter] = useState<ChangeOrderFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<EnrichedChangeOrder | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const { data: orders, isLoading, isError, isFetching, refetch } = useQuery<EnrichedChangeOrder[]>({
    queryKey: ["/api/change-orders"],
  });
  const safeOrders = orders ?? [];
  const filtered = useMemo(() => filterChangeOrders(safeOrders, activeFilter), [safeOrders, activeFilter]);
  const pendingOrders = useMemo(() => safeOrders.filter((order) => order.status === "pending"), [safeOrders]);
  const pendingTotal = sumChangeOrderCents(pendingOrders);
  const filteredTotal = sumChangeOrderCents(filtered);
  const allOrdersTotal = sumChangeOrderCents(safeOrders);
  const approvedCount = safeOrders.filter((order) => order.status === "approved").length;
  const thisMonthCount = safeOrders.filter((order) => !!order.createdAt && isThisMonth(new Date(order.createdAt))).length;
  const counts: Record<ChangeOrderFilter, number> = {
    all: safeOrders.length,
    pending: pendingOrders.length,
    approved: safeOrders.filter((order) => order.status === "approved").length,
    invoiced: safeOrders.filter((order) => order.status === "invoiced").length,
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ChangeOrderStatus }) => {
      const response = await apiRequest("PATCH", `/api/change-orders/${id}`, { status });
      return response.json();
    },
    onSuccess: async (_data, variables) => {
      await invalidateChangeOrderEffects(queryClient);
      toast({ title: variables.status === "approved" ? "Change order marked approved" : `Status changed to ${STATUS_LABEL[variables.status].toLowerCase()}` });
    },
    onError: (error: Error) => toast({ title: "Could not update change order", description: error.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/change-orders/${id}`); },
    onSuccess: async () => {
      await invalidateChangeOrderEffects(queryClient);
      toast({ title: "Change order deleted" });
      setDeletingOrder(null);
      setDeleteError("");
    },
    onError: (error: Error) => {
      setDeleteError(error.message || "Could not delete this change order. Try again.");
      toast({ title: "Could not delete change order", description: error.message, variant: "destructive" });
    },
  });

  const setStatus = (order: EnrichedChangeOrder, status: ChangeOrderStatus) => {
    if (!updateMutation.isPending) updateMutation.mutate({ id: order.id, status });
  };
  const openDelete = (order: EnrichedChangeOrder) => { setDeleteError(""); setDeletingOrder(order); };

  return <main className="relative min-h-[100dvh] min-w-0 px-4 pb-12 pt-7 text-jx-ink sm:px-7 sm:pt-9 xl:px-10">
    <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col gap-6 sm:gap-7">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="font-display text-[46px] !font-bold leading-[.95] tracking-[-.055em] text-jx-ink sm:text-[64px]" data-testid="heading-change-orders">Change Orders</h1>
          <p className="mt-3 max-w-2xl text-[15px] text-jx-ink-2 sm:text-[17px]">Keep every scope adjustment, credit and approval attached to the job it changes.</p>
        </div>
        <Button type="button" onClick={() => setDialogOpen(true)} className="min-h-12 rounded-full bg-jx-green px-6 text-xs font-bold tracking-[.08em] text-white hover:bg-jx-green-hover sm:px-7 sm:text-sm" data-testid="button-new-co">
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> NEW CHANGE ORDER
        </Button>
      </header>

      {isLoading ? <section aria-label="Pending approvals loading" className="min-h-[178px] animate-pulse rounded-[26px] bg-jx-orange-tint p-6 sm:p-8" data-testid="co-pending-loading">
        <div className="h-4 w-48 rounded bg-card/70" /><div className="mt-5 h-9 w-40 rounded bg-card/70" />
      </section> : isError ? <section className="flex flex-wrap items-center justify-between gap-4 rounded-[26px] bg-jx-orange-tint p-5 text-jx-orange-ink sm:p-7" role="alert" data-testid="co-pending-error">
        <div><h2 className="font-display text-xl !font-bold">Change orders didn’t load</h2><p className="mt-1 text-sm">Pending approvals and the order list are unavailable. Try again.</p></div>
        <Button type="button" variant="outline" className="min-h-11 rounded-full border-2 border-current px-5 text-current" onClick={() => void refetch()} disabled={isFetching} data-testid="button-retry-change-orders"><RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />{isFetching ? "Trying again…" : "Retry"}</Button>
      </section> : <section aria-label="Pending change orders" className="relative overflow-hidden rounded-[26px] bg-jx-orange-tint p-5 text-jx-orange-ink sm:p-8" data-testid="co-pending-banner">
        <div className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full border-[24px] border-card/25" aria-hidden="true" />
        <div className="relative flex min-w-0 flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.14em]"><Clock3 className="h-4 w-4" aria-hidden="true" /> Needs a decision</div>
            <h2 className="mt-3 font-display text-[25px] !font-bold leading-tight tracking-[-.04em] sm:text-[32px]" data-testid="text-co-pending-count"><span data-testid="stat-pending">{pendingOrders.length}</span> {pendingOrders.length === 1 ? "change order" : "change orders"} pending review</h2>
            <p className="mt-2 max-w-xl text-sm text-jx-orange-ink/85">Don’t start the extra work until it’s approved. Marking approved here updates the invoice; it doesn’t record a client sign-off.</p>
          </div>
          <div className="relative shrink-0 border-t border-jx-orange-ink/20 pt-4 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0 sm:text-right">
            <p className="text-[11px] font-bold uppercase tracking-[.12em]">Pending total</p>
            <p className="mt-1 font-mono text-[36px] leading-none tracking-[-.055em] tabular-nums sm:text-[40px]" data-testid="stat-co-pending-total">{formatSignedMoney(pendingTotal)}</p>
            <p className="mt-2 text-xs">Signed change across pending orders</p>
          </div>
        </div>
      </section>}

      {!isLoading && !isError && <section aria-label="Change order overview" className="grid min-w-0 grid-cols-1 divide-y divide-jx-line rounded-[20px] border border-jx-line bg-card px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-testid="change-order-overview">
        <div className="flex items-center justify-between gap-4 py-4 sm:justify-start sm:gap-5 sm:px-5 sm:first:pl-0">
          <span className="text-xs font-semibold text-jx-ink-2">Approved change orders</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-jx-ink" data-testid="stat-approved">{approvedCount}</span>
        </div>
        <div className="flex items-center justify-between gap-4 py-4 sm:justify-start sm:gap-5 sm:px-5">
          <span className="text-xs font-semibold text-jx-ink-2">Net change orders</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-jx-ink" data-testid="stat-net-value">{formatSignedMoney(allOrdersTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 py-4 sm:justify-start sm:gap-5 sm:px-5 sm:last:pr-0">
          <span className="text-xs font-semibold text-jx-ink-2">Created this month</span>
          <span className="font-mono text-lg font-semibold tabular-nums text-jx-ink" data-testid="stat-this-month">{thisMonthCount}</span>
        </div>
      </section>}

      <section aria-label="Change order filters" className="flex min-w-0 flex-wrap items-center gap-2">
        {CHANGE_ORDER_FILTERS.map((filter) => {
          const selected = activeFilter === filter.key;
          return <Button key={filter.key} type="button" variant="outline" onClick={() => setActiveFilter(filter.key)}
            className={`min-h-11 rounded-full border-2 px-4 text-sm ${selected ? "border-jx-green bg-jx-green text-white hover:bg-jx-green-hover hover:text-white" : "border-jx-line bg-card text-jx-ink-2 hover:border-jx-green hover:bg-jx-green-tint hover:text-jx-ink"}`}
            aria-pressed={selected} data-testid={`filter-co-${filter.key}`}>
            <span className="inline-flex items-center" data-testid={`filter-tab-${filter.key}`}>{filter.label}<span className={`ml-2 rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums ${selected ? "bg-white/20 text-white" : "bg-jx-surface text-jx-ink-2"}`}>{isLoading || isError ? "—" : counts[filter.key]}</span></span>
          </Button>;
        })}
        <p className="ml-auto text-xs text-jx-ink-3">{isLoading || isError ? "—" : `${filtered.length} ${filtered.length === 1 ? "order" : "orders"}`}</p>
      </section>

      <section className="min-w-0" aria-label="Change order cards">
        {isLoading ? <div className="grid min-w-0 gap-4 lg:grid-cols-2" data-testid="change-orders-loading">{[0, 1, 2, 3].map((item) => <SkeletonCard key={item} />)}</div>
          : isError ? <div className="flex min-h-64 flex-col items-center justify-center rounded-[26px] border border-jx-line bg-card px-6 text-center" data-testid="change-orders-error">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-orange-tint text-jx-orange-ink"><AlertTriangle className="h-6 w-6" aria-hidden="true" /></div>
            <h2 className="font-display text-2xl !font-bold">The change order list is unavailable</h2>
            <p className="mt-2 max-w-sm text-sm text-jx-ink-2">Your records are still safe. Retry to reload them.</p>
            <Button type="button" variant="outline" className="mt-4 min-h-11 rounded-full border-2 border-jx-ink px-5" onClick={() => void refetch()} disabled={isFetching}>Retry list</Button>
          </div>
          : filtered.length === 0 ? <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[26px] border border-jx-line bg-card px-6 py-12 text-center" data-testid={safeOrders.length ? "change-orders-no-matches" : "change-orders-empty"}>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink"><FileText className="h-6 w-6" aria-hidden="true" /></div>
            <h2 className="font-display text-2xl !font-bold">{safeOrders.length ? `No ${activeFilter} change orders` : "No change orders yet"}</h2>
            <p className="mt-2 max-w-sm text-sm text-jx-ink-2">{safeOrders.length ? "Choose another status filter to see more orders." : "Record a scope adjustment to keep its cost and reason with the job."}</p>
            {safeOrders.length ? <Button type="button" variant="outline" className="mt-4 min-h-11 rounded-full border-2 border-jx-ink px-5" onClick={() => setActiveFilter("all")}>Show all orders</Button>
              : <Button type="button" onClick={() => setDialogOpen(true)} className="mt-4 min-h-11 rounded-full bg-jx-green px-5 font-bold text-white hover:bg-jx-green-hover"><Plus className="mr-2 h-4 w-4" aria-hidden="true" /> New change order</Button>}
          </div>
          : <div className="grid min-w-0 gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" }} data-testid="change-orders-grid">
            {filtered.map((order) => {
              const status = (order.status ?? "draft") as ChangeOrderStatus;
              const isPending = status === "pending";
              const amount = Number(order.amount);
              const amountIcon = amount > 0 ? <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> : amount < 0 ? <ArrowDownRight className="h-4 w-4" aria-hidden="true" /> : null;
              return <article key={order.id} className="min-w-0 rounded-[26px] border border-jx-line bg-jx-surface p-5 transition-transform duration-200 hover:-translate-y-0.5 sm:p-6" data-testid={`row-co-${order.id}`}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold tracking-[.04em] text-jx-ink-3">{formatChangeOrderNumber(order.id)}</p>
                    <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-[11px] font-bold ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`} data-testid={`status-co-${order.id}`}>{STATUS_LABEL[status] ?? STATUS_LABEL.draft}</span>
                  </div>
                  <div className={`flex shrink-0 items-center gap-1 font-mono text-[22px] font-semibold tracking-[-.04em] tabular-nums ${signedStyle(order.amount)}`} data-testid={`amount-co-${order.id}`}>
                    {amountIcon}{changeOrderAmountText(order.amount)}
                  </div>
                </div>
                <h2 className="mt-5 break-words font-display text-[20px] !font-bold leading-snug tracking-[-.035em] text-jx-ink" data-testid={`description-co-${order.id}`}>{order.description}</h2>
                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-jx-ink-2">
                  {order.job ? <Link href={`/jobs/${order.job.id}`} className="max-w-full truncate font-semibold text-jx-green-ink underline decoration-jx-green-ink/30 underline-offset-4 hover:decoration-current" data-testid={`link-job-co-${order.id}`}>{order.job.title}</Link> : <span>Job not linked</span>}
                  {order.job && order.invoice && <span aria-hidden="true" className="text-jx-ink-3">·</span>}
                  {order.invoice ? <Link href={`/invoices/${order.invoice.id}`} className="max-w-full truncate text-jx-ink-2 underline decoration-jx-ink-3/40 underline-offset-4 hover:text-jx-ink" data-testid={`link-invoice-co-${order.id}`}>Invoice {order.invoice.invoiceNumber}</Link> : <span>Invoice not available</span>}
                </div>
                <div className="mt-5 min-h-[78px] rounded-2xl bg-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[.12em] text-jx-ink-3">Reason for change</p>
                  <p className="mt-1 break-words text-sm leading-relaxed text-jx-ink" data-testid={`reason-co-${order.id}`}>{order.reason?.trim() || "No reason provided."}</p>
                </div>
                <div className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-jx-line pt-4">
                  <div className="text-xs text-jx-ink-3"><span className="font-medium text-jx-ink-2">{formatDate(order.createdAt)}</span>{order.client?.name ? <span> · {order.client.name}</span> : null}</div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {isPending && <Button type="button" onClick={() => setStatus(order, "approved")} disabled={updateMutation.isPending} className="min-h-10 rounded-full bg-jx-green px-4 text-xs font-bold text-white hover:bg-jx-green-hover" data-testid={`button-mark-approved-co-${order.id}`}><Check className="mr-1.5 h-4 w-4" aria-hidden="true" />Mark approved</Button>}
                    {isPending && <Button type="button" variant="outline" onClick={() => setStatus(order, "rejected")} disabled={updateMutation.isPending} className="min-h-10 rounded-full border-2 border-jx-line px-4 text-xs font-semibold text-jx-ink-2 hover:border-jx-orange hover:bg-jx-orange-tint hover:text-jx-orange-ink" data-testid={`button-decline-co-${order.id}`}><X className="mr-1.5 h-4 w-4" aria-hidden="true" />Declined</Button>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button type="button" variant="outline" disabled={updateMutation.isPending || deleteMutation.isPending} className="min-h-10 rounded-full border-jx-line px-3 text-xs" aria-label={`More actions for ${formatChangeOrderNumber(order.id)}`} data-testid={`button-co-actions-${order.id}`}>More</Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl">
                        {status !== "approved" && <DropdownMenuItem disabled={updateMutation.isPending} onClick={() => setStatus(order, "approved")} data-testid={`button-approve-co-${order.id}`}><Check className="mr-2 h-4 w-4 text-jx-green-ink" />Mark approved</DropdownMenuItem>}
                        {status !== "pending" && <DropdownMenuItem disabled={updateMutation.isPending} onClick={() => setStatus(order, "pending")} data-testid={`button-pending-co-${order.id}`}><Clock3 className="mr-2 h-4 w-4 text-jx-orange-ink" />Mark pending</DropdownMenuItem>}
                        {status !== "rejected" && <DropdownMenuItem disabled={updateMutation.isPending} onClick={() => setStatus(order, "rejected")} data-testid={`button-reject-co-${order.id}`}><X className="mr-2 h-4 w-4 text-jx-orange-ink" />Decline</DropdownMenuItem>}
                        {order.invoice && <DropdownMenuItem asChild><Link href={`/invoices/${order.invoice.id}`} data-testid={`button-view-invoice-co-${order.id}`}>View invoice</Link></DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => openDelete(order)} data-testid={`button-delete-co-${order.id}`}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </article>;
            })}
          </div>}
      </section>

      {!isLoading && !isError && filtered.length > 0 && <footer className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-[20px] bg-jx-surface px-5 py-4" data-testid="change-orders-filtered-summary">
        <p className="text-sm text-jx-ink-2">{filtered.length} {filtered.length === 1 ? "change order" : "change orders"}<span className="mx-2 text-jx-ink-3">·</span><span className="font-mono font-semibold tabular-nums text-jx-ink" data-testid="text-co-filtered-total">{formatMoney(filteredTotal)}</span><span className="ml-1">net in this view</span></p>
        <Button type="button" variant="ghost" onClick={() => setDialogOpen(true)} className="min-h-11 rounded-full px-4 font-bold text-jx-green-ink hover:bg-jx-green-tint" data-testid="button-new-co-footer"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New change order</Button>
      </footer>}
    </div>

    <ChangeOrderFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    <AlertDialog open={!!deletingOrder} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) { setDeletingOrder(null); setDeleteError(""); } }}>
      <AlertDialogContent className="rounded-[26px] border-jx-line bg-card text-jx-ink">
        <AlertDialogHeader>
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-jx-orange-tint text-jx-orange-ink"><Trash2 className="h-5 w-5" aria-hidden="true" /></div>
          <AlertDialogTitle className="font-display text-2xl !font-bold">Delete this change order?</AlertDialogTitle>
          <AlertDialogDescription className="text-jx-ink-2">Permanently remove <strong className="text-jx-ink">{deletingOrder?.description}</strong>. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && <p className="rounded-xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" role="alert" data-testid="delete-co-error">{deleteError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending} className="min-h-11 rounded-full" data-testid="button-cancel-delete-co">Cancel</AlertDialogCancel>
          <AlertDialogAction className="min-h-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteMutation.isPending} onClick={(event) => {
            event.preventDefault();
            if (deletingOrder && !deleteMutation.isPending) { setDeleteError(""); deleteMutation.mutate(deletingOrder.id); }
          }} data-testid="button-confirm-delete-co">{deleteMutation.isPending ? "Deleting…" : "Delete change order"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
