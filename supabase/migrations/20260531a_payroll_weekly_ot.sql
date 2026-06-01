-- Payroll Phase 2 — Connor's payroll rules.
--
-- New rules, applied as a layer ON TOP of the billed hour buckets carried on
-- timesheet_entries (which represent what the CLIENT is billed):
--
--   1. 5-hour minimum per (employee, work_date) in this payroll run.
--      A 3-hour day pays 5; the 2-hour bump goes to pay_std_hours.
--   2. Round UP to the next whole hour per (employee, work_date).
--      6.5 hrs → 7. 7.0 stays 7.
--   3. Daily OT/DT thresholds match what's billed — already encoded by
--      whoever keyed std/ot/dt on the timesheet. We snapshot the bill split
--      verbatim into pay_* and only round/min on top.
--   4. Weekly 40-hour override: anything over 40 in a Sun-Sat pay week is
--      pay_ot, regardless of the daily split. Spill comes from pay_std only
--      (we don't downgrade pay_dt).
--
-- Rules 1–3 are row-local — applied at snapshot time (createPayrollRun /
-- addEntriesToPayrollRun). Rule 4 is cross-row + cross-run — applied at
-- finalize time, looking at hours from OTHER finalized runs for the same
-- employee in the same pay week. See lib/store/payroll.ts.
--
-- pay_week_start is on the run so we can vary it later without a code change.
-- 'sun' is Connor's confirmed policy. ISO week ('mon') is supported by the
-- helper for future flexibility.

-- ─── payroll_runs: pay week + ot-calc audit ─────────────────────────────────
ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS pay_week_start    text         NOT NULL DEFAULT 'sun'
    CHECK (pay_week_start IN ('sun','mon')),
  ADD COLUMN IF NOT EXISTS ot_calculated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS ot_calculated_by  uuid;

-- ─── payroll_run_entries: pay-hour buckets ──────────────────────────────────
-- pay_* mirror billed std/ot/dt but reflect Connor's payroll rules.
-- std/ot/dt columns stay as the BILLED snapshot (what the client pays).
ALTER TABLE payroll_run_entries
  ADD COLUMN IF NOT EXISTS pay_std_hours          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_ot_hours           numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_dt_hours           numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_total_hours        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pay_adjustment_reason  text;

-- Backfill: existing draft run entries have pay_* = 0 from the default.
-- For drafts, seed pay_* = billed * so the totals make sense pre-recalc.
-- (Finalized runs keep zero pay_* since no payroll rules were applied at
--  finalize-time — the operator should reopen + re-finalize to apply rules.)
UPDATE payroll_run_entries pre
SET
  pay_std_hours   = pre.std_hours,
  pay_ot_hours    = pre.ot_hours,
  pay_dt_hours    = pre.dt_hours,
  pay_total_hours = pre.total_hours
FROM payroll_runs pr
WHERE pre.payroll_run_id = pr.id
  AND pr.status = 'draft'
  AND pre.pay_total_hours = 0;

-- ─── Trigger: refresh_payroll_run_totals — switch to pay_* ──────────────────
-- The cached header rollup should reflect what gets PAID, not the bill snapshot.
CREATE OR REPLACE FUNCTION refresh_payroll_run_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_run_id text;
BEGIN
  v_run_id := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  UPDATE payroll_runs SET
    entry_count    = COALESCE((SELECT COUNT(*)                       FROM payroll_run_entries WHERE payroll_run_id = v_run_id), 0),
    employee_count = COALESCE((SELECT COUNT(DISTINCT employee_key)   FROM payroll_run_entries WHERE payroll_run_id = v_run_id AND employee_key IS NOT NULL), 0),
    total_hours    = COALESCE((SELECT SUM(pay_total_hours)           FROM payroll_run_entries WHERE payroll_run_id = v_run_id), 0),
    total_pay      = COALESCE((SELECT SUM(total_pay)                 FROM payroll_run_entries WHERE payroll_run_id = v_run_id), 0)
   WHERE id = v_run_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ─── Trigger: freeze check — extend to cover pay_* columns ──────────────────
-- Same protection as billed std/ot/dt: once a run is finalized/exported,
-- nobody can mutate the pay-hour buckets either.
CREATE OR REPLACE FUNCTION payroll_run_entries_freeze_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM payroll_runs WHERE id = OLD.payroll_run_id;
    IF v_status IN ('finalized','exported') THEN
      RAISE EXCEPTION
        'Cannot delete payroll_run_entries row (%) — parent run % is %.',
        OLD.id, OLD.payroll_run_id, v_status
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_status FROM payroll_runs WHERE id = NEW.payroll_run_id;
    IF v_status IN ('finalized','exported')
       AND (NEW.timesheet_entry_id IS DISTINCT FROM OLD.timesheet_entry_id
         OR NEW.total_pay          IS DISTINCT FROM OLD.total_pay
         OR NEW.total_hours        IS DISTINCT FROM OLD.total_hours
         OR NEW.std_hours          IS DISTINCT FROM OLD.std_hours
         OR NEW.ot_hours           IS DISTINCT FROM OLD.ot_hours
         OR NEW.dt_hours           IS DISTINCT FROM OLD.dt_hours
         OR NEW.std_rate           IS DISTINCT FROM OLD.std_rate
         OR NEW.ot_rate            IS DISTINCT FROM OLD.ot_rate
         OR NEW.dt_rate            IS DISTINCT FROM OLD.dt_rate
         OR NEW.pay_std_hours      IS DISTINCT FROM OLD.pay_std_hours
         OR NEW.pay_ot_hours       IS DISTINCT FROM OLD.pay_ot_hours
         OR NEW.pay_dt_hours       IS DISTINCT FROM OLD.pay_dt_hours
         OR NEW.pay_total_hours    IS DISTINCT FROM OLD.pay_total_hours)
    THEN
      RAISE EXCEPTION
        'Cannot modify payroll_run_entries row (%) — parent run % is %.',
        OLD.id, OLD.payroll_run_id, v_status
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Smoke test
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_runs' AND column_name = 'pay_week_start'
  ) THEN
    RAISE EXCEPTION 'payroll_runs.pay_week_start did not install';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payroll_run_entries' AND column_name = 'pay_total_hours'
  ) THEN
    RAISE EXCEPTION 'payroll_run_entries.pay_total_hours did not install';
  END IF;
END $$;
