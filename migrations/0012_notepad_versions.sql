CREATE TABLE "notepad_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notepad_id" varchar NOT NULL,
	"content" text NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL,
	"saved_by" varchar
);
--> statement-breakpoint
ALTER TABLE "notepad_versions" ADD CONSTRAINT "notepad_versions_notepad_id_notepads_id_fk" FOREIGN KEY ("notepad_id") REFERENCES "public"."notepads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notepad_versions" ADD CONSTRAINT "notepad_versions_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notepad_versions_notepad_saved_idx" ON "notepad_versions" USING btree ("notepad_id","saved_at");