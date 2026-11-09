import { useMutation } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import type { LineItem } from "@shared/schema";
import { LINE_ITEM_STATUSES, LINE_ITEM_STATUS_LABELS, isLineItemStatus, lineItemProgress, lineItemProgressSummary, type LineItemStatus } from "@shared/line-item-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLE: Record<LineItemStatus, string> = {
  pending: "border-jx-ink-3 text-jx-ink-2",
  in_progress: "border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-200",
  completed: "border-jx-green text-jx-green-ink bg-jx-green-tint",
};

/**
 * Work progress per line item: a status the admin sets by hand as the job
 * moves along. Saved immediately; shown on screen only, never on the printed
 * invoice.
 */
export function LineItemProgress({ invoiceId, items }: { invoiceId: string; items: LineItem[] }) {
  const { toast } = useToast();
  const detailKey = ["/api/invoices", invoiceId];
  const progress = lineItemProgress(items);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LineItemStatus }) => {
      const res = await apiRequest("PATCH", `/api/line-items/${id}`, { status });
      return res.json();
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<{ lineItems: LineItem[] }>(detailKey);
      queryClient.setQueryData<{ lineItems: LineItem[] }>(detailKey, (old) =>
        old ? { ...old, lineItems: old.lineItems.map((li) => (li.id === id ? { ...li, status } : li)) } : old,
      );
      return { previous };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey, context.previous);
      toast({ title: "Couldn't update status", description: err.message.replace(/^\d+:\s*/, ""), variant: "destructive" });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey });
      void queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
  });

  if (items.length === 0) return null;

  const sections = [...new Set(items.map((i) => i.section || "General"))];

  return (
    <Card className="mt-4 print:hidden" data-testid="panel-line-item-progress">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Work progress</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground" data-testid="text-line-item-progress">{lineItemProgressSummary(items)}</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-jx-green transition-all" style={{ width: `${progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">Status is for your team; it doesn't appear on the invoice sent to the client.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sections.map((section) => (
          <div key={section}>
            {sections.length > 1 && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section}</p>}
            <ul className="divide-y rounded-md border">
              {items.filter((i) => (i.section || "General") === section).map((item) => {
                const status: LineItemStatus = isLineItemStatus(item.status) ? item.status : "pending";
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2" data-testid={`progress-row-${item.id}`}>
                    <span className={`min-w-0 flex-1 truncate text-sm ${status === "completed" ? "text-muted-foreground line-through" : ""}`}>
                      {item.description}
                      {item.isChangeOrder && <span className="ml-2 text-xs text-amber-600">CO</span>}
                    </span>
                    <Select value={status} onValueChange={(value) => isLineItemStatus(value) && value !== status && setStatus.mutate({ id: item.id, status: value })}>
                      <SelectTrigger className={`h-8 w-[140px] text-xs font-semibold ${STATUS_STYLE[status]}`} aria-label={`Status for ${item.description}`} data-testid={`select-status-${item.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LINE_ITEM_STATUSES.map((value) => (
                          <SelectItem key={value} value={value} data-testid={`status-option-${value}`}>{LINE_ITEM_STATUS_LABELS[value]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
