// Text checks for invoice wording: deterministic tidying that runs as fields
// are left, and the shapes for the proofread pass that gates Send.
import { z } from "zod";

/** Mechanical cleanup that is always safe to apply without asking. */
export function tidyText(text: string): string {
  let out = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+([,.;:!?])/g, "$1")      // "coats , two" → "coats, two"
    .replace(/([,;:])(?=[A-Za-z])/g, "$1 ") // "walls,ceiling" → "walls, ceiling"
    .replace(/,{2,}/g, ",")
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/\.{4,}/g, "...")
    .replace(/(?<!\.)\.\.(?!\.)/g, ".");
  if (out && /[a-z]/.test(out[0])) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

export const PROOFREAD_ISSUE_KINDS = ["spelling", "punctuation", "capitalization", "grammar"] as const;
export type ProofreadIssueKind = (typeof PROOFREAD_ISSUE_KINDS)[number];

export const proofreadFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  text: z.string(),
});
export type ProofreadField = z.infer<typeof proofreadFieldSchema>;

export const proofreadIssueSchema = z.object({
  fieldId: z.string(),
  kind: z.enum(PROOFREAD_ISSUE_KINDS),
  /** Exact text as it appears in the field. */
  original: z.string().min(1),
  replacement: z.string(),
  /** One short plain-words reason, e.g. "Misspelled". */
  note: z.string(),
});
export type ProofreadIssue = z.infer<typeof proofreadIssueSchema>;

export const proofreadResultSchema = z.object({ issues: z.array(proofreadIssueSchema) });

/** JSON Schema handed to the model as its output format; kept in step with proofreadResultSchema. */
export const PROOFREAD_RESULT_JSON_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fieldId: { type: "string", description: "The id attribute of the field the issue is in." },
          kind: { type: "string", enum: [...PROOFREAD_ISSUE_KINDS] },
          original: { type: "string", description: "The exact text as it appears in the field, character for character." },
          replacement: { type: "string", description: "The corrected text; empty to remove the original." },
          note: { type: "string", description: "A few plain words on what was wrong." },
        },
        required: ["fieldId", "kind", "original", "replacement", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
} as const;

export const proofreadRequestSchema = z.object({
  fields: z.array(proofreadFieldSchema).max(600),
  /** Words or phrases the person chose to keep as written; never flag them again. */
  ignore: z.array(z.string()).max(500).default([]),
});

/** Keeps only issues that can actually be applied to the text they refer to. */
export function usableIssues(issues: ProofreadIssue[], fields: ProofreadField[], ignore: string[]): ProofreadIssue[] {
  const byId = new Map(fields.map((field) => [field.id, field.text]));
  const kept = new Set(ignore.map((word) => word.trim().toLowerCase()));
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const text = byId.get(issue.fieldId);
    if (text === undefined || !text.includes(issue.original) || issue.original === issue.replacement) return false;
    if (kept.has(issue.original.trim().toLowerCase())) return false;
    const key = `${issue.fieldId}\u0000${issue.original}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyIssue(text: string, issue: ProofreadIssue): string {
  return text.replace(issue.original, issue.replacement);
}
