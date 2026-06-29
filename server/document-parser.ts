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
  if (/paint|prime|primer|coat|labor|labour|work|hour|install|apply|prep|sand|finish|clean|strip|seal|repair|patch|decor|wallpaper|caulk|stain/i.test(desc)) return "labor";
  return "other";
}

function defaultUnit(cat: ParsedLineItem["category"]): string {
  if (cat === "labor") return "hours";
  if (cat === "square_footage") return "sqft";
  return "each";
}

function stripCurrency(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, "")) || 0;
}

const SKIP_LINE = /^(description|item\s*#?|qty|quantity|unit|rate|price|amount|total|subtotal|sub-?total|tax|gst|vat|hst|balance|invoice|date|number|bill\s*to|from|ship|company|address|phone|email|due|terms|notes?|payment|page|authoris|signature|thank)[\s:]*$/i;
const SUMMARY_LINE = /^(subtotal|sub-total|total\s*(due)?|grand\s*total|balance\s*due|amount\s*due|tax|gst|vat|hst|discount)\s*[:$\d]/i;
const SEPARATOR = /^[-=_*#]{3,}$/;
const CURRENCY_RE = /\$?([\d,]+\.?\d{0,2})/g;

export function parseDocumentText(rawText: string): ParsedDocument {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fullText = lines.join(" ");
  const lineItems: ParsedLineItem[] = [];

  for (const line of lines) {
    if (SKIP_LINE.test(line) || SEPARATOR.test(line) || SUMMARY_LINE.test(line)) continue;

    const amounts: number[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(CURRENCY_RE.source, "g");
    while ((m = re.exec(line)) !== null) {
      const v = stripCurrency(m[1]);
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
      if (a > 0 && b > 0 && Math.abs(a * b - total) < 0.02) {
        qty = a;
        rate = b;
      }
    } else if (amounts.length === 2) {
      const a = amounts[0];
      if (a > 0 && a !== total && total > 0) {
        const ratio = total / a;
        if (ratio >= 1 && ratio <= 1000 && Math.abs(ratio - Math.round(ratio)) < 0.01) {
          qty = Math.round(ratio);
          rate = a;
        } else {
          rate = total;
        }
      }
    }

    const cat = guessCategory(desc);
    lineItems.push({
      description: desc,
      quantity: parseFloat(qty.toFixed(2)),
      unit: defaultUnit(cat),
      rate: parseFloat(rate.toFixed(2)),
      amount: parseFloat(total.toFixed(2)),
      category: cat,
    });
  }

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

  let taxRate: number | undefined;
  const taxHit = fullText.match(/(?:tax|gst|vat|hst)\s*:?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (taxHit) taxRate = parseFloat(taxHit[1]);

  let notes: string | undefined;
  const notesIdx = lines.findIndex((l) => /^notes?:?\s*$/i.test(l));
  if (notesIdx !== -1 && notesIdx < lines.length - 1) {
    notes = lines.slice(notesIdx + 1, Math.min(notesIdx + 5, lines.length)).join(" ").slice(0, 500);
  }

  const confidence: ParsedDocument["confidence"] =
    lineItems.length >= 3 ? "high" : lineItems.length >= 1 ? "medium" : "low";

  return { lineItems, dueDate, taxRate, notes, confidence };
}
