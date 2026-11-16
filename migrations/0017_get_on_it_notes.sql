CREATE TABLE "note_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" varchar NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp,
	"done_by" varchar,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar,
	"archived_at" timestamp,
	"archived_by" varchar
);
--> statement-breakpoint
ALTER TABLE "note_items" ADD CONSTRAINT "note_items_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_items" ADD CONSTRAINT "note_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_items" ADD CONSTRAINT "note_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_items_note_position_idx" ON "note_items" USING btree ("note_id","position");--> statement-breakpoint
CREATE INDEX "notes_archived_idx" ON "notes" USING btree ("archived_at");
--> statement-breakpoint
-- Carry the old free-text notepad over: the current page becomes the current
-- note (one item per line; a line starting "[x]" is already done), and every
-- saved earlier version becomes an archived note, so nothing anyone wrote is lost.
INSERT INTO "notes" ("id", "created_at", "created_by")
SELECT gen_random_uuid(), "updated_at", "updated_by" FROM "notepads" WHERE "id" = 'get-on-it' AND btrim("content") <> '';
--> statement-breakpoint
INSERT INTO "note_items" ("note_id", "text", "done", "done_at", "position", "created_at", "created_by")
SELECT n."id",
       regexp_replace(regexp_replace(l.line, '^\s*(\[[xX ]\]|[-*•])\s*', ''), '\s+$', ''),
       l.line ~ '^\s*\[[xX]\]',
       CASE WHEN l.line ~ '^\s*\[[xX]\]' THEN p."updated_at" END,
       l.ord - 1, p."updated_at", p."updated_by"
FROM "notepads" p
JOIN "notes" n ON n."archived_at" IS NULL
CROSS JOIN LATERAL regexp_split_to_table(p."content", E'\r?\n') WITH ORDINALITY AS l(line, ord)
WHERE p."id" = 'get-on-it' AND btrim(regexp_replace(l.line, '^\s*(\[[xX ]\]|[-*•])\s*', '')) <> '';
--> statement-breakpoint
INSERT INTO "notes" ("id", "title", "created_at", "created_by", "archived_at", "archived_by")
SELECT v."id", 'Earlier version', v."saved_at", v."saved_by", v."saved_at", v."saved_by"
FROM "notepad_versions" v WHERE btrim(v."content") <> '';
--> statement-breakpoint
INSERT INTO "note_items" ("note_id", "text", "done", "done_at", "position", "created_at", "created_by")
SELECT v."id",
       regexp_replace(regexp_replace(l.line, '^\s*(\[[xX ]\]|[-*•])\s*', ''), '\s+$', ''),
       l.line ~ '^\s*\[[xX]\]',
       CASE WHEN l.line ~ '^\s*\[[xX]\]' THEN v."saved_at" END,
       l.ord - 1, v."saved_at", v."saved_by"
FROM "notepad_versions" v
CROSS JOIN LATERAL regexp_split_to_table(v."content", E'\r?\n') WITH ORDINALITY AS l(line, ord)
WHERE btrim(v."content") <> '' AND btrim(regexp_replace(l.line, '^\s*(\[[xX ]\]|[-*•])\s*', '')) <> '';
