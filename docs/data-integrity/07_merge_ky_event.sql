-- ════════════════════════════════════════════════════════════════════
-- KY EVENT (Loud&Clear, 2026-04-05) — delete 2 empty siblings
--
-- 3 rows exist for the same real-world event. Keep the one with the
-- linked quote; delete the two empty ones.
--
-- KEEP   jobreq-1775346228492  (has linked quote client-event-1774997531865)
-- DELETE jobreq-1775346126232  (empty)
-- DELETE jobreq-1775345942610  (empty)
--
-- Prereq: Phase 2 migrations applied (so FK columns + cascades exist).
-- Run 06_audit_duplicate_jobs.sql FIRST, confirm the to-delete rows
-- have zero references across every column shown.
--
-- Idempotent — second run finds no matching rows and does nothing.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Pre-flight inside the transaction — abort cleanly if anything still
-- references the to-delete rows. Counts must all be zero.
DO $$
DECLARE
  refs int;
BEGIN
  SELECT
      (SELECT count(*) FROM quotes              WHERE job_request_id        IN ('jobreq-1775346126232','jobreq-1775345942610'))
    + (SELECT count(*) FROM quotes              WHERE linked_job_request_id IN ('jobreq-1775346126232','jobreq-1775345942610'))
    + (SELECT count(*) FROM invoices            WHERE job_request_id        IN ('jobreq-1775346126232','jobreq-1775345942610'))
    + (SELECT count(*) FROM calendar_events     WHERE linked_job_request_id IN ('jobreq-1775346126232','jobreq-1775345942610'))
    + (SELECT count(*) FROM job_costing_drafts  WHERE linked_job_request_id IN ('jobreq-1775346126232','jobreq-1775345942610'))
    + (SELECT count(*) FROM timesheets          WHERE job_id                IN ('jobreq-1775346126232','jobreq-1775345942610'))
    + (SELECT count(*) FROM timesheet_entries   WHERE job_id                IN ('jobreq-1775346126232','jobreq-1775345942610'))
    + (SELECT count(*) FROM job_request_attachments WHERE job_request_id    IN ('jobreq-1775346126232','jobreq-1775345942610'))
  INTO refs;

  IF refs > 0 THEN
    RAISE EXCEPTION
      'KY Event sibling deletion aborted: % external reference(s) found. Re-run 06_audit_duplicate_jobs.sql to identify.', refs;
  END IF;

  RAISE NOTICE 'KY Event pre-flight clean — proceeding with deletion of 2 sibling rows.';
END;
$$;

-- Cascade deletes job_request_days, _crew_needs, _assignments, _shifts,
-- _attachments via existing ON DELETE CASCADE.
DELETE FROM job_requests
 WHERE id IN ('jobreq-1775346126232','jobreq-1775345942610');

-- Verification — should report 'kept=1, deleted=2'
DO $$
DECLARE
  kept    int;
  deleted int;
BEGIN
  SELECT count(*) INTO kept    FROM job_requests WHERE id = 'jobreq-1775346228492';
  SELECT count(*) INTO deleted FROM job_requests WHERE id IN ('jobreq-1775346126232','jobreq-1775345942610');
  RAISE NOTICE 'KY Event post-flight: keeper exists=%, siblings remaining=% (expect 1 / 0)', kept, deleted;
END;
$$;

COMMIT;
