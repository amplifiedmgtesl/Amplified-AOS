-- Phase 1 Payroll — actual pay-rate source.
--
-- Adds pay-rate columns to two places:
--   rate_card_profile_rows  → pay_hourly / pay_ot_rate / pay_dt_rate
--   employees               → pay_std_rate / pay_ot_rate / pay_dt_rate
--
-- Resolution at payroll snapshot time (lib/store/payroll.ts):
--   1. Employee override (any of the three set on the employee row)
--   2. Job's pinned rate card (matches the existing pickRateCardForJob
--      logic — client + effective_date)
--   3. Default master rate card (ratecard-master-default profile)
--
-- All six new columns default to 0 (not null). Zero means "not set" —
-- the payroll module shows a yellow banner and blocks finalize when any
-- entry resolves to zero, so unfilled rates are loud rather than silent.
--
-- IMPORTANT — bill/pay separation:
--   * The existing rate_card_profile_rows.hourly / ot_rate / dt_rate
--     columns are BILL rates (what AES bills the client). They are NOT
--     renamed in this migration — see project_pending_prod_migrations.md
--     #44 for the rationale (bill-side has never been ambiguous; only
--     the timesheet rates needed the bill_* rename in 20260528b).
--   * The new pay_* columns are PAY rates (what AES pays the worker).
--     They live next to the bill columns on the same row so a per-
--     specialty rate is fully described in one place, but they're
--     entirely independent — no formula links them.
--
-- LEAK PROTECTION:
--   * pay_* columns are admin-only. They appear ONLY on:
--       - Rate Card editor (/rate-card)
--       - Master Rate Card editor (/maintenance → Master Rate Card)
--       - Employee Directory (/employee-directory)
--       - Payroll module screens (/payroll/*)
--   * They are explicitly NOT pulled into:
--       - quote_lines (bill snapshot only)
--       - invoice_lines (bill snapshot only)
--       - Quote PDF (/quotes/[id]/pdf)
--       - Invoice PDF (/invoices/[id]/pdf)
--     The snapshot chains stay separate: rate card → quote_lines uses
--     bill columns only; rate card → payroll_run_entries (via the new
--     resolvePayRateForEntry helper) uses pay columns only.

-- ─── rate_card_profile_rows ─────────────────────────────────────────────
ALTER TABLE rate_card_profile_rows
  ADD COLUMN IF NOT EXISTS pay_hourly  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_ot_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_dt_rate numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN rate_card_profile_rows.pay_hourly  IS 'Pay rate per hour (what AES pays the worker). NOT bill. 0 = not set.';
COMMENT ON COLUMN rate_card_profile_rows.pay_ot_rate IS 'Pay OT rate per hour. Conventionally pay_hourly * 1.5 but stored explicitly so per-specialty exceptions can be entered. 0 = not set.';
COMMENT ON COLUMN rate_card_profile_rows.pay_dt_rate IS 'Pay DT rate per hour. Conventionally pay_hourly * 2.0 but stored explicitly. 0 = not set.';

-- ─── employees ─────────────────────────────────────────────────────────
-- Per-employee override. NULL means "use rate card". Stored as numeric
-- so a partial override is meaningful (e.g. negotiate a custom base but
-- inherit standard OT/DT multipliers — set pay_std_rate, leave OT/DT NULL).
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS pay_std_rate numeric,
  ADD COLUMN IF NOT EXISTS pay_ot_rate  numeric,
  ADD COLUMN IF NOT EXISTS pay_dt_rate  numeric;

COMMENT ON COLUMN employees.pay_std_rate IS 'Per-employee pay rate override. NULL = use rate card. Override-wins precedence (set value wins regardless of rate card value).';
COMMENT ON COLUMN employees.pay_ot_rate  IS 'Per-employee pay OT override. NULL = use rate card.';
COMMENT ON COLUMN employees.pay_dt_rate  IS 'Per-employee pay DT override. NULL = use rate card.';

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rate_card_profile_rows' AND column_name = 'pay_hourly') THEN
    RAISE EXCEPTION 'pay_hourly column missing on rate_card_profile_rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'pay_std_rate') THEN
    RAISE EXCEPTION 'pay_std_rate column missing on employees';
  END IF;
END $$;
