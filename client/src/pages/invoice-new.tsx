import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Trash2, ArrowLeft, Save, Send } from "lucide-react";
import { format, addDays } from "date-fns";
import type { Client, Job, LineItem } from "@shared/schema";

const lineItemSchema = z.object({
  category: z.enum(["materials", "labor", "square_footage", "other"]),
  description: z.string().min(1, "Description is required"),
  quantity: z.string().min(1, "Quantity is required"),
  unit: z.string().min(1, "Unit is required"),
  rate: z.string().min(1, "Rate is required"),
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

interface NewLineItem extends Omit<LineItemFormValues, "quantity" | "rate"> {
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
      toast({
        title: "Error creating invoice",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addLineItem = (data: LineItemFormValues) => {
    const quantity = parseFloat(data.quantity);
    const rate = parseFloat(data.rate);
    const amount = quantity * rate;

    setLineItems([
      ...lineItems,
      {
        id: crypto.randomUUID(),
        ...data,
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
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-invoice-job">
                                <SelectValue placeholder="Link to job" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="">No job</SelectItem>
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
    defaultValues: {
      category: "labor",
      description: "",
      quantity: "",
      unit: "hours",
      rate: "",
    },
  });

  const category = form.watch("category");

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
