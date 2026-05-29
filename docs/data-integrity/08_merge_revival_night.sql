-- ════════════════════════════════════════════════════════════════════
-- REVIVAL NIGHT (Alive Productions, 2026-04-17) — delete empty sibling
--
-- 2 rows exist for the same real-world event. Keep the one with notes
-- content; delete the empty one.
--
-- KEEP   jobreq-1775344443515  (has notes)
-- DELETE jobreq-1775227265513  (empty)
--
-- Prereq: Phase 2 migrations applied.
-- Run 06_audit_duplicate_jobs.sql FIRST.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  refs int;
BEGIN
  SELECT
      (SELECT count(*) FROM quotes              WHERE job_request_id        = 'jobreq-1775227265513')
    + (SELECT count(*) FROM quotes              WHERE linked_job_request_id = 'jobreq-1775227265513')
    + (SELECT count(*) FROM invoices            WHERE job_request_id        = 'jobreq-1775227265513')
    + (SELECT count(*) FROM calendar_events     WHERE linked_job_request_id = 'jobreq-1775227265513')
    + (SELECT count(*) FROM job_costing_drafts  WHERE linked_job_request_id = 'jobreq-1775227265513')
    + (SELECT count(*) FROM timesheets          WHERE job_id                = 'jobreq-1775227265513')
    + (SELECT count(*) FROM timesheet_entries   WHERE job_id                = 'jobreq-1775227265513')
    + (SELECT count(*) FROM job_request_attachments WHERE job_request_id    = 'jobreq-1775227265513')
  INTO refs;

  IF refs > 0 THEN
    RAISE EXCEPTION
      'Revival Night sibling deletion aborted: % external reference(s) found.', refs;
  END IF;

  RAISE NOTICE 'Revival Night pre-flight clean — proceeding.';
END;
$$;

DELETE FROM job_requests WHERE id = 'jobreq-1775227265513';

DO $$
DECLARE
  kept    int;
  deleted int;
BEGIN
  SELECT count(*) INTO kept    FROM job_requests WHERE id = 'jobreq-1775344443515';
  SELECT count(*) INTO deleted FROM job_requests WHERE id = 'jobreq-1775227265513';
  RAISE NOTICE 'Revival Night post-flight: keeper exists=%, sibling remaining=% (expect 1 / 0)', kept, deleted;
END;
$$;

COMMIT;
