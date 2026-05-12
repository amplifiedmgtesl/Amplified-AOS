-- Lines: explicit OT/DT hours + crew_count, replacing rule-derived splits.
--
-- BEFORE this migration, day-mode lines stored a single `hours` field
-- (total hours worked) and the calc engine derived ST/OT/DT tiers at
-- runtime by parsing the `rule` string ("OT after 12 / DT after 15") and
-- splitting hours via computeDayHourSplit. This works fine when every
-- worker on a line had the same hours (the quote-builder assumption) but
-- breaks for timesheet aggregation: 3 workers with hours 8 / 14 / 16
-- each cross OT thresholds differently and cannot be represented as one
-- aggregated line under the rule-derived model.
--
-- AFTER this migration:
--   crew_count    = explicit worker count (multiplier for day-rate base)
--   hours         = total ST person-hours (0 on day-rate lines since the
--                   day rate covers straight time)
--   ot_hours      = total OT person-hours billed at ot_rate     (NEW)
--   dt_hours      = total DT person-hours billed at dt_rate     (NEW)
--   holiday_hours = total holiday person-hours billed at dt_rate (unchanged)
--   rule          = informational only (printed for the customer; no
--                   longer drives runtime calc — splits are explicit now)
--
-- New formula in both modes:
--   Day:    crew_count × base_day + ot_hours × ot_rate + dt_hours × dt_rate
--         + holiday_hours × dt_rate + travel
--   Hourly: hours × base_hourly + ot_hours × ot_rate + dt_hours × dt_rate
--         + holiday_hours × dt_rate + travel
--
-- Backfill is mathematically faithful — every existing line's `total`
-- recomputes to the same value under the new formula. Verified by the
-- check block at the bottom (RAISES + ABORTS if any line drifts).
--
-- Companion: docs/invoice-rewrite-plan.md (Phase C addendum).

-- ─── 1. Add columns ────────────────────────────────────────────────────────

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS ot_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS dt_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS crew_count integer DEFAULT 1 NOT NULL;

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS ot_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS dt_hours   numeric DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS crew_count integer DEFAULT 1 NOT NULL;

-- ─── 2. Helper functions ─ pure-SQL mirror of lib/rates/ot-trigger.ts ─────

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
  -- Default trigger when no rule string present
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

-- ─── 3. Disable freeze triggers for backfill ──────────────────────────────
-- The existing freeze triggers block ALL updates on lines whose parent
-- doc is frozen. The backfill is a one-time schema-level migration, not
-- a content edit, so we disable the triggers for the duration of the
-- backfill UPDATE then immediately re-enable.

ALTER TABLE quote_lines   DISABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 4. Backfill quote_lines ──────────────────────────────────────────────

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

-- ─── 5. Backfill invoice_lines ────────────────────────────────────────────

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

-- ─── 6. Re-enable freeze triggers ─────────────────────────────────────────

ALTER TABLE quote_lines   ENABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines ENABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 7. Verification — recompute total under new formula, compare to
--        stored total. Aborts the migration if any line drifts >1 cent. ─

DO $$
DECLARE
  drift_count int;
  drift_sample text;
BEGIN
  -- Quote lines
  SELECT count(*), string_agg(id || ' (drift ' || drift::text || ')', ', ')
    INTO drift_count, drift_sample
  FROM (
    SELECT id,
      round((
        (CASE
           WHEN rate_mode = 'day' OR (COALESCE(base_day, 0) > 0 AND COALESCE(hours, 0) = 0)
             THEN COALESCE(crew_count, 1) * COALESCE(base_day, 0)
           ELSE COALESCE(hours, 0) * COALESCE(base_hourly, 0)
         END)
        + COALESCE(ot_hours, 0)      * COALESCE(ot_rate, 0)
        + COALESCE(dt_hours, 0)      * COALESCE(dt_rate, 0)
        + COALESCE(holiday_hours, 0) * COALESCE(dt_rate, 0)
        + COALESCE(travel, 0)
        - COALESCE(total, 0)
      )::numeric, 2) AS drift
    FROM quote_lines
  ) sub
  WHERE ABS(drift) > 0.01;

  IF drift_count > 0 THEN
    RAISE EXCEPTION 'Quote-line total drift after backfill: % rows. Sample: %. Migration ABORTED.',
      drift_count, LEFT(drift_sample, 500);
  END IF;

  -- Invoice lines
  SELECT count(*), string_agg(id || ' (drift ' || drift::text || ')', ', ')
    INTO drift_count, drift_sample
  FROM (
    SELECT id,
      round((
        (CASE
           WHEN rate_mode = 'day' OR (COALESCE(base_day, 0) > 0 AND COALESCE(hours, 0) = 0)
             THEN COALESCE(crew_count, 1) * COALESCE(base_day, 0)
           ELSE COALESCE(hours, 0) * COALESCE(base_hourly, 0)
         END)
        + COALESCE(ot_hours, 0)      * COALESCE(ot_rate, 0)
        + COALESCE(dt_hours, 0)      * COALESCE(dt_rate, 0)
        + COALESCE(holiday_hours, 0) * COALESCE(dt_rate, 0)
        + COALESCE(travel, 0)
        - COALESCE(total, 0)
      )::numeric, 2) AS drift
    FROM invoice_lines
  ) sub
  WHERE ABS(drift) > 0.01;

  IF drift_count > 0 THEN
    RAISE EXCEPTION 'Invoice-line total drift after backfill: % rows. Sample: %. Migration ABORTED.',
      drift_count, LEFT(drift_sample, 500);
  END IF;

  RAISE NOTICE 'Line backfill verified — all quote_line and invoice_line totals reconcile under the new formula.';
END $$;

-- ─── 8. Clean up helpers ──────────────────────────────────────────────────

DROP FUNCTION IF EXISTS _migration_parse_ot_trigger(text);
DROP FUNCTION IF EXISTS _migration_compute_split(numeric, text, numeric);

-- ─── 9. Final state report ────────────────────────────────────────────────

SELECT 'quote_lines' AS tbl,
       count(*) AS total_rows,
       count(*) FILTER (WHERE ot_hours > 0) AS rows_with_ot,
       count(*) FILTER (WHERE dt_hours > 0) AS rows_with_dt,
       count(*) FILTER (WHERE crew_count > 1) AS rows_with_crew_gt_1
FROM quote_lines
UNION ALL
SELECT 'invoice_lines',
       count(*),
       count(*) FILTER (WHERE ot_hours > 0),
       count(*) FILTER (WHERE dt_hours > 0),
       count(*) FILTER (WHERE crew_count > 1)
FROM invoice_lines;
