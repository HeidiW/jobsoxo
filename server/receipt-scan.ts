// Reads a purchase receipt (photo or PDF) with Claude and returns the vendor,
// date and line items. The result is only a proposal: the person reviews and
// edits it in the browser, and nothing is saved until they choose to.
import Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "@shared/schema";
import { RECEIPT_MEDIA_TYPES, RECEIPT_SCAN_JSON_SCHEMA, receiptScanSchema, type ReceiptMediaType, type ReceiptScan } from "@shared/receipt-scan";

export const RECEIPT_SCAN_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function isReceiptMediaType(value: string): value is ReceiptMediaType {
  return (RECEIPT_MEDIA_TYPES as readonly string[]).includes(value);
}

export function buildReceiptSystemPrompt(settings: Settings | undefined): string {
  const company = settings?.companyName?.trim();
  return [
    "You read purchase receipts for a painting, decorating and plastering business in the US and turn them into a list of materials bought. The person will review your list before it is saved, so be complete and flag anything you are unsure of rather than guessing silently.",
    "",
    "List every product line on the receipt as one item. Use a short product name a painter would recognize (brand and product, e.g. \"ProMar 200 eggshell\"), and put color, sheen, size, SKU or other details in the description. Quantity is the number bought; when the receipt shows a quantity and a unit price, the item price is the line total (quantity × unit price) after any line discount. Prices are in dollars, before sales tax.",
    "",
    "Pick the unit from the list: each, oz, lb, bag, gal, qt, ft, sqft, box, set, other. A gallon can of paint is 1 each, not 1 gal, unless the receipt sells by volume. Skip lines that are not goods: subtotal, tax, total, payment, change, rewards, coupons and fees. Record sales tax and the grand total in their own fields.",
    "",
    "Set isReceipt to false if the file is not a receipt or supplier invoice for goods. Give the purchase date as YYYY-MM-DD only when it is printed; never invent one. Add a warning for each line you could not read clearly, for prices that don't add up to the printed total, and for anything you left out.",
    company ? `The business is ${company}; it is the buyer, not the vendor.` : "",
  ].join("\n");
}

export interface ReceiptFile {
  data: Buffer;
  mediaType: ReceiptMediaType;
}

function fileBlock(file: ReceiptFile): Anthropic.Messages.ContentBlockParam {
  const data = file.data.toString("base64");
  if (file.mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  return { type: "image", source: { type: "base64", media_type: file.mediaType, data } };
}

export async function scanReceipt(file: ReceiptFile, settings: Settings | undefined): Promise<ReceiptScan> {
  const response = await getClient().messages.create({
    model: RECEIPT_SCAN_MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: RECEIPT_SCAN_JSON_SCHEMA } },
    system: [{ type: "text", text: buildReceiptSystemPrompt(settings), cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: [fileBlock(file), { type: "text", text: "Read this receipt and list the materials bought." }],
    }],
  });
  if (response.stop_reason === "refusal") {
    return { isReceipt: false, vendor: null, purchaseDate: null, items: [], tax: null, total: null, warnings: ["The reader declined to process this file."] };
  }
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  const parsed = receiptScanSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    console.error("Receipt scan: unusable model output", parsed.error.issues);
    throw new ReceiptScanError("The receipt reader returned something unexpected. Try again, or log the purchase by hand.");
  }
  return parsed.data;
}

export class ReceiptScanError extends Error {}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function receiptScanErrorMessage(error: unknown): string {
  if (error instanceof ReceiptScanError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return "The receipt reader isn't set up correctly (invalid API key).";
  if (error instanceof Anthropic.RateLimitError) return "The receipt reader is busy right now. Try again in a moment.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the receipt reader. Check your connection and try again.";
  if (error instanceof Anthropic.BadRequestError && /image|document|pdf|too large|exceeds/i.test(error.message)) {
    return "That file couldn't be read. Try a clearer photo or a smaller file.";
  }
  return "The receipt reader hit a problem. Try again.";
}
