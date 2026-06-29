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

  const grouped = baseItems.reduce<Record<string, LineItem[]>>((acc, item) => {
    const cat = item.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const categoryLabel = (cat: string) =>
    cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-slate-200 print:shadow-none print:border-none print:rounded-none"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", padding: "48px 56px" }}
    >
      {/* ── Header ── */}
      <div className="flex justify-between items-start mb-8">
        <div className="flex-1 min-w-0 pr-8">
          <div className="text-xl font-bold text-slate-900 leading-tight">
            {settings?.companyName || "Your Company"}
          </div>
          {settings?.companyAddress && (
            <div className="text-sm text-slate-500 mt-1 whitespace-pre-line">{settings.companyAddress}</div>
          )}
          {(settings?.companyEmail || settings?.companyPhone) && (
            <div className="text-sm text-slate-400 mt-1">
              {[settings?.companyEmail, settings?.companyPhone].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div
            className="font-black text-blue-600 uppercase tracking-widest"
            style={{ fontSize: "32px", letterSpacing: "0.08em" }}
          >
            Invoice
          </div>
          <div className="text-sm font-mono text-slate-500 mt-1">{invoice.invoiceNumber}</div>
          <div className="text-sm text-slate-500 mt-3 space-y-0.5">
            <div>
              <span className="text-slate-400">Issued&nbsp;</span>
              {format(new Date(invoice.issueDate), "MMMM d, yyyy")}
            </div>
            <div>
              <span className="text-slate-400">Due&nbsp;</span>
              {format(new Date(invoice.dueDate), "MMMM d, yyyy")}
            </div>
          </div>
        </div>
      </div>

      {/* Blue divider */}
      <div className="h-0.5 bg-blue-600 mb-7" />

      {/* ── Bill To / Project Site ── */}
      <div className="grid grid-cols-2 gap-8 mb-7">
        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Bill To</div>
          <div className="text-base font-bold text-slate-900">{invoice.client?.name}</div>
          {invoice.client?.address && (
            <div className="text-sm text-slate-500 mt-0.5">
              {invoice.client.address}
              {invoice.client.city && <>, {invoice.client.city}</>}
              {invoice.client.state && <>, {invoice.client.state}</>}
              {invoice.client.zipCode && <> {invoice.client.zipCode}</>}
            </div>
          )}
          {invoice.client?.email && (
            <div className="text-sm text-slate-500 mt-0.5">{invoice.client.email}</div>
          )}
          {invoice.client?.phone && (
            <div className="text-sm text-slate-500 mt-0.5">{invoice.client.phone}</div>
          )}
        </div>
        {invoice.job && (
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Project / Site</div>
            <div className="text-base font-bold text-slate-900">{invoice.job.name}</div>
            {(invoice.job as any).siteAddress && (
              <div className="text-sm text-slate-500 mt-0.5">{(invoice.job as any).siteAddress}</div>
            )}
          </div>
        )}
      </div>

      {/* ── Memo / Notes blockquote ── */}
      {invoice.notes && (
        <div className="border-l-4 border-blue-200 pl-4 py-1 mb-7">
          <p className="text-sm text-slate-500 italic">{invoice.notes}</p>
        </div>
      )}

      {/* ── Line items table ── */}
      <table className="w-full text-sm mb-6" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1.5px solid #e2e8f0" }}>
            <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-widest pb-3">
              Description
            </th>
            <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-widest pb-3 w-24">
              Qty
            </th>
            <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-widest pb-3 w-32">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(grouped).map(([cat, items]) => {
            const catTotal = items.reduce((s, i) => s + Number(i.amount), 0);
            return (
              <>
                <tr key={`hdr-${cat}`}>
                  <td
                    className="font-bold text-slate-800 text-xs uppercase tracking-wide pt-5 pb-1"
                    colSpan={2}
                  >
                    {categoryLabel(cat)}
                  </td>
                  <td className="text-right font-bold text-blue-600 pt-5 pb-1">
                    {formatCurrency(catTotal)}
                  </td>
                </tr>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1.5 pr-6 text-slate-600">{item.description}</td>
                    <td className="py-1.5 text-right text-slate-400 font-mono text-xs">
                      {Number(item.quantity) === 0 ? "—" : `${Number(item.quantity)} ${item.unit}`}
                    </td>
                    <td className="py-1.5 text-right text-slate-700 font-mono">
                      {formatCurrency(item.amount)}
                    </td>
                  </tr>
                ))}
              </>
            );
          })}

          {changeOrders.length > 0 && (
            <>
              <tr key="hdr-co" style={{ borderTop: "1.5px solid #fef3c7" }}>
                <td
                  className="font-bold text-amber-700 text-xs uppercase tracking-wide pt-5 pb-1"
                  colSpan={2}
                >
                  Change Orders
                </td>
                <td className="text-right font-bold text-amber-700 pt-5 pb-1">
                  +{formatCurrency(changeOrders.reduce((s, i) => s + Number(i.amount), 0))}
                </td>
              </tr>
              {changeOrders.map((item) => (
                <tr key={item.id}>
                  <td className="py-1.5 pr-6 text-slate-600">
                    <div>{item.description}</div>
                    {item.changeOrderReason && (
                      <div className="text-xs text-slate-400 italic mt-0.5">{item.changeOrderReason}</div>
                    )}
                  </td>
                  <td className="py-1.5 text-right text-slate-400 font-mono text-xs">
                    {Number(item.quantity) === 0 ? "—" : `${Number(item.quantity)} ${item.unit}`}
                  </td>
                  <td className="py-1.5 text-right text-amber-700 font-mono">
                    +{formatCurrency(item.amount)}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>

      {/* ── Totals ── */}
      <div className="flex justify-end">
        <div className="w-64 space-y-2 text-sm">
          {changeOrders.length > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Base subtotal</span>
              <span className="font-mono">
                {formatCurrency(baseItems.reduce((s, i) => s + Number(i.amount), 0))}
              </span>
            </div>
          )}
          <div className="flex justify-between text-slate-500">
            <span>Subtotal</span>
            <span className="font-mono">{formatCurrency(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Tax ({Number(invoice.taxRate)}%)</span>
            <span className="font-mono">{formatCurrency(invoice.taxAmount)}</span>
          </div>
          <div className="h-px bg-slate-200" />
          <div className="flex justify-between font-bold text-slate-900 text-base pt-0.5">
            <span>Total</span>
            <span className="font-mono">{formatCurrency(invoice.total)}</span>
          </div>
          {Number(invoice.amountPaid) > 0 && (
            <>
              <div className="flex justify-between text-green-600">
                <span>Paid</span>
                <span className="font-mono">−{formatCurrency(invoice.amountPaid)}</span>
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex justify-between font-bold text-slate-900">
                <span>Balance Due</span>
                <span
                  className={`font-mono ${
                    Number(invoice.balance) > 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {formatCurrency(invoice.balance)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Terms ── */}
      {invoice.termsAndConditions && (
        <div className="mt-8 pt-6 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Terms &amp; Conditions
          </div>
          <p className="text-sm text-slate-500">{invoice.termsAndConditions}</p>
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
