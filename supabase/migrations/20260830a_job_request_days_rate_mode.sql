-- Day-rate basis moves from the quote line to the job day record.
--
-- Until now, whether a day is billed and paid as a flat DAY RATE or by the
-- clock lived in exactly two places, both line-level: quote_lines.rate_mode
-- and invoice_lines.rate_mode. Quote lines are keyed on (date, specialty),
-- so the only thing deciding whether a person is paid a day rate is which
-- specialty they were booked under.
--
-- That breaks whenever the crew that shows up differs from the crew that was
-- sold — which is normal. On the 2026-08-29 Neon Nights run it produced:
--   * a Stagehand Lead and a Lead paid 17 clock hours while the crew they
--     were supervising was paid a flat 10-hour block
--   * riggers booked as "Up" but quoted as "Climber" falling back to hourly
--   * 2026-08-17 paid hourly because the day was never quoted at all
--
-- A job day record exists for every day of the job regardless of what was
-- sold. Putting the basis there means there is always an answer, and the
-- quote line becomes a per-specialty OVERRIDE rather than the only source:
--
--   resolve(date, specialty):
--     quote line for (date, specialty) -> use it if present
--     else job_request_days for (date) -> use rate_mode + day_rate_hours
--     else                             -> hourly
--
-- Design doc: docs/day-rate-source-of-truth-design.md

-- ─── Schema ─────────────────────────────────────────────────────────────
ALTER TABLE job_request_days
  ADD COLUMN IF NOT EXISTS rate_mode      text,
  ADD COLUMN IF NOT EXISTS day_rate_hours numeric;

-- Constraints are added defensively: Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS, so drop-then-add keeps the migration re-runnable.
ALTER TABLE job_request_days DROP CONSTRAINT IF EXISTS job_request_days_rate_mode_check;
ALTER TABLE job_request_days DROP CONSTRAINT IF EXISTS job_request_days_day_rate_hours_check;
ALTER TABLE job_request_days DROP CONSTRAINT IF EXISTS job_request_days_day_rate_hours_required_check;

-- Only two spellings, ever. quote_lines was never constrained and drifted to
-- a third value ('day_rate', 19 rows) that the code silently treats as
-- hourly — do not repeat that here.
ALTER TABLE job_request_days
  ADD CONSTRAINT job_request_days_rate_mode_check
  CHECK (rate_mode IS NULL OR rate_mode IN ('day','hourly'));

-- A block outside this range is a data-entry error, not a real shift.
ALTER TABLE job_request_days
  ADD CONSTRAINT job_request_days_day_rate_hours_check
  CHECK (day_rate_hours IS NULL OR (day_rate_hours > 0 AND day_rate_hours <= 24));

-- The important one: "day rate with no hours" must be impossible. Without
-- this, such a row pays zero or falls through to a guess, and nobody finds
-- out until a payroll draft.
ALTER TABLE job_request_days
  ADD CONSTRAINT job_request_days_day_rate_hours_required_check
  CHECK (rate_mode IS DISTINCT FROM 'day' OR day_rate_hours > 0);

COMMENT ON COLUMN job_request_days.rate_mode IS
  'How this day is billed and paid: ''day'' (flat block of day_rate_hours) or ''hourly'' (clock time). NULL means fall back to the quote line, i.e. the behaviour before this column existed. Overridden per specialty by quote_lines.rate_mode.';
COMMENT ON COLUMN job_request_days.day_rate_hours IS
  'Hours the day rate covers per worker. Paid in full on a day-rate day regardless of clock time. Deliberately NOT expected_hours: that column is operational (crew print sheets, day planning, quote generation) and editing a shift length must never silently change what anyone is paid.';

-- ─── Backfill ───────────────────────────────────────────────────────────
-- Idempotent: only touches rows where rate_mode is still NULL.
--
-- Days on jobs whose issued quote has any day-rate line are seeded from
-- expected_hours. Verified against prod 2026-08-30: 64 such day records, and
-- every one has expected_hours between 4 and 14 — no outliers to launder.
-- The two columns are expected to agree today and are allowed to diverge
-- afterwards; only day_rate_hours drives pay.
WITH day_rate_jobs AS (
  SELECT DISTINCT q.job_request_id AS jid
    FROM quotes q
    JOIN quote_lines l ON l.quote_id = q.id
   WHERE l.rate_mode = 'day'
     AND q.job_request_id IS NOT NULL
)
UPDATE job_request_days jd
   SET rate_mode      = 'day',
       day_rate_hours = jd.expected_hours
  FROM day_rate_jobs d
 WHERE d.jid = jd.job_request_id
   AND jd.rate_mode IS NULL
   AND jd.expected_hours IS NOT NULL
   AND jd.expected_hours > 0;

-- Everything else is hourly. day_rate_hours stays NULL.
UPDATE job_request_days
   SET rate_mode = 'hourly'
 WHERE rate_mode IS NULL;

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
DECLARE
  n_missing_cols int;
  n_bad_mode     int;
  n_day_no_hours int;
  n_day          int;
  n_hourly       int;
BEGIN
  SELECT count(*) INTO n_missing_cols
    FROM (VALUES ('rate_mode'), ('day_rate_hours')) AS c(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'job_request_days'
        AND column_name  = c.col
   );
  IF n_missing_cols > 0 THEN
    RAISE EXCEPTION 'job_request_days is missing % of the new columns', n_missing_cols;
  END IF;

  SELECT count(*) INTO n_bad_mode
    FROM job_request_days WHERE rate_mode NOT IN ('day','hourly');
  IF n_bad_mode > 0 THEN
    RAISE EXCEPTION '% job_request_days rows have an invalid rate_mode', n_bad_mode;
  END IF;

  SELECT count(*) INTO n_day_no_hours
    FROM job_request_days WHERE rate_mode = 'day' AND coalesce(day_rate_hours,0) <= 0;
  IF n_day_no_hours > 0 THEN
    RAISE EXCEPTION '% day-rate rows have no day_rate_hours', n_day_no_hours;
  END IF;

  SELECT count(*) FILTER (WHERE rate_mode = 'day'),
         count(*) FILTER (WHERE rate_mode = 'hourly')
    INTO n_day, n_hourly
    FROM job_request_days;
  RAISE NOTICE 'job_request_days backfilled: % day-rate, % hourly', n_day, n_hourly;
END $$;
