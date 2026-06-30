import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, MoreVertical, Trash2, CheckCircle, Clock, XCircle } from "lucide-react";
import { format, isThisMonth } from "date-fns";
import type { ChangeOrder, Invoice } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────
interface EnrichedChangeOrder extends ChangeOrder {
  invoice: Invoice | null;
  job: { id: string; title: string } | null;
  client: { id: string; name: string } | null;
}

type COStatus = "draft" | "pending" | "approved" | "rejected" | "invoiced";

// ── Design tokens ─────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<COStatus, { bg: string; fg: string; label: string }> = {
  draft:     { bg: "var(--b-gray-bg)",  fg: "var(--b-gray-fg)",  label: "Draft" },
  pending:   { bg: "var(--b-amber-bg)", fg: "var(--b-amber-fg)", label: "Pending approval" },
  approved:  { bg: "var(--b-green-bg)", fg: "var(--b-green-fg)", label: "Approved" },
  rejected:  { bg: "var(--b-red-bg)",   fg: "var(--b-red-fg)",   label: "Rejected" },
  invoiced:  { bg: "var(--b-blue-bg)",  fg: "var(--b-blue-fg)",  label: "Invoiced" },
};

const POS_COLOR = "#15a35a"; // green for positive delta (light)
const NEG_COLOR = "#d23b1f"; // red for negative delta (light)

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCoNumber(id: string) {
  return "CO-" + id.slice(-8, -2).toUpperCase();
}

function fmtDelta(amount: string | number): { text: string; color: string } {
  const n = parseFloat(String(amount));
  if (isNaN(n) || n === 0) return { text: "—", color: "var(--faint)" };
  if (n > 0) return { text: "+$" + n.toLocaleString("en-US", { minimumFractionDigits: 0 }), color: POS_COLOR };
  return { text: "−$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0 }), color: NEG_COLOR };
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try { return format(new Date(d), "MMM d"); } catch { return "—"; }
}

// ── Form schema ───────────────────────────────────────────────────────────────
const coFormSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  description: z.string().min(1, "Description is required"),
  amountAbs: z.string().min(1, "Amount is required").refine(v => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, "Must be a positive number"),
  amountType: z.enum(["add", "credit"]),
  reason: z.string().optional(),
  status: z.enum(["draft", "pending", "approved", "rejected", "invoiced"]),
});
type COFormValues = z.infer<typeof coFormSchema>;

