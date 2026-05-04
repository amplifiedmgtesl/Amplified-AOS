-- Lock in the job_no naming convention with a uniqueness guarantee.
-- Prereq: 20260503a (adds + backfills job_no) AND duplicate cleanup
-- (3 rows on Loud&Clear KY Event + Alive Productions Revival Night).
--
-- Validation block runs first; if any duplicates remain, the migration
-- aborts cleanly without leaving a half-applied constraint.

DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT job_no FROM job_requests WHERE job_no IS NOT NULL
    GROUP BY job_no HAVING count(*) > 1
  ) sub;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot add unique constraint: % duplicate job_no group(s) still present. Resolve before applying.', dup_count;
  END IF;
END $$;

-- Partial unique index: enforces uniqueness only on non-null job_no values.
-- A row with no job_no yet (e.g. brand-new draft missing components) won't
-- conflict; once the user fills in the source fields, uniqueness applies.
DROP INDEX IF EXISTS job_requests_job_no_unique;
CREATE UNIQUE INDEX job_requests_job_no_unique
  ON job_requests (job_no)
  WHERE job_no IS NOT NULL;

-- Optional sanity: event_abbr length and shape constraints. Defends
-- against malformed values reaching the column from any future write path.
ALTER TABLE job_requests
  DROP CONSTRAINT IF EXISTS job_requests_event_abbr_format;
ALTER TABLE job_requests
  ADD CONSTRAINT job_requests_event_abbr_format
  CHECK (event_abbr IS NULL OR (length(event_abbr) <= 8 AND event_abbr ~ '^[A-Z0-9]+$'));
