import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { Invoice } from "@shared/schema";
import { AlertTriangle, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CHANGE_ORDER_STATUSES, invalidateChangeOrderEffects } from "@/pages/change-orders-logic";

const amountSchema = z.string()
  .trim()
  .min(1, "Enter an amount.")
  .regex(/^\d+(?:\.\d{1,2})?$/, "Use a non-negative amount with up to two decimal places.");

const formSchema = z.object({
  invoiceId: z.string().min(1, "Choose an invoice."),
  description: z.string().trim().min(1, "Describe the scope change."),
  amountAbs: amountSchema,
  amountType: z.enum(["add", "credit"]),
  reason: z.string().optional(),
  status: z.enum(CHANGE_ORDER_STATUSES),
});
type FormValues = z.infer<typeof formSchema>;

const statusLabels: Record<FormValues["status"], string> = {
  draft: "Draft", pending: "Pending approval", approved: "Approved", rejected: "Rejected", invoiced: "Invoiced",
};

export function ChangeOrderFormDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState("");
  const { data: invoices, isLoading: invoicesLoading, isError: invoicesError, isFetching: invoicesFetching, refetch: retryInvoices } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    enabled: open,
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { invoiceId: "", description: "", amountAbs: "", amountType: "add", reason: "", status: "pending" },
  });
  const selectedInvoiceId = form.watch("invoiceId");
  const hasRealInvoice = !!invoices?.some((invoice) => invoice.id === selectedInvoiceId);
  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!invoices?.some((invoice) => invoice.id === values.invoiceId)) {
        throw new Error("Select an available invoice before creating this change order.");
      }
      const amountValue = Number(values.amountAbs);
      const cents = Math.round(amountValue * 100);
      const amount = `${values.amountType === "credit" && cents > 0 ? "-" : ""}${(cents / 100).toFixed(2)}`;
      const response = await apiRequest("POST", "/api/change-orders", {
        invoiceId: values.invoiceId,
        description: values.description.trim(),
        amount,
        reason: values.reason?.trim() || null,
        status: values.status,
      });
      return response.json();
    },
    onSuccess: async () => {
      await invalidateChangeOrderEffects(queryClient);
      toast({ title: "Change order created" });
      onOpenChange(false);
      form.reset();
      setServerError("");
    },
    onError: (error: Error) => {
      setServerError(error.message || "Could not create the change order. Check the details and try again.");
      toast({ title: "Could not create change order", description: error.message, variant: "destructive" });
    },
  });
  const update = (field: keyof FormValues, value: string) => {
    form.setValue(field, value as never, { shouldDirty: true, shouldValidate: true });
    setServerError("");
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) onOpenChange(next); }}>
    <DialogContent className="relative flex max-h-[92dvh] min-w-0 flex-col overflow-hidden rounded-[28px] border-jx-line bg-card p-0 text-jx-ink sm:max-w-[620px]" data-testid="dialog-change-order">
      <DialogHeader className="shrink-0 border-b border-jx-line px-5 py-4 sm:px-7">
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink"><FilePlus2 className="h-5 w-5" aria-hidden="true" /></div>
        <DialogTitle className="font-display text-2xl !font-bold tracking-[-.04em] text-jx-ink">New change order</DialogTitle>
        <DialogDescription className="text-sm text-jx-ink-2">Record the changed scope and its exact cost against an invoice.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        <Form {...form}>
          <form id="change-order-form" onSubmit={form.handleSubmit((values) => {
            if (!mutation.isPending && hasRealInvoice) {
              setServerError("");
              mutation.mutate(values);
            }
          })} className="space-y-4" noValidate>
            {serverError && <p className="rounded-xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" role="alert" data-testid="change-order-form-error">{serverError}</p>}
            <FormField control={form.control} name="invoiceId" render={({ field }) => <FormItem className="space-y-1.5">
              <Label htmlFor="co-invoice">Invoice *</Label>
              <Select value={field.value} onValueChange={(value) => { if (value) update("invoiceId", value); }} disabled={invoicesLoading || invoicesError}>
                <FormControl><SelectTrigger id="co-invoice" className="min-h-11 w-full" aria-describedby="co-invoice-help" data-testid="select-co-invoice"><SelectValue placeholder={invoicesError ? "Invoices unavailable" : invoicesLoading ? "Loading invoices…" : "Choose an invoice"} /></SelectTrigger></FormControl>
                <SelectContent>
                  {field.value && !invoices?.some((invoice) => invoice.id === field.value) && <SelectItem value={field.value}>Previously selected invoice</SelectItem>}
                  {(invoices ?? []).map((invoice) => <SelectItem key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.status}</SelectItem>)}
                </SelectContent>
              </Select>
              <p id="co-invoice-help" className="text-xs text-jx-ink-2">An invoice is required to attach this scope change.</p>
              {invoicesLoading && <p role="status" className="text-xs text-jx-ink-2">Loading your invoices…</p>}
              {invoicesError && <div className="flex flex-wrap items-center gap-2 text-xs text-jx-orange-ink" role="alert" data-testid="co-invoice-error">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Invoices didn’t load.
                <Button type="button" variant="ghost" className="min-h-11 rounded-full px-3 text-jx-orange-ink underline" onClick={() => void retryInvoices()} disabled={invoicesFetching} data-testid="button-retry-co-invoices">{invoicesFetching ? "Retrying…" : "Retry"}</Button>
              </div>}
              {!invoicesLoading && !invoicesError && invoices?.length === 0 && <p className="text-xs text-jx-ink-2">No invoices are available yet.</p>}
              <FormMessage />
            </FormItem>} />
            <FormField control={form.control} name="description" render={({ field }) => <FormItem className="space-y-1.5">
              <Label htmlFor="co-description">Scope change *</Label>
              <FormControl><Input id="co-description" {...field} placeholder="e.g. Add a second coat in the stairwell" data-testid="input-co-description" /></FormControl>
              <FormMessage />
            </FormItem>} />
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(145px,.65fr)]">
              <FormField control={form.control} name="amountAbs" render={({ field }) => <FormItem className="space-y-1.5">
                <Label htmlFor="co-amount">Amount *</Label>
                <div className="relative"><span className="pointer-events-none absolute left-3 top-2.5 text-sm text-jx-ink-2">$</span><FormControl><Input id="co-amount" className="pl-7 font-mono tabular-nums" type="text" inputMode="decimal" {...field} placeholder="0.00" aria-describedby="co-amount-help" data-testid="input-co-amount" /></FormControl></div>
                <p id="co-amount-help" className="text-xs text-jx-ink-2">Zero is allowed. Use cents for exact totals.</p>
                <FormMessage />
              </FormItem>} />
              <FormField control={form.control} name="amountType" render={({ field }) => <FormItem className="space-y-1.5">
                <Label htmlFor="co-type">Adjustment</Label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger id="co-type" className="min-h-11" data-testid="select-co-type"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent><SelectItem value="add">Addition +</SelectItem><SelectItem value="credit">Credit −</SelectItem></SelectContent>
                </Select>
              </FormItem>} />
            </div>
            <FormField control={form.control} name="reason" render={({ field }) => <FormItem className="space-y-1.5">
              <Label htmlFor="co-reason">Reason <span className="font-normal text-jx-ink-3">(optional)</span></Label>
              <FormControl><Input id="co-reason" {...field} placeholder="What prompted the change?" data-testid="input-co-reason" /></FormControl>
            </FormItem>} />
            <FormField control={form.control} name="status" render={({ field }) => <FormItem className="space-y-1.5">
              <Label htmlFor="co-status">Starting status</Label>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger id="co-status" className="min-h-11" data-testid="select-co-status"><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>{CHANGE_ORDER_STATUSES.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}</SelectContent>
              </Select>
            </FormItem>} />
          </form>
        </Form>
      </div>
      <DialogFooter className="shrink-0 border-t border-jx-line px-5 py-4 sm:px-7">
        <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
        <Button type="submit" form="change-order-form" disabled={mutation.isPending || !hasRealInvoice || invoicesLoading || invoicesError} className="min-h-11 rounded-full bg-jx-green px-6 font-bold text-white hover:bg-jx-green-hover" data-testid="button-save-co">
          {mutation.isPending ? "Creating…" : "Create change order"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
