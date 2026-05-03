-- Adds the user-facing "job_no" identifier to job_requests, plus a
-- user-overridable event abbreviation it's derived from. This is the base
-- composite the entire system will use for display:
--   AES_YYMMDDDD_CLI_EVENT
-- See project_todo.md (Display-code naming convention) for the full design.
--
-- Phase 1 (this migration): adds columns + backfills. job_no is NOT yet unique
-- enforced — that comes after the editor lands and any backfill collisions get
-- a chance to be resolved by hand.

ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS event_abbr text,
  ADD COLUMN IF NOT EXISTS job_no     text;

-- Backfill event_abbr from event_name: alphanumeric chars only, uppercase,
-- truncated to 8. Same rule the editor will use as the default suggestion.
UPDATE job_requests
SET event_abbr = upper(substring(regexp_replace(coalesce(event_name, ''), '[^a-zA-Z0-9]', '', 'g'), 1, 8))
WHERE event_abbr IS NULL;

-- Backfill job_no for rows that have all the components we need.
-- Format: AES_YYMMDD[DD]_CLI_EVENT
--   YYMMDD = start date (request_date)
--   second DD = end_date day, only when end_date != start_date AND end_date is set
--   CLI = clients.code (3 chars; we just enforced the format)
--   EVENT = event_abbr from above
-- Skips rows missing request_date, client.code, or event_abbr.
UPDATE job_requests jr
SET job_no = 'AES_'
  || to_char(jr.request_date::date, 'YYMMDD')
  || CASE
       WHEN jr.end_date IS NOT NULL
            AND jr.end_date <> ''
            AND jr.end_date ~ '^\d{4}-\d{2}-\d{2}$'
            AND jr.end_date::date <> jr.request_date::date
       THEN to_char(jr.end_date::date, 'DD')
       ELSE ''
     END
  || '_' || c.code
  || '_' || jr.event_abbr
FROM clients c
WHERE jr.client_id = c.id
  AND c.code IS NOT NULL
  AND jr.event_abbr IS NOT NULL
  AND jr.event_abbr <> ''
  AND jr.request_date IS NOT NULL
  AND jr.request_date <> ''
  AND jr.request_date ~ '^\d{4}-\d{2}-\d{2}$'
  AND jr.job_no IS NULL;

-- Report any duplicates that the unique constraint would reject. The constraint
-- itself is deferred to a follow-up migration once collisions are resolved.
DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT job_no FROM job_requests WHERE job_no IS NOT NULL
    GROUP BY job_no HAVING count(*) > 1
  ) sub;
  IF dup_count > 0 THEN
    RAISE NOTICE 'job_no backfill produced % duplicate group(s). Resolve by editing event_abbr before adding the unique constraint.', dup_count;
  END IF;
END $$;
