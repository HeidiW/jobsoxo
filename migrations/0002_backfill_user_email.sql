-- First-time setup used to save an email-style username without filling in
-- the email column, so password reset had nowhere to send. Copy such usernames
-- into email where it's empty. Leaves every other row unchanged.
UPDATE "users"
SET "email" = btrim("username")
WHERE ("email" IS NULL OR btrim("email") = '')
  AND btrim("username") ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
