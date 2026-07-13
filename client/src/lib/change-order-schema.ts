import { z } from "zod";
import { positiveNumericField } from "./positive-numeric-field";

export const changeOrderSchema = z.object({
  category: z.enum(["materials", "labor", "square_footage", "other"]),
  description: z.string().min(1, "Description is required"),
  quantity: positiveNumericField("Quantity"),
  unit: z.string().min(1, "Unit is required"),
  rate: positiveNumericField("Rate"),
  changeOrderReason: z.string().min(1, "Reason for change order is required"),
});

export type ChangeOrderValues = z.infer<typeof changeOrderSchema>;
