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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { changeOrderSchema, type ChangeOrderValues } from "@/lib/change-order-schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatPhone } from "@/lib/formatPhone";
import {
  ArrowLeft,
  Mail,
  Download,
  DollarSign,
  CheckCircle,
  FileText,
  Printer,
  Plus,
  X,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import type { Invoice, Client, LineItem, Payment, Job, Settings } from "@shared/schema";

interface InvoiceDetail extends Invoice {
  client: Client;
  job: Job | null;
  lineItems: LineItem[];
  payments: Payment[];
}

const formatCurrency = (amount: string | number | null | undefined) => {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
};

function InvoiceStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    draft: { variant: "secondary", label: "Draft" },
    sent: { variant: "outline", label: "Sent" },
    paid: { variant: "default", label: "Paid" },
    overdue: { variant: "destructive", label: "Overdue" },
    partial: { variant: "outline", label: "Partial" },
  };
  const config = variants[status] || { variant: "secondary", label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

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

function InvoiceDocument({
  invoice,
  settings,
}: {
  invoice: InvoiceDetail;
  settings: Settings | undefined;
}) {
  const baseItems = invoice.lineItems?.filter((i) => !i.isChangeOrder) ?? [];
  const changeOrders = invoice.lineItems?.filter((i) => i.isChangeOrder) ?? [];

  const sectionOrder = [...new Set(baseItems.map((i) => (i as any).section || "General"))];
  const bySec = sectionOrder.reduce<Record<string, LineItem[]>>((acc, sec) => {
    acc[sec] = baseItems.filter((i) => ((i as any).section || "General") === sec);
    return acc;
  }, {});

  const mono: React.CSSProperties = { fontFamily: "ui-monospace,Menlo,monospace" };
  const lbl: React.CSSProperties = {
    fontSize: "10px", fontWeight: 800, color: "#94a3b8",
    textTransform: "uppercase", letterSpacing: ".08em", marginBottom: "6px",
  };

  return (
    <div
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

      {/* Grey divider */}
      <div style={{ height: "1px", background: "#e2e8f0", margin: "22px 0" }} />

      {/* ── Bill To / Project Site ── */}
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
          </div>
        )}
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div style={{ marginTop: "18px", fontSize: "12.5px", color: "#475569", fontStyle: "italic", lineHeight: 1.6, borderLeft: "3px solid #dbeafe", paddingLeft: "12px" }}>
          {invoice.notes}
        </div>
      )}

      {/* ── Line items ── */}
      <div style={{ marginTop: "24px" }}>
        {/* Column header */}
        <div style={{ display: "flex", fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".06em", paddingBottom: "8px", borderBottom: "2px solid #0f172a" }}>
          <span style={{ flex: 1 }}>Description</span>
          <span style={{ width: "70px", textAlign: "right" }}>Qty</span>
          <span style={{ width: "110px", textAlign: "right" }}>Amount</span>
        </div>

        {/* Sections */}
        {sectionOrder.map((sec) => {
          const items = bySec[sec];
          const secTotal = items.reduce((s, i) => s + Number(i.amount), 0);
          return (
            <div key={sec}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "13px 0 6px", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#0f172a", textTransform: "uppercase", letterSpacing: ".03em" }}>{sec}</span>
                <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#64748b", ...mono }}>{formatCurrency(secTotal)}</span>
              </div>
              {items.map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f8fafc" }}>
                  <div style={{ flex: 1, paddingRight: "12px" }}>
                    <div style={{ fontSize: "12.5px", color: "#0f172a", lineHeight: 1.45 }}>{item.description}</div>
                    {(item as any).refs && (
                      <div style={{ fontSize: "10.5px", color: "#2563eb", ...mono, marginTop: "2px" }}>
                        {(item as any).refs}
                      </div>
                    )}
                  </div>
                  <div style={{ width: "70px", textAlign: "right", fontSize: "11.5px", color: "#64748b", ...mono }}>
                    {Number(item.quantity) === 0 ? "—" : `${Number(item.quantity)} ${item.unit}`}
                  </div>
                  <div style={{ width: "110px", textAlign: "right", fontSize: "12.5px", fontWeight: 600, color: "#0f172a", ...mono }}>
                    {formatCurrency(item.amount)}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* Change orders */}
        {changeOrders.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "13px 0 6px", borderTop: "2px solid #fef3c7", borderBottom: "1px solid #fef3c7" }}>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#b45309", textTransform: "uppercase", letterSpacing: ".03em" }}>Change Orders</span>
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#b45309", ...mono }}>
                +{formatCurrency(changeOrders.reduce((s, i) => s + Number(i.amount), 0))}
              </span>
            </div>
            {changeOrders.map((item) => (
              <div key={item.id} style={{ display: "flex", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f8fafc" }}>
                <div style={{ flex: 1, paddingRight: "12px" }}>
                  <div style={{ fontSize: "12.5px", color: "#0f172a", lineHeight: 1.45 }}>{item.description}</div>
                  {item.changeOrderReason && (
                    <div style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic", marginTop: "2px" }}>{item.changeOrderReason}</div>
                  )}
                </div>
                <div style={{ width: "70px", textAlign: "right", fontSize: "11.5px", color: "#64748b", ...mono }}>
                  {Number(item.quantity) === 0 ? "—" : `${Number(item.quantity)} ${item.unit}`}
                </div>
                <div style={{ width: "110px", textAlign: "right", fontSize: "12.5px", fontWeight: 600, color: "#b45309", ...mono }}>
                  +{formatCurrency(item.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Totals ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "22px" }}>
        <div style={{ width: "300px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
            <span>Subtotal</span>
            <span style={{ ...mono, color: "#0f172a" }}>{formatCurrency(invoice.subtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
            <span>Tax ({Number(invoice.taxRate)}%)</span>
            <span style={{ ...mono, color: "#0f172a" }}>{formatCurrency(invoice.taxAmount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", fontWeight: 800, color: "#0f172a", paddingTop: "9px", borderTop: "2px solid #0f172a" }}>
            <span>Total</span>
            <span style={mono}>{formatCurrency(invoice.total)}</span>
          </div>
          {Number(invoice.amountPaid) > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 800, color: "#fff", background: "#2563eb", padding: "11px 13px", borderRadius: "8px", marginTop: "6px" }}>
                <span>Deposit paid</span>
                <span style={mono}>−{formatCurrency(invoice.amountPaid)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", color: "#475569" }}>
                <span>Balance remaining</span>
                <span style={{ ...mono, color: Number(invoice.balance) > 0 ? "#dc2626" : "#16a34a" }}>
                  {formatCurrency(invoice.balance)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom divider */}
      <div style={{ height: "1px", background: "#e2e8f0", margin: "24px 0 18px" }} />

      {/* Footer */}
      {invoice.termsAndConditions && (
        <div>
          <div style={lbl}>Terms &amp; Conditions</div>
          <p style={{ fontSize: "11.5px", color: "#475569", lineHeight: 1.6, margin: 0 }}>{invoice.termsAndConditions}</p>
        </div>
      )}
    </div>
  );
}

function ChangeOrderForm({
  invoiceId,
  onSuccess,
  onCancel,
}: {
  invoiceId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<ChangeOrderValues>({
    resolver: zodResolver(changeOrderSchema),
    defaultValues: {
      category: "labor",
      description: "",
      quantity: "",
      unit: "hours",
      rate: "",
      changeOrderReason: "",
    },
  });

  const category = form.watch("category");
  const quantity = parseFloat(form.watch("quantity") || "0");
  const rate = parseFloat(form.watch("rate") || "0");
  const previewAmount = isNaN(quantity * rate) ? 0 : quantity * rate;

  useEffect(() => {
    if (category === "labor") form.setValue("unit", "hours");
    else if (category === "materials") form.setValue("unit", "each");
    else if (category === "square_footage") form.setValue("unit", "sqft");
  }, [category, form]);

  const addMutation = useMutation({
    mutationFn: async (data: ChangeOrderValues) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/line-items`, {
        ...data,
        quantity: parseFloat(data.quantity),
        rate: parseFloat(data.rate),
        isChangeOrder: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Change order added", description: "The invoice total has been updated." });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Error adding change order", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-4">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">New Change Order</span>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => addMutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-co-category">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="materials">Materials</SelectItem>
                      <SelectItem value="labor">Labor</SelectItem>
                      <SelectItem value="square_footage">Square Footage</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="unit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-co-unit">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="each">Each</SelectItem>
                      <SelectItem value="sqft">Sq Ft</SelectItem>
                      <SelectItem value="gallon">Gallon</SelectItem>
                      <SelectItem value="linear_ft">Linear Ft</SelectItem>
                      <SelectItem value="flat">Flat Rate</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

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

          <div className="grid grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-co-quantity" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rate</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-co-rate" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="space-y-2">
              <FormLabel className="text-muted-foreground">Amount</FormLabel>
              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm font-medium">
                {formatCurrency(previewAmount)}
              </div>
            </div>
          </div>

          <FormField
            control={form.control}
            name="changeOrderReason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Reason for Change Order <span className="text-destructive">*</span>
                </FormLabel>
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
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={addMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="button-save-co"
            >
              <Plus className="h-4 w-4 mr-1" />
              {addMutation.isPending
                ? "Adding..."
                : `Add Change Order${previewAmount > 0 ? " · " + formatCurrency(previewAmount) : ""}`}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showChangeOrderForm, setShowChangeOrderForm] = useState(false);

  const { data: invoice, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ["/api/invoices", id],
    enabled: !!id,
  });

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
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
    onError: (error: Error) => {
      toast({ title: "Error sending invoice", description: error.message, variant: "destructive" });
    },
  });

  const sendChangeOrderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invoices/${id}/send-change-order`);
      return res.json();
    },
    onSuccess: (data: { sentTo: string }) => {
      toast({ title: "Change order sent", description: `Emailed to ${data.sentTo}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Error sending change order", description: error.message, variant: "destructive" });
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
      toast({ title: "Invoice marked as paid", description: "The invoice status has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error updating invoice", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <InvoiceDetailSkeleton />
      </div>
    );
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

  const changeOrders = invoice.lineItems?.filter((i) => i.isChangeOrder) ?? [];

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 p-6">
      <div className="max-w-4xl mx-auto">

        {/* ── Top action bar ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
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
            {invoice.status !== "paid" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => sendInvoiceMutation.mutate()}
                  disabled={sendInvoiceMutation.isPending}
                  data-testid="button-send-invoice"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Send to Client
                </Button>
                <Button asChild>
                  <Link href={`/invoices/${id}/payment`} data-testid="button-record-payment">
                    <DollarSign className="h-4 w-4 mr-2" />
                    Record Payment
                  </Link>
                </Button>
              </>
            )}
            {changeOrders.length > 0 && (
              <Button
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
                onClick={() => sendChangeOrderMutation.mutate()}
                disabled={sendChangeOrderMutation.isPending}
                data-testid="button-email-change-order"
              >
                <Mail className="h-4 w-4 mr-2" />
                {sendChangeOrderMutation.isPending ? "Sending…" : "Email Change Order"}
              </Button>
            )}
            <Button variant="outline" onClick={() => window.print()} data-testid="button-print-invoice">
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
            <Button variant="outline" data-testid="button-download-invoice">
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </div>
        </div>

        {/* ── Invoice document ── */}
        <InvoiceDocument invoice={invoice} settings={settings} />

        {/* ── Change order panel ── */}
        {invoice.status !== "paid" && (
          <div className="mt-4">
            {showChangeOrderForm ? (
              <ChangeOrderForm
                invoiceId={invoice.id}
                onSuccess={() => setShowChangeOrderForm(false)}
                onCancel={() => setShowChangeOrderForm(false)}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
                onClick={() => setShowChangeOrderForm(true)}
                data-testid="button-add-change-order"
              >
                <AlertTriangle className="h-4 w-4 mr-1.5" />
                Add Change Order
              </Button>
            )}
          </div>
        )}

        {/* ── Payment History ── */}
        {invoice.payments && invoice.payments.length > 0 && (
          <Card className="mt-4">
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>
                          {format(new Date(payment.paymentDate), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="capitalize">
                          {payment.paymentMethod.replace("_", " ")}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {payment.referenceNumber || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium text-green-600 dark:text-green-400">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Mark as Paid ── */}
        {invoice.status !== "paid" && (
          <div className="mt-4 flex justify-end">
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
    </div>
  );
}
