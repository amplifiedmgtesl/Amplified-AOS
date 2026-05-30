-- Job-scoped shifts: replace free-text `shift_label` with a real FK.
--
-- BEFORE: quote_lines.shift_label and invoice_lines.shift_label were free
-- text. Two lines that should reference the same shift could diverge by
-- whitespace or casing ("Load In" vs "load-in" vs " Load In"), causing
-- silent fragmentation in any grouped display and breaking
-- cross-document consistency (quote vs invoice vs timesheet).
--
-- AFTER: shifts are first-class rows in a new `job_request_shifts` table,
-- parented by job_request_id. Lines reference shifts by FK. The free-text
-- columns are DROPPED — single source of truth.
--
-- Lines whose parent doc has no job_request_id (legacy orphan quotes /
-- invoices) lose their shift label silently — no job to scope shifts to.
-- Those rows are pre-rewrite legacy artifacts and the user can re-assign
-- shifts after running the "Link to Job" orphan-recovery flow if needed.
--
-- Backfill canonicalization: distinct shifts per job are identified by
-- LOWER(TRIM(label)). The first encountered original casing wins as the
-- canonical label — operator can rename via the new Shifts UI after.

-- ─── 1. New table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_request_shifts (
  id              text         PRIMARY KEY,
  job_request_id  text         NOT NULL REFERENCES job_requests(id) ON DELETE CASCADE,
  label           text         NOT NULL,
  sort_order      integer      NOT NULL DEFAULT 0,
  is_active       boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  created_by      uuid         REFERENCES auth.users(id),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  updated_by      uuid         REFERENCES auth.users(id)
);

-- Case-insensitive uniqueness per job (prevents typo duplicates at the DB).
CREATE UNIQUE INDEX IF NOT EXISTS job_request_shifts_job_label_ci_unique
  ON job_request_shifts (job_request_id, lower(trim(label)));

CREATE INDEX IF NOT EXISTS job_request_shifts_job_idx
  ON job_request_shifts (job_request_id, sort_order);

-- RLS: full access (per the project's existing pattern; auth is enforced
-- at the application layer for this project).
ALTER TABLE job_request_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON job_request_shifts;
CREATE POLICY full_access ON job_request_shifts FOR ALL USING (true) WITH CHECK (true);

-- Audit trigger
DROP TRIGGER IF EXISTS set_audit_columns_trg ON job_request_shifts;
CREATE TRIGGER set_audit_columns_trg
  BEFORE INSERT OR UPDATE ON job_request_shifts
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── 2. shift_id columns on lines ───────────────────────────────────────

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS shift_id text REFERENCES job_request_shifts(id) ON DELETE RESTRICT;

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS shift_id text REFERENCES job_request_shifts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS quote_lines_shift_idx   ON quote_lines   (shift_id) WHERE shift_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoice_lines_shift_idx ON invoice_lines (shift_id) WHERE shift_id IS NOT NULL;

-- ─── 3. Backfill: create one shift row per (job_request_id, canonical
--                   label) pair found across both line tables ──────────

INSERT INTO job_request_shifts (id, job_request_id, label, sort_order)
SELECT
  'shift-' || substr(md5(job_request_id || '|' || lower(trim(canonical_label))), 1, 16) AS id,
  job_request_id,
  canonical_label,
  ROW_NUMBER() OVER (PARTITION BY job_request_id ORDER BY canonical_label) AS sort_order
FROM (
  -- distinct (job_request_id, lower(trim(label))) pairs from both tables,
  -- carrying along one original casing as the canonical display label.
  SELECT
    job_request_id,
    (array_agg(label ORDER BY label))[1] AS canonical_label
  FROM (
    SELECT q.job_request_id, ql.shift_label AS label
      FROM quote_lines ql
      JOIN quotes q ON q.id = ql.quote_id
     WHERE ql.shift_label IS NOT NULL
       AND TRIM(ql.shift_label) <> ''
       AND q.job_request_id IS NOT NULL
    UNION ALL
    SELECT i.job_request_id, il.shift_label AS label
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
     WHERE il.shift_label IS NOT NULL
       AND TRIM(il.shift_label) <> ''
       AND i.job_request_id IS NOT NULL
  ) all_labels
  GROUP BY job_request_id, lower(trim(label))
) distinct_shifts
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Map lines.shift_id (freeze triggers off for the one-time write) ─

