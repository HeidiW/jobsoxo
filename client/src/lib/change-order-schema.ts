import { z } from "zod";

function positiveNumericField(label: string) {
  return z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (val) => !isNaN(parseFloat(val)) && isFinite(Number(val)),
      `${label} must be a valid number`
    )
    .refine((val) => parseFloat(val) > 0, `${label} must be greater than zero`);
}

export const changeOrderSchema = z.object({
  category: z.enum(["materials", "labor", "square_footage", "other"]),
  description: z.string().min(1, "Description is required"),
  quantity: positiveNumericField("Quantity"),
  unit: z.string().min(1, "Unit is required"),
  rate: positiveNumericField("Rate"),
  changeOrderReason: z.string().min(1, "Reason for change order is required"),
});

export type ChangeOrderValues = z.infer<typeof changeOrderSchema>;
