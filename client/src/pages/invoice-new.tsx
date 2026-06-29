import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
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
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { Plus, Trash2, ArrowLeft, Save, Send, Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format, addDays } from "date-fns";
import type { Client, Job, LineItem } from "@shared/schema";

interface ParsedLineItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  category: "materials" | "labor" | "square_footage" | "other";
}

interface ParsedDocument {
  lineItems: ParsedLineItem[];
  dueDate?: string;
  taxRate?: number;
  notes?: string;
  confidence: "high" | "medium" | "low";
  message?: string;
}

function positiveNumericField(label: string) {
  return z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (val) => !isNaN(parseFloat(val)) && isFinite(Number(val)),
      `${label} must be a valid number`
    )
    .refine((val) => parseFloat(val) > 0, `${label} must be greater than zero`);
}

const lineItemSchema = z
  .object({
    category: z.enum(["materials", "labor", "square_footage", "other"]),
    description: z.string().min(1, "Description is required"),
    quantity: positiveNumericField("Quantity"),
    unit: z.string().min(1, "Unit is required"),
    rate: positiveNumericField("Rate"),
    amount: positiveNumericField("Amount"),
  })
  .superRefine((data, ctx) => {
    const qty = parseFloat(data.quantity);
    const rate = parseFloat(data.rate);
    const amount = parseFloat(data.amount);
    if (!isNaN(qty) && !isNaN(rate) && !isNaN(amount)) {
      const expected = qty * rate;
      if (Math.abs(amount - expected) > 0.001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Amount must equal quantity × rate (expected ${expected.toFixed(2)}, got ${amount.toFixed(2)})`,
          path: ["amount"],
        });
      }
    }
  });

const invoiceFormSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  jobId: z.string().optional(),
  dueDate: z.string().min(1, "Due date is required"),
  notes: z.string().optional(),
  termsAndConditions: z.string().optional(),
  taxRate: z.string().optional(),
});

type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;
type LineItemFormValues = z.infer<typeof lineItemSchema>;

interface NewLineItem extends Omit<LineItemFormValues, "quantity" | "rate" | "amount"> {
  id: string;
  quantity: number;
  rate: number;
  amount: number;
}

export default function InvoiceNew() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const preselectedClientId = searchParams.get("clientId") || "";
  const preselectedJobId = searchParams.get("jobId") || "";

  const { toast } = useToast();
  const [lineItems, setLineItems] = useState<NewLineItem[]>([]);
  const [showLineItemForm, setShowLineItemForm] = useState(false);
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectedParsedItems, setSelectedParsedItems] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: jobs } = useQuery<(Job & { client: Client })[]>({
    queryKey: ["/api/jobs"],
  });

  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      clientId: preselectedClientId,
      jobId: preselectedJobId,
      dueDate: format(addDays(new Date(), 30), "yyyy-MM-dd"),
      notes: "",
      termsAndConditions: "Payment is due within 30 days. Late payments may incur additional fees.",
      taxRate: "0",
    },
  });

  const selectedClientId = form.watch("clientId");
  const selectedJobId = form.watch("jobId");
  const taxRate = parseFloat(form.watch("taxRate") || "0");

  useEffect(() => {
    if (preselectedJobId && jobs) {
      const job = jobs.find((j) => j.id === preselectedJobId);
      if (job) {
        form.setValue("clientId", job.clientId);
      }
    }
  }, [preselectedJobId, jobs, form]);

  const { data: jobLineItems } = useQuery<LineItem[]>({
    queryKey: ["/api/jobs", selectedJobId, "line-items"],
    enabled: !!selectedJobId,
  });

  useEffect(() => {
    if (jobLineItems && jobLineItems.length > 0 && lineItems.length === 0) {
      const importedItems = jobLineItems.map((item) => ({
        id: crypto.randomUUID(),
        category: item.category as NewLineItem["category"],
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        rate: Number(item.rate),
        amount: Number(item.amount),
      }));
      setLineItems(importedItems);
    }
  }, [jobLineItems, lineItems.length]);

  const filteredJobs = jobs?.filter((job) =>
    !selectedClientId || job.clientId === selectedClientId
  );

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: { formData: InvoiceFormValues; send: boolean }) => {
      const payload = {
        ...data.formData,
        taxRate: parseFloat(data.formData.taxRate || "0"),
        subtotal,
        taxAmount,
        total,
        balance: total,
        lineItems: lineItems.map((item) => ({
          category: item.category,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          amount: item.amount,
        })),
        send: data.send,
      };
      const res = await apiRequest("POST", "/api/invoices", payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: "Invoice created",
        description: `Invoice ${data.invoiceNumber} has been created.`,
      });
      setLocation("/invoices");
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof InvoiceFormValues, {
            type: "server",
            message: Array.isArray(messages) ? messages[0] : String(messages),
          });
        });
        toast({
          title: "Please fix the errors below",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error creating invoice",
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });

  const parseDocumentMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoices/parse-document", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to parse document");
      }
      return res.json() as Promise<ParsedDocument>;
    },
    onSuccess: (data) => {
      if (data.lineItems.length === 0) {
        toast({
          title: "No line items found",
          description: data.message ?? "The document didn't contain recognisable line items. Try a different file.",
          variant: "destructive",
        });
        return;
      }
      setParsedDoc(data);
      setSelectedParsedItems(new Set(data.lineItems.map((_, i) => i)));
      setShowImportDialog(true);
    },
    onError: (err: Error) => {
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseDocumentMutation.mutate(file);
    e.target.value = "";
  };

  const applyParsedItems = () => {
    if (!parsedDoc) return;
    const toAdd: NewLineItem[] = parsedDoc.lineItems
      .filter((_, i) => selectedParsedItems.has(i))
      .map((item) => ({
        id: crypto.randomUUID(),
        category: item.category,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        amount: item.amount,
      }));
    setLineItems((prev) => [...prev, ...toAdd]);
    if (parsedDoc.dueDate) form.setValue("dueDate", parsedDoc.dueDate);
    if (parsedDoc.taxRate !== undefined) form.setValue("taxRate", String(parsedDoc.taxRate));
    if (parsedDoc.notes) form.setValue("notes", parsedDoc.notes);
    setShowImportDialog(false);
    setParsedDoc(null);
    toast({ title: `Imported ${toAdd.length} item${toAdd.length !== 1 ? "s" : ""}`, description: "Line items have been added to the invoice." });
  };

  const addLineItem = (data: LineItemFormValues) => {
    const quantity = parseFloat(data.quantity);
    const rate = parseFloat(data.rate);
    const amount = parseFloat(data.amount);

    setLineItems([
      ...lineItems,
      {
        id: crypto.randomUUID(),
        category: data.category,
        description: data.description,
        unit: data.unit,
        quantity,
        rate,
        amount,
      },
    ]);
    setShowLineItemForm(false);
  };

  const removeLineItem = (id: string) => {
    setLineItems(lineItems.filter((item) => item.id !== id));
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const onSubmit = (data: InvoiceFormValues, send: boolean = false) => {
    if (lineItems.length === 0) {
      toast({
        title: "No line items",
        description: "Please add at least one line item to the invoice.",
        variant: "destructive",
      });
      return;
    }
    createInvoiceMutation.mutate({ formData: data, send });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-semibold">Create Invoice</h1>
          <p className="text-muted-foreground mt-1">Generate a new invoice for your client</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* ── Import from Document ── */}
          <Card className="border-dashed">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start gap-4">
                <div className="rounded-lg bg-muted p-2.5 mt-0.5 shrink-0">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">Import from Document</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload a PDF quote or invoice to auto-fill line items, due date and notes.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="input-document-upload"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={parseDocumentMutation.isPending}
                  data-testid="button-import-document"
                  className="shrink-0"
                >
                  {parseDocumentMutation.isPending ? (
                    <>
                      <FileText className="h-4 w-4 mr-1 animate-pulse" />
                      Parsing…
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4 mr-1" />
                      Choose PDF
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="clientId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-invoice-client">
                                <SelectValue placeholder="Select client" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {clients?.map((client) => (
                                <SelectItem key={client.id} value={client.id}>
                                  {client.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="jobId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Job (Optional)</FormLabel>
                          <Select onValueChange={(v) => field.onChange(v === "none" ? "" : v)} value={field.value || "none"}>
                            <FormControl>
                              <SelectTrigger data-testid="select-invoice-job">
                                <SelectValue placeholder="Link to job" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="none">No job</SelectItem>
                              {filteredJobs?.map((job) => (
                                <SelectItem key={job.id} value={job.id}>
                                  {job.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Due Date *</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-invoice-due-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="taxRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tax Rate (%)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-invoice-tax-rate" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Line Items</CardTitle>
              <Button size="sm" onClick={() => setShowLineItemForm(true)} data-testid="button-add-line-item">
                <Plus className="h-4 w-4 mr-1" />
                Add Item
              </Button>
            </CardHeader>
            <CardContent>
              {lineItems.length === 0 && !showLineItemForm ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No line items yet. Add items to build your invoice.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {lineItems.length > 0 && (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="w-24">Qty</TableHead>
                            <TableHead className="w-24">Rate</TableHead>
                            <TableHead className="w-28 text-right">Amount</TableHead>
                            <TableHead className="w-12"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lineItems.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-medium">{item.description}</span>
                                  <Badge variant="secondary" className="w-fit text-xs">
                                    {item.category.replace("_", " ")}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {item.quantity} {item.unit}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {formatCurrency(item.rate)}
                              </TableCell>
                              <TableCell className="font-mono text-right font-medium">
                                {formatCurrency(item.amount)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeLineItem(item.id)}
                                  data-testid={`button-remove-item-${item.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {showLineItemForm && (
                    <LineItemForm
                      onSubmit={addLineItem}
                      onCancel={() => setShowLineItemForm(false)}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Form {...form}>
            <Card>
              <CardHeader>
                <CardTitle>Notes & Terms</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Additional notes for the client" {...field} data-testid="input-invoice-notes" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="termsAndConditions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Terms & Conditions</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Payment terms and conditions" {...field} data-testid="input-invoice-terms" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </Form>
        </div>

        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Invoice Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                  <span className="font-mono">{formatCurrency(taxAmount)}</span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between font-medium">
                    <span>Total</span>
                    <span className="text-xl font-mono">{formatCurrency(total)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <Button
                  className="w-full"
                  onClick={form.handleSubmit((data) => onSubmit(data, true))}
                  disabled={createInvoiceMutation.isPending || lineItems.length === 0}
                  data-testid="button-create-send-invoice"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {createInvoiceMutation.isPending ? "Creating..." : "Create & Send"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={form.handleSubmit((data) => onSubmit(data, false))}
                  disabled={createInvoiceMutation.isPending || lineItems.length === 0}
                  data-testid="button-save-draft-invoice"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save as Draft
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Document Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col" data-testid="dialog-import-document">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Import from Document
            </DialogTitle>
          </DialogHeader>

          {parsedDoc && (
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Confidence banner */}
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${
                parsedDoc.confidence === "high"
                  ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
                  : parsedDoc.confidence === "medium"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
              }`}>
                {parsedDoc.confidence === "high" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                <span>
                  {parsedDoc.confidence === "high"
                    ? `Extracted ${parsedDoc.lineItems.length} line items with high confidence.`
                    : parsedDoc.confidence === "medium"
                    ? `Extracted ${parsedDoc.lineItems.length} line item${parsedDoc.lineItems.length !== 1 ? "s" : ""} — review and adjust quantities/rates before importing.`
                    : "Low confidence extraction — please review all fields carefully."}
                </span>
              </div>

              {/* Extra fields detected */}
              {(parsedDoc.dueDate || parsedDoc.taxRate !== undefined || parsedDoc.notes) && (
                <div className="rounded-md border px-4 py-3 space-y-1 text-sm">
                  <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-2">Also detected</p>
                  {parsedDoc.dueDate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Due Date</span>
                      <span className="font-mono">{parsedDoc.dueDate}</span>
                    </div>
                  )}
                  {parsedDoc.taxRate !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax Rate</span>
                      <span className="font-mono">{parsedDoc.taxRate}%</span>
                    </div>
                  )}
                  {parsedDoc.notes && (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground shrink-0">Notes</span>
                      <span className="text-right truncate">{parsedDoc.notes}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground pt-1">These fields will be applied when you import.</p>
                </div>
              )}

              {/* Line items selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Select items to import</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => setSelectedParsedItems(new Set(parsedDoc.lineItems.map((_, i) => i)))}
                    >
                      All
                    </button>
                    <span className="text-xs text-muted-foreground">·</span>
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => setSelectedParsedItems(new Set())}
                    >
                      None
                    </button>
                  </div>
                </div>

                <div className="rounded-md border divide-y">
                  {parsedDoc.lineItems.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer ${
                        selectedParsedItems.has(idx) ? "bg-muted/40" : ""
                      }`}
                      onClick={() =>
                        setSelectedParsedItems((prev) => {
                          const next = new Set(prev);
                          next.has(idx) ? next.delete(idx) : next.add(idx);
                          return next;
                        })
                      }
                      data-testid={`import-item-${idx}`}
                    >
                      <Checkbox
                        checked={selectedParsedItems.has(idx)}
                        onCheckedChange={(checked) =>
                          setSelectedParsedItems((prev) => {
                            const next = new Set(prev);
                            checked ? next.add(idx) : next.delete(idx);
                            return next;
                          })
                        }
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5"
                        data-testid={`checkbox-import-item-${idx}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.description}</p>
                        <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-xs py-0">
                            {item.category.replace("_", " ")}
                          </Badge>
                          <span>{item.quantity} {item.unit}</span>
                          <span>@&nbsp;${item.rate.toFixed(2)}</span>
                        </div>
                      </div>
                      <span className="font-mono text-sm font-medium shrink-0">
                        ${item.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="border-t pt-4 mt-2">
            <Button variant="outline" onClick={() => setShowImportDialog(false)} data-testid="button-cancel-import">
              Cancel
            </Button>
            <Button
              onClick={applyParsedItems}
              disabled={selectedParsedItems.size === 0}
              data-testid="button-apply-import"
            >
              Import {selectedParsedItems.size > 0 ? `${selectedParsedItems.size} item${selectedParsedItems.size !== 1 ? "s" : ""}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineItemForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: LineItemFormValues) => void;
  onCancel: () => void;
}) {
  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    mode: "onChange",
    defaultValues: {
      category: "labor",
      description: "",
      quantity: "",
      unit: "hours",
      rate: "",
      amount: "",
    },
  });

  const category = form.watch("category");
  const watchedQuantity = form.watch("quantity");
  const watchedRate = form.watch("rate");

  const computedAmount = (() => {
    const q = parseFloat(watchedQuantity);
    const r = parseFloat(watchedRate);
    if (isNaN(q) || isNaN(r) || !isFinite(q) || !isFinite(r)) return 0;
    if (q <= 0 || r <= 0) return 0;
    return q * r;
  })();

  useEffect(() => {
    if (computedAmount > 0) {
      form.setValue("amount", computedAmount.toFixed(2), { shouldValidate: true });
    }
  }, [computedAmount, form]);

  useEffect(() => {
    if (category === "labor") {
      form.setValue("unit", "hours");
    } else if (category === "materials") {
      form.setValue("unit", "each");
    } else if (category === "square_footage") {
      form.setValue("unit", "sqft");
    }
  }, [category, form]);

  return (
    <Card className="border-dashed">
      <CardContent className="pt-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-line-item-category">
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
                        <SelectTrigger data-testid="select-line-item-unit">
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
                    <Input placeholder="Interior wall painting" {...field} data-testid="input-line-item-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="10" {...field} data-testid="input-line-item-quantity" />
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
                    <FormLabel>Rate ($)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="45.00" {...field} data-testid="input-line-item-rate" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-line-item-amount" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-line-item">
                Cancel
              </Button>
              <Button type="submit" data-testid="button-add-item-submit">
                Add Item
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
