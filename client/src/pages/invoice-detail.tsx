import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";
import { format } from "date-fns";
import type { Invoice, Client, LineItem, Payment } from "@shared/schema";

interface InvoiceDetail extends Invoice {
  client: Client;
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

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: invoice, isLoading } = useQuery<InvoiceDetail>({
    queryKey: ["/api/invoices", id],
    enabled: !!id,
  });

  const sendInvoiceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invoices/${id}/send`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({
        title: "Invoice sent",
        description: "The invoice has been sent to the client.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error sending invoice",
        description: error.message,
        variant: "destructive",
      });
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
      toast({
        title: "Invoice marked as paid",
        description: "The invoice status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating invoice",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (amount: string | number | null | undefined) => {
    if (!amount) return "$0.00";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(Number(amount));
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
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Bill To
              </h3>
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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
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
                {invoice.lineItems?.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="font-medium">{item.description}</span>
                      {item.isChangeOrder && (
                        <Badge variant="outline" className="ml-2 text-xs">
                          Change Order
                        </Badge>
                      )}
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

          <div className="mt-6 flex justify-end">
            <div className="w-64 space-y-2">
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

      {(invoice.notes || invoice.termsAndConditions) && (
        <Card>
          <CardContent className="pt-6">
            {invoice.notes && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Notes
                </h3>
                <p className="text-sm">{invoice.notes}</p>
              </div>
            )}
            {invoice.termsAndConditions && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Terms & Conditions
                </h3>
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