// ── Label styles ──────────────────────────────────────────────────────────────
const lbl: React.CSSProperties = {
  display: "block", fontSize: "11px", fontWeight: 700, color: "#64748b",
  textTransform: "uppercase", letterSpacing: ".04em", marginBottom: "5px",
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1", borderRadius: "8px",
  fontSize: "13.5px", color: "#0f172a", background: "#fff", fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

// ── New CO Form ───────────────────────────────────────────────────────────────
function ChangeOrderForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();

  const { data: invoices } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });

  const form = useForm<COFormValues>({
    resolver: zodResolver(coFormSchema),
    defaultValues: { invoiceId: "", description: "", amountAbs: "", amountType: "add", reason: "", status: "pending" },
  });

  const mutation = useMutation({
    mutationFn: async (data: COFormValues) => {
      const amount = data.amountType === "credit"
        ? (-parseFloat(data.amountAbs)).toString()
        : parseFloat(data.amountAbs).toString();
      const res = await apiRequest("POST", "/api/change-orders", {
        invoiceId: data.invoiceId, description: data.description,
        amount, reason: data.reason || null, status: data.status,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders"] });
      toast({ title: "Change order created" });
      onClose();
    },
    onError: () => toast({ title: "Failed to create change order", variant: "destructive" }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <FormField control={form.control} name="invoiceId" render={({ field }) => (
          <FormItem>
            <label style={lbl}>Invoice *</label>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-co-invoice">
                  <SelectValue placeholder="Select invoice…" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {invoices?.map(inv => (
                  <SelectItem key={inv.id} value={inv.id}>{inv.invoiceNumber}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <label style={lbl}>Description *</label>
            <FormControl><input {...field} style={inp} placeholder="What changed?" data-testid="input-co-description" /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "12px" }}>
          <FormField control={form.control} name="amountAbs" render={({ field }) => (
            <FormItem>
              <label style={lbl}>Amount ($) *</label>
              <FormControl><input {...field} type="number" min="0" step="0.01" style={inp} placeholder="0.00" data-testid="input-co-amount" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="amountType" render={({ field }) => (
            <FormItem>
              <label style={lbl}>Type</label>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-co-type">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="add">Addition +</SelectItem>
                  <SelectItem value="credit">Credit −</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>
          )} />
        </div>

        <FormField control={form.control} name="reason" render={({ field }) => (
          <FormItem>
            <label style={lbl}>Reason <span style={{ color: "#94a3b8", fontWeight: 400, textTransform: "none" }}>(optional)</span></label>
            <FormControl><input {...field} style={inp} placeholder="Why was this changed?" data-testid="input-co-reason" /></FormControl>
          </FormItem>
        )} />

        <FormField control={form.control} name="status" render={({ field }) => (
          <FormItem>
            <label style={lbl}>Status</label>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger style={{ ...inp, height: "auto" }} data-testid="select-co-status">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending">Pending approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="invoiced">Invoiced</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )} />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
          <button type="button" onClick={onClose} style={{ padding: "9px 16px", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "9px", fontSize: "13px", fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending} style={{ padding: "9px 18px", border: "none", background: "#2563eb", borderRadius: "9px", fontSize: "13px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: mutation.isPending ? 0.7 : 1 }} data-testid="button-save-co">
            {mutation.isPending ? "Creating…" : "Create change order"}
          </button>
        </div>
      </form>
    </Form>
  );
}

// ── Filter tab helpers ────────────────────────────────────────────────────────
type Filter = "all" | "pending" | "approved" | "invoiced";
const FILTER_DEFS: { key: Filter; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "pending",  label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "invoiced", label: "Invoiced" },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ChangeOrders() {
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingCO, setDeletingCO] = useState<EnrichedChangeOrder | null>(null);
  const { toast } = useToast();

  const { data: orders, isLoading } = useQuery<EnrichedChangeOrder[]>({
    queryKey: ["/api/change-orders"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/change-orders/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/change-orders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders"] });
      toast({ title: "Change order deleted" });
      setDeletingCO(null);
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  // ── Computed stats ──────────────────────────────────────────────────────────
  const pending   = (orders ?? []).filter(o => o.status === "pending").length;
  const approved  = (orders ?? []).filter(o => o.status === "approved").length;
  const netValue  = (orders ?? []).reduce((s, o) => s + parseFloat(String(o.amount)), 0);
  const thisMonth = (orders ?? []).filter(o => o.createdAt && isThisMonth(new Date(o.createdAt))).length;

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = (orders ?? []).filter(o => {
    if (activeFilter === "pending")  return o.status === "pending";
    if (activeFilter === "approved") return o.status === "approved";
    if (activeFilter === "invoiced") return o.status === "invoiced";
    return true;
  });

  const counts: Record<Filter, number> = {
    all:      (orders ?? []).length,
    pending,
    approved,
    invoiced: (orders ?? []).filter(o => o.status === "invoiced").length,
  };

  const netFmt = fmtDelta(netValue);

  return (
    <>
      {/* ── New CO Dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={open => { if (!open) setIsDialogOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>New change order</DialogTitle>
          </DialogHeader>
          <ChangeOrderForm onClose={() => setIsDialogOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deletingCO} onOpenChange={o => { if (!o) setDeletingCO(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete change order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>"{deletingCO?.description}"</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingCO && deleteMutation.mutate(deletingCO.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-co"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
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
              <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-.02em" }}>Change Orders</h2>
              <p style={{ margin: "5px 0 0", fontSize: "13.5px", color: "var(--muted)" }}>
                Mid-job scope changes — approved orders update the job and can be invoiced.
              </p>
            </div>
            <button
              onClick={() => setIsDialogOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 16px", fontSize: "13.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(37,99,235,.3)" }}
              data-testid="button-new-co"
            >
              <Plus style={{ width: "16px", height: "16px" }} />
              New change order
            </button>
          </div>

          {/* ── 4-stat strip ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "20px" }}>
            {/* Pending */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Pending approval</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px", color: isLoading ? "var(--faint)" : (pending > 0 ? "#b6731a" : "var(--fg)") }} data-testid="stat-pending">
                {isLoading ? "—" : pending}
              </div>
            </div>
            {/* Approved */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Approved (not invoiced)</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-approved">
                {isLoading ? "—" : approved}
              </div>
            </div>
            {/* Net value */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>Net value change</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px", color: isLoading ? "var(--faint)" : netFmt.color }} data-testid="stat-net-value">
                {isLoading ? "—" : netFmt.text}
              </div>
            </div>
            {/* This month */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "11px", padding: "14px 16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" as const, color: "var(--faint)" }}>This month</div>
              <div className="font-mono" style={{ fontSize: "22px", fontWeight: 600, marginTop: "6px" }} data-testid="stat-this-month">
                {isLoading ? "—" : thisMonth}
              </div>
            </div>
          </div>

          {/* ── Filter tabs ── */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
            {FILTER_DEFS.map(f => {
              const active = activeFilter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "7px", cursor: "pointer",
                    fontFamily: "inherit", fontSize: "13px", fontWeight: 600, padding: "7px 13px", borderRadius: "8px",
                    border: "1px solid " + (active ? "transparent" : "var(--panel-bd)"),
                    background: active ? "var(--jox-primary)" : "var(--panel)",
                    color: active ? "#fff" : "var(--muted)",
                  }}
                  data-testid={`filter-tab-${f.key}`}
                >
                  {f.label}
                  <span
                    className="font-mono"
                    style={{
                      fontSize: "11px", fontWeight: 600, padding: "0px 6px", borderRadius: "5px",
                      background: active ? "rgba(255,255,255,.22)" : "var(--track)",
                      color: active ? "#fff" : "var(--faint)",
                    }}
                  >
                    {counts[f.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Table card ── */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" as const, color: "var(--faint)", padding: "11px 18px", background: "var(--track)", borderBottom: "1px solid var(--panel-bd)" }}>
              <span style={{ width: "116px", flexShrink: 0 }}>CO #</span>
              <span style={{ flex: 1, minWidth: 0 }}>Job / change</span>
              <span style={{ width: "96px", flexShrink: 0 }}>Date</span>
              <span style={{ width: "104px", flexShrink: 0, textAlign: "right" as const }}>Amount Δ</span>
              <span style={{ width: "128px", flexShrink: 0, textAlign: "center" as const }}>Status</span>
              <span style={{ width: "28px", flexShrink: 0 }}></span>
            </div>

            {/* Loading */}
            {isLoading && (
              <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>
                Loading change orders…
              </div>
            )}

            {/* Empty */}
            {!isLoading && filtered.length === 0 && (
              <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                <div style={{ fontSize: "32px", marginBottom: "10px" }}>📋</div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>
                  {activeFilter === "all" ? "No change orders yet" : `No ${activeFilter} change orders`}
                </div>
                <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>
                  {activeFilter === "all"
                    ? "Change orders track mid-job scope changes."
                    : "Try a different filter."}
                </div>
                {activeFilter === "all" && (
                  <button
                    onClick={() => setIsDialogOpen(true)}
                    style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    data-testid="button-add-first-co"
                  >
                    <Plus style={{ width: "15px", height: "15px" }} /> New change order
                  </button>
                )}
              </div>
            )}

            {/* Rows */}
            {!isLoading && filtered.map(order => {
              const status = (order.status ?? "draft") as COStatus;
              const badge = STATUS_BADGE[status] ?? STATUS_BADGE.draft;
              const delta = fmtDelta(order.amount);
              return (
                <div
                  key={order.id}
                  className="rowhover"
                  style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: "1px solid var(--panel-bd)" }}
                  data-testid={`row-co-${order.id}`}
                >
                  {/* CO # */}
                  <span
                    className="font-mono"
                    style={{ width: "116px", flexShrink: 0, fontSize: "12.5px", fontWeight: 600, color: "var(--jox-primary)" }}
                  >
                    {fmtCoNumber(order.id)}
                  </span>

                  {/* Job / change */}
                  <div style={{ flex: 1, minWidth: 0, paddingRight: "12px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {order.description}
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {order.job?.title
                        ? <Link href={`/jobs/${order.job.id}`} style={{ color: "inherit", textDecoration: "none" }}>{order.job.title}</Link>
                        : (order.invoice
                          ? <Link href={`/invoices/${order.invoice.id}`} style={{ color: "inherit", textDecoration: "none" }}>Invoice {order.invoice.invoiceNumber}</Link>
                          : "—")}
                    </div>
                    {order.reason && (
                      <div style={{ fontSize: "11px", color: "var(--faint)", fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {order.reason}
                      </div>
                    )}
                  </div>

                  {/* Date */}
                  <span
                    className="font-mono"
                    style={{ width: "96px", flexShrink: 0, fontSize: "12px", color: "var(--muted)" }}
                  >
                    {fmtDate(order.createdAt)}
                  </span>

                  {/* Amount Δ */}
                  <span
                    className="font-mono"
                    style={{ width: "104px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600, color: delta.color }}
                    data-testid={`amount-co-${order.id}`}
                  >
                    {delta.text}
                  </span>

                  {/* Status badge */}
                  <span style={{ width: "128px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                    <span style={{ background: badge.bg, color: badge.fg, fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px", textTransform: "capitalize", whiteSpace: "nowrap" }}>
                      {badge.label}
                    </span>
                  </span>

                  {/* Actions */}
                  <span style={{ width: "28px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px 0", display: "flex", alignItems: "center" }}
                          data-testid={`button-co-actions-${order.id}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={4}>
                        {status !== "approved" && (
                          <DropdownMenuItem onClick={() => updateMutation.mutate({ id: order.id, status: "approved" })} data-testid={`button-approve-co-${order.id}`}>
                            <CheckCircle className="h-4 w-4 mr-2 text-green-600" />Approve
                          </DropdownMenuItem>
                        )}
                        {status !== "pending" && (
                          <DropdownMenuItem onClick={() => updateMutation.mutate({ id: order.id, status: "pending" })} data-testid={`button-pending-co-${order.id}`}>
                            <Clock className="h-4 w-4 mr-2 text-amber-600" />Mark pending
                          </DropdownMenuItem>
                        )}
                        {status !== "rejected" && (
                          <DropdownMenuItem onClick={() => updateMutation.mutate({ id: order.id, status: "rejected" })} data-testid={`button-reject-co-${order.id}`}>
                            <XCircle className="h-4 w-4 mr-2 text-red-600" />Reject
                          </DropdownMenuItem>
                        )}
                        {order.invoice && (
                          <DropdownMenuItem asChild>
                            <Link href={`/invoices/${order.invoice.id}`} data-testid={`button-view-invoice-co-${order.id}`}>
                              View invoice →
                            </Link>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingCO(order)}
                          data-testid={`button-delete-co-${order.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              );
            })}

            {/* Footer */}
            {!isLoading && filtered.length > 0 && (
              <div style={{ padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                  {filtered.length} change order{filtered.length !== 1 ? "s" : ""}
                  {activeFilter !== "all" ? ` · ${activeFilter}` : ""}
                  {" · "}
                  <span style={{ fontWeight: 600, color: netFmt.color }} className="font-mono">{netFmt.text}</span>
                  {" net"}
                </span>
                <button
                  onClick={() => setIsDialogOpen(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--jox-primary)", borderRadius: "8px", padding: "6px 14px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  data-testid="button-new-co-footer"
                >
                  <Plus style={{ width: "13px", height: "13px" }} />New change order
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
