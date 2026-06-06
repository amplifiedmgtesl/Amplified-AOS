-- Backfill of the columns that commit 86ecfe3 added directly to prod
-- (via the Supabase SQL editor during the May-30 Connor recovery push)
-- without a matching migration file. Captured here so future fresh
-- deployments include them and so the migrations folder reflects the
-- actual prod schema.
--
-- See commit 86ecfe3: "Backfill invoice_no to AES spec format + preserve
-- legacy refs" — TS changes were committed, the ALTERs were not.
--
-- Columns:
--   quotes.legacy_quote_no       — pre-canonical customer-facing reference
--   invoices.legacy_invoice_no   — same, on the invoice side
--
-- Both nullable text. Used by the detail screens to display a
-- "Legacy reference: ..." line when the legacy ID differs from the
-- current canonical AES_* format.

ALTER TABLE public.quotes   ADD COLUMN IF NOT EXISTS legacy_quote_no   text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS legacy_invoice_no text;
