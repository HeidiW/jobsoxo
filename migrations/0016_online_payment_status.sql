ALTER TABLE "payments" ADD COLUMN "status" text DEFAULT 'succeeded' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_ref" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "payment_instructions" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_ref_unique" UNIQUE("provider_ref");