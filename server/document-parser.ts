export interface ParsedLineItem {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  category: "materials" | "labor" | "square_footage" | "other";
  section?: string;
}

export interface ParsedDocument {
  lineItems: ParsedLineItem[];
  dueDate?: string;
  taxRate?: number;
  notes?: string;
  confidence: "high" | "medium" | "low";
}

// ── Category guesser ──────────────────────────────────────────────────────────

function guessCategory(desc: string): ParsedLineItem["category"] {
  if (/sq\s*ft|square\s*foot|sqft|m2|square\s*meter/i.test(desc)) return "square_footage";
  if (/tape|roller|brush|drop\s*cloth|material|supply|supplies|sheet|board|timber|lumber|nail|screw|hardware|putty|filler|plaster|drywall|equipment|tool|gallon|litre|liter/i.test(desc)) return "materials";
  if (/paint|prime|primer|coat|labor|labour|work|hour|install|apply|prep|sand|finish|clean|strip|seal|repair|patch|decor|wallpaper|caulk|stain|skim|spray|rolled|satin|faux|beam|ceiling|wall|trim|door|floor|basetrim/i.test(desc)) return "labor";
  return "other";
}

// ── Text-cleaning helpers ────────────────────────────────────────────────────

// Plan spec codes (PT-01A, RCP-102, ID-202, etc.)
const PLAN_CODE_RE = /\b(PT-\d+[A-Z]?|RCP-?\d*|ID-\d+(?:[,\s\d]*\d)?)\b\.?/gi;
// Parenthetical plan references like (RCP, ID-102. Elevations ID-202,203)
const PAREN_REF_RE = /\s*[\(\[][^\)\]]{1,120}[\)\]]/g;
// Summary/skip keywords
const SKIP_RE = /^(total\b|sub[-\s]?total|grand\s*total|balance\s*due|amount\s*due|deposit\s*required|presented\s*to|breakdown\s*of|-- \d)/i;
// Section headers: lines that are entirely uppercase (or close to it) like "BASEMENT:" "WALLS AND TRIM."
const SECTION_HDR_RE = /^[A-Z][A-Z0-9\s\/&\-]{3,}[:.\s]*$/;

function cleanText(s: string): string {
  return s
    .replace(PAREN_REF_RE, "")           // remove parenthetical plan refs like (RCP, ID-102)
    .replace(/([a-zA-Z])(PT-\d+[A-Z]?)/g, "$1 $2")  // insert space before PT code when directly joined e.g. "wallsPT-01B"
    .replace(/\s*\/\s*(?=[A-Z\s]|$)/g, " ")   // clean lone slashes from "PT-01B/ PT-08" artifacts
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;()\-–_\/]+/, "")    // strip leading punctuation
    .replace(/[\-–_.,;()\/\s]+$/, "")    // strip trailing punctuation
    .trim();
}

function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4) return false;
  // Lines containing a dollar sign are price lines, not headers
  if (/\$/.test(trimmed)) return false;
  // Short plan/spec codes like "PT-01C." are never section headers
  if (/^[A-Z]{2,4}-\d+[A-Z]?\.?\s*$/.test(trimmed)) return false;
  // Skip summary keywords
  if (SKIP_RE.test(trimmed)) return false;
  // Count uppercase letters vs total alpha characters
  const alpha = trimmed.replace(/[^A-Za-z]/g, "");
  if (alpha.length === 0) return false;
  const upperRatio = (trimmed.match(/[A-Z]/g) || []).length / alpha.length;
  return upperRatio >= 0.85 && /^[A-Z]/.test(trimmed);
}

// ── Section name mapper ───────────────────────────────────────────────────────
// Maps raw ALL-CAPS section header text → Claude design section names

