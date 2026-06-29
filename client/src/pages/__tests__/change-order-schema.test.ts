import { describe, it, expect } from "vitest";
import { changeOrderSchema } from "@/lib/change-order-schema";

const validBase = {
  category: "labor" as const,
  description: "Extra framing work",
  unit: "hrs",
  rate: "75",
  changeOrderReason: "Scope expansion",
};

describe("changeOrderSchema — quantity validation", () => {
  it('rejects quantity = "0" with "Quantity must be greater than zero"', () => {
    const result = changeOrderSchema.safeParse({ ...validBase, quantity: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('rejects quantity = "-1" with "Quantity must be greater than zero"', () => {
    const result = changeOrderSchema.safeParse({ ...validBase, quantity: "-1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('accepts quantity = "5"', () => {
    const result = changeOrderSchema.safeParse({ ...validBase, quantity: "5" });
    expect(result.success).toBe(true);
  });
});
