-- Payroll Phase 2.1 — snapshot specialty on payroll_run_entries.
--
-- Lets the payroll detail screen show specialty next to position, so the
-- operator can confirm "this Rigger is a Climber at $35" without having to
-- click into the timesheet. Also future-proofs payroll exports — the
-- pay-rate audit trail now records WHY a given rate was applied (specialty
-- drove the rate-card lookup).
--
-- Two columns: specialty_id (FK) + specialty (denormalized name). Same
-- pattern as the existing `position` text + `position_id` FK on the table —
-- the name snapshot survives even if the specialty is later renamed.

ALTER TABLE payroll_run_entries
  ADD COLUMN IF NOT EXISTS specialty_id text REFERENCES specialties(id),
  ADD COLUMN IF NOT EXISTS specialty    text;

CREATE INDEX IF NOT EXISTS idx_payroll_run_entries_specialty_id
  ON payroll_run_entries(specialty_id);

-- Backfill from the source timesheet entry for every existing row.
UPDATE payroll_run_entries pre
SET
  specialty_id = te.specialty_id,
  specialty    = s.name
FROM timesheet_entries te
LEFT JOIN specialties s ON s.id = te.specialty_id
WHERE pre.timesheet_entry_id = te.id
  AND pre.specialty_id IS NULL;

-- Extend the freeze trigger so finalized runs can't have specialty changed.
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
         OR NEW.pay_total_hours    IS DISTINCT FROM OLD.pay_total_hours
         OR NEW.specialty_id       IS DISTINCT FROM OLD.specialty_id
         OR NEW.specialty          IS DISTINCT FROM OLD.specialty)
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
    WHERE table_name = 'payroll_run_entries' AND column_name = 'specialty_id'
  ) THEN
    RAISE EXCEPTION 'payroll_run_entries.specialty_id did not install';
  END IF;
END $$;
