-- Delete-protection FK hardening pass.
--
-- Per the project rule "records can't be deleted if they're referenced
-- elsewhere" (see memory: feedback_normalization_delete_protection.md).
-- An audit found six "fake FK" text columns that should be real foreign
-- keys with ON DELETE RESTRICT, so the database rejects any attempt to
-- hard-delete a still-referenced parent row.
--
-- The columns being constrained:
--   1. job_requests.client_id        → clients(id)
--   2. invoices.client_id            → clients(id)
--   3. rate_card_profiles.client_id  → clients(id)
--   4. quote_lines.specialty_id      → specialties(id)
--   5. invoice_lines.position_id     → positions(id)
--   6. invoice_lines.specialty_id    → specialties(id)
--
-- Each gets ON DELETE RESTRICT (the default NO ACTION is functionally
-- equivalent — both block the delete — but RESTRICT is checked at
-- statement time and produces a clearer error message). For the line-
-- table lookup FKs we accept NULL freely (legacy rows have no id).
--
-- Pre-flight: the ALTER TABLE ADD CONSTRAINT calls fail noisily if
-- any orphan values exist. Each section first reports the orphan count
-- via RAISE NOTICE so the operator sees the problem before the abort.
-- If a section reports orphans, fix the data, then re-run.
--
-- Companion: feedback_normalization_delete_protection.md (memory)

-- ─── 1. job_requests.client_id → clients ─────────────────────────────────────
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM job_requests jr
  WHERE jr.client_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = jr.client_id);
  IF orphan_count > 0 THEN
    RAISE NOTICE 'job_requests.client_id orphans: %', orphan_count;
  END IF;
END $$;

ALTER TABLE job_requests
  DROP CONSTRAINT IF EXISTS job_requests_client_id_fkey;
ALTER TABLE job_requests
  ADD  CONSTRAINT job_requests_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT;

-- ─── 2. invoices.client_id → clients ─────────────────────────────────────────
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM invoices i
  WHERE i.client_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = i.client_id);
  IF orphan_count > 0 THEN
    RAISE NOTICE 'invoices.client_id orphans: %', orphan_count;
  END IF;
END $$;

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_client_id_fkey;
ALTER TABLE invoices
  ADD  CONSTRAINT invoices_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT;

-- ─── 3. rate_card_profiles.client_id → clients ───────────────────────────────
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM rate_card_profiles rcp
  WHERE rcp.client_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = rcp.client_id);
  IF orphan_count > 0 THEN
    RAISE NOTICE 'rate_card_profiles.client_id orphans: %', orphan_count;
  END IF;
END $$;

ALTER TABLE rate_card_profiles
  DROP CONSTRAINT IF EXISTS rate_card_profiles_client_id_fkey;
ALTER TABLE rate_card_profiles
  ADD  CONSTRAINT rate_card_profiles_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT;

-- ─── 4. quote_lines.specialty_id → specialties ──────────────────────────────
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM quote_lines ql
  WHERE ql.specialty_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM specialties s WHERE s.id = ql.specialty_id);
  IF orphan_count > 0 THEN
    RAISE NOTICE 'quote_lines.specialty_id orphans: % (set to NULL or fix data before constraint will accept)', orphan_count;
  END IF;
END $$;

ALTER TABLE quote_lines
  DROP CONSTRAINT IF EXISTS quote_lines_specialty_id_fkey;
ALTER TABLE quote_lines
  ADD  CONSTRAINT quote_lines_specialty_id_fkey
  FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT;

-- ─── 5. invoice_lines.position_id → positions ───────────────────────────────
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM invoice_lines il
  WHERE il.position_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = il.position_id);
  IF orphan_count > 0 THEN
    RAISE NOTICE 'invoice_lines.position_id orphans: %', orphan_count;
  END IF;
END $$;

ALTER TABLE invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_position_id_fkey;
ALTER TABLE invoice_lines
  ADD  CONSTRAINT invoice_lines_position_id_fkey
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE RESTRICT;

-- ─── 6. invoice_lines.specialty_id → specialties ────────────────────────────
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM invoice_lines il
  WHERE il.specialty_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM specialties s WHERE s.id = il.specialty_id);
  IF orphan_count > 0 THEN
    RAISE NOTICE 'invoice_lines.specialty_id orphans: %', orphan_count;
  END IF;
END $$;

ALTER TABLE invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_specialty_id_fkey;
ALTER TABLE invoice_lines
  ADD  CONSTRAINT invoice_lines_specialty_id_fkey
  FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT;

-- ─── Verification ────────────────────────────────────────────────────────────
-- Print all six new constraints to confirm they landed.
SELECT conname AS constraint_name,
       conrelid::regclass AS on_table,
       confrelid::regclass AS references_table,
       CASE confdeltype
         WHEN 'a' THEN 'NO ACTION'
         WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS on_delete
FROM pg_constraint
WHERE conname IN (
  'job_requests_client_id_fkey',
  'invoices_client_id_fkey',
  'rate_card_profiles_client_id_fkey',
  'quote_lines_specialty_id_fkey',
  'invoice_lines_position_id_fkey',
  'invoice_lines_specialty_id_fkey'
)
ORDER BY on_table, conname;
