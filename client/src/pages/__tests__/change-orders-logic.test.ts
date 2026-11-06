import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  amountToCents, changeOrderAmountText, filterChangeOrders,
  invalidateChangeOrderEffects, sumChangeOrderCents, type EnrichedChangeOrder,
} from "../change-orders-logic";

describe("change order amounts and filters", () => {
  it("preserves cents, additions, credits and zero", () => {
    expect(amountToCents("110.25")).toBe(11025);
    expect(amountToCents("-10.10")).toBe(-1010);
    expect(sumChangeOrderCents([{ amount: "110.25" }, { amount: "-10.10" }])).toBe(10015);
    expect(changeOrderAmountText("110.25")).toBe("+$110.25");
    expect(changeOrderAmountText("-10.10")).toBe("−$10.10");
    expect(changeOrderAmountText("0.00")).toBe("$0.00");
  });

  it("filters without losing draft, rejected or invoiced records from All", () => {
    const records = ["pending", "approved", "draft", "rejected", "invoiced"]
      .map((status, index) => ({ id: String(index), status, amount: "0.10" })) as EnrichedChangeOrder[];
    expect(filterChangeOrders(records, "all")).toHaveLength(5);
    for (const status of ["pending", "approved", "invoiced"] as const) {
      expect(filterChangeOrders(records, status).map((record) => record.status)).toEqual([status]);
    }
  });

  it("adds fractional amounts without cumulative floating-point errors", () => {
    expect(sumChangeOrderCents(Array.from({ length: 10 }, () => ({ amount: "0.10" })))).toBe(100);
  });

  it("refreshes change orders and all invoice-related financial views", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateChangeOrderEffects({ invalidateQueries } as unknown as QueryClient);
    for (const key of ["/api/change-orders", "/api/invoices", "/api/jobs", "/api/dashboard"]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});
