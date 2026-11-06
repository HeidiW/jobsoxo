import type { Client, Invoice, Job } from "@shared/schema";

export interface InvoiceWithRelations extends Invoice {
  client: Client;
  job?: Job;
  paymentDate?: Date;
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
