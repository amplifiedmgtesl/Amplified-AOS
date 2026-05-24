-- Extend shifts to the crew side.
--
-- The 20260512a shift migration added shift_id to quote_lines + invoice_lines
-- but skipped the planning/operational side. Without shift_id on
-- job_request_crew_needs we can't say "we need 5 stagehands on Load In + 3
-- on Show Call" — only one combined number per (day, position). Without
-- shift_id on job_request_assignments we can't say "Mike is on Load In,
-- Sarah is on Show" — assignments are flat per day.
--
-- This migration:
--   1. Adds nullable shift_id FK to both tables (ON DELETE RESTRICT — same
--      as the line side; a shift with crew assignments can't be hard-deleted).
--   2. Replaces the assignments unique index to allow the same employee on
--      different shifts of the same day. NULL shift_id collapses via COALESCE
--      so the "no-shift" bucket still has uniqueness within it.
--
-- Backfill: all existing rows get shift_id = NULL ("any shift / unspecified").
-- The new UI hides the Shift column when a job has zero shifts so single-shift
-- jobs stay clean. Operators can fill in shifts retroactively where useful.

-- ─── 1. crew_needs.shift_id ─────────────────────────────────────────────

ALTER TABLE job_request_crew_needs
  ADD COLUMN IF NOT EXISTS shift_id text REFERENCES job_request_shifts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS job_request_crew_needs_shift_idx
  ON job_request_crew_needs(shift_id) WHERE shift_id IS NOT NULL;

-- ─── 2. assignments.shift_id ────────────────────────────────────────────

ALTER TABLE job_request_assignments
  ADD COLUMN IF NOT EXISTS shift_id text REFERENCES job_request_shifts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS job_request_assignments_shift_idx
  ON job_request_assignments(shift_id) WHERE shift_id IS NOT NULL;

-- ─── 3. Replace the day-employee uniqueness to include shift ────────────
-- Same employee may now appear twice on the same day if on different shifts
-- (Mike on Load In AND Show Call). Within a single shift (or the NULL bucket),
-- still no duplicates.

DROP INDEX IF EXISTS job_request_assignments_unique_employee_day;
CREATE UNIQUE INDEX IF NOT EXISTS job_request_assignments_unique_employee_day_shift
  ON job_request_assignments(job_request_day_id, COALESCE(shift_id, ''), employee_key)
  WHERE employee_key IS NOT NULL;

-- ─── 4. Final state report ──────────────────────────────────────────────

SELECT 'crew_needs total'        AS metric, count(*) AS n FROM job_request_crew_needs
UNION ALL
SELECT 'crew_needs with shift',  count(*) FROM job_request_crew_needs WHERE shift_id IS NOT NULL
UNION ALL
SELECT 'assignments total',      count(*) FROM job_request_assignments
UNION ALL
SELECT 'assignments with shift', count(*) FROM job_request_assignments WHERE shift_id IS NOT NULL;
