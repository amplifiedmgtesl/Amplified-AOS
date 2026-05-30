-- Lines: explicit OT/DT hours + crew_count, replacing rule-derived splits.
--
-- BEFORE: day-mode lines stored one `hours` field; ST/OT/DT tiers were
-- derived at calc time by parsing the `rule` string. Worked when every
-- worker on a line had the same hours, broke for timesheet aggregation
-- with variable hours per worker.
--
-- AFTER:
--   crew_count    explicit worker count (multiplies day rate; informational
--                 on hourly lines)
--   hours         total ST person-hours (0 on day-rate lines)
--   ot_hours      total OT person-hours billed at ot_rate     (NEW)
--   dt_hours      total DT person-hours billed at dt_rate     (NEW)
--   holiday_hours total holiday person-hours at dt_rate       (unchanged)
--   rule          informational only — no longer parsed at calc time
--
-- Formula (both modes):
--   (day:    crew_count × base_day, hourly: hours × base_hourly)
--   + ot_hours × ot_rate + dt_hours × dt_rate + holiday_hours × dt_rate
--   + travel
--
-- VERIFICATION POLICY:
--   - DRAFT lines must reconcile exactly under the new formula. The check
--     aborts the migration if any draft line drifts >1 cent.
--   - FROZEN lines are tolerated for drift. Legacy data (Connor-era
--     slug-PK rows and similar) has stored `total` values that didn't
--     match even the legacy formula — likely due to historical hand
--     edits or pre-rewrite bugs. We preserve those stored totals as
--     the authoritative customer-facing values (they represent what was
--     actually quoted/billed) and populate the new fields best-effort
--     for revise/audit. The drift count is reported via NOTICE.
--
-- Companion: docs/explicit-line-model-summary.md

-- ─── 1. Add columns ────────────────────────────────────────────────────────

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS ot_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS dt_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS crew_count integer DEFAULT 1 NOT NULL;

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS ot_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS dt_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS crew_count integer DEFAULT 1 NOT NULL;

-- ─── 2. Helper functions — pure-SQL mirror of lib/rates/ot-trigger.ts ─────

CREATE OR REPLACE FUNCTION _migration_parse_ot_trigger(rule text)
RETURNS TABLE(kind text, ot_start numeric) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  r text := COALESCE(rule, '');
  m text;
BEGIN
  IF r ~* 'no\s*ot' THEN
    RETURN QUERY SELECT 'none'::text, NULL::numeric;
    RETURN;
  END IF;
  IF r ~* 'OT after\s+40\s*/?\s*week' THEN
    RETURN QUERY SELECT 'weekly'::text, NULL::numeric;
    RETURN;
  END IF;
  m := (regexp_match(r, 'OT after\s+([0-9]+(?:\.[0-9]+)?)', 'i'))[1];
  IF m IS NOT NULL THEN
    RETURN QUERY SELECT 'daily'::text, m::numeric;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'daily'::text, 10::numeric;
END $$;

CREATE OR REPLACE FUNCTION _migration_compute_split(
  total_hours numeric,
  kind text,
  ot_start numeric
)
RETURNS TABLE(st numeric, ot numeric, dt numeric) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  h numeric := GREATEST(0, COALESCE(total_hours, 0));
BEGIN
  IF kind IN ('none', 'weekly') THEN
    RETURN QUERY SELECT h, 0::numeric, 0::numeric;
    RETURN;
  END IF;
  RETURN QUERY SELECT
    LEAST(h, ot_start),
    GREATEST(0::numeric, LEAST(h, 15) - ot_start),
    GREATEST(0::numeric, h - 15);
END $$;

-- ─── 3. Disable freeze triggers for the one-time backfill ────────────────

ALTER TABLE quote_lines   DISABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 4. Backfill quote_lines ─────────────────────────────────────────────

UPDATE quote_lines ql
SET
  crew_count = GREATEST(1, COALESCE(ql.qty, 1)),
  hours = CASE
    WHEN ql.rate_mode = 'day' OR (COALESCE(ql.base_day, 0) > 0 AND COALESCE(ql.hours, 0) = 0)
      THEN 0
    ELSE COALESCE(ql.qty, 1) * COALESCE(ql.hours, 0)
  END,
  ot_hours = CASE
    WHEN ql.rate_mode = 'day' OR (COALESCE(ql.base_day, 0) > 0 AND COALESCE(ql.hours, 0) = 0)
      THEN COALESCE(ql.qty, 1) * (split).ot
    ELSE 0
  END,
  dt_hours = CASE
    WHEN ql.rate_mode = 'day' OR (COALESCE(ql.base_day, 0) > 0 AND COALESCE(ql.hours, 0) = 0)
      THEN COALESCE(ql.qty, 1) * (split).dt
    ELSE 0
  END
