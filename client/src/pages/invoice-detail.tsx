import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  Clock,
  FileText,
  Building,
  Phone,
  MapPin,
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
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
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

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

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
                  <FormLabel>Rate (£)</FormLabel>
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
                <FormLabel>Reason for Change Order <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Explain what changed and why (e.g. client requested additional feature wall, scope agreed on site)"
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
              {addMutation.isPending ? "Adding..." : `Add Change Order${previewAmount > 0 ? " · " + formatCurrency(previewAmount) : ""}`}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

function ordinalDay(d: number): string {
  if (d >= 11 && d <= 13) return `${d}th`;
  const suffix = ["th", "st", "nd", "rd"];
  return `${d}${suffix[d % 10] ?? "th"}`;
}

function formatChangeOrderDate(date: Date): string {
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const day = ordinalDay(date.getDate());
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
}

function printChangeOrderDoc(invoice: InvoiceDetail, settings: Settings | null) {
  const changeOrders = invoice.lineItems?.filter((i) => i.isChangeOrder) ?? [];
  if (!changeOrders.length) return;

  const fmt = (n: string | number | null | undefined) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n ?? 0));

  const today = formatChangeOrderDate(new Date());
  const companyName = settings?.companyName ?? "";
  const companyAddress = settings?.companyAddress ?? "";

  const jobLine = [invoice.job?.title, invoice.job?.address].filter(Boolean).join(", ");

  const total = changeOrders.reduce((s, co) => s + Number(co.amount), 0);

  const client = invoice.client;
  const clientAddr = [client.address, client.city, client.state, client.zipCode].filter(Boolean).join(" ");
  const presentedTo = client.name ? `Presented to ${client.name}${clientAddr ? `, at ${clientAddr}` : ""}.` : "";

  const itemLines = changeOrders
    .map((co, i) => `<p class="item">${i + 1}. ${co.description} - ${fmt(co.amount)}.</p>`)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Change Order</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 13pt; color: #000; padding: 60px 72px; line-height: 1.6; }
  .date { margin-bottom: 4px; }
  .company-name { font-weight: bold; margin-bottom: 2px; }
  .company-address { margin-bottom: 24px; }
  .project { font-weight: bold; text-transform: uppercase; margin-bottom: 16px; }
  .item { margin-bottom: 6px; }
  .total { font-weight: bold; text-transform: uppercase; margin-top: 24px; margin-bottom: 24px; }
  .footer { margin-top: 0; }
  @media print {
    body { padding: 40px 54px; }
  }
</style>
</head>
<body>
  <p class="date">${today}</p>
  ${companyName ? `<p class="company-name">${companyName}</p>` : ""}
  ${companyAddress ? `<p class="company-address">${companyAddress}.</p>` : ""}
  ${jobLine ? `<p class="project">${jobLine}:</p>` : ""}
  ${itemLines}
  <p class="total">OUTSTANDING TOTAL - ${fmt(total)}.</p>
  ${presentedTo ? `<p class="footer">${presentedTo}</p>` : ""}
