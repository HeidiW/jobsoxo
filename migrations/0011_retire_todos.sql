-- "Get on it" became a free-form notepad. Carry any open to-dos over as
-- lines on the notepad before the to-do table goes.
INSERT INTO "notepads" ("id", "content", "updated_at")
SELECT 'get-on-it',
       string_agg('- ' || "text", E'\n' ORDER BY "due_date" NULLS LAST, "created_at"),
       now()
FROM "todos"
WHERE "done" = false
HAVING count(*) > 0
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DROP TABLE "todos" CASCADE;
