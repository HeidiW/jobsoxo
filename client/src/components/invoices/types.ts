import type { Client, Invoice, Job } from "@shared/schema";

export interface InvoiceWithRelations extends Invoice {
  client: Client;
  job?: Job;
  paymentDate?: Date;
  /** Line item work status counts, from the list endpoint. */
  workProgress?: { pending: number; in_progress: number; completed: number; total: number };
  /** Latest client email about this invoice and what happened to it. */
  lastEmail?: { kind: string; status: string; detail: string | null; createdAt: string } | null;
}

export interface CollectionsEntry {
  id: string;
  invoiceNumber: string;
  status: string;
  balance: string;
  dueDate: string;
  lastReminderSent: string | null;
  reminderCount: number;
  remindersPaused: boolean;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  jobTitle: string | null;
  daysOverdue: number;
  currentStage: number;
  nextActionDate: string | null;
}
