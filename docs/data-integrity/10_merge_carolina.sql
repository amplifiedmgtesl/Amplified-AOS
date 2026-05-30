-- ════════════════════════════════════════════════════════════════════
-- CAROLINA COUNTRY MUSIC FEST (Loud&Clear, 2026-05-31) — TRUE MERGE
--
-- Two rows exist with COMPLEMENTARY data — must be merged, not just
-- one-side-deleted.
--
-- KEEP        jobreq-1779670159567  (10 days, 40 crew_needs, 0 quotes, 1 attachment)
-- MERGE FROM  jobreq-1778348194976  (10 days, 0  crew_needs, 1 quote w/79 lines, 0 attachments)
--
-- The quote on source needs to move to target. Source's shifts
-- (created by Phase 2 migration 20260512a's backfill from quote_lines.
-- shift_label) need to move to target — they'll appear case-insensitive
-- on target via job_request_shifts.label, so we copy with new IDs and
-- re-point quote_lines.shift_id.
--
-- Target's 10 days + 40 crew_needs are authoritative. Source's 10 days
-- are duplicates of target's calendar dates and get deleted when source
-- is removed (cascade).
--
-- Prereq:
--   * Phase 2 schema migrations applied to prod (quote.job_request_id
--     FK + freeze triggers + job_request_shifts table all present)
--   * 06_audit_duplicate_jobs.sql output reviewed
--   * Source quote's status confirmed via:
--       SELECT id, is_draft, status FROM quotes WHERE job_request_id = 'jobreq-1778348194976'
--         OR linked_job_request_id = 'jobreq-1778348194976';
--     The merge handles both draft and frozen quotes by temporarily
--     disabling the freeze triggers inside the transaction.
--
-- TIME-PRESSURED: event is 2026-05-31. Run before that date even if
-- the broader V2 cutover slips.
--
-- Idempotent — second run sees source row gone and exits early.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 0. Idempotency guard ────────────────────────────────────────────
DO $$
DECLARE
  src_exists boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM job_requests WHERE id = 'jobreq-1778348194976') INTO src_exists;
  IF NOT src_exists THEN
    RAISE NOTICE 'Carolina merge: source jobreq-1778348194976 already gone — nothing to do.';
    -- Cause a clean abort of the rest of the script
    RAISE EXCEPTION 'idempotency_noop';
  END IF;
END;
$$;

-- ─── 1. Pre-flight: target exists + shape sanity ─────────────────────
DO $$
DECLARE
  tgt_exists  boolean;
  tgt_days    int;
  tgt_needs   int;
  src_quote_ct int;
  tgt_quote_ct int;
BEGIN
  SELECT EXISTS(SELECT 1 FROM job_requests WHERE id = 'jobreq-1779670159567') INTO tgt_exists;
  IF NOT tgt_exists THEN
    RAISE EXCEPTION 'Carolina merge: target jobreq-1779670159567 missing — aborting.';
  END IF;

  SELECT count(*) INTO tgt_days  FROM job_request_days WHERE job_request_id = 'jobreq-1779670159567';
  SELECT count(*) INTO tgt_needs FROM job_request_crew_needs cn
    JOIN job_request_days d ON d.id = cn.job_request_day_id
    WHERE d.job_request_id = 'jobreq-1779670159567';
  SELECT count(*) INTO src_quote_ct FROM quotes
    WHERE job_request_id = 'jobreq-1778348194976' OR linked_job_request_id = 'jobreq-1778348194976';
  SELECT count(*) INTO tgt_quote_ct FROM quotes
    WHERE job_request_id = 'jobreq-1779670159567' OR linked_job_request_id = 'jobreq-1779670159567';

  IF tgt_days = 0 OR tgt_needs = 0 THEN
    RAISE EXCEPTION 'Carolina merge: target shape unexpected (days=%, needs=%) — aborting.', tgt_days, tgt_needs;
  END IF;

  IF tgt_quote_ct > 0 THEN
    RAISE EXCEPTION 'Carolina merge: target already has % quote(s) — abort, this case needs manual review.', tgt_quote_ct;
  END IF;

  RAISE NOTICE 'Carolina pre-flight: target days=%, crew_needs=%, src quotes to move=%', tgt_days, tgt_needs, src_quote_ct;
