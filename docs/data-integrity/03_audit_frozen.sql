-- ════════════════════════════════════════════════════════════════════
-- FROZEN DRIFT AUDIT (read-only)
--
-- Lists frozen quotes + invoices whose stored values don't match what
-- the formula would produce today. Output is per-row for human review
-- — Connor decides per-document:
--   * Leave alone — original PDF stands.
--   * Revise — create a new revision and re-issue (supersedes original).
--
-- The pre-2026-05-28 recovered/historical quotes are expected to show
-- drift here because their line hours/rates were only partially
-- populated during the Connor-incident PDF recovery. Their stored
-- totals match the PDFs Connor sent clients — leave them alone.
--
-- Categories:
--   A. Line-total drift  (formula disagrees with stored line.total)
--   B. Header-total drift (subtotal/total ≠ sum of lines)
--   C. amount_due drift   (invoices only)
--   D. deposit_applied stale (final invoice's depositApplied no longer
--      matches the current active deposit invoice's subtotal)
--
-- B-inv excludes deposit invoices (they intentionally have no lines
-- — subtotal carries the lump-sum). Audit pre-2026-05-28 was wrong
-- to flag them.
-- ════════════════════════════════════════════════════════════════════

-- ─── A-quote. Frozen quote_lines drift ───────────────────────────────
WITH expected AS (
  SELECT
    q.id AS quote_id, q.quote_no, q.client, q.event_name,
    q.issued_at::date AS issued_date,
    ql.id AS line_id, ql.quote_date AS line_date,
    ql.total AS stored_total,
    ROUND((
      CASE
        WHEN COALESCE(qd.is_holiday, false) THEN
          COALESCE(q.holiday_multiplier, 2.0) * (
            CASE
              WHEN ql.rate_mode = 'day' OR (COALESCE(ql.base_day,0) > 0 AND COALESCE(ql.hours,0) = 0 AND ql.rate_mode IS DISTINCT FROM 'hourly')
                THEN COALESCE(ql.crew_count, ql.qty, 1) * COALESCE(ql.base_day, 0)
              ELSE COALESCE(ql.hours, 0) * COALESCE(ql.base_hourly, 0)
            END
            + (COALESCE(ql.ot_hours, 0) + COALESCE(ql.dt_hours, 0)) * COALESCE(ql.base_hourly, 0)
          ) + COALESCE(ql.travel, 0)
        ELSE
          CASE
            WHEN ql.rate_mode = 'day' OR (COALESCE(ql.base_day,0) > 0 AND COALESCE(ql.hours,0) = 0 AND ql.rate_mode IS DISTINCT FROM 'hourly')
              THEN COALESCE(ql.crew_count, ql.qty, 1) * COALESCE(ql.base_day, 0)
            ELSE COALESCE(ql.hours, 0) * COALESCE(ql.base_hourly, 0)
          END
          + COALESCE(ql.ot_hours, 0) * COALESCE(ql.ot_rate, 0)
          + COALESCE(ql.dt_hours, 0) * COALESCE(ql.dt_rate, 0)
          + COALESCE(ql.travel, 0)
      END
    )::numeric, 2) AS expected_total
  FROM quote_lines ql
  JOIN quotes q ON q.id = ql.quote_id
  LEFT JOIN quote_days qd
    ON qd.quote_id = q.id
   AND qd.quote_date = NULLIF(TRIM(ql.quote_date), '')::date
  WHERE q.is_draft = false
)
SELECT
  'A. FROZEN QUOTE line drift' AS category,
  quote_id, quote_no, client, event_name, issued_date, line_date,
  stored_total, expected_total,
  ROUND((expected_total - stored_total)::numeric, 2) AS delta
FROM expected
WHERE ABS(COALESCE(stored_total,0) - expected_total) > 0.005
ORDER BY ABS(expected_total - COALESCE(stored_total,0)) DESC, quote_no, line_date;

-- ─── B-quote. Frozen quotes header total drift ───────────────────────
SELECT
  'B. FROZEN QUOTE total drift' AS category,
  q.id AS quote_id, q.quote_no, q.client, q.event_name, q.issued_at::date AS issued_date,
  q.total AS stored_total,
  ROUND(COALESCE(s.line_sum, 0)::numeric, 2) AS sum_of_lines,
  ROUND((COALESCE(s.line_sum,0) - COALESCE(q.total,0))::numeric, 2) AS delta
FROM quotes q
LEFT JOIN (
  SELECT quote_id, SUM(COALESCE(total,0)) AS line_sum FROM quote_lines GROUP BY quote_id
) s ON s.quote_id = q.id
WHERE q.is_draft = false
  AND ABS(COALESCE(q.total,0) - COALESCE(s.line_sum,0)) > 0.005
ORDER BY ABS(COALESCE(s.line_sum,0) - COALESCE(q.total,0)) DESC;

-- ─── A-inv. Frozen invoice_lines drift ───────────────────────────────
WITH expected AS (
  SELECT
    i.id AS invoice_id, i.invoice_no, i.client, i.event_name,
    i.issued_at::date AS issued_date,
    il.id AS line_id, il.quote_date AS line_date,
    il.total AS stored_total,
    ROUND((
      CASE
        WHEN COALESCE(idays.is_holiday, false) THEN
          COALESCE(i.holiday_multiplier, 2.0) * (
            CASE
              WHEN il.rate_mode = 'day' OR (COALESCE(il.base_day,0) > 0 AND COALESCE(il.hours,0) = 0 AND il.rate_mode IS DISTINCT FROM 'hourly')
                THEN COALESCE(il.crew_count, il.qty, 1) * COALESCE(il.base_day, 0)
              ELSE COALESCE(il.hours, 0) * COALESCE(il.base_hourly, 0)
            END
            + (COALESCE(il.ot_hours, 0) + COALESCE(il.dt_hours, 0)) * COALESCE(il.base_hourly, 0)
          ) + COALESCE(il.travel, 0)
        ELSE
          CASE
            WHEN il.rate_mode = 'day' OR (COALESCE(il.base_day,0) > 0 AND COALESCE(il.hours,0) = 0 AND il.rate_mode IS DISTINCT FROM 'hourly')
              THEN COALESCE(il.crew_count, il.qty, 1) * COALESCE(il.base_day, 0)
            ELSE COALESCE(il.hours, 0) * COALESCE(il.base_hourly, 0)
          END
          + COALESCE(il.ot_hours, 0) * COALESCE(il.ot_rate, 0)
          + COALESCE(il.dt_hours, 0) * COALESCE(il.dt_rate, 0)
          + COALESCE(il.travel, 0)
      END
    )::numeric, 2) AS expected_total
  FROM invoice_lines il
  JOIN invoices i ON i.id = il.invoice_id
  LEFT JOIN invoice_days idays
    ON idays.invoice_id = i.id
   AND idays.invoice_date = NULLIF(TRIM(il.quote_date), '')::date
  WHERE i.is_draft = false
)
SELECT
  'A. FROZEN INVOICE line drift' AS category,
  invoice_id, invoice_no, client, event_name, issued_date, line_date,
  stored_total, expected_total,
  ROUND((expected_total - stored_total)::numeric, 2) AS delta
FROM expected
WHERE ABS(COALESCE(stored_total,0) - expected_total) > 0.005
ORDER BY ABS(expected_total - COALESCE(stored_total,0)) DESC, invoice_no, line_date;

-- ─── B-inv. Frozen invoices subtotal drift (excluding deposits) ──────
-- Deposit invoices intentionally have no line items — subtotal carries
-- the lump-sum deposit amount. Excluded here.
SELECT
  'B. FROZEN INVOICE subtotal drift' AS category,
  i.id AS invoice_id, i.invoice_no, i.client, i.event_name, i.issued_at::date AS issued_date,
  i.subtotal AS stored_subtotal,
  ROUND(COALESCE(s.line_sum, 0)::numeric, 2) AS sum_of_lines,
  ROUND((COALESCE(s.line_sum,0) - COALESCE(i.subtotal,0))::numeric, 2) AS delta
FROM invoices i
LEFT JOIN (
  SELECT invoice_id, SUM(COALESCE(total,0)) AS line_sum FROM invoice_lines GROUP BY invoice_id
) s ON s.invoice_id = i.id
WHERE i.is_draft = false
  AND i.invoice_type IS DISTINCT FROM 'deposit'
  AND i.invoice_no NOT LIKE '%-DEP%'
  AND ABS(COALESCE(i.subtotal,0) - COALESCE(s.line_sum,0)) > 0.005
ORDER BY ABS(COALESCE(s.line_sum,0) - COALESCE(i.subtotal,0)) DESC;

-- ─── C. Frozen invoices amount_due drift ─────────────────────────────
-- amount_due is an aggregate, NOT in the freeze trigger lock list, so
-- it's safe to UPDATE on frozen rows. See 05_fix_frozen_amount_due.sql
-- for the corrective.
SELECT
  'C. FROZEN INVOICE amount_due drift' AS category,
  i.id AS invoice_id, i.invoice_no, i.client, i.event_name,
  i.subtotal, i.deposit_applied, i.credits_applied, i.paid_amount,
  i.amount_due AS stored_amount_due,
  ROUND((COALESCE(i.subtotal,0) - COALESCE(i.deposit_applied,0) - COALESCE(i.credits_applied,0) - COALESCE(i.paid_amount,0))::numeric, 2) AS expected_amount_due
FROM invoices i
WHERE i.is_draft = false
  AND ABS(
        COALESCE(i.amount_due,0)
      - (COALESCE(i.subtotal,0) - COALESCE(i.deposit_applied,0) - COALESCE(i.credits_applied,0) - COALESCE(i.paid_amount,0))
      ) > 0.005;

-- ─── D. Frozen FINAL invoices with stale deposit_applied ─────────────
-- Real customer-facing money implication. Connor's review per-row —
-- revise the final if the deposit truly should be applied.
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
  'D. FROZEN FINAL stale deposit_applied' AS category,
  i.id AS invoice_id, i.invoice_no, i.client, i.event_name, i.issued_at::date AS issued_date,
  i.deposit_applied AS stored_deposit_applied,
  COALESCE(ad.deposit_total, 0) AS current_active_deposit,
  ROUND((COALESCE(ad.deposit_total,0) - COALESCE(i.deposit_applied,0))::numeric, 2) AS delta
FROM invoices i
LEFT JOIN active_deposit ad ON ad.job_request_id = i.job_request_id
WHERE i.is_draft = false
  AND i.invoice_type = 'final'
  AND (i.status IS NULL OR i.status NOT IN ('superseded','void'))
  AND ABS(COALESCE(i.deposit_applied,0) - COALESCE(ad.deposit_total,0)) > 0.005;
