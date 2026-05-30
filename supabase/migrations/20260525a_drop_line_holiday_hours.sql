-- Holiday handling: drop the per-line holiday_hours columns.
--
-- After Connor confirmation (2026-05-25):
--   1. Holiday days are atomic. If any work touches a holiday date, the
--      WHOLE day bills at holiday rate. No partial-day splits.
--   2. Holiday rate is flat 2× base. It SUPERSEDES OT/DT; it doesn't stack.
--      A 16-hr holiday line bills at 16 × base × 2, regardless of how the
--      hours would normally split into OT/DT for a non-holiday day.
--
-- Both rules together mean the per-line `holiday_hours` column is dead
-- weight: the day-level `quote_days.is_holiday` / `invoice_days.is_holiday`
-- flag is the single source of holiday treatment, applied uniformly to
-- every line on that date via the calc engine.
--
-- Footprint at drop time (dev): 2 quote_lines + 1 invoice_line had non-zero
-- holiday_hours, all from the recent 20260511a backfill from legacy data —
-- never seen by the user since the day-flag feature shipped after. The
-- dollar totals on those rows are already persisted in `total`, so dropping
-- the column doesn't change any frozen-record amounts.

-- ─── 1. Disable freeze triggers for the DDL drop ────────────────────────
-- ALTER TABLE ... DROP COLUMN doesn't fire row triggers, but stay defensive
-- in case the table has any BEFORE triggers that interpret schema changes.

ALTER TABLE quote_lines   DISABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 2. Drop the columns ────────────────────────────────────────────────

ALTER TABLE quote_lines   DROP COLUMN IF EXISTS holiday_hours;
ALTER TABLE invoice_lines DROP COLUMN IF EXISTS holiday_hours;

-- ─── 3. Re-enable freeze triggers ───────────────────────────────────────

ALTER TABLE quote_lines   ENABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines ENABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 4. Verify columns are gone ────────────────────────────────────────

SELECT
  'quote_lines.holiday_hours'  AS column_name,
  EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='quote_lines'
            AND column_name='holiday_hours') AS still_exists
UNION ALL SELECT
  'invoice_lines.holiday_hours',
  EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='invoice_lines'
            AND column_name='holiday_hours');