FROM (
  SELECT
    ql2.id,
    _migration_compute_split(
      COALESCE(ql2.hours, 0),
      (SELECT kind FROM _migration_parse_ot_trigger(ql2.rule)),
      (SELECT ot_start FROM _migration_parse_ot_trigger(ql2.rule))
    ) AS split
  FROM quote_lines ql2
) AS sub
WHERE ql.id = sub.id;

-- ─── 5. Backfill invoice_lines ───────────────────────────────────────────

UPDATE invoice_lines il
SET
  crew_count = GREATEST(1, COALESCE(il.qty, 1)),
  hours = CASE
    WHEN il.rate_mode = 'day' OR (COALESCE(il.base_day, 0) > 0 AND COALESCE(il.hours, 0) = 0)
      THEN 0
    ELSE COALESCE(il.qty, 1) * COALESCE(il.hours, 0)
  END,
  ot_hours = CASE
    WHEN il.rate_mode = 'day' OR (COALESCE(il.base_day, 0) > 0 AND COALESCE(il.hours, 0) = 0)
      THEN COALESCE(il.qty, 1) * (split).ot
    ELSE 0
  END,
  dt_hours = CASE
    WHEN il.rate_mode = 'day' OR (COALESCE(il.base_day, 0) > 0 AND COALESCE(il.hours, 0) = 0)
      THEN COALESCE(il.qty, 1) * (split).dt
    ELSE 0
  END
FROM (
  SELECT
    il2.id,
    _migration_compute_split(
      COALESCE(il2.hours, 0),
      (SELECT kind FROM _migration_parse_ot_trigger(il2.rule)),
      (SELECT ot_start FROM _migration_parse_ot_trigger(il2.rule))
    ) AS split
  FROM invoice_lines il2
) AS sub
WHERE il.id = sub.id;

-- ─── 6. Re-enable freeze triggers ────────────────────────────────────────

ALTER TABLE quote_lines   ENABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines ENABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 7. Verification — strict on drafts, tolerant on frozen ──────────────

DO $$
DECLARE
  draft_drift int;
  frozen_drift_quote int;
  frozen_drift_invoice int;
  draft_sample text;
