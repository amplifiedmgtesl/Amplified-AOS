-- Payroll super-freeze on timesheet_entries.
--
-- Adds payroll_run_id FK + extends the freeze trigger so that once a
-- timesheet entry is included in a (non-voided) payroll run, the source
-- entry becomes immutable on the timesheet side — no status changes,
-- no content edits, no delete. Same pattern as the invoice_line_id
-- super-freeze in 20260525d. To undo, the operator voids the run.
--
-- The payroll module is responsible for maintaining payroll_run_id on
-- the entry:
--   * createPayrollRun / addEntriesToPayrollRun: SET payroll_run_id = run.id
--   * voidPayrollRun: trigger payroll_runs_void_releases_entries fires and
--     clears payroll_run_id on every entry that pointed at the voided run
--   * removeEntryFromRun: clears payroll_run_id on the one entry removed
--
-- The freeze trigger explicitly ALLOWS payroll_run_id itself to change
-- (it's metadata maintained by the payroll side). Only other fields are
-- blocked while payroll_run_id is set.

-- ─── Schema change ──────────────────────────────────────────────────────
ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS payroll_run_id text REFERENCES payroll_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_payroll_run_id
  ON timesheet_entries(payroll_run_id) WHERE payroll_run_id IS NOT NULL;

-- ─── Backfill from existing payroll_run_entries ─────────────────────────
-- Any entry currently in a non-voided payroll run gets its payroll_run_id
-- populated. The freeze trigger is dropped first so the backfill can run
-- on approved rows.
DROP TRIGGER IF EXISTS timesheet_entries_freeze_iud_trg ON timesheet_entries;

UPDATE timesheet_entries te
   SET payroll_run_id = pre.payroll_run_id
  FROM payroll_run_entries pre
 WHERE te.id = pre.timesheet_entry_id
   AND te.payroll_run_id IS NULL;

-- ─── Re-create freeze function with payroll super-freeze ────────────────
CREATE OR REPLACE FUNCTION timesheet_entries_freeze_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- ─── DELETE ──────────────────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    IF OLD.payroll_run_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot delete a timesheet entry locked by payroll run % (id=%). Void the run first.',
        OLD.payroll_run_id, OLD.id USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION 'Cannot delete an approved timesheet entry (id=%). Unlock it (status -> submitted) first, or reject it.',
        OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- ─── UPDATE ──────────────────────────────────────────────────────────
  -- Payroll super-freeze: when OLD.payroll_run_id IS NOT NULL, the entry
  -- is locked. Only payroll_run_id itself may change (set/clear by the
  -- payroll module's lifecycle hooks).
  IF TG_OP = 'UPDATE' AND OLD.payroll_run_id IS NOT NULL THEN
    IF (NEW.position             IS DISTINCT FROM OLD.position
     OR NEW.position_id          IS DISTINCT FROM OLD.position_id
     OR NEW.specialty_id         IS DISTINCT FROM OLD.specialty_id
     OR NEW.first_name           IS DISTINCT FROM OLD.first_name
     OR NEW.last_name            IS DISTINCT FROM OLD.last_name
     OR NEW.phone                IS DISTINCT FROM OLD.phone
     OR NEW.email                IS DISTINCT FROM OLD.email
     OR NEW.work_date            IS DISTINCT FROM OLD.work_date
     OR NEW.end_date             IS DISTINCT FROM OLD.end_date
     OR NEW.time_in1             IS DISTINCT FROM OLD.time_in1
     OR NEW.time_out1            IS DISTINCT FROM OLD.time_out1
     OR NEW.time_in2             IS DISTINCT FROM OLD.time_in2
     OR NEW.time_out2            IS DISTINCT FROM OLD.time_out2
     OR NEW.lunch_minutes        IS DISTINCT FROM OLD.lunch_minutes
     OR NEW.meal_break_1_minutes IS DISTINCT FROM OLD.meal_break_1_minutes
     OR NEW.meal_break_2_minutes IS DISTINCT FROM OLD.meal_break_2_minutes
     OR NEW.std_hours            IS DISTINCT FROM OLD.std_hours
     OR NEW.ot_hours             IS DISTINCT FROM OLD.ot_hours
     OR NEW.dt_hours             IS DISTINCT FROM OLD.dt_hours
     OR NEW.total_hours          IS DISTINCT FROM OLD.total_hours
     OR NEW.bill_std_rate        IS DISTINCT FROM OLD.bill_std_rate
     OR NEW.bill_ot_rate         IS DISTINCT FROM OLD.bill_ot_rate
     OR NEW.bill_dt_rate         IS DISTINCT FROM OLD.bill_dt_rate
     OR NEW.bill_total           IS DISTINCT FROM OLD.bill_total
     OR NEW.employee_key         IS DISTINCT FROM OLD.employee_key
     OR NEW.user_id              IS DISTINCT FROM OLD.user_id
     OR NEW.notes                IS DISTINCT FROM OLD.notes
     OR NEW.timesheet_id         IS DISTINCT FROM OLD.timesheet_id
     OR NEW.job_id               IS DISTINCT FROM OLD.job_id
     OR NEW.job_sheet_id         IS DISTINCT FROM OLD.job_sheet_id
     OR NEW.shift_id             IS DISTINCT FROM OLD.shift_id
     OR NEW.is_holiday           IS DISTINCT FROM OLD.is_holiday
     OR NEW.holiday_multiplier   IS DISTINCT FROM OLD.holiday_multiplier
     OR NEW.status               IS DISTINCT FROM OLD.status
     OR NEW.invoice_line_id      IS DISTINCT FROM OLD.invoice_line_id)
    THEN
      RAISE EXCEPTION 'Timesheet entry % is locked by payroll run %. Void the run to release.',
        OLD.id, OLD.payroll_run_id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- ─── Existing approved-state freeze (unchanged from 20260528b) ───────
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    IF OLD.invoice_line_id IS NOT NULL THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Cannot change status of an invoice-bound timesheet entry (id=%). Unlink the invoice line first.',
          OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NEW.status = 'approved' THEN
      IF (NEW.position             IS DISTINCT FROM OLD.position
       OR NEW.position_id          IS DISTINCT FROM OLD.position_id
       OR NEW.specialty_id         IS DISTINCT FROM OLD.specialty_id
       OR NEW.first_name           IS DISTINCT FROM OLD.first_name
       OR NEW.last_name            IS DISTINCT FROM OLD.last_name
       OR NEW.phone                IS DISTINCT FROM OLD.phone
       OR NEW.email                IS DISTINCT FROM OLD.email
       OR NEW.work_date            IS DISTINCT FROM OLD.work_date
       OR NEW.end_date             IS DISTINCT FROM OLD.end_date
       OR NEW.time_in1             IS DISTINCT FROM OLD.time_in1
       OR NEW.time_out1            IS DISTINCT FROM OLD.time_out1
       OR NEW.time_in2             IS DISTINCT FROM OLD.time_in2
       OR NEW.time_out2            IS DISTINCT FROM OLD.time_out2
       OR NEW.lunch_minutes        IS DISTINCT FROM OLD.lunch_minutes
       OR NEW.meal_break_1_minutes IS DISTINCT FROM OLD.meal_break_1_minutes
       OR NEW.meal_break_2_minutes IS DISTINCT FROM OLD.meal_break_2_minutes
       OR NEW.std_hours            IS DISTINCT FROM OLD.std_hours
       OR NEW.ot_hours             IS DISTINCT FROM OLD.ot_hours
       OR NEW.dt_hours             IS DISTINCT FROM OLD.dt_hours
       OR NEW.total_hours          IS DISTINCT FROM OLD.total_hours
       OR NEW.bill_std_rate        IS DISTINCT FROM OLD.bill_std_rate
       OR NEW.bill_ot_rate         IS DISTINCT FROM OLD.bill_ot_rate
       OR NEW.bill_dt_rate         IS DISTINCT FROM OLD.bill_dt_rate
       OR NEW.bill_total           IS DISTINCT FROM OLD.bill_total
       OR NEW.employee_key         IS DISTINCT FROM OLD.employee_key
       OR NEW.user_id              IS DISTINCT FROM OLD.user_id
       OR NEW.notes                IS DISTINCT FROM OLD.notes
       OR NEW.timesheet_id         IS DISTINCT FROM OLD.timesheet_id
       OR NEW.job_id               IS DISTINCT FROM OLD.job_id
       OR NEW.job_sheet_id         IS DISTINCT FROM OLD.job_sheet_id
       OR NEW.shift_id             IS DISTINCT FROM OLD.shift_id
       OR NEW.is_holiday           IS DISTINCT FROM OLD.is_holiday
       OR NEW.holiday_multiplier   IS DISTINCT FROM OLD.holiday_multiplier
      ) THEN
        RAISE EXCEPTION 'Cannot modify content of an approved timesheet entry (id=%). Unlock it (status -> submitted) first to edit.',
          OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER timesheet_entries_freeze_iud_trg
  BEFORE UPDATE OR DELETE ON timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION timesheet_entries_freeze_check();

-- ─── Extend payroll-runs void trigger to clear payroll_run_id ───────────
-- The existing trigger already deletes payroll_run_entries on void.
-- Add the timesheet-side cleanup so the source entries are released
-- atomically.
CREATE OR REPLACE FUNCTION payroll_runs_void_releases_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided' THEN
    NEW.voided_at := COALESCE(NEW.voided_at, now());
    -- Release the timesheet-side super-freeze first (FK = SET NULL also
    -- works, but doing this explicitly keeps audit logs cleaner).
    UPDATE timesheet_entries
       SET payroll_run_id = NULL
     WHERE payroll_run_id = NEW.id;
    DELETE FROM payroll_run_entries WHERE payroll_run_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'timesheet_entries' AND column_name = 'payroll_run_id'
  ) THEN
    RAISE EXCEPTION 'payroll_run_id column missing after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'timesheet_entries_freeze_iud_trg'
  ) THEN
    RAISE EXCEPTION 'freeze trigger did not re-attach';
  END IF;
END $$;
