// Proofreads invoice wording with Claude before an invoice is saved or sent.
// It returns exact, minimal corrections (spelling, punctuation,
// capitalization) and leaves trade terms, brands and names alone; the person
// fixes or keeps each one in the builder.
import Anthropic from "@anthropic-ai/sdk";
import type { Settings } from "@shared/schema";
import { PROOFREAD_RESULT_JSON_SCHEMA, proofreadResultSchema, usableIssues, type ProofreadField, type ProofreadIssue } from "@shared/invoice-proofread";

export const PROOFREAD_MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function buildProofreadSystemPrompt(settings: Settings | undefined): string {
  const company = settings?.companyName?.trim();
  return [
    "You proofread the wording on invoices for a painting, decorating and plastering business in the US. Each field you receive will be printed on the invoice the client sees.",
    "",
    "Report only definite errors a careful reader would call wrong: misspelled everyday words, wrong or missing punctuation, a sentence or item that doesn't start with a capital letter, doubled words, and clear grammar slips. Fix each with the smallest change that corrects it.",
    "",
    "Do not report: trade terms and materials (eggshell, skim coat, drywall, primer, caulk, cut-in), brand and product names, people's and company names, street addresses, abbreviations and units (sq ft, LF, hrs, ea), product codes and color codes, numbers and prices, intentional fragments on line items (\"Prep and two coats, living room\" is fine without a period), or anything on the keep list. Never change meaning, tone or wording for style, and never add words beyond what the fix needs.",
    "",
    "For each issue give the field id, the exact original text as it appears in that field (copy it character for character, including capitalization), the corrected text, the kind, and a note of a few plain words. If nothing is wrong, return an empty list.",
    company ? `The business is ${company}; treat that name as correct.` : "",
  ].join("\n");
}

export function describeFields(fields: ProofreadField[], ignore: string[]): string {
  const lines = fields.map((field) => `<field id="${field.id}" label="${field.label}">${field.text}</field>`);
  const keep = ignore.length > 0 ? `\n\nKeep list (never flag these): ${ignore.map((word) => JSON.stringify(word)).join(", ")}` : "";
  return `Proofread these invoice fields.\n\n${lines.join("\n")}${keep}`;
}

export async function proofreadFields(
  fields: ProofreadField[],
  ignore: string[],
  settings: Settings | undefined,
): Promise<ProofreadIssue[]> {
  const nonEmpty = fields.filter((field) => field.text.trim() !== "");
  if (nonEmpty.length === 0) return [];
  const response = await getClient().messages.create({
    model: PROOFREAD_MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: { type: "json_schema", schema: PROOFREAD_RESULT_JSON_SCHEMA } },
    system: [{ type: "text", text: buildProofreadSystemPrompt(settings), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: describeFields(nonEmpty, ignore) }],
  });
  if (response.stop_reason === "refusal") return [];
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  const parsed = proofreadResultSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    console.error("Invoice proofread: unusable model output", parsed.error.issues);
    return [];
  }
  return usableIssues(parsed.data.issues, nonEmpty, ignore);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}


export function proofreadErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "The proofreader isn't set up correctly (invalid API key).";
  if (error instanceof Anthropic.RateLimitError) return "The proofreader is busy right now. Try again in a moment.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the proofreader. Check your connection and try again.";
  return "The proofreader hit a problem. Try again.";
}
