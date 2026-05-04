-- Per-day crew assignments on a job request. The actual people scheduled
-- to work each day, paired with the role they're filling. Replaces the
-- legacy job_sheet_workers concept (which is single-day-per-job_sheet
-- and not coupled to the job_request days). When this fills in across
-- the system, the job_sheets table becomes deletable.
--
-- Relationship to job_request_crew_needs:
--   crew_needs  = "client wants 4 stagehands on Day 1"   (target)
--   assignments = "Joe and Mike and Sara and Tim are the 4 stagehands" (actual)

CREATE TABLE IF NOT EXISTS job_request_assignments (
  id                  text PRIMARY KEY,
  job_request_day_id  text NOT NULL REFERENCES job_request_days(id) ON DELETE CASCADE,
  employee_key        text REFERENCES employees(employee_key),
  position_id         text REFERENCES positions(id),
  specialty_id        text REFERENCES specialties(id),
  confirmed           boolean NOT NULL DEFAULT false,
  notes               text,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_request_assignments_day_id_idx
  ON job_request_assignments(job_request_day_id);
CREATE INDEX IF NOT EXISTS job_request_assignments_employee_idx
  ON job_request_assignments(employee_key);

ALTER TABLE job_request_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_request_assignments_full_access" ON job_request_assignments;
CREATE POLICY "job_request_assignments_full_access" ON job_request_assignments
  FOR ALL USING (true);

-- Prevent duplicate assignments: same employee can't be scheduled twice for
-- the same day on the same job. (Different days are fine — a worker can be
-- on every day of a multi-day job.)
DROP INDEX IF EXISTS job_request_assignments_unique_employee_day;
CREATE UNIQUE INDEX job_request_assignments_unique_employee_day
  ON job_request_assignments(job_request_day_id, employee_key)
  WHERE employee_key IS NOT NULL;
