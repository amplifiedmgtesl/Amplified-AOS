ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS venue_zip text;