BEGIN
  -- Quote_lines: draft parent must reconcile exactly.
  SELECT count(*), string_agg(id || ' (drift ' || drift::text || ')', ', ')
    INTO draft_drift, draft_sample
  FROM (
    SELECT ql.id,
      round((
        (CASE
           WHEN ql.rate_mode = 'day' OR (COALESCE(ql.base_day, 0) > 0 AND COALESCE(ql.hours, 0) = 0)
             THEN COALESCE(ql.crew_count, 1) * COALESCE(ql.base_day, 0)
           ELSE COALESCE(ql.hours, 0) * COALESCE(ql.base_hourly, 0)
         END)
        + COALESCE(ql.ot_hours, 0)      * COALESCE(ql.ot_rate, 0)
        + COALESCE(ql.dt_hours, 0)      * COALESCE(ql.dt_rate, 0)
        + COALESCE(ql.holiday_hours, 0) * COALESCE(ql.dt_rate, 0)
        + COALESCE(ql.travel, 0)
        - COALESCE(ql.total, 0)
      )::numeric, 2) AS drift
    FROM quote_lines ql
    JOIN quotes q ON q.id = ql.quote_id
    WHERE q.is_draft = true
  ) sub
  WHERE ABS(drift) > 0.01;

  IF draft_drift > 0 THEN
    RAISE EXCEPTION 'DRAFT quote-line drift: % rows. Sample: %. Migration ABORTED.',
      draft_drift, LEFT(draft_sample, 500);
  END IF;

  -- Quote_lines: frozen rows — count only, do not abort.
  SELECT count(*) INTO frozen_drift_quote
  FROM (
    SELECT ql.id,
      round((
        (CASE
           WHEN ql.rate_mode = 'day' OR (COALESCE(ql.base_day, 0) > 0 AND COALESCE(ql.hours, 0) = 0)
             THEN COALESCE(ql.crew_count, 1) * COALESCE(ql.base_day, 0)
           ELSE COALESCE(ql.hours, 0) * COALESCE(ql.base_hourly, 0)
         END)
        + COALESCE(ql.ot_hours, 0)      * COALESCE(ql.ot_rate, 0)
        + COALESCE(ql.dt_hours, 0)      * COALESCE(ql.dt_rate, 0)
        + COALESCE(ql.holiday_hours, 0) * COALESCE(ql.dt_rate, 0)
        + COALESCE(ql.travel, 0)
        - COALESCE(ql.total, 0)
      )::numeric, 2) AS drift
    FROM quote_lines ql
    JOIN quotes q ON q.id = ql.quote_id
    WHERE q.is_draft = false
  ) sub
  WHERE ABS(drift) > 0.01;

  -- Invoice_lines: draft parent must reconcile exactly.
  SELECT count(*), string_agg(id || ' (drift ' || drift::text || ')', ', ')
    INTO draft_drift, draft_sample
  FROM (
    SELECT il.id,
      round((
        (CASE
           WHEN il.rate_mode = 'day' OR (COALESCE(il.base_day, 0) > 0 AND COALESCE(il.hours, 0) = 0)
             THEN COALESCE(il.crew_count, 1) * COALESCE(il.base_day, 0)
           ELSE COALESCE(il.hours, 0) * COALESCE(il.base_hourly, 0)
         END)
        + COALESCE(il.ot_hours, 0)      * COALESCE(il.ot_rate, 0)
        + COALESCE(il.dt_hours, 0)      * COALESCE(il.dt_rate, 0)
        + COALESCE(il.holiday_hours, 0) * COALESCE(il.dt_rate, 0)
        + COALESCE(il.travel, 0)
        - COALESCE(il.total, 0)
      )::numeric, 2) AS drift
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE i.is_draft = true
  ) sub
  WHERE ABS(drift) > 0.01;

  IF draft_drift > 0 THEN
    RAISE EXCEPTION 'DRAFT invoice-line drift: % rows. Sample: %. Migration ABORTED.',
      draft_drift, LEFT(draft_sample, 500);
  END IF;

  -- Invoice_lines: frozen rows — count only, do not abort.
  SELECT count(*) INTO frozen_drift_invoice
  FROM (
    SELECT il.id,
      round((
        (CASE
           WHEN il.rate_mode = 'day' OR (COALESCE(il.base_day, 0) > 0 AND COALESCE(il.hours, 0) = 0)
             THEN COALESCE(il.crew_count, 1) * COALESCE(il.base_day, 0)
           ELSE COALESCE(il.hours, 0) * COALESCE(il.base_hourly, 0)
         END)
        + COALESCE(il.ot_hours, 0)      * COALESCE(il.ot_rate, 0)
        + COALESCE(il.dt_hours, 0)      * COALESCE(il.dt_rate, 0)
        + COALESCE(il.holiday_hours, 0) * COALESCE(il.dt_rate, 0)
        + COALESCE(il.travel, 0)
        - COALESCE(il.total, 0)
      )::numeric, 2) AS drift
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE i.is_draft = false
  ) sub
  WHERE ABS(drift) > 0.01;

  RAISE NOTICE 'Backfill verified: all DRAFT lines reconcile.';
  RAISE NOTICE 'Frozen quote_lines with legacy total drift (preserved as historical): %', frozen_drift_quote;
  RAISE NOTICE 'Frozen invoice_lines with legacy total drift (preserved as historical): %', frozen_drift_invoice;
END $$;

-- ─── 8. Clean up helpers ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS _migration_parse_ot_trigger(text);
DROP FUNCTION IF EXISTS _migration_compute_split(numeric, text, numeric);

-- ─── 9. Final state report ───────────────────────────────────────────────

SELECT 'quote_lines' AS tbl,
       count(*) AS total_rows,
       count(*) FILTER (WHERE ot_hours > 0)        AS rows_with_ot,
       count(*) FILTER (WHERE dt_hours > 0)        AS rows_with_dt,
       count(*) FILTER (WHERE crew_count > 1)      AS rows_with_crew_gt_1
FROM quote_lines
UNION ALL
SELECT 'invoice_lines',
       count(*),
       count(*) FILTER (WHERE ot_hours > 0),
       count(*) FILTER (WHERE dt_hours > 0),
       count(*) FILTER (WHERE crew_count > 1)
FROM invoice_lines;
