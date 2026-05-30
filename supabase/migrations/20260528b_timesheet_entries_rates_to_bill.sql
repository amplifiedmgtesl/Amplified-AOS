-- Rename ambiguous "rate" columns on timesheet_entries to explicit bill_*.
--
-- These columns have always been bill rates (admin-typed; same multiplier
-- structure as the rate card). Their original names — std_rate / ot_rate /
-- dt_rate / total_pay — implied they were pay-side, which caused exactly
-- the kind of bill-vs-pay confusion documented in project_payroll.md.
--
--   std_rate   → bill_std_rate
--   ot_rate    → bill_ot_rate
--   dt_rate    → bill_dt_rate
--   total_pay  → bill_total      (computed as hours × bill rates)
--
-- This is a one-shot rename. No data migration is needed — the column
-- contents are unchanged, only their names.
--
-- The freeze trigger (last refreshed in 20260526c) references all four
-- columns by name, so it must be re-created. The trigger is dropped
-- before the rename and re-attached after with the new names.
--
-- No other DB object (no FKs, no other triggers, no views, no generated
-- columns) references these — verified via:
--   SELECT * FROM information_schema.columns
--    WHERE table_name='timesheet_entries' AND column_name LIKE '%rate%';
--
-- The payroll module's payroll_run_entries.std_rate/ot_rate/dt_rate/
-- total_pay columns KEEP their names — those are genuinely pay-side,
-- snapshotted at run creation, and the Phase 1 Payroll work is the
-- only place in the system that talks about pay rates.

-- ─── Drop trigger before rename ─────────────────────────────────────────
DROP TRIGGER IF EXISTS timesheet_entries_freeze_iud_trg ON timesheet_entries;

-- ─── Rename columns ─────────────────────────────────────────────────────
ALTER TABLE timesheet_entries RENAME COLUMN std_rate   TO bill_std_rate;
ALTER TABLE timesheet_entries RENAME COLUMN ot_rate    TO bill_ot_rate;
ALTER TABLE timesheet_entries RENAME COLUMN dt_rate    TO bill_dt_rate;
ALTER TABLE timesheet_entries RENAME COLUMN total_pay  TO bill_total;

-- ─── Re-create freeze function with new column names ────────────────────
CREATE OR REPLACE FUNCTION timesheet_entries_freeze_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION 'Cannot delete an approved timesheet entry (id=%). Unlock it (status -> submitted) first, or reject it.',
        OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

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

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'timesheet_entries' AND column_name = 'bill_std_rate'
  ) THEN
    RAISE EXCEPTION 'bill_std_rate column missing after rename';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'timesheet_entries' AND column_name = 'std_rate'
  ) THEN
    RAISE EXCEPTION 'std_rate column still present after rename';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'timesheet_entries_freeze_iud_trg'
  ) THEN
    RAISE EXCEPTION 'freeze trigger did not re-attach';
  END IF;
END $$;
