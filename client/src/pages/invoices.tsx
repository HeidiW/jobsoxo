import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  Search,
  FileText,
  Mail,
  Download,
  MoreHorizontal,
  Eye,
  DollarSign,
  Clock,
  CheckCircle,
  Banknote,
  CreditCard,
  Building2,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import type { Invoice, Client, Job } from "@shared/schema";

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

function InvoiceStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; icon: React.ElementType }> = {
    draft: { variant: "secondary", label: "Draft", icon: FileText },
    sent: { variant: "outline", label: "Sent", icon: Mail },
    paid: { variant: "default", label: "Paid", icon: CheckCircle },
    overdue: { variant: "destructive", label: "Overdue", icon: Clock },
    partial: { variant: "outline", label: "Partial", icon: DollarSign },
  };
  const config = variants[status] || { variant: "secondary", label: status, icon: FileText };
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function InvoicesTableSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-8" />
        </div>
      ))}
    </div>
  );
}

export default function Invoices() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Quick-pay dialog state
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

  const filteredInvoices = invoices?.filter((invoice) => {
    const matchesSearch =
      invoice.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.client?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || invoice.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const formatCurrency = (amount: string | number | null | undefined) => {
    if (!amount) return "$0.00";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(Number(amount));
  };

  const stats = invoices?.reduce(
    (acc, inv) => {
      acc.total += Number(inv.total);
      acc.paid += Number(inv.amountPaid);
      acc.outstanding += Number(inv.balance);
      if (inv.status === "overdue") acc.overdue++;
      return acc;
    },
    { total: 0, paid: 0, outstanding: 0, overdue: 0 }
  ) || { total: 0, paid: 0, outstanding: 0, overdue: 0 };

  const formatCurrencyShort = (amount: string | number | null | undefined) => {
    if (!amount) return "$0";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(amount));
  };

  return (
    <>
    {/* Quick Pay Dialog */}
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
          <Button variant="outline" onClick={() => setQuickPayInvoice(null)} data-testid="button-cancel-quick-pay">
            Cancel
          </Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            disabled={markPaidMutation.isPending}
            onClick={() => quickPayInvoice && markPaidMutation.mutate({ invoiceId: quickPayInvoice.id, paymentMethod: quickPayMethod, paymentDate: quickPayDate })}
            data-testid="button-confirm-quick-pay"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {markPaidMutation.isPending ? "Saving..." : "Confirm Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold">Invoices</h1>
          <p className="text-muted-foreground mt-1">Manage billing and payments</p>
        </div>
        <Button onClick={() => setLocation("/invoices/new")} data-testid="button-create-invoice">
          <Plus className="h-4 w-4 mr-2" />
          Create Invoice
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Total Invoiced</div>
            <div className="text-2xl font-bold font-mono">{formatCurrency(stats.total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Collected</div>
            <div className="text-2xl font-bold font-mono text-green-600 dark:text-green-400">
              {formatCurrency(stats.paid)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Outstanding</div>
            <div className="text-2xl font-bold font-mono">{formatCurrency(stats.outstanding)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Overdue</div>
            <div className="text-2xl font-bold font-mono text-destructive">
              {stats.overdue}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              All Invoices
              {invoices && (
                <Badge variant="secondary" className="ml-2">
                  {invoices.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search invoices..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-invoices"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40" data-testid="select-filter-invoice-status">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <InvoicesTableSkeleton />
          ) : !filteredInvoices || filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium text-lg">No invoices found</h3>
              <p className="text-muted-foreground mt-1 mb-4">
                {searchQuery || statusFilter !== "all" ? "Try different filters" : "Create your first invoice to get started"}
              </p>
              {!searchQuery && statusFilter === "all" && (
                <Button onClick={() => setLocation("/invoices/new")} data-testid="button-create-first-invoice">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Invoice
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead className="hidden md:table-cell">Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Due Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">Balance</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => (
                    <TableRow key={invoice.id} className="hover-elevate">
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono font-medium">{invoice.invoiceNumber}</span>
                          <span className="text-sm text-muted-foreground">
                            {format(new Date(invoice.issueDate), "MMM d, yyyy")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="text-sm">{invoice.client?.name || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm">
                          {format(new Date(invoice.dueDate), "MMM d, yyyy")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono font-medium">
                          {formatCurrency(invoice.total)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right">
                        <span className={`font-mono text-sm ${Number(invoice.balance) > 0 ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                          {formatCurrency(invoice.balance)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {invoice.status !== "paid" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-green-700 border-green-300 hover:bg-green-50 hover:text-green-800 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950 gap-1.5"
                              onClick={() => openQuickPay(invoice)}
                              data-testid={`button-mark-paid-${invoice.id}`}
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Mark Paid
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-invoice-actions-${invoice.id}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={4} collisionPadding={12}>
                              <DropdownMenuItem asChild>
                                <Link href={`/invoices/${invoice.id}`} data-testid={`button-view-invoice-${invoice.id}`}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  View
                                </Link>
                              </DropdownMenuItem>
                              {invoice.status !== "paid" && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => sendInvoiceMutation.mutate(invoice.id)}
                                    disabled={sendInvoiceMutation.isPending}
                                    data-testid={`button-send-invoice-${invoice.id}`}
                                  >
                                    <Mail className="h-4 w-4 mr-2" />
                                    Send to Client
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem asChild>
                                    <Link href={`/invoices/${invoice.id}/payment`} data-testid={`button-record-payment-${invoice.id}`}>
                                      <DollarSign className="h-4 w-4 mr-2" />
                                      Record Partial Payment
                                    </Link>
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem asChild>
                                <Link href={`/invoices/${invoice.id}?autoDownload=1`} data-testid={`button-download-invoice-${invoice.id}`}>
                                  <Download className="h-4 w-4 mr-2" />
                                  Download PDF
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteInvoiceId(invoice.id)}
                                data-testid={`button-delete-invoice-${invoice.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>

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
    </>
  );
}
