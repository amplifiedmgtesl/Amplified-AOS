-- Phase C invoice rewrite — Migration 2: invoice_lines source discriminator.
--
-- Each invoice line tracks where its content came from:
--   'quote_line'        — copied from a quote_lines row at draft creation
--   'timesheet_entry'   — pulled from approved timesheet entries (Phase F)
--   'manual_override'   — user-edited or hand-added on the draft
--
-- Plus source FKs for re-billing prevention. Generating a new final invoice
-- excludes any quote_lines or timesheet_entries already on a non-superseded
-- invoice for the same job — structurally prevents double-billing.
--
-- Companion: docs/invoice-rewrite-plan.md

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS source_kind text;

ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_source_kind_check;
ALTER TABLE invoice_lines ADD  CONSTRAINT invoice_lines_source_kind_check
  CHECK (source_kind IS NULL OR source_kind IN ('quote_line','timesheet_entry','manual_override'));

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS source_quote_line_id      text REFERENCES quote_lines(id);
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS source_timesheet_entry_id text REFERENCES timesheet_entries(id);

CREATE INDEX IF NOT EXISTS invoice_lines_source_quote_line_idx
  ON invoice_lines(source_quote_line_id) WHERE source_quote_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoice_lines_source_timesheet_idx
  ON invoice_lines(source_timesheet_entry_id) WHERE source_timesheet_entry_id IS NOT NULL;

-- Existing legacy invoice_lines have NULL source_kind — they predate the new
-- model. Display code treats NULL as 'quote_line' for safety, but no backfill
-- attempted (we'd have to guess which quote_line was the source).
