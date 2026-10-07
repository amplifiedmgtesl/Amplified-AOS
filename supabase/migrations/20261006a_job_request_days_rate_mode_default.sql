-- Backlog #105: every job day says Day Rate or Hourly — no more NULLs.
--
-- 20260830a added job_request_days.rate_mode + day_rate_hours and backfilled
-- every row that existed then, but nothing in the app wrote the columns, so
-- every day created since is NULL (prod 2026-10-06: 78 rows, all on jobs
-- created after 8/31). Payroll skips a NULL day, which means:
--   * roles quoted at a day rate make the payroll run refuse to build, and
--   * roles NOT on the quote are silently paid hourly (the Neon Nights case).
--
-- The Daily Requirements tab now has a Rate control per day (default
-- Hourly). This migration closes the gap at the database too:
--   1. backfill the NULL rows, using the same rule as 20260830a;
--   2. DEFAULT 'hourly' so any insert that leaves it out gets an answer;
--   3. NOT NULL so the "no answer" state can't come back.
--
-- Prod check before writing this (2026-10-06): none of the 78 NULL days is on
-- a job with a day-rate quote line, so step 1 sets them all to hourly there.

-- ─── 1. Backfill (idempotent — only NULL rows) ──────────────────────────
WITH day_rate_jobs AS (
  SELECT DISTINCT q.job_request_id AS jid
    FROM quotes q
    JOIN quote_lines l ON l.quote_id = q.id
   WHERE l.rate_mode = 'day'
     AND q.job_request_id IS NOT NULL
     AND q.superseded_at IS NULL
)
UPDATE job_request_days jd
   SET rate_mode      = 'day',
       day_rate_hours = jd.expected_hours
  FROM day_rate_jobs d
 WHERE d.jid = jd.job_request_id
   AND jd.rate_mode IS NULL
   AND jd.expected_hours > 0
   AND jd.expected_hours <= 24;

UPDATE job_request_days
   SET rate_mode = 'hourly'
 WHERE rate_mode IS NULL;

-- ─── 2 + 3. Default and NOT NULL ────────────────────────────────────────
ALTER TABLE job_request_days ALTER COLUMN rate_mode SET DEFAULT 'hourly';
ALTER TABLE job_request_days ALTER COLUMN rate_mode SET NOT NULL;

COMMENT ON COLUMN job_request_days.rate_mode IS
  'How this day is billed and paid: ''day'' (flat block of day_rate_hours) or ''hourly'' (clock time). Set per day on the Daily Requirements tab; defaults to hourly. Overridden per specialty by quote_lines.rate_mode.';

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
DECLARE n_null int; n_day int; n_hourly int;
BEGIN
  SELECT count(*) FILTER (WHERE rate_mode IS NULL),
         count(*) FILTER (WHERE rate_mode = 'day'),
         count(*) FILTER (WHERE rate_mode = 'hourly')
    INTO n_null, n_day, n_hourly
    FROM job_request_days;
  IF n_null > 0 THEN
    RAISE EXCEPTION '% job_request_days rows still have no rate_mode', n_null;
  END IF;
  RAISE NOTICE 'job_request_days: % day-rate, % hourly', n_day, n_hourly;
END $$;
