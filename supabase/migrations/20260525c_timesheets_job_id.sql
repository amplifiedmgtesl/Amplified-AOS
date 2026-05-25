-- Phase 1: anchor timesheets + timesheet_entries on job_requests (the new "Job")
--
-- Background
-- ----------
-- Historically, timesheets/timesheet_entries linked to job_sheets via a
-- text "job_sheet_id" column. job_sheets and job_requests were never
-- directly linked at the schema level — they were kept in sync by humans
-- typing matching client/event strings. The intended bridge through
-- calendar_events.linked_job_request_id was never populated (0 rows on
-- both dev and prod).
--
-- The Jobs rewrite (`job_no`, per-day rows, per-day crew, shifts, holiday
-- flags) has made job_requests the canonical "Job". Timekeeping needs to
-- speak that language so downstream pulls (invoice draft, holiday math,
-- shifts, rate cards) work without a translation layer.
--
-- What this migration does
-- ------------------------
-- 1. Adds `job_id text REFERENCES job_requests(id) ON DELETE RESTRICT` to
--    both `timesheets` and `timesheet_entries`. Nullable: legacy rows
--    that can't be matched stay NULL and continue to display via the
--    existing `job_sheet_id`.
--
-- 2. Backfills `timesheets.job_id` using a scoring heuristic that
--    matches each timesheet's job_sheet (client, date, event_name)
--    against candidate job_requests in the same date window. Auto-
--    applies score >= 13 (high confidence: client match + event name
--    exact or substring match). Lower-confidence matches are left NULL.
--
-- 3. Backfills `timesheet_entries.job_id` by inheriting from the parent
--    timesheet's `job_id`. A data check on dev (126 entries) and prod
--    (693 entries) confirmed 0 mismatched pairs — every entry's
--    job_sheet_id agreed with its parent timesheet's job_sheet_id.
--    The "office/remote" entries with no timesheet_id stay NULL.
--
-- 4. Indexes both new columns for the picker and filter lookups added
--    by the Phase 1 UI work.
--
-- Idempotency
-- -----------
-- All UPDATEs are gated by `WHERE job_id IS NULL`, so re-running the
-- migration (or running it on prod after dev) is safe and additive.
--
-- Prod cutover note
-- -----------------
-- This migration becomes part of the coordinated rewrite cutover.
-- See project_pending_prod_migrations.md. Before applying to prod, the
-- coverage query in step (2) below should be re-run as a sanity check
-- — counts will have drifted (more timesheets, more job_requests) but
-- the heuristic itself remains valid.

-- ─── 1. Add columns ─────────────────────────────────────────────────────────
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS job_id text;
ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS job_id text;

-- Pre-flight: orphans (should be zero on a fresh add)
DO $$
DECLARE
  o int;
BEGIN
  SELECT count(*) INTO o
  FROM timesheets t
  WHERE t.job_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM job_requests jr WHERE jr.id = t.job_id);
  IF o > 0 THEN RAISE NOTICE 'timesheets.job_id orphans: %', o; END IF;

  SELECT count(*) INTO o
  FROM timesheet_entries te
  WHERE te.job_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM job_requests jr WHERE jr.id = te.job_id);
  IF o > 0 THEN RAISE NOTICE 'timesheet_entries.job_id orphans: %', o; END IF;
END $$;

ALTER TABLE timesheets
  DROP CONSTRAINT IF EXISTS timesheets_job_id_fkey;
ALTER TABLE timesheets
  ADD  CONSTRAINT timesheets_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES job_requests(id) ON DELETE RESTRICT;

ALTER TABLE timesheet_entries
  DROP CONSTRAINT IF EXISTS timesheet_entries_job_id_fkey;
ALTER TABLE timesheet_entries
  ADD  CONSTRAINT timesheet_entries_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES job_requests(id) ON DELETE RESTRICT;

