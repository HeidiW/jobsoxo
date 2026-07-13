import { z } from "zod";

export function positiveNumericField(label: string) {
  return z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (val) => !isNaN(parseFloat(val)) && isFinite(Number(val)),
      `${label} must be a valid number`
    )
    .refine((val) => parseFloat(val) > 0, `${label} must be greater than zero`);
}
