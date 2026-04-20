-- Add RLS + full-access policies to quote_lines and invoice_lines.
-- Without these, browser Supabase queries silently return empty and the app
-- falls back to the legacy JSONB blob on the parent invoice/quote.

ALTER TABLE quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_lines_full_access" ON quote_lines FOR ALL USING (true);
CREATE POLICY "invoice_lines_full_access" ON invoice_lines FOR ALL USING (true);
