-- Add received_date to job_requests: the date the inquiry/request came in.
-- Distinct from request_date which is the event start date.

ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS received_date text;

-- Seed all existing rows with April 1 of current year as the best available approximation.
UPDATE job_requests
SET received_date = '2026-04-01'
WHERE received_date IS NULL;
