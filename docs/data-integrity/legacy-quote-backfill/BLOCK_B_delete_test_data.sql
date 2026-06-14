-- ════════════════════════════════════════════════════════════════════
-- LEGACY QUOTE BACKFILL — Block B: Delete test data + empty jobs
--
-- Deletes:
--   1. 4 test-client quotes + their quote_lines
--   2. 1 test-client invoice + its invoice_lines (already deleted in Phase 1d
--      preflight cleanup if applicable, but idempotent)
--   3. 2 empty job_requests with zero children
--
-- All deletions verified safe (no FK references) via Phase 0/Phase 3 audits.
-- Idempotent — uses IN clauses that no-op if rows already gone.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Disable freeze trigger for the duration (test-client data may be in is_draft=false state from migrations)
ALTER TABLE quote_lines    DISABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines  DISABLE TRIGGER invoice_lines_freeze_iud_trg;
ALTER TABLE quotes         DISABLE TRIGGER quotes_freeze_trg;
ALTER TABLE invoices       DISABLE TRIGGER invoices_freeze_trg;

-- ─── 1. Test client quotes + lines ──────────────────────────────────
DELETE FROM quote_lines WHERE quote_id IN (
  'test-client-any-event.--2026-04-29',
  'test-client-fakeevent-2026-06-01',
  'test-client-fakeevent-1777471747511',
  'test-client-test-event...-no-linking-2026-05-11'
);

DELETE FROM quotes WHERE id IN (
  'test-client-any-event.--2026-04-29',
  'test-client-fakeevent-2026-06-01',
  'test-client-fakeevent-1777471747511',
  'test-client-test-event...-no-linking-2026-05-11'
);

-- ─── 2. Test-client invoice + lines ─────────────────────────────────
DELETE FROM invoice_lines WHERE invoice_id = 'inv-1777473948476-test-client-fakeevent-2026-06-01';
DELETE FROM invoices WHERE id = 'inv-1777473948476-test-client-fakeevent-2026-06-01';

-- ─── 3. Empty job_requests (verified zero children in audit) ────────
DELETE FROM job_requests
WHERE id IN ('jobreq-1775064576002','jobreq-1776229712651');

-- ─── Re-enable triggers ─────────────────────────────────────────────
ALTER TABLE quote_lines    ENABLE TRIGGER quote_lines_freeze_iud_trg;
ALTER TABLE invoice_lines  ENABLE TRIGGER invoice_lines_freeze_iud_trg;
ALTER TABLE quotes         ENABLE TRIGGER quotes_freeze_trg;
ALTER TABLE invoices       ENABLE TRIGGER invoices_freeze_trg;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  remaining_test_q int;
  remaining_test_i int;
  remaining_empty_jr int;
BEGIN
  SELECT count(*) INTO remaining_test_q FROM quotes WHERE id IN (
    'test-client-any-event.--2026-04-29',
    'test-client-fakeevent-2026-06-01',
    'test-client-fakeevent-1777471747511',
    'test-client-test-event...-no-linking-2026-05-11'
  );
  SELECT count(*) INTO remaining_test_i FROM invoices WHERE id = 'inv-1777473948476-test-client-fakeevent-2026-06-01';
  SELECT count(*) INTO remaining_empty_jr FROM job_requests WHERE id IN ('jobreq-1775064576002','jobreq-1776229712651');

  IF remaining_test_q <> 0 OR remaining_test_i <> 0 OR remaining_empty_jr <> 0 THEN
    RAISE EXCEPTION 'Block B verification failed: test_quotes=%, test_invoice=%, empty_jobs=% (all expect 0)',
      remaining_test_q, remaining_test_i, remaining_empty_jr;
  END IF;
  RAISE NOTICE 'Block B complete: all test data + empty jobs removed.';
END;
$$;

COMMIT;
