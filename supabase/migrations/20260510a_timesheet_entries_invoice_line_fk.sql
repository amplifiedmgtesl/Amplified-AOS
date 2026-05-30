-- Phase C invoice rewrite: timesheet → invoice line back-reference.
--
-- When an invoice is generated from timesheet actuals (Overwrite from
-- Timesheets), each contributing timesheet_entries row gets its
-- invoice_line_id pointer set to the aggregated line it landed on. This
-- prevents double-billing — the import filters out entries already pointing
-- at a non-superseded/non-void invoice line.
--
-- ON DELETE SET NULL: when a draft invoice line gets deleted (drafts can
-- delete-and-recreate freely), the entry's pointer clears so it becomes
-- available again. Frozen lines can't be deleted (freeze trigger blocks),
-- so pointers on issued invoices are stable.
--
-- Replaces invoice_lines.source_timesheet_entry_id (singular) which couldn't
-- represent the many-to-one aggregation pattern.
--
-- Companion: docs/invoice-rewrite-plan.md

ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS invoice_line_id text REFERENCES invoice_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS timesheet_entries_invoice_line_idx
  ON timesheet_entries(invoice_line_id)
  WHERE invoice_line_id IS NOT NULL;

-- Drop the unused per-line FK from migration 20260506c. Reversing the
-- direction (FK lives on timesheet_entries instead) is cleaner since each
-- entry can only be billed once.
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS source_timesheet_entry_id;
