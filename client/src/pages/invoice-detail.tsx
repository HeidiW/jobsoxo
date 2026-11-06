import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatPhone } from "@/lib/formatPhone";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Mail, Download, DollarSign, CheckCircle, FileText, Printer,
  Plus, X, Trash2, Pencil, Check, Ban, AlertTriangle, Save,
  Bell, BellOff, PauseCircle, PlayCircle, Copy, Landmark,
} from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import type {
  Invoice, Client, LineItem, Payment, Job, Settings, ChangeOrder,
} from "@shared/schema";
import { InvoiceStatusBadge } from "@/components/status-badge";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlaidTransactionSummary {
  plaidTransactionId: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
}

interface PaymentWithPlaid extends Payment {
  plaidTransaction?: PlaidTransactionSummary;
}

interface InvoiceDetail extends Invoice {
  client: Client;
  job: Job | null;
  lineItems: LineItem[];
  payments: PaymentWithPlaid[];
  changeOrders: ChangeOrder[];
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const editInvoiceSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  jobId: z.string().optional(),
  issueDate: z.string().min(1, "Issue date is required"),
  dueDate: z.string().min(1, "Due date is required"),
  taxRate: z.string().optional(),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
});
type EditInvoiceValues = z.infer<typeof editInvoiceSchema>;

const lineItemEditSchema = z.object({
  description: z.string().min(1, "Description is required"),
  category: z.enum(["materials", "labor", "square_footage", "other"]),
  quantity: z.string().min(1, "Required"),
  unit: z.string().min(1, "Required"),
  rate: z.string().min(1, "Required"),
});
type LineItemEditValues = z.infer<typeof lineItemEditSchema>;

const newCOSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.string().min(1, "Amount is required").refine(
    (v) => !isNaN(Number(v)) && Number(v) !== 0,
    "Must be a non-zero number",
  ),
  reason: z.string().optional(),
});
type NewCOValues = z.infer<typeof newCOSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatCurrency = (amount: string | number | null | undefined) => {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  }).format(n);
};

const fmt = formatCurrency;

// ── Skeleton ──────────────────────────────────────────────────────────────────

function InvoiceDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <Skeleton className="h-10 w-10" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-[600px] w-full rounded-xl" />
    </div>
  );
}

// ── InvoiceDocument ───────────────────────────────────────────────────────────

