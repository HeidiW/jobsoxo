ALTER TABLE "clients" ADD COLUMN "additional_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recipient_emails" jsonb;