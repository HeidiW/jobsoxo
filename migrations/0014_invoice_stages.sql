ALTER TABLE "invoices" ADD COLUMN "stage" text DEFAULT 'standalone' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stage_basis" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_scope" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contract_total" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "previously_invoiced" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "previously_paid" numeric(10, 2);