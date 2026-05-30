-- ════════════════════════════════════════════════════════════════════
-- DATA INTEGRITY FIX — DRAFTS + LEGACY PAID BACKFILL
--
-- Applied to dev 2026-05-28. Queued for prod V2 cutover (run after
-- 01_audit_drafts.sql sizes the problem).
--
-- Idempotent — re-running is safe:
--   * Steps 1-6 update to computed truth. Re-run = no change.
--   * Step 7 WHERE clause becomes false after first run.
--
-- Drafts only for steps 1-6. Frozen quotes/invoices are intentionally
-- immutable historical record — never touched here.
--
-- Step 7 inserts synthetic invoice_payments rows so the
-- `status='paid' ↔ paid_amount >= billable` invariant holds for legacy
-- invoices that were marked paid via the old binary "Mark Paid"
-- button before invoice_payments existed.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. quote_lines.total (drafts) ───────────────────────────────────
WITH computed AS (
  SELECT
    ql.id AS line_id,
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
UPDATE quote_lines ql
SET total = c.expected_total
FROM computed c
WHERE c.line_id = ql.id;

-- ─── 2. quotes.total = sum(quote_lines.total) (drafts) ───────────────
UPDATE quotes q
SET total = ROUND(COALESCE(s.line_sum, 0)::numeric, 2)
FROM (
  SELECT quote_id, SUM(COALESCE(total,0)) AS line_sum
    FROM quote_lines GROUP BY quote_id
) s
WHERE q.id = s.quote_id
  AND q.is_draft = true;

-- ─── 3. quotes.deposit = total × deposit_pct (drafts) ────────────────
UPDATE quotes
SET deposit = ROUND((COALESCE(total,0) * COALESCE(deposit_pct,0) / 100.0)::numeric, 2)
WHERE is_draft = true;

-- ─── 4. invoice_lines.total (drafts) ─────────────────────────────────
WITH computed AS (
  SELECT
    il.id AS line_id,
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
UPDATE invoice_lines il
SET total = c.expected_total
FROM computed c
WHERE c.line_id = il.id;

-- ─── 5. invoices.subtotal = sum(invoice_lines.total) (drafts) ────────
UPDATE invoices i
SET subtotal = ROUND(COALESCE(s.line_sum, 0)::numeric, 2)
FROM (
  SELECT invoice_id, SUM(COALESCE(total,0)) AS line_sum
    FROM invoice_lines GROUP BY invoice_id
) s
WHERE i.id = s.invoice_id
  AND i.is_draft = true;

-- ─── 6. invoices.amount_due (drafts) ─────────────────────────────────
UPDATE invoices
SET amount_due = ROUND((
    COALESCE(subtotal,0)
  - COALESCE(deposit_applied,0)
  - COALESCE(credits_applied,0)
  - COALESCE(paid_amount,0)
)::numeric, 2)
WHERE is_draft = true;

-- ─── 7. LEGACY PAID INVOICE BACKFILL ─────────────────────────────────
INSERT INTO invoice_payments (
  id,
  invoice_id,
  payment_date,
  payment_method,
  amount,
  reference_number,
  memo,
  notes,
  is_active
)
SELECT
  'ipy-backfill-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  i.id,
  COALESCE(i.paid_at::date, CURRENT_DATE),
  'other',
  ROUND((
      COALESCE(i.subtotal,0)
    - COALESCE(i.deposit_applied,0)
    - COALESCE(i.credits_applied,0)
    - COALESCE(i.paid_amount,0)
  )::numeric, 2),
  'legacy-backfill',
  'Pre-payment-tracking backfill 2026-05-28',
  'Synthetic marker created when invoice_payments was introduced. The original Mark Paid action did not record payment details; this row exists so SUM(invoice_payments.amount) covers the invoice balance and keeps status=paid consistent with the auto-paid-status invariant. NOT a real receipt — do not reconcile against the bank.',
  true
FROM invoices i
WHERE i.status = 'paid'
  AND i.is_draft = false
  AND COALESCE(i.paid_amount,0) < (
        COALESCE(i.subtotal,0)
      - COALESCE(i.deposit_applied,0)
      - COALESCE(i.credits_applied,0)
      ) - 0.005;

COMMIT;
