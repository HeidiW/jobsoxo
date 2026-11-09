-- Invoices were marked "paid" whenever their balance reached $0, including
-- $0 drafts with no payments, which locked them. Put those back to draft.
-- Invoices with any recorded payment are left alone.
UPDATE "invoices"
SET "status" = 'draft'
WHERE "status" IN ('paid', 'partial')
  AND COALESCE("amount_paid", 0) <= 0
  AND NOT EXISTS (SELECT 1 FROM "payments" WHERE "payments"."invoice_id" = "invoices"."id");
