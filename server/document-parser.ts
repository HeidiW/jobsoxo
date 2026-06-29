export interface ParsedLineItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  category: "materials" | "labor" | "square_footage" | "other";
}

export interface ParsedDocument {
  lineItems: ParsedLineItem[];
  dueDate?: string;
  taxRate?: number;
  notes?: string;
  confidence: "high" | "medium" | "low";
}

function guessCategory(desc: string): ParsedLineItem["category"] {
  if (/sq\s*ft|square\s*foot|sqft|m2|square\s*meter|area/i.test(desc)) return "square_footage";
  if (/tape|roller|brush|drop\s*cloth|material|supply|supplies|sheet|board|timber|lumber|nail|screw|hardware|putty|filler|plaster|drywall|equipment|tool|gallon|litre|liter/i.test(desc)) return "materials";
  if (/paint|prime|primer|coat|labor|labour|work|hour|install|apply|prep|sand|finish|clean|strip|seal|repair|patch|decor|wallpaper|caulk|stain|skim|spray|rolled|satin|faux|beam/i.test(desc)) return "labor";
  return "other";
}

function stripAmount(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, "")) || 0;
}

// ─── Table-format parser ────────────────────────────────────────────────────
// Works for traditional invoice tables: "Description   Qty   Rate   Amount"

