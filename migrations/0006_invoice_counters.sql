CREATE TABLE "invoice_counters" (
	"scope" text NOT NULL,
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "invoice_counters_scope_series_year_pk" PRIMARY KEY("scope","series","year")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "invoice_next_number" integer;