END;
$$;

-- ─── 2. Disable freeze triggers for the duration of the transaction ──
ALTER TABLE quotes        DISABLE TRIGGER quotes_freeze_trg;
ALTER TABLE quote_lines   DISABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoices      DISABLE TRIGGER invoices_freeze_trg;
ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 3. Copy source's shifts onto target (with new ids) ──────────────
-- Case-insensitive uniqueness per job means we don't collide unless
-- target already has a shift with the same label. Target has 0 quotes
-- so it's extremely unlikely to have any shifts — but we ON CONFLICT
-- defensively in case the operator created one via the new UI.
WITH src_shifts AS (
  SELECT id, label, sort_order, is_active
    FROM job_request_shifts
   WHERE job_request_id = 'jobreq-1778348194976'
)
INSERT INTO job_request_shifts (id, job_request_id, label, sort_order, is_active)
SELECT
  'shift-' || replace(gen_random_uuid()::text,'-',''),
  'jobreq-1779670159567',
  s.label,
  s.sort_order,
  s.is_active
FROM src_shifts s
ON CONFLICT (job_request_id, lower(trim(label))) DO NOTHING;

-- ─── 4. Re-point quote_lines.shift_id from source-shift → target-shift
-- Match by case-insensitive label. Lines whose source shift now has a
-- twin on target by label get re-pointed; if the ON CONFLICT skipped
-- copying (target already had that label), this still resolves to the
-- pre-existing target shift.
UPDATE quote_lines ql
   SET shift_id = ts.id
  FROM job_request_shifts ss
  JOIN job_request_shifts ts
    ON lower(trim(ts.label)) = lower(trim(ss.label))
   AND ts.job_request_id = 'jobreq-1779670159567'
 WHERE ql.shift_id = ss.id
   AND ss.job_request_id = 'jobreq-1778348194976';

-- Same remap for invoice_lines.shift_id
UPDATE invoice_lines il
   SET shift_id = ts.id
  FROM job_request_shifts ss
  JOIN job_request_shifts ts
    ON lower(trim(ts.label)) = lower(trim(ss.label))
   AND ts.job_request_id = 'jobreq-1779670159567'
 WHERE il.shift_id = ss.id
   AND ss.job_request_id = 'jobreq-1778348194976';

-- Verify no line on either table still references a source-side shift
DO $$
DECLARE
  stuck_q int;
  stuck_i int;
BEGIN
  SELECT count(*) INTO stuck_q
    FROM quote_lines ql
    JOIN job_request_shifts s ON s.id = ql.shift_id
   WHERE s.job_request_id = 'jobreq-1778348194976';

  SELECT count(*) INTO stuck_i
    FROM invoice_lines il
    JOIN job_request_shifts s ON s.id = il.shift_id
   WHERE s.job_request_id = 'jobreq-1778348194976';

  IF stuck_q > 0 OR stuck_i > 0 THEN
    RAISE EXCEPTION 'Carolina merge: % quote_line(s) + % invoice_line(s) still reference source-side shifts — aborting.', stuck_q, stuck_i;
  END IF;
END;
$$;