</body>
</html>`;

  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
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

  const formatCurrency = (amount: string | number | null | undefined) => {
    if (!amount) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(Number(amount));
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <InvoiceDetailSkeleton />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
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

  const baseItems = invoice.lineItems?.filter((i) => !i.isChangeOrder) ?? [];
  const changeOrders = invoice.lineItems?.filter((i) => i.isChangeOrder) ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold font-mono">{invoice.invoiceNumber}</h1>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
            <p className="text-muted-foreground mt-1">
              Created on {format(new Date(invoice.createdAt), "MMMM d, yyyy")}
            </p>
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
          <Button variant="outline" data-testid="button-print-invoice">
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button variant="outline" data-testid="button-download-invoice">
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
          {changeOrders.length > 0 && (
            <Button
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
              onClick={() => printChangeOrderDoc(invoice, settings ?? null)}
              data-testid="button-print-change-order"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Print Change Order
            </Button>
          )}
        </div>
      </div>

      {/* Client & Invoice Info */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Bill To</h3>
              <div className="space-y-2">
                <p className="font-medium text-lg">{invoice.client?.name}</p>
                {invoice.client?.address && (
                  <p className="text-sm text-muted-foreground flex items-start gap-2">
                    <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      {invoice.client.address}
                      {invoice.client.city && <>, {invoice.client.city}</>}
                      {invoice.client.state && <>, {invoice.client.state}</>}
                      {invoice.client.zipCode && <> {invoice.client.zipCode}</>}
                    </span>
                  </p>
                )}
                {invoice.client?.email && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {invoice.client.email}
                  </p>
                )}
                {invoice.client?.phone && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {invoice.client.phone}
                  </p>
                )}
              </div>
            </div>
            <div className="md:text-right">
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Number</p>
                  <p className="font-mono font-medium">{invoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Issue Date</p>
                  <p className="font-medium">{format(new Date(invoice.issueDate), "MMMM d, yyyy")}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Due Date</p>
                  <p className="font-medium">{format(new Date(invoice.dueDate), "MMMM d, yyyy")}</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Line Items */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Line Items</CardTitle>
          {invoice.status !== "paid" && !showChangeOrderForm && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
              onClick={() => setShowChangeOrderForm(true)}
              data-testid="button-add-change-order"
            >
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              Add Change Order
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Base line items */}
          {baseItems.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24">Category</TableHead>
                    <TableHead className="w-24 text-right">Qty</TableHead>
                    <TableHead className="w-28 text-right">Rate</TableHead>
                    <TableHead className="w-28 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baseItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <span className="font-medium">{item.description}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {item.category.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {Number(item.quantity)} {item.unit}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(item.rate)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {formatCurrency(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Change orders section */}
          {changeOrders.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  Change Orders ({changeOrders.length})
                </span>
              </div>
              <div className="rounded-md border border-amber-200 dark:border-amber-800">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-amber-50/50 dark:bg-amber-950/20">
                      <TableHead>Description &amp; Reason</TableHead>
                      <TableHead className="w-24">Category</TableHead>
                      <TableHead className="w-24 text-right">Qty</TableHead>
                      <TableHead className="w-28 text-right">Rate</TableHead>
                      <TableHead className="w-28 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changeOrders.map((item) => (
                      <TableRow key={item.id} className="bg-amber-50/30 dark:bg-amber-950/10">
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{item.description}</span>
                              <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-700">
                                Change Order
                              </Badge>
                            </div>
                            {item.changeOrderReason && (
                              <span className="text-xs text-muted-foreground italic">
                                Reason: {item.changeOrderReason}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {item.category.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {Number(item.quantity)} {item.unit}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(item.rate)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium text-amber-700 dark:text-amber-400">
                          +{formatCurrency(item.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Change order form */}
          {showChangeOrderForm && (
            <ChangeOrderForm
              invoiceId={invoice.id}
              onSuccess={() => setShowChangeOrderForm(false)}
              onCancel={() => setShowChangeOrderForm(false)}
            />
          )}

          {/* Totals */}
          <div className="mt-2 flex justify-end">
            <div className="w-72 space-y-2">
              {changeOrders.length > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Base subtotal</span>
                    <span className="font-mono">
                      {formatCurrency(baseItems.reduce((s, i) => s + Number(i.amount), 0))}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-amber-700 dark:text-amber-400">
                    <span>Change orders</span>
                    <span className="font-mono">
                      +{formatCurrency(changeOrders.reduce((s, i) => s + Number(i.amount), 0))}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({Number(invoice.taxRate)}%)</span>
                <span className="font-mono">{formatCurrency(invoice.taxAmount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-medium text-lg">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(invoice.total)}</span>
              </div>
              {Number(invoice.amountPaid) > 0 && (
                <>
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>Paid</span>
                    <span className="font-mono">-{formatCurrency(invoice.amountPaid)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-medium">
                    <span>Balance Due</span>
                    <span className={`font-mono ${Number(invoice.balance) > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                      {formatCurrency(invoice.balance)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      {invoice.payments && invoice.payments.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
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

      {/* Notes / Terms */}
      {(invoice.notes || invoice.termsAndConditions) && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            {invoice.notes && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Notes</h3>
                <p className="text-sm">{invoice.notes}</p>
              </div>
            )}
            {invoice.termsAndConditions && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">Terms & Conditions</h3>
                <p className="text-sm">{invoice.termsAndConditions}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {invoice.status !== "paid" && (
        <div className="mt-6 flex justify-end">
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
  );
}
