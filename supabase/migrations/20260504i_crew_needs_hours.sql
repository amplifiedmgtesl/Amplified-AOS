-- Per-position-per-day hours on job_request_crew_needs.
--
-- Default flow: when a need is created, hours is seeded from the day's
-- expected_hours so the user always sees a concrete number rather than NULL.
-- The user can override per-row (e.g., 4 hour rehearsal call for an audio
-- tech on a day where everyone else works 10).
--
-- The quote-create flow uses need.hours directly when seeding line.hours.

ALTER TABLE job_request_crew_needs
  ADD COLUMN IF NOT EXISTS hours numeric;

-- Backfill existing rows from their day's expected_hours so the new column
-- isn't NULL on data created before this migration.
UPDATE job_request_crew_needs c
   SET hours = d.expected_hours
  FROM job_request_days d
 WHERE c.job_request_day_id = d.id
   AND c.hours IS NULL
   AND d.expected_hours IS NOT NULL;