-- ─── 5. Re-point the quote(s) themselves ─────────────────────────────
-- New FK column (post-#10)
UPDATE quotes
   SET job_request_id = 'jobreq-1779670159567'
 WHERE job_request_id = 'jobreq-1778348194976';

-- Legacy text column (still present pre-#21 drop)
UPDATE quotes
   SET linked_job_request_id = 'jobreq-1779670159567'
 WHERE linked_job_request_id = 'jobreq-1778348194976';

-- ─── 6. Re-point invoices (if any — memory says none, but safe to run)
UPDATE invoices
   SET job_request_id = 'jobreq-1779670159567'
 WHERE job_request_id = 'jobreq-1778348194976';

-- ─── 7. Re-point other id-anchored refs ──────────────────────────────
UPDATE calendar_events
   SET linked_job_request_id = 'jobreq-1779670159567'
 WHERE linked_job_request_id = 'jobreq-1778348194976';

UPDATE job_costing_drafts
   SET linked_job_request_id = 'jobreq-1779670159567'
 WHERE linked_job_request_id = 'jobreq-1778348194976';

UPDATE timesheets
   SET job_id = 'jobreq-1779670159567'
 WHERE job_id = 'jobreq-1778348194976';

UPDATE timesheet_entries
   SET job_id = 'jobreq-1779670159567'
 WHERE job_id = 'jobreq-1778348194976';

-- ─── 8. Verify zero remaining references to source ───────────────────
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT
      (SELECT count(*) FROM quotes              WHERE job_request_id        = 'jobreq-1778348194976')
    + (SELECT count(*) FROM quotes              WHERE linked_job_request_id = 'jobreq-1778348194976')
    + (SELECT count(*) FROM invoices            WHERE job_request_id        = 'jobreq-1778348194976')
    + (SELECT count(*) FROM calendar_events     WHERE linked_job_request_id = 'jobreq-1778348194976')
    + (SELECT count(*) FROM job_costing_drafts  WHERE linked_job_request_id = 'jobreq-1778348194976')
    + (SELECT count(*) FROM timesheets          WHERE job_id                = 'jobreq-1778348194976')
    + (SELECT count(*) FROM timesheet_entries   WHERE job_id                = 'jobreq-1778348194976')
  INTO remaining;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'Carolina merge: % external reference(s) to source remain after re-point — aborting.', remaining;
  END IF;
  RAISE NOTICE 'Carolina merge: all references re-pointed cleanly.';
END;
$$;

-- ─── 9. Delete source — cascades remove its days/shifts/crew/attachments
DELETE FROM job_requests WHERE id = 'jobreq-1778348194976';

-- ─── 10. Re-enable freeze triggers ───────────────────────────────────
ALTER TABLE quotes        ENABLE TRIGGER quotes_freeze_trg;
ALTER TABLE quote_lines   ENABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoices      ENABLE TRIGGER invoices_freeze_trg;
ALTER TABLE invoice_lines ENABLE TRIGGER invoice_lines_freeze_iud_trg;

-- ─── 11. Post-flight report ──────────────────────────────────────────
DO $$
DECLARE
  tgt_quotes int;
  tgt_lines  int;
  tgt_needs  int;
  tgt_attach int;
  src_exists boolean;
BEGIN
  SELECT count(*) INTO tgt_quotes FROM quotes
    WHERE job_request_id = 'jobreq-1779670159567' OR linked_job_request_id = 'jobreq-1779670159567';
  SELECT count(*) INTO tgt_lines FROM quote_lines ql
    JOIN quotes q ON q.id = ql.quote_id
   WHERE q.job_request_id = 'jobreq-1779670159567' OR q.linked_job_request_id = 'jobreq-1779670159567';
  SELECT count(*) INTO tgt_needs FROM job_request_crew_needs cn
    JOIN job_request_days d ON d.id = cn.job_request_day_id
   WHERE d.job_request_id = 'jobreq-1779670159567';
  SELECT count(*) INTO tgt_attach FROM job_request_attachments
   WHERE job_request_id = 'jobreq-1779670159567';
  SELECT EXISTS(SELECT 1 FROM job_requests WHERE id = 'jobreq-1778348194976') INTO src_exists;

  RAISE NOTICE 'Carolina post-flight: target has quotes=%, quote_lines=%, crew_needs=%, attachments=%. Source still exists=% (expect false).',
    tgt_quotes, tgt_lines, tgt_needs, tgt_attach, src_exists;
END;
$$;

COMMIT;
