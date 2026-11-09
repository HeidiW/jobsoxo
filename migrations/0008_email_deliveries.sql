CREATE TABLE "email_deliveries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"kind" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"provider_id" text,
	"status" text NOT NULL,
	"detail" text,
	"provider_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_checked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_invoice_idx" ON "email_deliveries" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_provider_idx" ON "email_deliveries" USING btree ("provider_id");