ALTER TABLE quote_lines   DISABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_freeze_iud_trg;

UPDATE quote_lines ql
SET shift_id = s.id
FROM quotes q,
     job_request_shifts s
WHERE q.id = ql.quote_id
  AND q.job_request_id = s.job_request_id
  AND ql.shift_label IS NOT NULL
  AND TRIM(ql.shift_label) <> ''
  AND lower(trim(ql.shift_label)) = lower(trim(s.label));

UPDATE invoice_lines il
SET shift_id = s.id
FROM invoices i,
     job_request_shifts s
WHERE i.id = il.invoice_id
  AND i.job_request_id = s.job_request_id
  AND il.shift_label IS NOT NULL
  AND TRIM(il.shift_label) <> ''
  AND lower(trim(il.shift_label)) = lower(trim(s.label));

ALTER TABLE quote_lines   ENABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines ENABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 5. Verify zero unmapped rows on lines whose parent has a job ──────

DO $$
DECLARE
  unmapped_ql int;
  unmapped_il int;
  orphan_ql int;
  orphan_il int;
BEGIN
  -- Lines that SHOULD have mapped (parent has job_request_id) but didn't.
  SELECT count(*) INTO unmapped_ql
  FROM quote_lines ql
  JOIN quotes q ON q.id = ql.quote_id
  WHERE ql.shift_label IS NOT NULL
    AND TRIM(ql.shift_label) <> ''
    AND q.job_request_id IS NOT NULL
    AND ql.shift_id IS NULL;

  IF unmapped_ql > 0 THEN
    RAISE EXCEPTION 'Unmapped quote_lines: % rows have non-empty shift_label + parent job but NULL shift_id. Migration ABORTED.', unmapped_ql;
  END IF;

  SELECT count(*) INTO unmapped_il
  FROM invoice_lines il
  JOIN invoices i ON i.id = il.invoice_id
  WHERE il.shift_label IS NOT NULL
    AND TRIM(il.shift_label) <> ''
    AND i.job_request_id IS NOT NULL
    AND il.shift_id IS NULL;

  IF unmapped_il > 0 THEN
    RAISE EXCEPTION 'Unmapped invoice_lines: % rows have non-empty shift_label + parent job but NULL shift_id. Migration ABORTED.', unmapped_il;
  END IF;

  -- Orphan lines (parent has no job) — report only, these intentionally lose their shift.
  SELECT count(*) INTO orphan_ql
  FROM quote_lines ql
  JOIN quotes q ON q.id = ql.quote_id
  WHERE ql.shift_label IS NOT NULL
    AND TRIM(ql.shift_label) <> ''
    AND q.job_request_id IS NULL;

  SELECT count(*) INTO orphan_il
  FROM invoice_lines il
  JOIN invoices i ON i.id = il.invoice_id
  WHERE il.shift_label IS NOT NULL
    AND TRIM(il.shift_label) <> ''
    AND i.job_request_id IS NULL;

  RAISE NOTICE 'Shift backfill verified.';
  RAISE NOTICE 'Orphan quote_lines (no parent job, shift_label dropped silently): %', orphan_ql;
  RAISE NOTICE 'Orphan invoice_lines (no parent job, shift_label dropped silently): %', orphan_il;
END $$;

-- ─── 6. Drop the now-redundant text columns ────────────────────────────

ALTER TABLE quote_lines   DROP COLUMN shift_label;
ALTER TABLE invoice_lines DROP COLUMN shift_label;

-- ─── 7. Final state report ─────────────────────────────────────────────

SELECT 'job_request_shifts'         AS tbl, count(*) AS rows FROM job_request_shifts
UNION ALL
SELECT 'quote_lines.shift_id set',   count(*) FROM quote_lines   WHERE shift_id IS NOT NULL
UNION ALL
SELECT 'invoice_lines.shift_id set', count(*) FROM invoice_lines WHERE shift_id IS NOT NULL;
