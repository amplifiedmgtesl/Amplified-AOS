-- Phase 3: Add clients master table (supersedes 20260419e/f which were never run).
-- Seeded from distinct client names across all tables.
-- client_id FKs added to child tables in a later migration once data is clean.

CREATE TABLE IF NOT EXISTS clients (
  id           text    PRIMARY KEY,
  name         text    NOT NULL,
  contact_name text,
  bill_to      text,
  email        text,
  phone        text,
  address      text,
  city         text,
  state        text,
  zip          text,
  notes        text,
  is_active    boolean NOT NULL DEFAULT true
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_full_access" ON clients
  FOR ALL USING (true);

-- ─── Seed from distinct client names across all tables ────────────────────────
-- Uses md5 of lowercased trimmed name as a stable id so duplicates collapse.
INSERT INTO clients (id, name)
SELECT DISTINCT
  'clt-' || md5(lower(trim(client))),
  trim(client)
FROM (
  SELECT client FROM quotes              WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM invoices            WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM job_requests        WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM calendar_events     WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM job_sheets          WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client FROM job_costing_drafts  WHERE client IS NOT NULL AND trim(client) <> ''
  UNION
  SELECT client_name AS client FROM rate_card_profiles WHERE client_name IS NOT NULL AND trim(client_name) <> ''
) t
ON CONFLICT (id) DO NOTHING;
