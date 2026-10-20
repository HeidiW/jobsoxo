import type { ChangeOrder, Invoice } from "@shared/schema";
import type { QueryClient } from "@tanstack/react-query";

export interface EnrichedChangeOrder extends ChangeOrder {
  invoice: Invoice | null;
  job: { id: string; title: string } | null;
  client: { id: string; name: string } | null;
}

export type ChangeOrderStatus = "draft" | "pending" | "approved" | "rejected" | "invoiced";
export type ChangeOrderFilter = "all" | "pending" | "approved" | "invoiced";

export const CHANGE_ORDER_FILTERS: { key: ChangeOrderFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "invoiced", label: "Invoiced" },
];

export const CHANGE_ORDER_STATUSES = [
  "draft", "pending", "approved", "rejected", "invoiced",
] as const;

export function formatChangeOrderNumber(id: string) {
  return `CO-${id.slice(-8, -2).toUpperCase()}`;
}

export function amountToCents(value: string | number): number {
  const parsed = typeof value === "number" ? value.toFixed(2) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(parsed);
  if (!match) return 0;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return (match[1] ? -1 : 1) * cents;
}

export function sumChangeOrderCents(orders: Pick<ChangeOrder, "amount">[]): number {
  return orders.reduce((total, order) => total + amountToCents(order.amount), 0);
}

export function formatSignedMoney(cents: number): string {
  if (!cents) return "$0.00";
  const abs = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(abs);
  return `${cents > 0 ? "+" : "−"}${formatted}`;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function changeOrderAmountText(amount: string | number) {
  return formatSignedMoney(amountToCents(amount));
}

export function filterChangeOrders(orders: EnrichedChangeOrder[], filter: ChangeOrderFilter) {
  return filter === "all" ? orders : orders.filter((order) => order.status === filter);
}

export async function invalidateChangeOrderEffects(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["/api/change-orders"] }),
    client.invalidateQueries({ queryKey: ["/api/invoices"] }),
    client.invalidateQueries({ queryKey: ["/api/jobs"] }),
    client.invalidateQueries({ queryKey: ["/api/dashboard"] }),
  ]);
}
