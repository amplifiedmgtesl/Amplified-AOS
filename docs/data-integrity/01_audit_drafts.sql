-- ════════════════════════════════════════════════════════════════════
-- DATA INTEGRITY AUDIT — DRAFTS (read-only)
--
-- Finds every form of stored-aggregate drift on draft quotes/invoices
-- plus legacy paid invoices needing payment-row backfill. No data
-- changes. Safe to re-run anytime.
--
-- Run order: each numbered section is independent — run all 7 in one
-- go, or one at a time for cleaner per-check output.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. quote_lines totals (drafts only) ─────────────────────────────
WITH expected AS (
  SELECT
    ql.id,
    ql.quote_id,
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
  WHERE q.is_draft = true
)
SELECT
  'quote_lines drift (drafts only)' AS check_name,
  COUNT(*) FILTER (WHERE ABS(COALESCE(stored_total,0) - expected_total) > 0.005) AS rows_drifted,
  COUNT(*) AS rows_total
FROM expected;

-- ─── 2. quotes.total drift (drafts only) ─────────────────────────────
SELECT
  'quotes.total drift (drafts only)' AS check_name,
  COUNT(*) FILTER (WHERE ABS(COALESCE(q.total,0) - COALESCE(s.line_sum,0)) > 0.005) AS rows_drifted,
  COUNT(*) AS rows_total
FROM quotes q
LEFT JOIN (
  SELECT quote_id, SUM(COALESCE(total,0)) AS line_sum FROM quote_lines GROUP BY quote_id
) s ON s.quote_id = q.id
WHERE q.is_draft = true;

-- ─── 3. quotes.deposit drift (drafts only) ───────────────────────────
SELECT
  'quotes.deposit drift (drafts only)' AS check_name,
  COUNT(*) FILTER (WHERE ABS(COALESCE(q.deposit,0) - ROUND(COALESCE(q.total,0) * COALESCE(q.deposit_pct,0) / 100.0, 2)) > 0.005) AS rows_drifted,
  COUNT(*) AS rows_total
FROM quotes q
WHERE q.is_draft = true;

-- ─── 4. invoice_lines totals (drafts only) ───────────────────────────
WITH expected AS (
  SELECT
    il.id,
    il.invoice_id,
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
  WHERE i.is_draft = true
)
SELECT
  'invoice_lines drift (drafts only)' AS check_name,
  COUNT(*) FILTER (WHERE ABS(COALESCE(stored_total,0) - expected_total) > 0.005) AS rows_drifted,
  COUNT(*) AS rows_total
FROM expected;

-- ─── 5. invoices.subtotal drift (drafts only) ────────────────────────
SELECT
  'invoices.subtotal drift (drafts only)' AS check_name,
  COUNT(*) FILTER (WHERE ABS(COALESCE(i.subtotal,0) - COALESCE(s.line_sum,0)) > 0.005) AS rows_drifted,
  COUNT(*) AS rows_total
FROM invoices i
LEFT JOIN (
  SELECT invoice_id, SUM(COALESCE(total,0)) AS line_sum FROM invoice_lines GROUP BY invoice_id
) s ON s.invoice_id = i.id
WHERE i.is_draft = true;

-- ─── 6. invoices.amount_due drift (drafts only) ──────────────────────
SELECT
  'invoices.amount_due drift (drafts only)' AS check_name,
  COUNT(*) FILTER (WHERE ABS(
    COALESCE(amount_due,0)
    - (COALESCE(subtotal,0) - COALESCE(deposit_applied,0) - COALESCE(credits_applied,0) - COALESCE(paid_amount,0))
  ) > 0.005) AS rows_drifted,
  COUNT(*) AS rows_total
FROM invoices
WHERE is_draft = true;

-- ─── 7. LEGACY PAID INVOICES needing payment backfill ────────────────
SELECT
  'legacy paid invoices needing payment backfill' AS check_name,
  COUNT(*) AS rows_to_backfill,
  ROUND(SUM(
    GREATEST(0, COALESCE(subtotal,0) - COALESCE(deposit_applied,0) - COALESCE(credits_applied,0) - COALESCE(paid_amount,0))
  )::numeric, 2) AS total_dollars_to_backfill
FROM invoices
WHERE status = 'paid'
  AND is_draft = false
  AND COALESCE(paid_amount,0) < (COALESCE(subtotal,0) - COALESCE(deposit_applied,0) - COALESCE(credits_applied,0)) - 0.005;

-- ─── 7b. Sample of those legacy paid invoices (first 10) ─────────────
SELECT
  id,
  invoice_no,
  status,
  subtotal,
  deposit_applied,
  credits_applied,
  paid_amount,
  ROUND((COALESCE(subtotal,0) - COALESCE(deposit_applied,0) - COALESCE(credits_applied,0) - COALESCE(paid_amount,0))::numeric, 2) AS gap_to_backfill,
  paid_at
FROM invoices
WHERE status = 'paid'
  AND is_draft = false
  AND COALESCE(paid_amount,0) < (COALESCE(subtotal,0) - COALESCE(deposit_applied,0) - COALESCE(credits_applied,0)) - 0.005
ORDER BY paid_at DESC NULLS LAST
LIMIT 10;
