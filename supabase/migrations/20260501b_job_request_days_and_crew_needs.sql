-- Phase 1 of the Job Request multi-day refactor.
-- Adds two new tables:
--   job_request_days       — one row per calendar day of the event
--   job_request_crew_needs — one row per (day, position, specialty) the client wants
--
-- Old job_requests columns (request_date, end_date, start_time, end_time,
-- expected_hours) stay for now and are kept in sync from days via a trigger,
-- so existing readers (calendar.ts, quote-builder.tsx, invoice-builder.tsx,
-- client-maintenance.tsx) continue to work unchanged. Phase 2 will migrate
-- those readers and drop the legacy columns.

-- ─── job_request_days ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_request_days (
  id              text PRIMARY KEY,
  job_request_id  text NOT NULL REFERENCES job_requests(id) ON DELETE CASCADE,
  event_date      date NOT NULL,
  call_time       text,
  start_time      text,
  end_time        text,
  expected_hours  numeric,
  notes           text,
  sort_order      integer NOT NULL DEFAULT 0,
  UNIQUE (job_request_id, event_date)
);

CREATE INDEX IF NOT EXISTS job_request_days_jr_id_idx
  ON job_request_days(job_request_id);

ALTER TABLE job_request_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_request_days_full_access" ON job_request_days;
CREATE POLICY "job_request_days_full_access" ON job_request_days
  FOR ALL USING (true);

-- ─── job_request_crew_needs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_request_crew_needs (
  id                  text PRIMARY KEY,
  job_request_day_id  text NOT NULL REFERENCES job_request_days(id) ON DELETE CASCADE,
  position_id         text REFERENCES positions(id),
  specialty_id        text REFERENCES specialties(id),
  quantity            integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  notes               text,
  sort_order          integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS job_request_crew_needs_day_id_idx
  ON job_request_crew_needs(job_request_day_id);

ALTER TABLE job_request_crew_needs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_request_crew_needs_full_access" ON job_request_crew_needs;
CREATE POLICY "job_request_crew_needs_full_access" ON job_request_crew_needs
  FOR ALL USING (true);

-- ─── Backfill from legacy job_requests ───────────────────────────────────────
-- For each request that has a request_date, generate one job_request_days
-- row per calendar day in [request_date, COALESCE(end_date, request_date)],
-- copying start_time/end_time/expected_hours to each day.
-- Skips requests whose request_date is empty/non-parseable.
-- Idempotent via ON CONFLICT on (job_request_id, event_date).

INSERT INTO job_request_days (
  id, job_request_id, event_date, call_time, start_time, end_time,
  expected_hours, notes, sort_order
)
SELECT
  jr.id || '_d' || to_char(d::date, 'YYYYMMDD'),
  jr.id,
  d::date,
  NULL,                                      -- call_time has no legacy source
  NULLIF(jr.start_time, ''),
  NULLIF(jr.end_time, ''),
  jr.expected_hours,
  NULL,
  (d::date - jr.request_date::date)
FROM job_requests jr
CROSS JOIN LATERAL generate_series(
  jr.request_date::date,
  COALESCE(NULLIF(jr.end_date, '')::date, jr.request_date::date),
  interval '1 day'
) AS d
WHERE jr.request_date IS NOT NULL
  AND jr.request_date <> ''
  AND jr.request_date ~ '^\d{4}-\d{2}-\d{2}$'
  AND (jr.end_date IS NULL OR jr.end_date = '' OR jr.end_date ~ '^\d{4}-\d{2}-\d{2}$')
ON CONFLICT (job_request_id, event_date) DO NOTHING;

-- ─── Sync trigger: keep legacy job_requests columns in step with days ────────
-- After any change to job_request_days, recompute the parent's flat columns:
--   request_date    = MIN(event_date)
--   end_date        = MAX(event_date)
--   start_time      = first day's start_time (by event_date)
--   end_time        = last day's  end_time   (by event_date)
--   expected_hours  = first day's expected_hours (the per-day value)
--
-- expected_hours is per-day in the new model; the legacy column was also
-- "expected hours per day", so first-row mirrors the user's intent.

CREATE OR REPLACE FUNCTION sync_job_request_from_days()
RETURNS TRIGGER AS $$
DECLARE
  jr_id text;
BEGIN
  jr_id := COALESCE(NEW.job_request_id, OLD.job_request_id);
  IF jr_id IS NULL THEN RETURN NULL; END IF;

  UPDATE job_requests jr SET
    request_date   = COALESCE(to_char(agg.min_date, 'YYYY-MM-DD'), jr.request_date),
    end_date       = CASE WHEN agg.max_date = agg.min_date THEN NULL
                          ELSE to_char(agg.max_date, 'YYYY-MM-DD') END,
    start_time     = COALESCE(agg.first_start, jr.start_time),
    end_time       = COALESCE(agg.last_end,    jr.end_time),
    expected_hours = COALESCE(agg.first_hours, jr.expected_hours)
  FROM (
    SELECT
      MIN(event_date) AS min_date,
      MAX(event_date) AS max_date,
      (SELECT start_time     FROM job_request_days WHERE job_request_id = jr_id ORDER BY event_date ASC  LIMIT 1) AS first_start,
      (SELECT end_time       FROM job_request_days WHERE job_request_id = jr_id ORDER BY event_date DESC LIMIT 1) AS last_end,
      (SELECT expected_hours FROM job_request_days WHERE job_request_id = jr_id ORDER BY event_date ASC  LIMIT 1) AS first_hours
    FROM job_request_days
    WHERE job_request_id = jr_id
  ) AS agg
  WHERE jr.id = jr_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_job_request_from_days_trg ON job_request_days;
CREATE TRIGGER sync_job_request_from_days_trg
  AFTER INSERT OR UPDATE OR DELETE ON job_request_days
  FOR EACH ROW EXECUTE FUNCTION sync_job_request_from_days();
