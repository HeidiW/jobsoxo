// The invoice assistant: a Claude-backed helper that chats inside the invoice
// builder. It reads the live invoice, answers questions about pricing,
// wording and structure, and proposes concrete changes through one tool; the
// person applies or dismisses each proposal in the panel, so the model never
// edits the invoice directly.
import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import type { Settings } from "@shared/schema";
import {
  INVOICE_PROPOSAL_JSON_SCHEMA, invoiceProposalSchema,
  type AssistantHistory, type InvoiceSnapshot,
} from "@shared/invoice-assistant";
import { businessDay } from "./business-time";

export const INVOICE_ASSISTANT_MODEL = "claude-opus-5-5";
export const PROPOSAL_TOOL_NAME = "propose_invoice_changes";

// The SDK resolves credentials itself: an API key, an auth token, or OIDC
// workload identity federation (how Render connects). This mirrors its
// federation trigger so the panel only says "not set up" when none is present.
export function invoiceAssistantConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return true;
  return !!(env.ANTHROPIC_FEDERATION_RULE_ID && env.ANTHROPIC_ORGANIZATION_ID
    && (env.ANTHROPIC_IDENTITY_TOKEN_FILE || env.ANTHROPIC_IDENTITY_TOKEN));
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

// Everything that stays the same across turns lives in the system prompt so
// it caches; the invoice snapshot changes every turn and rides along with the
// user's message instead.
export function buildSystemPrompt(settings: Settings | undefined): string {
  const company = settings?.companyName?.trim() || "this painting and decorating business";
  const terms = settings?.invoiceTerms?.trim();
  return [
    `You are the invoice assistant inside JobsOxo, helping ${company} write a clear, professional invoice. The people you help are painters, decorators and plasterers, not accountants or software users: use plain language, keep answers short, and skip jargon.`,
    "",
    "You can see the invoice as it stands right now in each message. Use it: refer to the client, job and line items by name, point out what's missing (no line items, a vague description, a rate that looks like a typo, no due date), and answer questions about how to structure or word things.",
    "",
    `When the person asks you to add, change or write something on the invoice, use the ${PROPOSAL_TOOL_NAME} tool rather than describing the change in text. The tool only proposes; the person reviews and applies it. Put the whole change in one tool call, and keep the written reply to a sentence or two about what you proposed and why. Pass null for every field you are not changing. Line item descriptions should say what work was done, where, and what it included (prep, coats, materials), the way a good trade invoice does.`,
    "",
    "Rules: never invent prices or quantities the person hasn't given you or that aren't already on the invoice — ask instead, or leave the rate at 0 and say so. Don't give tax or legal advice; for sales tax say to check the local rule. Don't mark work complete, send the invoice, or touch payments; those are the person's actions. If asked for something outside invoicing, say briefly that you only help with the invoice.",
    "",
    `Units available: lump (lump sum), flat (flat rate), hours, sqft, each, day. Categories: materials, labor, square_footage, other.`,
    terms ? `The company's usual payment terms: ${terms}` : "",
  ].filter((line) => line !== null).join("\n");
}

export function describeInvoice(invoice: InvoiceSnapshot): string {
  const money = (n: number) => `$${n.toFixed(2)}`;
  const items = invoice.lineItems.length === 0
    ? "  (no line items yet)"
    : invoice.lineItems.map((item, i) =>
      `  ${i + 1}. [${item.section || "General"}] ${item.description || "(no description)"} — ${item.quantity} ${item.unit} × ${money(item.rate)} = ${money(item.amount)} (${item.category}, ${item.status || "pending"})`,
    ).join("\n");
  const subtotal = invoice.lineItems.reduce((sum, item) => sum + item.amount, 0);
  return [
    `Today (business day): ${businessDay()}`,
    `Invoice: ${invoice.invoiceNumber || "(not numbered yet)"}`,
    `Client: ${invoice.clientName || "(none chosen)"}`,
    `Job: ${invoice.jobName || "(none)"}`,
    `Issue date: ${invoice.issueDate || "(none)"} · Due date: ${invoice.dueDate || "(none)"}`,
    `Tax rate: ${invoice.taxRate || "0"}%`,
    `Line items (subtotal ${money(subtotal)}):`,
    items,
    `Notes: ${invoice.notes?.trim() || "(none)"}`,
    `Terms: ${invoice.termsAndConditions?.trim() || "(none)"}`,
  ].join("\n");
}

export const proposalTool: Anthropic.Tool = {
  name: PROPOSAL_TOOL_NAME,
  description: "Propose changes to the invoice being built: add line items, or replace the notes, payment terms, due date or tax rate. The person reviews the proposal and applies or dismisses it.",
  strict: true,
  input_schema: INVOICE_PROPOSAL_JSON_SCHEMA as unknown as Anthropic.Tool["input_schema"],
};

/** Builds the request messages: history as the browser kept it, with the live invoice attached to the last user turn. */
export function buildMessages(history: AssistantHistory, invoice: InvoiceSnapshot): Anthropic.MessageParam[] {
  const messages = history.map((message) => ({ role: message.role, content: [...message.content] })) as Anthropic.MessageParam[];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !Array.isArray(last.content)) {
    throw new Error("The conversation must end with the person's message");
  }
  last.content = [
    ...last.content,
    { type: "text", text: `<current_invoice>\n${describeInvoice(invoice)}\n</current_invoice>` },
  ];
  return messages;
}

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; id: string; input: unknown }
  | { type: "done"; content: Anthropic.ContentBlock[]; stopReason: string | null }
  | { type: "error"; message: string };

/** Runs one assistant turn, streaming events to `emit`. Resolves when the turn is complete. */
export async function runAssistantTurn(
  args: { history: AssistantHistory; invoice: InvoiceSnapshot; settings: Settings | undefined },
  emit: (event: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const stream = getClient().messages.stream({
    model: INVOICE_ASSISTANT_MODEL,
    max_tokens: 4096, // chat replies are deliberately short; proposals are small
    output_config: { effort: "low" },
    system: [{ type: "text", text: buildSystemPrompt(args.settings), cache_control: { type: "ephemeral" } }],
    tools: [proposalTool],
    messages: buildMessages(args.history, args.invoice),
  }, { signal });

  stream.on("text", (text) => emit({ type: "text", text }));
  const message = await stream.finalMessage();

  // Strip blocks the browser can't use (thinking) and surface each proposal
  // once it has been validated against the shared schema.
  const content = message.content.filter((block) => block.type === "text" || block.type === "tool_use");
  for (const block of content) {
    if (block.type !== "tool_use" || block.name !== PROPOSAL_TOOL_NAME) continue;
    const parsed = invoiceProposalSchema.safeParse(block.input);
    if (parsed.success) emit({ type: "proposal", id: block.id, input: parsed.data });
  }
  if (message.stop_reason === "refusal") {
    emit({ type: "text", text: "I can't help with that one. I'm here for the invoice — ask me about line items, wording, dates or totals." });
  }
  emit({ type: "done", content, stopReason: message.stop_reason });
}

/** Server-sent events plumbing for the route. */
export function startEventStream(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  return {
    send(event: AssistantEvent) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      res.end();
    },
  };
}

export function assistantErrorMessage(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "The assistant isn't set up correctly (invalid API key).";
  if (error instanceof Anthropic.RateLimitError) return "The assistant is busy right now. Try again in a moment.";
  if (error instanceof Anthropic.APIConnectionError) return "Couldn't reach the assistant. Check your connection and try again.";
  if (error instanceof Anthropic.APIError) return "The assistant hit a problem. Try again.";
  return "Something went wrong. Try again.";
}