function InvoiceDocument({
  invoice,
  settings,
  coApprovedTotal = 0,
}: {
  invoice: InvoiceDetail;
  settings: Settings | undefined;
  coApprovedTotal?: number;
}) {
  const { toast } = useToast();
  const [copiedRefCodeIndex, setCopiedRefCodeIndex] = useState<number | null>(null);

  const baseItems = invoice.lineItems?.filter((i) => !i.isChangeOrder) ?? [];
  const legacyCOs = invoice.lineItems?.filter((i) => i.isChangeOrder) ?? [];

  const sectionOrder = [...new Set(baseItems.map((i) => (i as any).section || "General"))];
  const bySec = sectionOrder.reduce<Record<string, LineItem[]>>((acc, sec) => {
    acc[sec] = baseItems.filter((i) => ((i as any).section || "General") === sec);
    return acc;
  }, {});

  const lineItemsTotal = invoice.lineItems?.reduce((s, i) => s + Number(i.amount), 0) ?? 0;

  const mono: React.CSSProperties = { fontFamily: "ui-monospace,Menlo,monospace" };
  const lbl: React.CSSProperties = {
    fontSize: "10px", fontWeight: 800, color: "#94a3b8",
    textTransform: "uppercase", letterSpacing: ".08em", marginBottom: "6px",
  };

  return (
    <div
      id="invoice-printable"
      className="print:shadow-none print:rounded-none print:max-w-none"
      style={{
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        background: "#fff",
        borderRadius: "6px",
        boxShadow: "0 8px 30px rgba(15,23,42,.14)",
        padding: "40px 48px",
        maxWidth: "720px",
        margin: "0 auto",
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "24px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>
            {settings?.companyName || "Your Company"}
          </div>
          {settings?.companyAddress && (
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "5px", lineHeight: 1.6, whiteSpace: "pre-line" }}>
              {settings.companyAddress}
            </div>
          )}
          {(settings?.companyEmail || settings?.companyPhone) && (
            <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "3px", lineHeight: 1.6 }}>
              {[settings?.companyEmail, settings?.companyPhone].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "26px", fontWeight: 800, letterSpacing: ".06em", color: "#2563eb" }}>INVOICE</div>
          <div style={{ fontSize: "13px", ...mono, color: "#0f172a", marginTop: "6px" }}>{invoice.invoiceNumber}</div>
          <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "8px" }}>
            Issued&nbsp;&nbsp;<span style={{ color: "#0f172a", fontWeight: 600 }}>{format(new Date(invoice.issueDate), "MMMM d, yyyy")}</span>
          </div>
          <div style={{ fontSize: "11.5px", color: "#64748b" }}>
            Due&nbsp;&nbsp;<span style={{ color: "#0f172a", fontWeight: 600 }}>{format(new Date(invoice.dueDate), "MMMM d, yyyy")}</span>
          </div>
        </div>
      </div>

      <div style={{ height: "1px", background: "#e2e8f0", margin: "22px 0" }} />

      {/* ── Bill To / Project ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div>
          <div style={lbl}>Bill to</div>
          <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#0f172a" }}>{invoice.client?.name}</div>
          {invoice.client?.address && (
            <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6, marginTop: "2px" }}>
              {invoice.client.address}
              {invoice.client.city && `, ${invoice.client.city}`}
              {invoice.client.state && `, ${invoice.client.state}`}
              {invoice.client.zipCode && ` ${invoice.client.zipCode}`}
            </div>
          )}
          {invoice.client?.email && <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>{invoice.client.email}</div>}
          {invoice.client?.phone && <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>{formatPhone(invoice.client.phone)}</div>}
        </div>
        {invoice.job && (
          <div>
            <div style={lbl}>Project / site</div>
            <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#0f172a" }}>
              {(invoice.job as any).title || (invoice.job as any).name}
            </div>
            {((invoice.job as any).address || (invoice.job as any).siteAddress) && (
              <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6, marginTop: "2px", whiteSpace: "pre-line" }}>
                {(invoice.job as any).address || (invoice.job as any).siteAddress}
              </div>
            )}
            {(() => {
              const codes = ((invoice.job as any).referenceCodes as { label: string; code: string }[] | null | undefined) ?? [];
              const nonEmpty = codes.filter((c) => c.code?.trim());
              return nonEmpty.length > 0 ? (
                <div style={{ marginTop: "6px" }}>
                  {nonEmpty.map((c, i) => (
                    <div key={i} style={{ fontSize: "11.5px", color: "#64748b", lineHeight: 1.6, display: "flex", alignItems: "center", gap: "6px" }}
                      data-testid={`ref-code-pdf-${i}`}
                    >
                      <span style={{ fontWeight: 600, color: "#475569" }}>{c.label}:</span>{" "}
                      <span style={{ fontFamily: "ui-monospace,Menlo,monospace" }} data-testid={`ref-code-pdf-value-${i}`}>{c.code}</span>
                      <button
                        className="no-print"
                        data-testid={`button-copy-ref-code-pdf-${i}`}
                        onClick={() => {
                          navigator.clipboard.writeText(c.code).then(() => {
                            setCopiedRefCodeIndex(i);
                            setTimeout(() => setCopiedRefCodeIndex(null), 2000);
                          }).catch(() => {
                            toast({ title: "Copy failed", description: "Could not access clipboard. Please copy manually.", variant: "destructive" });
                          });
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          padding: "1px 6px",
                          fontSize: "10.5px",
                          fontFamily: "inherit",
                          color: copiedRefCodeIndex === i ? "#16a34a" : "#475569",
                          background: copiedRefCodeIndex === i ? "#dcfce7" : "#f1f5f9",
                          border: `1px solid ${copiedRefCodeIndex === i ? "#86efac" : "#cbd5e1"}`,
                          borderRadius: "4px",
                          cursor: "pointer",
                          lineHeight: 1.5,
                        }}
                      >
                        {copiedRefCodeIndex === i ? (
                          <Check style={{ width: "10px", height: "10px" }} />
                        ) : (
                          <Copy style={{ width: "10px", height: "10px" }} />
                        )}
                        {copiedRefCodeIndex === i ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>

      {invoice.notes && (
        <div style={{ marginTop: "18px", fontSize: "12.5px", color: "#475569", fontStyle: "italic", lineHeight: 1.6, borderLeft: "3px solid #dbeafe", paddingLeft: "12px" }}>
          {invoice.notes}
        </div>
      )}

      {/* ── Line items ── */}
      <div style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em", paddingBottom: "8px", borderBottom: "2px solid #0f172a" }}>
          <span style={{ flex: 1 }}>Description</span>
          <span style={{ width: "70px", textAlign: "right" }}>Qty</span>
          <span style={{ width: "110px", textAlign: "right" }}>Amount</span>
        </div>

        {sectionOrder.map((sec) => {
          const items = bySec[sec];
          const secTotal = items.reduce((s, i) => s + Number(i.amount), 0);
          return (
            <div key={sec}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "13px 0 6px", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: ".03em" }}>{sec}</span>
                <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", ...mono }}>{fmt(secTotal)}</span>
              </div>
              {items.map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f8fafc" }}>
                  <div style={{ flex: 1, paddingRight: "12px" }}>
                    <div style={{ fontSize: "12.5px", color: "#0f172a", lineHeight: 1.45 }}>{item.description}</div>
                    {(item as any).refs && (
                      <div style={{ fontSize: "10.5px", color: "#2563eb", ...mono, marginTop: "2px" }}>{(item as any).refs}</div>
                    )}
                  </div>
                  <div style={{ width: "70px", textAlign: "right", fontSize: "11.5px", color: "#64748b", ...mono }}>
                    {!Number(item.quantity) ? "—" : `${Number(item.quantity)} ${item.unit}`}
                  </div>
                  <div style={{ width: "110px", textAlign: "right", fontSize: "12.5px", fontWeight: 600, color: "#0f172a", ...mono }}>
                    {fmt(item.amount)}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* Legacy line-item COs (isChangeOrder=true) */}
        {legacyCOs.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "13px 0 6px", borderTop: "2px solid #fef3c7", borderBottom: "1px solid #fef3c7" }}>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#b45309", textTransform: "uppercase", letterSpacing: ".03em" }}>Change Orders</span>
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#b45309", ...mono }}>
                +{fmt(legacyCOs.reduce((s, i) => s + Number(i.amount), 0))}
              </span>
            </div>
            {legacyCOs.map((item) => (
              <div key={item.id} style={{ display: "flex", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f8fafc" }}>
                <div style={{ flex: 1, paddingRight: "12px" }}>
                  <div style={{ fontSize: "12.5px", color: "#0f172a", lineHeight: 1.45 }}>{item.description}</div>
                  {item.changeOrderReason && (
                    <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic", marginTop: "2px" }}>{item.changeOrderReason}</div>
                  )}
                </div>
                <div style={{ width: "70px", textAlign: "right", fontSize: "11.5px", color: "#64748b", ...mono }}>
                  {!Number(item.quantity) ? "—" : `${Number(item.quantity)} ${item.unit}`}
                </div>
                <div style={{ width: "110px", textAlign: "right", fontSize: "12.5px", fontWeight: 600, color: "#b45309", ...mono }}>
                  +{fmt(item.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Totals ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "22px" }}>
        <div style={{ width: "300px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {coApprovedTotal > 0 ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
                <span>Work subtotal</span>
                <span style={{ ...mono, color: "#0f172a" }}>{fmt(lineItemsTotal)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#b45309" }}>
                <span>Approved changes</span>
                <span style={{ ...mono }}>+{fmt(coApprovedTotal)}</span>
              </div>
              <div style={{ height: "1px", background: "#e2e8f0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
                <span>Subtotal</span>
                <span style={{ ...mono, color: "#0f172a" }}>{fmt(invoice.subtotal)}</span>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
              <span>Subtotal</span>
              <span style={{ ...mono, color: "#0f172a" }}>{fmt(invoice.subtotal)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
            <span>Tax ({Number(invoice.taxRate)}%)</span>
            <span style={{ ...mono, color: "#0f172a" }}>{fmt(invoice.taxAmount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", fontWeight: 800, color: "#0f172a", paddingTop: "9px", borderTop: "2px solid #0f172a" }}>
            <span>Total</span>
            <span style={mono}>{fmt(invoice.total)}</span>
          </div>
          {Number(invoice.amountPaid) > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 800, color: "#fff", background: "#2563eb", padding: "11px 13px", borderRadius: "8px", marginTop: "6px" }}>
                <span>Deposit paid</span>
                <span style={mono}>−{fmt(invoice.amountPaid)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
                <span>Balance remaining</span>
                <span style={{ ...mono, color: Number(invoice.balance) > 0 ? "#dc2626" : "#16a34a" }}>
                  {fmt(invoice.balance)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ height: "1px", background: "#e2e8f0", margin: "24px 0 18px" }} />

      {invoice.termsAndConditions && (
        <div>
          <div style={lbl}>Terms &amp; Conditions</div>
          <p style={{ fontSize: "11.5px", color: "#475569", lineHeight: 1.6, margin: 0 }}>{invoice.termsAndConditions}</p>
        </div>
      )}
    </div>
  );
}

// ── LineItemEditRow ────────────────────────────────────────────────────────────

function LineItemEditRow({
  item,
  onSave,
  onCancel,
  isSaving,
}: {
  item: LineItem;
  onSave: (values: LineItemEditValues) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const form = useForm<LineItemEditValues>({
    resolver: zodResolver(lineItemEditSchema),
    defaultValues: {
      description: item.description,
      category: (item.category as any) || "other",
      quantity: String(item.quantity),
      unit: item.unit,
      rate: String(item.rate),
    },
  });

  const qty = parseFloat(form.watch("quantity") || "0");
  const rate = parseFloat(form.watch("rate") || "0");
  const amount = isNaN(qty * rate) ? 0 : qty * rate;

  return (
    <TableRow className="bg-muted/30">
      <TableCell colSpan={6} className="p-3">
        <form onSubmit={form.handleSubmit(onSave)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FormLabel className="text-xs mb-1 block">Description</FormLabel>
              <Input
                {...form.register("description")}
                placeholder="Description"
                data-testid="input-edit-li-description"
              />
              {form.formState.errors.description && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.description.message}</p>
              )}
            </div>
            <div>
              <FormLabel className="text-xs mb-1 block">Category</FormLabel>
              <Select
                onValueChange={(v) => form.setValue("category", v as any)}
                value={form.watch("category")}
              >
                <SelectTrigger data-testid="select-edit-li-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="materials">Materials</SelectItem>
                  <SelectItem value="labor">Labor</SelectItem>
                  <SelectItem value="square_footage">Square Footage</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 items-end">
            <div>
              <FormLabel className="text-xs mb-1 block">Quantity</FormLabel>
              <Input type="number" step="0.01" {...form.register("quantity")} data-testid="input-edit-li-qty" />
            </div>
            <div>
              <FormLabel className="text-xs mb-1 block">Unit</FormLabel>
              <Select onValueChange={(v) => form.setValue("unit", v)} value={form.watch("unit")}>
                <SelectTrigger data-testid="select-edit-li-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="each">Each</SelectItem>
                  <SelectItem value="sqft">Sq Ft</SelectItem>
                  <SelectItem value="gallon">Gallon</SelectItem>
                  <SelectItem value="linear_ft">Linear Ft</SelectItem>
                  <SelectItem value="flat">Flat Rate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <FormLabel className="text-xs mb-1 block">Rate</FormLabel>
              <Input type="number" step="0.01" {...form.register("rate")} data-testid="input-edit-li-rate" />
            </div>
            <div>
              <FormLabel className="text-xs mb-1 block text-muted-foreground">Amount</FormLabel>
              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm font-medium">
                {fmt(amount)}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-testid="button-cancel-li-edit">
              <X className="h-3.5 w-3.5 mr-1" />Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving} data-testid="button-save-li-edit">
              <Save className="h-3.5 w-3.5 mr-1" />
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}

// ── NewChangeOrderForm ─────────────────────────────────────────────────────────

function NewChangeOrderForm({
  invoiceId,
  onSuccess,
  onCancel,
}: {
  invoiceId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<NewCOValues>({
    resolver: zodResolver(newCOSchema),
    defaultValues: { description: "", amount: "", reason: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: NewCOValues) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/change-orders`, {
        description: data.description,
        amount: String(data.amount),
        reason: data.reason || null,
        status: "pending",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Change order created", description: "Pending approval before totals update." });
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const amountVal = parseFloat(form.watch("amount") || "0");

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-4">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">New Change Order</span>
        <Badge variant="outline" className="text-xs border-amber-300 text-amber-600">Pending approval</Badge>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Additional coats on feature wall" {...field} data-testid="input-co-description" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-co-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <FormLabel className="text-muted-foreground text-sm">Preview</FormLabel>
              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm font-medium">
                {amountVal >= 0 ? "+" : ""}{fmt(amountVal)}
              </div>
            </div>
          </div>
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reason <span className="text-muted-foreground">(optional)</span></FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Explain what changed and why"
                    className="resize-none"
                    rows={2}
                    {...field}
                    data-testid="input-co-reason"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-testid="button-cancel-co">
              <X className="h-4 w-4 mr-1" />Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={mutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="button-save-co"
            >
              <Plus className="h-4 w-4 mr-1" />
              {mutation.isPending ? "Creating…" : "Create Change Order"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// ── ChangeOrdersPanel ─────────────────────────────────────────────────────────

function coBadge(status: string) {
  if (status === "approved") return <Badge className="bg-jx-green-tint text-jx-green-ink border-jx-green-tint-2">Approved</Badge>;
  if (status === "rejected") return <Badge variant="outline" className="text-muted-foreground">Rejected</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300">Pending</Badge>;
}

function ChangeOrdersPanel({
  invoiceId,
  orders,
  canEdit,
}: {
  invoiceId: string;
  orders: ChangeOrder[];
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/change-orders/${id}`, { status: "approved" });
      return res.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Change order approved", description: "Invoice total updated." }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/change-orders/${id}`, { status: "rejected" });
      return res.json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Change order rejected" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/change-orders/${id}`);
    },
    onSuccess: () => { invalidate(); setDeletingId(null); toast({ title: "Change order deleted" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const sendCOMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/send-change-order`);
      return res.json();
    },
    onSuccess: (data: { sentTo: string }) => {
      toast({ title: "Change order emailed", description: `Sent to ${data.sentTo}.` });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <>
      <Card className="mt-4 print:hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Change Orders</CardTitle>
              {orders.length > 0 && (
                <Badge variant="secondary" className="text-xs">{orders.length}</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {orders.some((o) => o.status === "pending") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
                  onClick={() => sendCOMutation.mutate()}
                  disabled={sendCOMutation.isPending}
                  data-testid="button-email-change-order"
                >
                  <Mail className="h-3.5 w-3.5 mr-1.5" />
                  {sendCOMutation.isPending ? "Sending…" : "Email to Client"}
                </Button>
              )}
              {canEdit && !showForm && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
                  onClick={() => setShowForm(true)}
                  data-testid="button-add-change-order"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Change Order
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showForm && (
            <NewChangeOrderForm
              invoiceId={invoiceId}
              onSuccess={() => setShowForm(false)}
              onCancel={() => setShowForm(false)}
            />
          )}

          {orders.length === 0 && !showForm ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No change orders yet. Add one to request additional work approval.
            </p>
          ) : (
            <div className="rounded-md border divide-y">
              {orders.map((co, idx) => (
                <div
                  key={co.id}
                  data-testid={`row-change-order-${co.id}`}
                  className={`flex items-start gap-3 p-3 ${co.status === "rejected" ? "opacity-60" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground">CO-{String(idx + 1).padStart(2, "0")}</span>
                      {coBadge(co.status)}
                    </div>
                    <p className="text-sm font-medium mt-1">{co.description}</p>
                    {co.reason && (
                      <p className="text-xs text-muted-foreground mt-0.5 italic">{co.reason}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`font-mono text-sm font-semibold ${co.status === "approved" ? "text-jx-green-ink" : co.status === "rejected" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
                      {Number(co.amount) >= 0 ? "+" : ""}{fmt(co.amount)}
                    </span>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {co.status === "pending" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-jx-green-ink hover:text-jx-green-ink hover:bg-jx-green-tint"
                            onClick={() => approveMutation.mutate(co.id)}
                            disabled={approveMutation.isPending}
                            data-testid={`button-approve-co-${co.id}`}
                            title="Approve"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => rejectMutation.mutate(co.id)}
                            disabled={rejectMutation.isPending}
                            data-testid={`button-reject-co-${co.id}`}
                            title="Reject"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {co.status === "approved" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => rejectMutation.mutate(co.id)}
                          disabled={rejectMutation.isPending}
                          data-testid={`button-reject-approved-co-${co.id}`}
                          title="Revoke approval"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {(co.status === "rejected" || co.status === "pending") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeletingId(co.id)}
                          data-testid={`button-delete-co-${co.id}`}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete change order?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-co"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── CollectionsPanel ──────────────────────────────────────────────────────────

type ReminderLog = {
  id: string;
  invoiceId: string;
  channel: string;
  stage: number;
  sentAt: string;
  success: boolean;
  errorMessage: string | null;
};

function CollectionsPanel({ invoice }: { invoice: InvoiceDetail }) {
  const { toast } = useToast();
  const { data: logs = [], isLoading } = useQuery<ReminderLog[]>({
    queryKey: ["/api/invoices", invoice.id, "reminder-logs"],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoice.id}/reminder-logs`);
      if (!res.ok) throw new Error("Failed to fetch reminder logs");
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (paused: boolean) => {
      const res = await apiRequest("PATCH", `/api/invoices/${invoice.id}/collections`, { remindersPaused: paused });
      if (!res.ok) throw new Error("Failed to update collections status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoice.id, "reminder-logs"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isPaused = (invoice as any).remindersPaused ?? false;
  const reminderCount = (invoice as any).reminderCount ?? 0;
  const lastSent = (invoice as any).lastReminderSent;

  // Compute next scheduled reminder date from settings
  const { data: settings } = useQuery<any>({ queryKey: ["/api/settings"] });
  const reminderIntervals: number[] = (settings?.reminderIntervals as number[]) || [7, 14, 30];
  const nextStageIdx = reminderCount; // 0-based index into intervals
  const nextIntervalDays = reminderIntervals[nextStageIdx] ?? null;
  const nextReminderDate = nextIntervalDays != null && invoice.dueDate
    ? new Date(new Date(invoice.dueDate).getTime() + nextIntervalDays * 24 * 60 * 60 * 1000)
    : null;
  const isDueSoon = nextReminderDate && nextReminderDate.getTime() <= Date.now() + 2 * 24 * 60 * 60 * 1000;

  return (
    <Card className="mt-4 print:hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Collections Agent</CardTitle>
          {isPaused ? (
            <Badge variant="secondary" className="text-xs"><BellOff className="h-3 w-3 mr-1" />Paused</Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-jx-green-ink border-jx-green-tint-2"><Bell className="h-3 w-3 mr-1" />Active</Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => toggleMutation.mutate(!isPaused)}
          disabled={toggleMutation.isPending}
          data-testid="button-toggle-reminders"
        >
          {isPaused ? (
            <><PlayCircle className="h-4 w-4 mr-1" />Resume</>
          ) : (
            <><PauseCircle className="h-4 w-4 mr-1" />Pause</>
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div className="rounded-md bg-muted/50 p-2 text-center">
            <p className="text-xs text-muted-foreground">Reminders sent</p>
            <p className="font-semibold" data-testid="text-reminder-count">{reminderCount}</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2 text-center">
            <p className="text-xs text-muted-foreground">Last contact</p>
            <p className="font-semibold text-xs" data-testid="text-last-reminder">
              {lastSent ? format(new Date(lastSent), "MMM d") : "—"}
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-2 text-center">
            <p className="text-xs text-muted-foreground">Stage</p>
            <p className="font-semibold" data-testid="text-reminder-stage">
              {reminderCount === 0 ? "Pending" : reminderCount >= 3 ? "Final" : `${reminderCount}/3`}
            </p>
          </div>
          <div className={`rounded-md p-2 text-center ${isDueSoon ? "bg-orange-50 dark:bg-orange-950/30" : "bg-muted/50"}`}>
            <p className="text-xs text-muted-foreground">Next reminder</p>
            <p className={`font-semibold text-xs ${isDueSoon ? "text-orange-600 dark:text-orange-400" : ""}`} data-testid="text-next-reminder">
              {reminderCount >= 3
                ? "Complete"
                : nextReminderDate
                  ? format(nextReminderDate, "MMM d")
                  : "—"}
            </p>
          </div>
        </div>

        {/* Reminder log history */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders sent yet.</p>
        ) : (
          <div className="rounded-md border text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-reminder-log-${log.id}`}>
                    <TableCell>{format(new Date(log.sentAt), "MMM d, yyyy h:mm a")}</TableCell>
                    <TableCell className="capitalize">{log.channel}</TableCell>
                    <TableCell>{log.stage}</TableCell>
                    <TableCell>
                      {log.success ? (
                        <Badge variant="outline" className="text-jx-green-ink border-jx-green-tint-2 text-xs">Sent</Badge>
                      ) : (
                        <Badge variant="outline" className="text-red-600 border-red-300 text-xs" title={log.errorMessage ?? ""}>Failed</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── InvoiceDetail (main page) ─────────────────────────────────────────────────

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [editMode, setEditMode] = useState(false);
  const [editingLineItemId, setEditingLineItemId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: invoice, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ["/api/invoices", id],
    enabled: !!id,
  });

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: allClients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: editMode,
  });

  const { data: allJobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    enabled: editMode,
  });

  // ── Edit header form ───────────────────────────────────────────────────────

  const editForm = useForm<EditInvoiceValues>({
    resolver: zodResolver(editInvoiceSchema),
    defaultValues: {
      clientId: "", jobId: "", issueDate: "", dueDate: "",
      taxRate: "", notes: "", termsAndConditions: "",
    },
  });

  useEffect(() => {
    if (invoice && editMode) {
      editForm.reset({
        clientId: invoice.clientId || "",
        jobId: invoice.jobId || "",
        issueDate: invoice.issueDate ? format(invoice.issueDate, "yyyy-MM-dd") : "",
        dueDate: invoice.dueDate ? format(invoice.dueDate, "yyyy-MM-dd") : "",
        taxRate: String(invoice.taxRate || "0"),
        notes: invoice.notes || "",
        termsAndConditions: invoice.termsAndConditions || "",
      });
    }
  }, [invoice, editMode]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateInvoiceMutation = useMutation({
    mutationFn: async (data: EditInvoiceValues) => {
      const res = await apiRequest("PATCH", `/api/invoices/${id}`, {
        clientId: data.clientId,
        jobId: data.jobId || null,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        taxRate: data.taxRate || "0",
        notes: data.notes || null,
        termsAndConditions: data.termsAndConditions || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Invoice updated" });
      setEditMode(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error updating invoice", description: err.message, variant: "destructive" });
    },
  });

  const updateLineItemMutation = useMutation({
    mutationFn: async ({ id: liId, values }: { id: string; values: LineItemEditValues }) => {
      const qty = parseFloat(values.quantity);
      const rate = parseFloat(values.rate);
      const res = await apiRequest("PATCH", `/api/line-items/${liId}`, {
        description: values.description,
        category: values.category,
        quantity: String(qty),
        unit: values.unit,
        rate: String(rate),
        amount: String(qty * rate),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      setEditingLineItemId(null);
      toast({ title: "Line item updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error updating line item", description: err.message, variant: "destructive" });
    },
  });

  const deleteLineItemMutation = useMutation({
    mutationFn: async (liId: string) => {
      await apiRequest("DELETE", `/api/line-items/${liId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Line item removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error removing line item", description: err.message, variant: "destructive" });
    },
  });

  const sendInvoiceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invoices/${id}/send`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice sent", description: "The invoice has been sent to the client." });
    },
    onError: (err: Error) => {
      toast({ title: "Error sending invoice", description: err.message, variant: "destructive" });
    },
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Invoice deleted" });
      setLocation("/invoices");
    },
    onError: (err: Error) => {
      toast({ title: "Error deleting invoice", description: err.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invoices/${id}/mark-paid`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Invoice marked as paid" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── PDF download ───────────────────────────────────────────────────────────

  const handleDownloadPdf = async () => {
    const element = document.getElementById("invoice-printable");
    if (!element || !invoice) return;
    setIsDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const canvas = await html2canvas(element, { scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      const pageHeight = pdf.internal.pageSize.getHeight();
      if (pdfHeight <= pageHeight) {
        pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
      } else {
        let yPos = 0;
        let remaining = pdfHeight;
        let first = true;
        while (remaining > 0) {
          if (!first) pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, -yPos, pdfWidth, pdfHeight);
          yPos += pageHeight;
          remaining -= pageHeight;
          first = false;
        }
      }
      pdf.save(`Invoice-${invoice.invoiceNumber}.pdf`);
    } catch {
      toast({ title: "Failed to generate PDF", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autoDownload") === "1" && invoice) {
      const timer = setTimeout(() => handleDownloadPdf(), 600);
      return () => clearTimeout(timer);
    }
  }, [invoice]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <div className="p-6 max-w-4xl mx-auto"><InvoiceDetailSkeleton /></div>;
  }

  if (!invoice) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-medium">Invoice not found</h2>
          <p className="text-muted-foreground mt-2">The invoice you're looking for doesn't exist.</p>
          <Button onClick={() => setLocation("/invoices")} className="mt-4" data-testid="button-back-to-invoices">
            Back to Invoices
          </Button>
        </div>
      </div>
    );
  }

  const canEdit = invoice.status !== "paid";
  const coOrders: ChangeOrder[] = invoice.changeOrders ?? [];
  const coApprovedTotal = coOrders
    .filter((co) => co.status === "approved")
    .reduce((s, co) => s + Number(co.amount), 0);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 p-6">
      <div className="max-w-4xl mx-auto">

        {/* ── Top bar ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 print:hidden">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-lg font-mono font-semibold text-slate-700 dark:text-slate-200">
                {invoice.invoiceNumber}
              </span>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && !editMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(true)}
                data-testid="button-edit-invoice"
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
            {editMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setEditMode(false); setEditingLineItemId(null); }}
                data-testid="button-cancel-edit"
              >
                <X className="h-4 w-4 mr-1" />Cancel editing
              </Button>
            )}
            {!editMode && (
              <>
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => sendInvoiceMutation.mutate()}
                    disabled={sendInvoiceMutation.isPending}
                    data-testid="button-send-invoice"
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    Send to Client
                  </Button>
                )}
                {canEdit && (
                  <Button asChild>
                    <Link href={`/invoices/${id}/payment`} data-testid="button-record-payment">
                      <DollarSign className="h-4 w-4 mr-2" />
                      Record Payment
                    </Link>
                  </Button>
                )}
                <Button variant="outline" onClick={() => window.print()} data-testid="button-print-invoice">
                  <Printer className="h-4 w-4 mr-2" />Print
                </Button>
                <Button variant="outline" onClick={handleDownloadPdf} disabled={isDownloading} data-testid="button-download-invoice">
                  <Download className="h-4 w-4 mr-2" />
                  {isDownloading ? "Generating…" : "Download PDF"}
                </Button>
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDeleteDialog(true)}
                  data-testid="button-delete-invoice"
                >
                  <Trash2 className="h-4 w-4 mr-2" />Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Edit header panel ── */}
        {editMode && (
          <Card className="mb-4 print:hidden border-blue-200 dark:border-blue-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-blue-600" />
                  Edit Invoice Details
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Form {...editForm}>
                <form onSubmit={editForm.handleSubmit((d) => updateInvoiceMutation.mutate(d))} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="clientId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-client">
                                <SelectValue placeholder="Select client" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {allClients.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="jobId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Job <span className="text-muted-foreground">(optional)</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-job">
                                <SelectValue placeholder="No job" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="">— No job —</SelectItem>
                              {allJobs.map((j) => (
                                <SelectItem key={j.id} value={j.id}>{(j as any).title || (j as any).name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={editForm.control}
                      name="issueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issue Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-edit-issue-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Due Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-edit-due-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="taxRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tax Rate (%)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" max="100" {...field} data-testid="input-edit-tax-rate" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={editForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes <span className="text-muted-foreground">(optional)</span></FormLabel>
                        <FormControl>
                          <Textarea rows={2} className="resize-none" {...field} data-testid="input-edit-notes" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="termsAndConditions"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Terms &amp; Conditions <span className="text-muted-foreground">(optional)</span></FormLabel>
                        <FormControl>
                          <Textarea rows={2} className="resize-none" {...field} data-testid="input-edit-terms" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditMode(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={updateInvoiceMutation.isPending}
                      data-testid="button-save-invoice-edit"
                    >
                      <Save className="h-4 w-4 mr-1.5" />
                      {updateInvoiceMutation.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {/* ── Line items editor (edit mode) ── */}
        {editMode && (
          <Card className="mb-4 print:hidden border-blue-200 dark:border-blue-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Pencil className="h-4 w-4 text-blue-600" />
                Line Items
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(invoice.lineItems?.length ?? 0) > 0 ? (
                <div className="rounded-md overflow-hidden border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-24">Qty / Unit</TableHead>
                        <TableHead className="w-24 text-right">Rate</TableHead>
                        <TableHead className="w-28 text-right">Amount</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoice.lineItems.map((item) =>
                        editingLineItemId === item.id ? (
                          <LineItemEditRow
                            key={item.id}
                            item={item}
                            onSave={(values) => updateLineItemMutation.mutate({ id: item.id, values })}
                            onCancel={() => setEditingLineItemId(null)}
                            isSaving={updateLineItemMutation.isPending}
                          />
                        ) : (
                          <TableRow key={item.id} data-testid={`row-line-item-${item.id}`}>
                            <TableCell className="text-sm">
                              <span className="font-medium">{item.description}</span>
                              {item.isChangeOrder && (
                                <Badge variant="outline" className="ml-2 text-xs border-amber-300 text-amber-600">CO</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground font-mono">
                              {Number(item.quantity)} {item.unit}
                            </TableCell>
                            <TableCell className="text-sm text-right font-mono">
                              {fmt(item.rate)}
                            </TableCell>
                            <TableCell className="text-sm text-right font-mono font-semibold">
                              {fmt(item.amount)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                  onClick={() => setEditingLineItemId(item.id)}
                                  data-testid={`button-edit-li-${item.id}`}
                                  title="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => deleteLineItemMutation.mutate(item.id)}
                                  disabled={deleteLineItemMutation.isPending}
                                  data-testid={`button-delete-li-${item.id}`}
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">No line items on this invoice.</p>
              )}
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Need to add new work? Use the <strong>Change Orders</strong> section below — any addition to an existing invoice is a change order.
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Invoice document ── */}
        <InvoiceDocument
          invoice={invoice}
          settings={settings}
          coApprovedTotal={coApprovedTotal}
        />

        {/* ── Change Orders panel ── */}
        <ChangeOrdersPanel
          invoiceId={invoice.id}
          orders={coOrders}
          canEdit={canEdit}
        />

        {/* ── Payment History ── */}
        {invoice.payments && invoice.payments.length > 0 && (
          <Card className="mt-4 print:hidden">
            <CardHeader>
              <CardTitle className="text-base">Payment History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-[130px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{format(new Date(payment.paymentDate), "MMM d, yyyy")}</TableCell>
                        <TableCell className="capitalize">{payment.paymentMethod.replace("_", " ")}</TableCell>
                        <TableCell className="font-mono text-sm">{payment.referenceNumber || "—"}</TableCell>
                        <TableCell className="text-right font-mono font-medium text-jx-green-ink">
                          {fmt(payment.amount)}
                        </TableCell>
                        <TableCell>
                          {payment.plaidTransaction ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  className="inline-flex items-center gap-1.5 rounded-full bg-jx-green-tint text-jx-green-ink border border-jx-green-tint-2 px-2.5 py-0.5 text-xs font-semibold hover:bg-jx-green-tint-2 transition-colors cursor-pointer"
                                  data-testid={`badge-bank-confirmed-${payment.id}`}
                                >
                                  <Landmark className="h-3 w-3" />
                                  Bank confirmed
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64 p-3" align="end">
                                <div className="space-y-2">
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-jx-green-ink mb-2">
                                    <Landmark className="h-3.5 w-3.5" />
                                    Bank Transaction
                                  </div>
                                  <div className="space-y-1.5 text-sm">
                                    <div className="flex justify-between gap-2">
                                      <span className="text-muted-foreground text-xs">Date</span>
                                      <span className="text-xs font-medium">
                                        {format(new Date(payment.plaidTransaction.date), "MMM d, yyyy")}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                      <span className="text-muted-foreground text-xs">Name</span>
                                      <span className="text-xs font-medium text-right max-w-[140px] truncate">
                                        {payment.plaidTransaction.merchantName || payment.plaidTransaction.name}
                                      </span>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                      <span className="text-muted-foreground text-xs">Amount</span>
                                      <span className="text-xs font-mono font-semibold text-jx-green-ink">
                                        {fmt(Math.abs(Number(payment.plaidTransaction.amount)))}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Collections Agent Panel ── */}
        {invoice.status !== "paid" && invoice.status !== "draft" && (
          <CollectionsPanel invoice={invoice} />
        )}

        {/* ── Mark as Paid ── */}
        {canEdit && (
          <div className="mt-4 flex justify-end print:hidden">
            <Button
              onClick={() => markPaidMutation.mutate()}
              disabled={markPaidMutation.isPending}
              data-testid="button-mark-paid"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark as Paid
            </Button>
          </div>
        )}

      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete invoice <strong>{invoice.invoiceNumber}</strong> and all its line items. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-invoice">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteInvoiceMutation.mutate()}
              disabled={deleteInvoiceMutation.isPending}
              data-testid="button-confirm-delete-invoice"
            >
              {deleteInvoiceMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
