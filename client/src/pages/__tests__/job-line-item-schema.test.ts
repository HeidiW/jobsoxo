import { describe, it, expect } from "vitest";
import { lineItemFormSchema } from "@/pages/job-line-items";

const validBase = {
  category: "labor" as const,
  description: "Install drywall",
  unit: "hours",
  quantity: "8",
  rate: "65",
  amount: "520",
  isChangeOrder: false,
};

describe("job-line-items lineItemFormSchema — quantity guard", () => {
  it('rejects quantity = "0"', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, quantity: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('rejects quantity = "-2"', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, quantity: "-2" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('rejects empty quantity', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, quantity: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity is required");
    }
  });

  it('accepts quantity = "3.5"', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, quantity: "3.5", rate: "10", amount: "35" });
    expect(result.success).toBe(true);
  });
});

describe("job-line-items lineItemFormSchema — rate guard", () => {
  it('rejects rate = "0"', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, rate: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Rate must be greater than zero");
    }
  });

  it('rejects rate = "-50"', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, rate: "-50" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Rate must be greater than zero");
    }
  });

  it('rejects empty rate', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, rate: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Rate is required");
    }
  });

  it('accepts rate = "120"', () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, quantity: "2", rate: "120", amount: "240" });
    expect(result.success).toBe(true);
  });
});

describe("job-line-items lineItemFormSchema — amount mismatch guard", () => {
  it("rejects amount that does not equal qty × rate", () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, quantity: "8", rate: "65", amount: "100" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("Amount must equal quantity"))).toBe(true);
    }
  });

  it("accepts amount equal to qty × rate", () => {
    const result = lineItemFormSchema.safeParse({ ...validBase, quantity: "8", rate: "65", amount: "520" });
    expect(result.success).toBe(true);
  });
});
