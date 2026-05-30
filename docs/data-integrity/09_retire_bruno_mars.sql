-- ════════════════════════════════════════════════════════════════════
-- BRUNO MARS (Rhino Staging, 2026-05-16..21) — retire abandoned sibling
--
-- 2 rows exist for the same real-world event (past — already happened).
-- Keep the fully-populated one; soft-retire the abandoned sibling
-- (status='cancelled') so it stays out of pickers but its row remains
-- as audit trail.
--
-- KEEP    jobreq-1778094212255  (5 days, 12 crew_needs, 1 quote w/ 12 lines)
-- RETIRE  jobreq-1777684960205  (4 days, 6 crew_needs, no quote)
--
-- Why soft-retire instead of DELETE? The event already happened, the
-- abandoned row may have ghost timesheet entries or calendar events
-- via free-text matches that surface only after V2 is live. Soft
-- retire preserves the row so we can re-point those later if found.
-- Hard delete can happen during the post-V2 hard-delete cleanup pass
-- (see project_todo.md — "Hard-delete cleanup project").
--
-- Prereq: Phase 2 migrations applied.
-- Run 06_audit_duplicate_jobs.sql FIRST.
-- Idempotent (re-running just re-applies the same UPDATE).
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Verify the keeper still has its data (sanity check before retiring sibling)
DO $$
DECLARE
  keep_days       int;
  keep_quote_ct   int;
  sib_quote_ct    int;
BEGIN
  SELECT count(*) INTO keep_days
    FROM job_request_days WHERE job_request_id = 'jobreq-1778094212255';
  SELECT count(*) INTO keep_quote_ct
    FROM quotes WHERE job_request_id = 'jobreq-1778094212255' OR linked_job_request_id = 'jobreq-1778094212255';
  SELECT count(*) INTO sib_quote_ct
    FROM quotes WHERE job_request_id = 'jobreq-1777684960205' OR linked_job_request_id = 'jobreq-1777684960205';

  IF keep_days = 0 OR keep_quote_ct = 0 THEN
    RAISE EXCEPTION
      'Bruno Mars sanity-check failed: keeper has days=% quotes=% — refusing to retire sibling', keep_days, keep_quote_ct;
  END IF;

  IF sib_quote_ct > 0 THEN
    RAISE EXCEPTION
      'Bruno Mars sibling has % quote(s) attached — review before retiring (expected 0)', sib_quote_ct;
  END IF;

  RAISE NOTICE 'Bruno Mars pre-flight clean — keeper has days=% quotes=%, sibling has quotes=0', keep_days, keep_quote_ct;
END;
$$;

UPDATE job_requests
   SET status = 'cancelled',
       notes  = COALESCE(notes,'') || E'\n[V2 cutover '||to_char(current_date,'YYYY-MM-DD')||']: retired as duplicate of jobreq-1778094212255'
 WHERE id = 'jobreq-1777684960205'
   AND status IS DISTINCT FROM 'cancelled';

DO $$
DECLARE
  s text;
BEGIN
  SELECT status INTO s FROM job_requests WHERE id = 'jobreq-1777684960205';
  RAISE NOTICE 'Bruno Mars post-flight: abandoned sibling status=%', s;
END;
$$;

COMMIT;
