// Receipt scanning: the shapes Claude returns when it reads a purchase receipt
// and the helpers that turn them into material purchases a person reviews
// before anything is saved.
import { z } from "zod";

export const RECEIPT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export type ReceiptMediaType = (typeof RECEIPT_MEDIA_TYPES)[number];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

/** Units the material form knows; the model picks the closest, "each" when unsure. */
export const RECEIPT_UNITS = ["each", "oz", "lb", "bag", "gal", "qt", "ft", "sqft", "box", "set", "other"] as const;

export const scannedItemSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.number(),
  unit: z.enum(RECEIPT_UNITS),
  /** Line total in dollars, after any line discount, before tax. */
  price: z.number(),
});
export type ScannedItem = z.infer<typeof scannedItemSchema>;

export const receiptScanSchema = z.object({
  isReceipt: z.boolean(),
  vendor: z.string().nullable(),
  /** YYYY-MM-DD when the receipt shows one. */
  purchaseDate: z.string().nullable(),
  items: z.array(scannedItemSchema),
  /** Sales tax shown on the receipt, if any. */
  tax: z.number().nullable(),
  /** Grand total printed on the receipt, if any. */
  total: z.number().nullable(),
  /** Anything the person should double-check, in plain words. */
  warnings: z.array(z.string()),
});
export type ReceiptScan = z.infer<typeof receiptScanSchema>;

/** JSON Schema handed to the model as its output format; kept in step with receiptScanSchema. */
export const RECEIPT_SCAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    isReceipt: { type: "boolean", description: "False when the file is not a purchase receipt or invoice for goods." },
    vendor: { type: ["string", "null"], description: "The store or supplier name as printed, e.g. \"Sherwin-Williams\"." },
    purchaseDate: { type: ["string", "null"], description: "Purchase date as YYYY-MM-DD, or null if not shown." },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short product name a painter would recognize, e.g. \"ProMar 200 eggshell\"." },
          description: { type: ["string", "null"], description: "Color, size, SKU or other details, or null." },
          quantity: { type: "number", description: "Quantity purchased; 1 when not shown." },
          unit: { type: "string", enum: [...RECEIPT_UNITS] },
          price: { type: "number", description: "Line total in dollars after line discounts, before tax." },
        },
        required: ["name", "description", "quantity", "unit", "price"],
        additionalProperties: false,
      },
    },
    tax: { type: ["number", "null"], description: "Sales tax in dollars, or null." },
    total: { type: ["number", "null"], description: "Grand total printed on the receipt, or null." },
    warnings: { type: "array", items: { type: "string" }, description: "Plain-words notes on anything unclear: a blurry line, a price that didn't add up, items left out." },
  },
  required: ["isReceipt", "vendor", "purchaseDate", "items", "tax", "total", "warnings"],
  additionalProperties: false,
} as const;

/** A scanned line ready for the review table: strings, like the material form. */
export interface ReviewItem {
  key: string;
  include: boolean;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
}

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const qty = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};

/** Drops lines that can't become materials (no name, zero or negative quantity, negative price). */
export function reviewItemsFromScan(scan: ReceiptScan): ReviewItem[] {
  return scan.items
    .filter((item) => item.name.trim() !== "" && item.quantity > 0 && item.price >= 0 && Number.isFinite(item.price) && Number.isFinite(item.quantity))
    .map((item, index) => ({
      key: `scan-${index}`,
      include: true,
      name: item.name.trim(),
      description: item.description?.trim() ?? "",
      quantity: qty(item.quantity),
      unit: item.unit,
      price: money(item.price),
    }));
}

export function reviewTotal(items: ReviewItem[]): number {
  return items.filter((item) => item.include).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
}

/** Plain-words heads-up when the lines don't add up to the receipt's total. */
export function totalMismatchNote(scan: Pick<ReceiptScan, "total" | "tax">, items: ReviewItem[]): string | null {
  if (scan.total === null) return null;
  const expected = scan.total - (scan.tax ?? 0);
  const lines = reviewTotal(items);
  if (Math.abs(expected - lines) < 0.015) return null;
  return `The items add up to $${money(lines)}, but the receipt total before tax is $${money(expected)}. Check for a missed line or a misread price.`;
}
