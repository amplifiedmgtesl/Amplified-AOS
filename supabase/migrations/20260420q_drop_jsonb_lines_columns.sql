-- Drop the legacy JSONB lines columns on quotes and invoices.
-- All line data has been normalized into quote_lines and invoice_lines
-- tables, and the corresponding JSONB snapshots are preserved in
-- snapshot_20260420_quotes_lines_jsonb / snapshot_20260420_invoices_lines_jsonb.

ALTER TABLE quotes   DROP COLUMN IF EXISTS lines;
ALTER TABLE invoices DROP COLUMN IF EXISTS lines;