const SKIP_LINE = /^(description|item\s*#?|qty|quantity|unit|rate|price|amount|total|subtotal|sub-?total|tax|gst|vat|hst|balance|invoice|date|number|bill\s*to|from|ship|company|address|phone|email|due|terms|notes?|payment|page|authoris|signature|thank)[\s:]*$/i;
const SUMMARY_LINE = /^(subtotal|sub-total|total\s*(due)?|grand\s*total|balance\s*due|amount\s*due|tax|gst|vat|hst|discount|deposit)\s*[-–:$\d(]/i;
const SEPARATOR = /^[-=_*#]{3,}$/;
const CURRENCY_RE = /\$?([\d,]+\.?\d{0,2})/g;

function parseTableFormat(lines: string[]): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];

  for (const line of lines) {
    if (SKIP_LINE.test(line) || SEPARATOR.test(line) || SUMMARY_LINE.test(line)) continue;

    const amounts: number[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(CURRENCY_RE.source, "g");
    while ((m = re.exec(line)) !== null) {
      const v = stripAmount(m[1]);
      if (v > 0) amounts.push(v);
    }
    if (amounts.length === 0) continue;

    const descMatch = line.match(/^([A-Za-z][^$\d]{2,60}?)(?:\s{2,}|\t|\s+\$)[\d$]/);
    if (!descMatch) continue;
    const desc = descMatch[1].replace(/[:\-]+$/, "").trim();
    if (desc.length < 3) continue;

    const total = amounts[amounts.length - 1];
    let qty = 1;
    let rate = total;

    if (amounts.length >= 3) {
      const a = amounts[amounts.length - 3];
      const b = amounts[amounts.length - 2];
      if (a > 0 && b > 0 && Math.abs(a * b - total) < 0.02) { qty = a; rate = b; }
    } else if (amounts.length === 2) {
      const a = amounts[0];
      if (a > 0 && a !== total && total > 0) {
        const ratio = total / a;
        if (ratio >= 1 && ratio <= 1000 && Math.abs(ratio - Math.round(ratio)) < 0.01) {
          qty = Math.round(ratio); rate = a;
        } else { rate = total; }
      }
    }

    const cat = guessCategory(desc);
    items.push({
      description: desc,
      quantity: parseFloat(qty.toFixed(2)),
      unit: cat === "labor" ? "hours" : cat === "square_footage" ? "sqft" : "each",
      rate: parseFloat(rate.toFixed(2)),
      amount: parseFloat(total.toFixed(2)),
      category: cat,
    });
  }
  return items;
}

// ─── Narrative / quote-format parser ───────────────────────────────────────
// Works for free-form construction quotes:
//   "Description text spanning
//    multiple lines - $35,000."
//
// Strategy: split into blank-line-delimited blocks, join wrapped lines,
// then extract each "$amount" with its leading description text.

const SKIP_BLOCK = /^(total|deposit\s*required|sub-?total|grand\s*total|balance|presented\s*to|breakdown\s*of)/i;
const SECTION_HDR = /^[A-Z][A-Z\s\/&]+[:.]\s*$/; // e.g. "BASEMENT:", "WALLS AND TRIM."

function parseNarrativeFormat(rawText: string): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];

  // Split on blank lines → one "block" per logical paragraph
  const blocks = rawText
    .split(/\n(?:\s*\n)+/)
    .map((b) =>
      b
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);

  // Price pattern: optional leading "- " then "$" then digits
  const PRICE_RE = /(?:[-–]\s*)?\$\s*([\d,]+(?:\.\d{0,2})?)/g;

  for (const block of blocks) {
    if (SKIP_BLOCK.test(block)) continue;
    // Pure section headers with no prices → skip
    if (SECTION_HDR.test(block) && !/\$/.test(block)) continue;

    // Collect all prices in this block
    const prices: Array<{ amount: number; start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(PRICE_RE.source, "g");
    while ((m = re.exec(block)) !== null) {
      const amount = parseFloat(m[1].replace(/,/g, ""));
      // Ignore tiny amounts that look like reference numbers (< $100)
      if (amount >= 100) {
        prices.push({ amount, start: m.index, end: m.index + m[0].length });
      }
    }
    if (prices.length === 0) continue;

    if (prices.length === 1) {
      // Single price: description = everything before it
      let desc = block
        .slice(0, prices[0].start)
        .replace(/[-–_.]+\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();

      // If price leads the block, use text after it as context
      if (desc.length < 5 && prices[0].end < block.length) {
        desc = block
          .slice(prices[0].end)
          .replace(/^[\s.,)(]+/, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);
      }

      desc = desc.slice(0, 120).trim();
      if (desc.length < 3 || SKIP_BLOCK.test(desc)) continue;

      const cat = guessCategory(desc);
      items.push({ description: desc, quantity: 1, unit: "flat", rate: prices[0].amount, amount: prices[0].amount, category: cat });
    } else {
      // Multiple prices in one block → split into separate items
      for (let i = 0; i < prices.length; i++) {
        const segStart = i === 0 ? 0 : prices[i - 1].end;
        let desc = block
          .slice(segStart, prices[i].start)
          .replace(/^[.,\s)(]+/, "")
          .replace(/[-–_.]+\s*$/, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);

        if (desc.length < 3 || SKIP_BLOCK.test(desc)) continue;

        const cat = guessCategory(desc);
        items.push({ description: desc, quantity: 1, unit: "flat", rate: prices[i].amount, amount: prices[i].amount, category: cat });
      }
    }
  }

  return items;
}

// ─── Main entry point ───────────────────────────────────────────────────────
export function parseDocumentText(rawText: string): ParsedDocument {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fullText = lines.join(" ");

  // Try table format first
  let lineItems = parseTableFormat(lines);

  // Fall back to narrative format if table mode found nothing
  if (lineItems.length === 0) {
    lineItems = parseNarrativeFormat(rawText);
  }

  // ── Due date ──
  let dueDate: string | undefined;
  const duePats: Array<[RegExp, "date" | "net"]> = [
    [/due\s*(?:date)?\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i, "date"],
    [/payment\s*due\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i, "date"],
    [/due\s*by\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i, "date"],
    [/net\s+(\d+)/i, "net"],
  ];
  for (const [pat, kind] of duePats) {
    const hit = fullText.match(pat);
    if (hit) {
      if (kind === "net") {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(hit[1]));
        dueDate = d.toISOString().split("T")[0];
      } else {
        const parts = hit[1].split(/[\/\-]/);
        if (parts.length === 3) {
          let [mo, dy, yr] = parts.map(Number);
          if (yr < 100) yr += 2000;
          const d = new Date(yr, mo - 1, dy);
          if (!isNaN(d.getTime())) dueDate = d.toISOString().split("T")[0];
        }
      }
      break;
    }
  }

  // ── Tax rate ──
  let taxRate: number | undefined;
  const taxHit = fullText.match(/(?:tax|gst|vat|hst)\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (taxHit) taxRate = parseFloat(taxHit[1]);

  // ── Notes ──
  let notes: string | undefined;
  const notesIdx = lines.findIndex((l) => /^notes?:?\s*$/i.test(l));
  if (notesIdx !== -1 && notesIdx < lines.length - 1) {
    notes = lines.slice(notesIdx + 1, Math.min(notesIdx + 5, lines.length)).join(" ").slice(0, 500);
  }

  const confidence: ParsedDocument["confidence"] =
    lineItems.length >= 3 ? "high" : lineItems.length >= 1 ? "medium" : "low";

  return { lineItems, dueDate, taxRate, notes, confidence };
}
