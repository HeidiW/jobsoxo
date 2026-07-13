import { describe, it, expect } from "vitest";
import { lineItemSchema } from "@/pages/invoice-new";

const validBase = {
  category: "labor" as const,
  description: "Paint walls",
  unit: "hours",
  quantity: "10",
  rate: "50",
  amount: "500",
};

describe("invoice-new lineItemSchema — quantity guard", () => {
  it('rejects quantity = "0"', () => {
    const result = lineItemSchema.safeParse({ ...validBase, quantity: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('rejects quantity = "-1"', () => {
    const result = lineItemSchema.safeParse({ ...validBase, quantity: "-1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('rejects empty quantity', () => {
    const result = lineItemSchema.safeParse({ ...validBase, quantity: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity is required");
    }
  });

  it('accepts quantity = "5"', () => {
    const result = lineItemSchema.safeParse({ ...validBase, quantity: "5", amount: "250" });
    expect(result.success).toBe(true);
  });
});

describe("invoice-new lineItemSchema — rate guard", () => {
  it('rejects rate = "0"', () => {
    const result = lineItemSchema.safeParse({ ...validBase, rate: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Rate must be greater than zero");
    }
  });

  it('rejects rate = "-10"', () => {
    const result = lineItemSchema.safeParse({ ...validBase, rate: "-10" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Rate must be greater than zero");
    }
  });

  it('rejects empty rate', () => {
    const result = lineItemSchema.safeParse({ ...validBase, rate: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Rate is required");
    }
  });

  it('accepts rate = "75.50"', () => {
    const result = lineItemSchema.safeParse({ ...validBase, rate: "75.50", quantity: "2", amount: "151" });
    expect(result.success).toBe(true);
  });
});

describe("invoice-new lineItemSchema — amount mismatch guard", () => {
  it("rejects amount that does not equal qty × rate", () => {
    const result = lineItemSchema.safeParse({ ...validBase, quantity: "10", rate: "50", amount: "999" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("Amount must equal qty"))).toBe(true);
    }
  });

  it("accepts amount equal to qty × rate", () => {
    const result = lineItemSchema.safeParse({ ...validBase, quantity: "4", rate: "25", amount: "100" });
    expect(result.success).toBe(true);
  });
});