function mapSectionName(rawHeader: string): string {
  const h = rawHeader.toUpperCase().replace(/[:.\s]+$/, "").trim();
  if (/\bBASEMENT\b/.test(h)) return "Basement";
  if (/\bEXTERIOR\b/.test(h)) return "Exterior";
  if (/\bGROUND\s*FLOOR\b/.test(h)) return "Ground Floor - Ceilings";
  if (/\bWALLS?\s*(AND|&)\s*TRIM\b/.test(h)) return "Ground Floor - Walls & Trim";
  if (/\bFIRST\s*FLOOR\b/.test(h)) return "First Floor";
  if (/\bSECOND\s*FLOOR\b/.test(h)) return "Second Floor";
  if (/\bUPPER\s*FLOOR\b/.test(h)) return "Upper Floor";
  // Capitalise the raw header as a fallback
  return h.charAt(0) + h.slice(1).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Painting-quote line-accumulation parser ──────────────────────────────────
// Strategy: scan line by line, accumulating description text.
// Each time a $ amount is found, emit an item using the accumulated text.
// Handles multi-price lines (e.g. "walls $2,400. Trim $1,200.")

function parsePaintingQuote(rawText: string): ParsedLineItem[] {
  const PRICE_RE = /\$\s*([\d,]+(?:\.\d{0,2})?)/g;

  const lines = rawText
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, "")  // remove PDF page markers
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: ParsedLineItem[] = [];
  let accumLines: string[] = [];
  let pastPreamble = false;   // ignore company/address header before first section
  let currentSection = "";
  let lastRoom = "";           // last "RoomName" seen, used to prefix orphan items like "Ceiling PT-06 Red Flat"

  // Type-word prefixes that indicate an orphan item (no room prefix) that should inherit lastRoom
  const ROOM_TYPE_RE = /^(Ceiling|Trim|Walls?|Floor|Door|Window|Entry|Restroom|Vestibule|Corridor|Lobby|Stairway|Kitchen|Dining|Bar|Bathroom)\b/i;

  const emitItem = (descParts: string[], amount: number) => {
    const raw = descParts.join(" ");
    let desc = cleanText(raw).replace(/:$/, "").trim().slice(0, 160);
    if (desc.length < 3 || SKIP_RE.test(desc)) return;
    if (/^TOTAL\b/i.test(desc)) return;
    // Orphan items (no room colon) that start with a type-word inherit the last seen room
    if (lastRoom && !desc.includes(":") && ROOM_TYPE_RE.test(desc)) {
      desc = `${lastRoom}: ${desc}`.slice(0, 160);
    }
    // Update lastRoom whenever an item carries a "RoomName: ..." prefix
    const roomMatch = desc.match(/^([^:]{3,40}):/);
    if (roomMatch) lastRoom = roomMatch[1].trim();
    const cat = guessCategory(desc);
    items.push({ description: desc, quantity: 1, unit: "flat", rate: amount, amount, category: cat, section: currentSection || undefined });
  };

  // Matches a known section keyword at the START of a line that also contains a price,
  // e.g. "EXTERIOR: PT-08 Sprayed semi gloss $9,000."
  const INLINE_SECTION_RE = /^(BASEMENT|EXTERIOR|GROUND\s+FLOOR|WALLS?\s+(?:AND|&)\s+TRIM|FIRST\s+FLOOR|SECOND\s+FLOOR|UPPER\s+FLOOR)\s*:\s*/i;

  for (const line of lines) {
    // Pure section headers (no $ on the line) → update section & reset accumulation
    if (isSectionHeader(line)) {
      pastPreamble = true;
      accumLines = [];
      currentSection = mapSectionName(line);
      continue;
    }

    // Inline section prefix on a price line, e.g. "EXTERIOR: Sprayed semi gloss $9,000."
    // Strip the prefix so it doesn't bleed into item descriptions.
    const inlineMatch = line.match(INLINE_SECTION_RE);
    let activeLine = line;
    if (inlineMatch) {
      pastPreamble = true;
      accumLines = [];
      currentSection = mapSectionName(inlineMatch[1]);
      activeLine = line.slice(inlineMatch[0].length); // strip "EXTERIOR: " etc.
    }

    // Skip preamble (address, date, company name before first section)
    if (!pastPreamble) continue;

    // Skip summary totals
    if (SKIP_RE.test(activeLine)) {
      accumLines = [];
      continue;
    }

    // Find all $ amounts on this line
    const priceMatches: Array<{ amount: number; index: number; end: number }> = [];
    let pm: RegExpExecArray | null;
    const priceRe = new RegExp(PRICE_RE.source, "g");
    while ((pm = priceRe.exec(activeLine)) !== null) {
      const amount = parseFloat(pm[1].replace(/,/g, ""));
      if (!isNaN(amount) && amount >= 100) {
        priceMatches.push({ amount, index: pm.index, end: pm.index + pm[0].length });
      }
    }

    if (priceMatches.length === 0) {
      // If line ends with a lone "$" (no valid amount), it's an unpriced entry — skip entirely
      if (/\$\s*$/.test(activeLine)) {
        accumLines = [];
        continue;
      }
      // No prices — accumulate cleaned text
      const cleaned = cleanText(activeLine);
      // Skip room reference lines like "Bar 114.0. Dining 114.1. Epicrie 114.2"
      if (/\b\d{3}\.\d\b/.test(cleaned)) continue;
      // Skip single-word sub-headers like "Ceilings." "Walls." that follow a section header
      if (/^[A-Z][a-z]+\.?$/.test(cleaned)) continue;
      // Skip standalone plan/spec code lines like "PT-01C." or "PT-09. PT-01B."
      if (/^([A-Z]{2,4}-\d+[A-Z]?\.?\s*)+$/.test(cleaned)) continue;
      if (cleaned.length > 2 && !SKIP_RE.test(cleaned)) {
        accumLines.push(cleaned);
      }
      continue;
    }

    // One or more prices on this line
    let scanFrom = 0;
    for (let pi = 0; pi < priceMatches.length; pi++) {
      const { amount, index, end } = priceMatches[pi];

      // Text before this $ sign on the line
      const beforeDollar = cleanText(activeLine.slice(scanFrom, index));

      if (pi === 0) {
        // First price on line: combine previously accumulated lines + text before this $
        const descParts = [
          ...accumLines,
          ...(beforeDollar.length > 2 ? [beforeDollar] : []),
        ];
        emitItem(descParts, amount);
        accumLines = [];
      } else {
        // Subsequent prices on same line: use only text between previous price and this $
        if (beforeDollar.length > 2) {
          emitItem([beforeDollar], amount);
        }
      }

      scanFrom = end;
    }

    // Text remaining after the last price on this line → start next accumulation
    const remaining = cleanText(activeLine.slice(priceMatches[priceMatches.length - 1].end));
    accumLines = remaining.length > 2 ? [remaining] : [];
  }

  return items;
}