-- ─── 2. Backfill timesheets.job_id via scoring heuristic ────────────────────
-- Scoring (must reach >= 13 to auto-apply):
--   + 10  jr.client_id matches the client_id resolved from js.client text
--   +  5  jr.client text matches js.client text (case-insensitive)
--   +  8  jr.event_name == js.event_name (case-insensitive)
--   +  4  jr.event_name and js.event_name are substrings of each other
WITH ts_view AS (
  SELECT t.id AS ts_id,
         TRIM(js.client) AS js_client,
         NULLIF(TRIM(js.date),'')::date AS js_date,
         TRIM(js.event_name) AS js_event
  FROM timesheets t
  JOIN job_sheets js ON js.id = t.job_sheet_id
  WHERE t.job_id IS NULL
    AND NULLIF(TRIM(js.date),'') IS NOT NULL
),
ts_with_client AS (
  SELECT ts.*,
         (SELECT c.id
            FROM clients c
            WHERE lower(c.name) = lower(ts.js_client)
            LIMIT 1) AS resolved_client_id
  FROM ts_view ts
),
candidates AS (
  SELECT ts.ts_id,
         jr.id AS jr_id,
         (CASE WHEN jr.client_id IS NOT NULL
                AND jr.client_id = ts.resolved_client_id THEN 10 ELSE 0 END
          + CASE WHEN lower(TRIM(jr.client)) = lower(ts.js_client) THEN 5 ELSE 0 END
          + CASE WHEN lower(TRIM(jr.event_name)) = lower(ts.js_event) THEN 8
                 WHEN lower(TRIM(jr.event_name)) LIKE '%' || lower(ts.js_event) || '%'
                   OR lower(ts.js_event) LIKE '%' || lower(TRIM(jr.event_name)) || '%' THEN 4
                 ELSE 0 END
         ) AS score
  FROM ts_with_client ts
  JOIN job_requests jr
    ON (jr.client_id = ts.resolved_client_id
        OR lower(TRIM(jr.client)) = lower(ts.js_client))
   AND ts.js_date BETWEEN NULLIF(jr.request_date,'')::date
                       AND COALESCE(NULLIF(jr.end_date,'')::date,
                                    NULLIF(jr.request_date,'')::date)
),
best AS (
  SELECT ts_id, jr_id, score,
         ROW_NUMBER() OVER (PARTITION BY ts_id ORDER BY score DESC, jr_id) AS rn
  FROM candidates
)
UPDATE timesheets t
SET job_id = b.jr_id
FROM best b
WHERE t.id = b.ts_id
  AND b.rn = 1
  AND b.score >= 13
  AND t.job_id IS NULL;

-- ─── 3. Backfill timesheet_entries.job_id from parent timesheet ─────────────
-- Safe: dev (126 entries) + prod (693 entries) both have 0 mismatched
-- (te.job_sheet_id, t.job_sheet_id) pairs. Office/remote entries with
-- no timesheet_id remain NULL.
UPDATE timesheet_entries te
SET job_id = t.job_id
FROM timesheets t
WHERE te.timesheet_id = t.id
  AND t.job_id IS NOT NULL
  AND te.job_id IS NULL;

-- ─── 4. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_timesheets_job_id        ON timesheets(job_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_job_id ON timesheet_entries(job_id);

-- ─── 5. Post-flight summary (visible in apply logs) ─────────────────────────
DO $$
DECLARE
  ts_total       int;
  ts_linked      int;
  te_total       int;
  te_linked      int;
  te_no_ts       int;
BEGIN
  SELECT count(*), count(job_id) INTO ts_total, ts_linked FROM timesheets;
  SELECT count(*), count(job_id),
         count(*) FILTER (WHERE timesheet_id IS NULL)
    INTO te_total, te_linked, te_no_ts
    FROM timesheet_entries;
  RAISE NOTICE 'timesheets:        % total, % linked to job_id (% legacy NULL)',
    ts_total, ts_linked, ts_total - ts_linked;
  RAISE NOTICE 'timesheet_entries: % total, % linked to job_id (% legacy NULL, of which % have no parent timesheet)',
    te_total, te_linked, te_total - te_linked, te_no_ts;
END $$;
