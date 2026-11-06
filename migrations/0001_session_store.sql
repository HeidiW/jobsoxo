-- IF NOT EXISTS: a Replit database may already have this table from db:push.
CREATE TABLE IF NOT EXISTS "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" USING btree ("expire");