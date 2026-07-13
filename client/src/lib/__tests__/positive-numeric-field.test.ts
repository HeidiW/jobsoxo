import { describe, it, expect } from "vitest";
import { z } from "zod";
import { positiveNumericField } from "@/lib/positive-numeric-field";

const schema = z.object({ value: positiveNumericField("Quantity") });

describe("positiveNumericField", () => {
  it('rejects empty string with "Quantity is required"', () => {
    const result = schema.safeParse({ value: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity is required");
    }
  });

  it('rejects "0" with "Quantity must be greater than zero"', () => {
    const result = schema.safeParse({ value: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('rejects "-5" with "Quantity must be greater than zero"', () => {
    const result = schema.safeParse({ value: "-5" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be greater than zero");
    }
  });

  it('rejects "abc" with "Quantity must be a valid number"', () => {
    const result = schema.safeParse({ value: "abc" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Quantity must be a valid number");
    }
  });

  it('accepts "1"', () => {
    const result = schema.safeParse({ value: "1" });
    expect(result.success).toBe(true);
  });

  it('accepts "0.01"', () => {
    const result = schema.safeParse({ value: "0.01" });
    expect(result.success).toBe(true);
  });

  it('accepts "100.5"', () => {
    const result = schema.safeParse({ value: "100.5" });
    expect(result.success).toBe(true);
  });
});
