-- ════════════════════════════════════════════════════════════════════
-- DEPOSIT STRAY-LINES CLEANUP
--
-- Companion to 04_audit_deposits.sql Check 1.
--
-- Deletes invoice_lines rows on deposit invoices where:
--   * The invoice is type='deposit' (or invoice_no LIKE '%-DEP%' for
--     pre-rewrite rows where invoice_type wasn't populated)
--   * lines_sum == deposit_subtotal (so deleting doesn't change any
--     displayed value — the deposit PDF synthesizes a single
--     "Deposit" row at display time and doesn't read invoice_lines)
--
-- Idempotent — re-running is safe. Second run finds no remaining
-- stray lines on deposits and does nothing.
--
-- Bypasses the invoice_lines freeze trigger (same idiom as migrations
-- 20260511a, 20260512a, 20260525a). Trigger disabled inside the
-- transaction; re-enabled before COMMIT. If anything throws, the
-- ROLLBACK restores the trigger via the transaction snapshot.
--
-- SAFETY GUARANTEE: the WHERE clause requires lines_sum == subtotal
-- to within $0.005. If a deposit's stray lines DON'T reconcile to its
-- subtotal, they aren't deleted — surfaces as drift in a re-run of
-- 04_audit_deposits Check 1 for human review.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE invoice_lines DISABLE TRIGGER invoice_lines_freeze_iud_trg;

DELETE FROM invoice_lines il
USING invoices i,
      (
        SELECT invoice_id, SUM(COALESCE(total,0)) AS lines_sum
          FROM invoice_lines
         GROUP BY invoice_id
      ) s
WHERE i.id = il.invoice_id
  AND s.invoice_id = i.id
  AND (
        i.invoice_type = 'deposit'
        OR (i.invoice_no LIKE '%-DEP%' AND i.invoice_type IS NULL)
      )
  AND ABS(COALESCE(i.subtotal,0) - s.lines_sum) < 0.005;

ALTER TABLE invoice_lines ENABLE TRIGGER invoice_lines_freeze_iud_trg;

COMMIT;

-- ─── Verification ────────────────────────────────────────────────────
-- Re-run 04_audit_deposits.sql Check 1 — should return 0 rows.
