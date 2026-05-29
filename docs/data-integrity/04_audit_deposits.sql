-- ════════════════════════════════════════════════════════════════════
-- DEPOSIT INVOICE AUDIT (read-only)
--
-- Three deposit-specific checks:
--   1. Deposits with stray invoice_lines rows (current design = zero)
--   2. Deposits whose subtotal doesn't match source quote × deposit_pct
--   3. Frozen finals with stale deposit_applied (also in 03_audit_frozen
--      as Category D; repeated here for completeness in the deposit set)
--
-- Per the current design:
--   * Deposit invoices have NO line items — subtotal carries the
--     lump-sum deposit amount.
--   * subtotal at creation = quote.total × quote.deposit_pct / 100,
--     OR an operator-typed override.
--   * Final invoices snapshot deposit_applied at draft creation from
--     the active deposit's subtotal. Snapshot doesn't auto-refresh.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Deposits with stray line rows ────────────────────────────────
-- Pre-rewrite deposits may have line rows. List them so we can decide
-- whether lines_sum reconciles to subtotal (lines were the real source
-- and the lump is right) or whether the lines are vestigial junk.
SELECT
  '1. DEPOSITS with stray line rows' AS check_name,
  i.id AS invoice_id,
  i.invoice_no,
  i.client,
  i.event_name,
  i.subtotal AS deposit_subtotal,
  COUNT(il.id) AS stray_line_count,
  ROUND(SUM(COALESCE(il.total,0))::numeric, 2) AS lines_sum,
  ROUND((COALESCE(i.subtotal,0) - SUM(COALESCE(il.total,0)))::numeric, 2) AS delta_subtotal_minus_lines
FROM invoices i
JOIN invoice_lines il ON il.invoice_id = i.id
WHERE i.invoice_type = 'deposit'
   OR (i.invoice_no LIKE '%-DEP%' AND i.invoice_type IS NULL)
GROUP BY i.id, i.invoice_no, i.client, i.event_name, i.subtotal
ORDER BY i.invoice_no;

-- ─── 2. Deposits whose subtotal doesn't match quote × deposit_pct ────
-- Legitimate reasons to differ:
--   * Operator typed a custom amount at generation (Generate Deposit
--     modal allows this — common case)
--   * Quote was revised after the deposit was issued (pct changed)
-- Worth a list either way — Connor decides per-row.
SELECT
  '2. DEPOSITS not matching quote × deposit_pct' AS check_name,
  i.id AS invoice_id, i.invoice_no, i.client, i.event_name,
  i.subtotal AS deposit_subtotal,
  q.id AS source_quote_id, q.quote_no AS source_quote_no,
  q.total AS quote_total, q.deposit_pct AS quote_deposit_pct,
  ROUND((COALESCE(q.total,0) * COALESCE(q.deposit_pct,0) / 100.0)::numeric, 2) AS expected_deposit,
  ROUND((COALESCE(i.subtotal,0) - (COALESCE(q.total,0) * COALESCE(q.deposit_pct,0) / 100.0))::numeric, 2) AS delta
FROM invoices i
LEFT JOIN quotes q ON q.id = COALESCE(i.source_quote_id, i.quote_id)
WHERE (i.invoice_type = 'deposit' OR (i.invoice_no LIKE '%-DEP%' AND i.invoice_type IS NULL))
  AND q.id IS NOT NULL
  AND ABS(COALESCE(i.subtotal,0) - (COALESCE(q.total,0) * COALESCE(q.deposit_pct,0) / 100.0)) > 0.005
ORDER BY ABS(COALESCE(i.subtotal,0) - (COALESCE(q.total,0) * COALESCE(q.deposit_pct,0) / 100.0)) DESC;

-- ─── 2b. Deposits with no resolvable source quote ────────────────────
SELECT
  '2b. DEPOSITS with no resolvable source quote' AS check_name,
  i.id AS invoice_id, i.invoice_no, i.client, i.event_name,
  i.subtotal AS deposit_subtotal,
  i.source_quote_id, i.quote_id AS legacy_quote_id
FROM invoices i
LEFT JOIN quotes q ON q.id = COALESCE(i.source_quote_id, i.quote_id)
WHERE (i.invoice_type = 'deposit' OR (i.invoice_no LIKE '%-DEP%' AND i.invoice_type IS NULL))
  AND q.id IS NULL;

-- ─── 3. FROZEN FINALS with stale deposit_applied ─────────────────────
-- (Also Category D in 03_audit_frozen.sql.)
WITH active_deposit AS (
  SELECT job_request_id, SUM(COALESCE(subtotal,0)) AS deposit_total
  FROM invoices
  WHERE invoice_type = 'deposit'
    AND is_draft = false
    AND (status IS NULL OR status NOT IN ('superseded','void'))
    AND job_request_id IS NOT NULL
  GROUP BY job_request_id
)
SELECT
  '3. FROZEN FINAL stale deposit_applied' AS check_name,
  i.id AS invoice_id, i.invoice_no, i.client, i.event_name, i.issued_at::date AS issued_date,
  i.deposit_applied AS stored_deposit_applied,
  COALESCE(ad.deposit_total, 0) AS current_active_deposit,
  ROUND((COALESCE(ad.deposit_total,0) - COALESCE(i.deposit_applied,0))::numeric, 2) AS delta
FROM invoices i
LEFT JOIN active_deposit ad ON ad.job_request_id = i.job_request_id
WHERE i.is_draft = false
  AND i.invoice_type = 'final'
  AND (i.status IS NULL OR i.status NOT IN ('superseded','void'))
  AND ABS(COALESCE(i.deposit_applied,0) - COALESCE(ad.deposit_total,0)) > 0.005
ORDER BY ABS(COALESCE(i.deposit_applied,0) - COALESCE(ad.deposit_total,0)) DESC;
