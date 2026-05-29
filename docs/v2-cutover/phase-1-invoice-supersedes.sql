-- ════════════════════════════════════════════════════════════════════
-- PHASE 1d — INVOICE SUPERSEDE DECISIONS (PROD-SPECIFIC)
--
-- Resolves the 4 duplicate-invoice clusters surfaced by
-- 00_prod_preflight_audit.sql Sections 3a + 3b. Each conflict cluster
-- must have exactly ONE non-superseded/non-void/non-draft row before
-- migration #23 (20260506b_invoices_extend_for_rewrite.sql) builds its
-- partial unique indices.
--
-- Resolution rule (per the playbook):
--   paid > sent (partial) > sent (unpaid); recovered-* loses to
--   non-recovered; older twin loses to newer twin.
--
-- Supersede does NOT unpaid the invoice — payment records stay
-- attached. It removes the row from the "active" set so the unique
-- index can be built.
--
-- All UPDATEs are read-back-verified by post-flight SELECTs.
-- Idempotent — re-running sees status='superseded' already and is
-- a no-op (status already in the excluded set, no rows match).
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Cluster 1 — jobreq-1775073944709 (Loud&Clear) ──────────────────

-- Deposits: 2 paid, keep newer/larger ($890), supersede older ($840)
UPDATE invoices SET status = 'superseded'
 WHERE id = 'inv-deposit-1775076872973';  -- INV-2026-0401-645-DEP $840 paid

-- Finals: 1 real paid, 1 recovered sent — supersede the recovered
UPDATE invoices SET status = 'superseded'
 WHERE id = 'inv-recovered-770ff8c3';     -- INV-2026-0419-808 sent (recovered dup)

-- ─── Cluster 2 — jobreq-1777325737896 ──────────────────────────────

-- Deposits: 3 rows, two identical $2990 twins + 1 recovered $2676.80
-- Keep newer $2990 twin (inv-deposit-1776986749588? CHECK — see note)
-- NOTE: from audit output, both $2990 twins have status='sent'.
-- Choosing the newer-id one as winner. Older twin + recovered both lose.
UPDATE invoices SET status = 'superseded'
 WHERE id IN (
   'inv-deposit-1776985961946',  -- INV-2026-0423-695-DEP $2990.40 sent (older twin)
   'inv-recovered-cc078ebd'      -- INV-2026-0424-352-DEP $2676.80 SENT (recovered, lower amount)
 );

-- Finals: 3 rows
--   - inv-1777300439133  INV-2026-0424-352 [partial]  — older; partial payment
--   - inv-1779151840416  INV-2026-0518-273 AES_*      — newer (the Revise output)
--   - inv-recovered-922d482c  INV-2026-0424-352 [partial]  — recovered dup
--
-- Decision: supersede the recovered dup AND the older -352.
-- Keep the newer AES_-format -273 as the active final.
-- The partial payment stays on -352 (superseded) as historical record.
UPDATE invoices SET status = 'superseded'
 WHERE id IN (
   'inv-recovered-922d482c',     -- recovered dup
   'inv-1777300439133'           -- INV-2026-0424-352 partial (older, revised)
 );

-- ─── Post-flight verification ────────────────────────────────────────
-- Each cluster should now have exactly ONE active invoice per type.

DO $$
DECLARE
  c1_dep_active  int;
  c1_fin_active  int;
  c2_dep_active  int;
  c2_fin_active  int;
BEGIN
  SELECT count(*) INTO c1_dep_active FROM invoices i JOIN quotes q ON q.id = i.quote_id
   WHERE q.linked_job_request_id = 'jobreq-1775073944709'
     AND i.invoice_no LIKE '%-DEP%'
     AND (i.status IS NULL OR LOWER(i.status) NOT IN ('superseded','void','draft'));

  SELECT count(*) INTO c1_fin_active FROM invoices i JOIN quotes q ON q.id = i.quote_id
   WHERE q.linked_job_request_id = 'jobreq-1775073944709'
     AND i.invoice_no NOT LIKE '%-DEP%'
     AND (i.status IS NULL OR LOWER(i.status) NOT IN ('superseded','void','draft'));

  SELECT count(*) INTO c2_dep_active FROM invoices i JOIN quotes q ON q.id = i.quote_id
   WHERE q.linked_job_request_id = 'jobreq-1777325737896'
     AND i.invoice_no LIKE '%-DEP%'
     AND (i.status IS NULL OR LOWER(i.status) NOT IN ('superseded','void','draft'));

  SELECT count(*) INTO c2_fin_active FROM invoices i JOIN quotes q ON q.id = i.quote_id
   WHERE q.linked_job_request_id = 'jobreq-1777325737896'
     AND i.invoice_no NOT LIKE '%-DEP%'
     AND (i.status IS NULL OR LOWER(i.status) NOT IN ('superseded','void','draft'));

  RAISE NOTICE 'Cluster 1 (jobreq-1775073944709): deposits_active=%, finals_active=% (expect 1, 1)', c1_dep_active, c1_fin_active;
  RAISE NOTICE 'Cluster 2 (jobreq-1777325737896): deposits_active=%, finals_active=% (expect 1, 1)', c2_dep_active, c2_fin_active;

  IF c1_dep_active <> 1 OR c1_fin_active <> 1 OR c2_dep_active <> 1 OR c2_fin_active <> 1 THEN
    RAISE EXCEPTION 'Supersede did not leave exactly 1 active invoice per type/cluster — aborting.';
  END IF;
END;
$$;

COMMIT;
