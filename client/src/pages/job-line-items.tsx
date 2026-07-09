import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import {
  Plus,
  ArrowLeft,
  Trash2,
  Edit,
  MoreHorizontal,
  Ruler,
  FileText,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Job, Client, LineItem } from "@shared/schema";

// Mirror server-side positiveNumericString validation inline so errors surface
// without a network round-trip. The exact rules (> 0) come from insertLineItemSchema.
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

const lineItemFormSchema = z
  .object({
    category: z.enum(["materials", "labor", "square_footage", "other"]),
    description: z.string().min(1, "Description is required"),
    quantity: positiveNumericField("Quantity"),
    unit: z.string().min(1, "Unit is required"),
    rate: positiveNumericField("Rate"),
    amount: positiveNumericField("Amount"),
    isChangeOrder: z.boolean().default(false),
    changeOrderReason: z.string().optional(),
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

type LineItemFormValues = z.infer<typeof lineItemFormSchema>;

interface JobWithClient extends Job {
  client: Client;
}

interface PreviewInfo {
  delta: number;
  category: string;
  isChangeOrder: boolean;
}

function LineItemForm({
  jobId,
  lineItem,
  onSuccess,
  onClose,
  onPreviewChange,
  savedTotal,
  sidebarOpen,
}: {
  jobId: string;
  lineItem?: LineItem;
  onSuccess: () => void;
  onClose: () => void;
  onPreviewChange?: (info: PreviewInfo | null) => void;
  savedTotal?: number;
  sidebarOpen?: boolean;
}) {
  const { toast } = useToast();
  const isEdit = !!lineItem;

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemFormSchema),
    defaultValues: {
      category: (lineItem?.category as LineItemFormValues["category"]) || "labor",
      description: lineItem?.description || "",
      quantity: lineItem?.quantity?.toString() || "",
      unit: lineItem?.unit || "hours",
      rate: lineItem?.rate?.toString() || "",
      amount: lineItem?.amount?.toString() || "",
      isChangeOrder: lineItem?.isChangeOrder || false,
      changeOrderReason: lineItem?.changeOrderReason || "",
    },
  });

  const isChangeOrder = form.watch("isChangeOrder");
  const watchedQuantity = form.watch("quantity");
  const watchedRate = form.watch("rate");
  const watchedCategory = form.watch("category");

  const computedAmount = (() => {
    const q = parseFloat(watchedQuantity);
    const r = parseFloat(watchedRate);
    if (isNaN(q) || isNaN(r) || !isFinite(q) || !isFinite(r)) return 0;
    if (q <= 0 || r < 0) return 0;
    return q * r;
  })();

  useEffect(() => {
    if (computedAmount > 0) {
      form.setValue("amount", computedAmount.toFixed(2), { shouldValidate: true });
    }
  }, [computedAmount, form]);

  const savedAmount = isEdit ? Number(lineItem.amount) : 0;

  const runningTotal = (savedTotal ?? 0) + (isEdit ? computedAmount - savedAmount : computedAmount);

  useEffect(() => {
    if (onPreviewChange) {
      onPreviewChange({
        delta: computedAmount - savedAmount,
        category: watchedCategory,
        isChangeOrder,
      });
    }
  }, [computedAmount, savedAmount, watchedCategory, isChangeOrder, onPreviewChange]);

  useEffect(() => {
    return () => {
      if (onPreviewChange) onPreviewChange(null);
    };
  }, [onPreviewChange]);

  const mutation = useMutation({
    mutationFn: async (data: LineItemFormValues) => {
      const payload = {
        ...data,
        jobId,
        quantity: parseFloat(data.quantity),
        rate: parseFloat(data.rate),
        amount: parseFloat(data.amount),
      };

      const url = isEdit ? `/api/line-items/${lineItem.id}` : "/api/line-items";
      const method = isEdit ? "PATCH" : "POST";
      const res = await apiRequest(method, url, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({
        title: isEdit ? "Item updated" : "Item added",
        description: `Line item has been ${isEdit ? "updated" : "added"} successfully.`,
      });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.details) {
        Object.entries(error.details).forEach(([field, messages]) => {
          form.setError(field as keyof LineItemFormValues, {
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
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });

  const onSubmit = (data: LineItemFormValues) => {
    mutation.mutate(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-line-category">
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
                      <SelectTrigger data-testid="select-line-unit">
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
                  <Input placeholder="Interior wall painting" {...field} data-testid="input-line-description" />
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
                    <Input type="number" step="0.01" placeholder="10" {...field} data-testid="input-line-quantity" />
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
                    <Input type="number" step="0.01" placeholder="45.00" {...field} data-testid="input-line-rate" />
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
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...field}
                    data-testid="input-line-amount"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isChangeOrder"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="checkbox-change-order"
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>This is a change order</FormLabel>
                </div>
              </FormItem>
            )}
          />
          {isChangeOrder && (
            <FormField
              control={form.control}
              name="changeOrderReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Change Order Reason</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Reason for the change order" {...field} data-testid="input-change-order-reason" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {savedTotal !== undefined && (
          <div
            className={`${sidebarOpen ? "lg:hidden" : ""} flex items-center justify-between rounded-lg border bg-muted/50 px-4 py-2.5 mt-4 shrink-0`}
            data-testid="banner-running-total"
          >
            <span className="text-sm text-muted-foreground">Running total</span>
            <span
              className={`text-base font-mono font-semibold transition-colors ${computedAmount > 0 ? "text-primary" : ""}`}
              data-testid="text-running-total"
            >
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
              }).format(runningTotal)}
            </span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 shrink-0">
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-line-item">
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending} data-testid="button-save-line-item">
            {mutation.isPending ? "Saving..." : isEdit ? "Update Item" : "Add Item"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default function JobLineItems() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LineItem | null>(null);
  const [previewInfo, setPreviewInfo] = useState<PreviewInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem("job-line-items-sidebar-open");
    return saved === null ? true : saved === "true";
  });

  const { data: job, isLoading: jobLoading } = useQuery<JobWithClient>({
    queryKey: ["/api/jobs", id],
    enabled: !!id,
  });

  const { data: lineItems, isLoading: itemsLoading } = useQuery<LineItem[]>({
    queryKey: ["/api/jobs", id, "line-items"],
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiRequest("DELETE", `/api/line-items/${itemId}`);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "line-items"] });
      toast({
        title: "Item deleted",
        description: "The line item has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
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

  const CATEGORIES = [
    { key: "materials", label: "Materials" },
    { key: "labor", label: "Labor" },
    { key: "square_footage", label: "Square Footage" },
    { key: "other", label: "Other" },
  ] as const;

  const savedByCategory = (lineItems ?? []).reduce<Record<string, number>>(
    (acc, item) => {
      if (!item.isChangeOrder) {
        const key = item.category as string;
        acc[key] = (acc[key] || 0) + Number(item.amount);
      }
      return acc;
    },
    {}
  );

  const changeOrderTotal =
    (lineItems ?? [])
      .filter((item) => item.isChangeOrder)
      .reduce((sum, item) => sum + Number(item.amount), 0);

  const previewDelta = previewInfo?.delta ?? 0;
  const total = (lineItems?.reduce((sum, item) => sum + Number(item.amount), 0) || 0) + previewDelta;

  const isLoading = jobLoading || itemsLoading;

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex gap-4 mb-6">
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
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="text-center py-12">
          <Ruler className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-medium">Job not found</h2>
          <Button onClick={() => setLocation("/jobs")} className="mt-4" data-testid="button-back-to-jobs">
            Back to Jobs
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/jobs")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-semibold">{job.title}</h1>
            <p className="text-muted-foreground mt-1">
              Line items for {job.client?.name}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/invoices/new?jobId=${id}`} data-testid="button-create-invoice-from-items">
              <FileText className="h-4 w-4 mr-2" />
              Create Invoice
            </a>
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              setEditingItem(null);
              setPreviewInfo(null);
            }
          }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-line-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md !flex flex-col max-h-[90dvh] overflow-hidden">
              <DialogHeader className="shrink-0">
                <DialogTitle>{editingItem ? "Edit Line Item" : "Add Line Item"}</DialogTitle>
              </DialogHeader>
              <LineItemForm
                jobId={id!}
                lineItem={editingItem || undefined}
                onSuccess={() => {}}
                onClose={() => {
                  setIsDialogOpen(false);
                  setEditingItem(null);
                  setPreviewInfo(null);
                }}
                onPreviewChange={(info) => setPreviewInfo(info)}
                savedTotal={(lineItems ?? []).reduce((sum, item) => sum + Number(item.amount), 0)}
                sidebarOpen={sidebarOpen}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ruler className="h-5 w-5" />
                Pricing Breakdown
                {lineItems && (
                  <Badge variant="secondary" className="ml-2">
                    {lineItems.length} items
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!lineItems || lineItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Ruler className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="font-medium text-lg">No line items yet</h3>
                  <p className="text-muted-foreground mt-1 mb-4">
                    Add materials, labor, and other costs
                  </p>
                  <Button onClick={() => setIsDialogOpen(true)} data-testid="button-add-first-item">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Item
                  </Button>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-24">Qty</TableHead>
                        <TableHead className="w-28">Rate</TableHead>
                        <TableHead className="w-28 text-right">Amount</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineItems.map((item) => (
                        <TableRow key={item.id} className="hover-elevate">
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="font-medium">{item.description}</span>
                              <div className="flex gap-1">
                                <Badge variant="secondary" className="text-xs">
                                  {item.category.replace("_", " ")}
                                </Badge>
                                {item.isChangeOrder && (
                                  <Badge variant="outline" className="text-xs">
                                    Change Order
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {!Number(item.quantity) ? "—" : `${Number(item.quantity)} ${item.unit}`}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {formatCurrency(item.rate)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            {formatCurrency(item.amount)}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-item-actions-${item.id}`}>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => {
                                    setEditingItem(item);
                                    setIsDialogOpen(true);
                                  }}
                                  data-testid={`button-edit-item-${item.id}`}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => deleteMutation.mutate(item.id)}
                                  className="text-destructive"
                                  data-testid={`button-delete-item-${item.id}`}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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

        <div className="hidden lg:block">
          <Card className="sticky top-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle>Job Summary</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen((prev) => {
                  const next = !prev;
                  localStorage.setItem("job-line-items-sidebar-open", String(next));
                  return next;
                })}
                data-testid="button-toggle-sidebar"
                title={sidebarOpen ? "Collapse summary" : "Expand summary"}
                className="h-8 w-8 -mr-1"
              >
                {sidebarOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </Button>
            </CardHeader>
            {sidebarOpen && <CardContent>
              <div className="space-y-2">
                {CATEGORIES.map(({ key, label }) => {
                  const saved = savedByCategory[key] || 0;
                  const isActiveCategory =
                    previewInfo &&
                    !previewInfo.isChangeOrder &&
                    previewInfo.category === key;
                  const preview = isActiveCategory ? previewInfo!.delta : 0;
                  const displayAmount = saved + preview;
                  if (displayAmount === 0 && !isActiveCategory) return null;
                  return (
                    <div
                      key={key}
                      className={`flex justify-between text-sm rounded px-1 -mx-1 transition-colors ${
                        isActiveCategory && previewInfo!.delta !== 0
                          ? "bg-primary/8"
                          : ""
                      }`}
                      data-testid={`row-category-${key}`}
                    >
                      <span className={`text-muted-foreground ${isActiveCategory && previewInfo!.delta !== 0 ? "text-primary" : ""}`}>
                        {label}
                        {isActiveCategory && previewInfo!.delta !== 0 && (
                          <span className="text-xs italic ml-1">(in progress)</span>
                        )}
                      </span>
                      <span className={`font-mono ${isActiveCategory && previewInfo!.delta !== 0 ? "text-primary" : ""}`}>
                        {formatCurrency(displayAmount)}
                      </span>
                    </div>
                  );
                })}

                {(() => {
                  const isChangeOrderPreview = previewInfo?.isChangeOrder && previewInfo.delta !== 0;
                  const displayChangeOrder = changeOrderTotal + (isChangeOrderPreview ? previewInfo!.delta : 0);
                  if (displayChangeOrder === 0 && !isChangeOrderPreview) return null;
                  return (
                    <div
                      className={`flex justify-between text-sm rounded px-1 -mx-1 transition-colors ${
                        isChangeOrderPreview ? "bg-primary/8" : ""
                      }`}
                      data-testid="row-category-change-orders"
                    >
                      <span className={`text-muted-foreground ${isChangeOrderPreview ? "text-primary" : ""}`}>
                        Change Orders
                        {isChangeOrderPreview && (
                          <span className="text-xs italic ml-1">(in progress)</span>
                        )}
                      </span>
                      <span className={`font-mono ${isChangeOrderPreview ? "text-primary" : ""}`}>
                        {formatCurrency(displayChangeOrder)}
                      </span>
                    </div>
                  );
                })()}

                <div className="border-t pt-3 mt-1">
                  <div className="flex justify-between font-medium">
                    <span>Total</span>
                    <span
                      className={`text-xl font-mono transition-colors ${previewDelta !== 0 ? "text-primary" : ""}`}
                      data-testid="text-job-total"
                    >
                      {formatCurrency(total)}
                    </span>
                  </div>
                  {previewDelta !== 0 && (
                    <p className="text-xs text-muted-foreground mt-1 italic" data-testid="text-preview-hint">
                      Preview — save to confirm
                    </p>
                  )}
                </div>
              </div>

              {job.squareFootage && (
                <div className="mt-6 pt-4 border-t">
                  <div className="text-sm text-muted-foreground mb-1">Square Footage</div>
                  <div className="font-mono text-lg">{Number(job.squareFootage).toLocaleString()} sq ft</div>
                  {total > 0 && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {formatCurrency(total / Number(job.squareFootage))} / sq ft
                    </div>
                  )}
                </div>
              )}
            </CardContent>}
          </Card>
        </div>
      </div>
    </div>
  );
}
