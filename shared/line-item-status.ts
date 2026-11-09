// Work status of an invoice line item, set by hand as the job progresses.
// Internal to the business: it never prints on the client's invoice.

export const LINE_ITEM_STATUSES = ["pending", "in_progress", "completed"] as const;
export type LineItemStatus = (typeof LINE_ITEM_STATUSES)[number];

export const LINE_ITEM_STATUS_LABELS: Record<LineItemStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
};

export function isLineItemStatus(value: unknown): value is LineItemStatus {
  return typeof value === "string" && (LINE_ITEM_STATUSES as readonly string[]).includes(value);
}

/** Counts for a summary line such as "2 of 5 completed · 1 in progress". */
export function lineItemProgress(items: ReadonlyArray<{ status?: string | null }>) {
  const counts = { pending: 0, in_progress: 0, completed: 0 };
  for (const item of items) {
    const status = isLineItemStatus(item.status) ? item.status : "pending";
    counts[status] += 1;
  }
  return { ...counts, total: items.length };
}

export function lineItemProgressSummary(items: ReadonlyArray<{ status?: string | null }>): string {
  const p = lineItemProgress(items);
  if (p.total === 0) return "No line items";
  const parts = [`${p.completed} of ${p.total} completed`];
  if (p.in_progress) parts.push(`${p.in_progress} in progress`);
  return parts.join(" · ");
}
