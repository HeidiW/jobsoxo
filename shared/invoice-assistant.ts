// Shapes shared by the invoice assistant route and the builder's chat panel.
import { z } from "zod";

export const INVOICE_ASSISTANT_UNITS = ["lump", "flat", "hours", "sqft", "each", "day"] as const;
export const INVOICE_ASSISTANT_CATEGORIES = ["materials", "labor", "square_footage", "other"] as const;

/** What the builder currently holds; sent with every message so the assistant sees the live invoice. */
export const invoiceSnapshotSchema = z.object({
  invoiceNumber: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  jobName: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  taxRate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  termsAndConditions: z.string().nullable().optional(),
  lineItems: z.array(z.object({
    section: z.string().nullable().optional(),
    category: z.string(),
    description: z.string(),
    quantity: z.number(),
    unit: z.string(),
    rate: z.number(),
    amount: z.number(),
    status: z.string().nullable().optional(),
  })).max(500),
});
export type InvoiceSnapshot = z.infer<typeof invoiceSnapshotSchema>;

/** Changes the assistant proposes; the user applies or dismisses them in the panel. */
export const proposedLineItemSchema = z.object({
  section: z.string().nullable(),
  category: z.enum(INVOICE_ASSISTANT_CATEGORIES),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.enum(INVOICE_ASSISTANT_UNITS),
  rate: z.number().min(0),
});
export const invoiceProposalSchema = z.object({
  summary: z.string().min(1),
  lineItems: z.array(proposedLineItemSchema).nullable(),
  notes: z.string().nullable(),
  termsAndConditions: z.string().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  taxRate: z.number().min(0).max(100).nullable(),
});
export type InvoiceProposal = z.infer<typeof invoiceProposalSchema>;
export type ProposedLineItem = z.infer<typeof proposedLineItemSchema>;

/** JSON Schema for the tool, kept in step with invoiceProposalSchema (strict: every property required, nullable when optional). */
export const INVOICE_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One sentence, in plain words, saying what this change does." },
    lineItems: {
      type: ["array", "null"],
      description: "Line items to add to the invoice. Null when not adding any.",
      items: {
        type: "object",
        properties: {
          section: { type: ["string", "null"], description: "Section heading, e.g. a room or floor. Null for the general section." },
          category: { type: "string", enum: [...INVOICE_ASSISTANT_CATEGORIES] },
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string", enum: [...INVOICE_ASSISTANT_UNITS] },
          rate: { type: "number", description: "Price per unit in dollars." },
        },
        required: ["section", "category", "description", "quantity", "unit", "rate"],
        additionalProperties: false,
      },
    },
    notes: { type: ["string", "null"], description: "Replacement text for the invoice notes, or null to leave them." },
    termsAndConditions: { type: ["string", "null"], description: "Replacement payment terms, or null to leave them." },
    dueDate: { type: ["string", "null"], description: "New due date as YYYY-MM-DD, or null to leave it." },
    taxRate: { type: ["number", "null"], description: "New tax rate as a percentage, or null to leave it." },
  },
  required: ["summary", "lineItems", "notes", "termsAndConditions", "dueDate", "taxRate"],
  additionalProperties: false,
} as const;

/** Conversation history as the browser keeps it: the API's own block shapes, minus anything we don't use. */
const textBlock = z.object({ type: z.literal("text"), text: z.string() });
const toolUseBlock = z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() });
const toolResultBlock = z.object({ type: z.literal("tool_result"), tool_use_id: z.string(), content: z.string() });

export const assistantHistorySchema = z.array(z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.array(z.union([textBlock, toolResultBlock])).min(1) }),
  z.object({ role: z.literal("assistant"), content: z.array(z.union([textBlock, toolUseBlock])).min(1) }),
])).max(60);
export type AssistantHistory = z.infer<typeof assistantHistorySchema>;

export const invoiceAssistantRequestSchema = z.object({
  messages: assistantHistorySchema,
  invoice: invoiceSnapshotSchema,
});
