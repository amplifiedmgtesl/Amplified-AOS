-- Phase 3a: Add customers master table.
-- Seeded from distinct client names across all tables.
-- customer_id FKs added to child tables in a later migration once data is clean.

CREATE TABLE IF NOT EXISTS customers (
  id         text    PRIMARY KEY,
  name       text    NOT NULL,
  bill_to    text,
  email      text,
  phone      text,
  address    text,
  city       text,
  state      text,
  notes      text,
  is_active  boolean NOT NULL DEFAULT true
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_full_access" ON customers
  FOR ALL USING (true);

-- ─── Seed from distinct client names across all tables ────────────────────────
-- Uses md5 of lowercased trimmed name as a stable id so duplicates collapse.
INSERT INTO customers (id, name)
SELECT DISTINCT
  'cust-' || md5(lower(trim(client))),
  trim(client)
FROM (
  SELECT client FROM quotes            WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM invoices          WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM job_requests      WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM calendar_events   WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM job_sheets        WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM job_costing_drafts WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client_name AS client FROM rate_card_profiles WHERE client_name IS NOT NULL AND trim(client_name) <> ''
) t
ON CONFLICT (id) DO NOTHING;