// ── Traditional table-format parser ─────────────────────────────────────────
// For invoices with "Description | Qty | Rate | Amount" columns.

const SKIP_LINE = /^(description|item\s*#?|qty|quantity|unit|rate|price|amount|total|subtotal|sub-?total|tax|gst|vat|hst|balance|invoice|date|number|bill\s*to|from|ship|company|address|phone|email|due|terms|notes?|payment|page|authoris|signature|thank)[\s:]*$/i;
const SUMMARY_LINE = /^(subtotal|sub-total|total\s*(due)?|grand\s*total|balance\s*due|amount\s*due|tax|gst|vat|hst|discount|deposit)\s*[-–:$\d(]/i;
const SEPARATOR = /^[-=_*#]{3,}$/;

function stripAmount(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, "")) || 0;
}

function parseTableFormat(lines: string[]): ParsedLineItem[] {
  const items: ParsedLineItem[] = [];
  const CURRENCY_RE = /\$?([\d,]+\.?\d{0,2})/g;

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

// ── Main entry point ──────────────────────────────────────────────────────────

export function parseDocumentText(rawText: string): ParsedDocument {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fullText = lines.join(" ");

  // 1. Try painting-quote line-accumulation parser (narrative quotes with $ prices)
  let lineItems = parsePaintingQuote(rawText);

  // 2. If that found nothing, try traditional table format
  if (lineItems.length === 0) {
    lineItems = parseTableFormat(lines);
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
