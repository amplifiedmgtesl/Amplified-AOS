-- Phase 2: shift_id on timesheet_entries.
--
-- The Jobs rewrite introduced job_request_shifts as the canonical way to
-- represent shift identity (replacing free-text shift labels — see
-- 20260512a). Quote/invoice lines and job_request_crew_needs /
-- job_request_assignments already carry shift_id. Phase 2 brings
-- timesheet_entries into the same model so post-execution time tracks
-- the same shift the plan and quote used.
--
-- Schema-only: pure additive. No backfill (no prior shift info on
-- existing entries — operator fills in going forward via the new
-- per-day-assignments-driven Add Crew flow).
--
-- Freeze: shift_id joins the content-frozen list. Recreate the
-- timesheet_entries_freeze_check function to include it.

ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS shift_id text;

-- Pre-flight orphans (shouldn't be any — column is new)
DO $$
DECLARE o int;
BEGIN
  SELECT count(*) INTO o FROM timesheet_entries te
   WHERE te.shift_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM job_request_shifts s WHERE s.id = te.shift_id);
  IF o > 0 THEN RAISE NOTICE 'timesheet_entries.shift_id orphans: %', o; END IF;
END $$;

ALTER TABLE timesheet_entries DROP CONSTRAINT IF EXISTS timesheet_entries_shift_id_fkey;
ALTER TABLE timesheet_entries ADD  CONSTRAINT timesheet_entries_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES job_request_shifts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_shift_id ON timesheet_entries(shift_id);

-- Refresh the freeze trigger to protect shift_id once approved.
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
       OR NEW.std_rate             IS DISTINCT FROM OLD.std_rate
       OR NEW.ot_rate              IS DISTINCT FROM OLD.ot_rate
       OR NEW.dt_rate              IS DISTINCT FROM OLD.dt_rate
       OR NEW.total_pay            IS DISTINCT FROM OLD.total_pay
       OR NEW.employee_key         IS DISTINCT FROM OLD.employee_key
       OR NEW.user_id              IS DISTINCT FROM OLD.user_id
       OR NEW.notes                IS DISTINCT FROM OLD.notes
       OR NEW.timesheet_id         IS DISTINCT FROM OLD.timesheet_id
       OR NEW.job_id               IS DISTINCT FROM OLD.job_id
       OR NEW.job_sheet_id         IS DISTINCT FROM OLD.job_sheet_id
       OR NEW.shift_id             IS DISTINCT FROM OLD.shift_id
      ) THEN
        RAISE EXCEPTION 'Cannot modify content of an approved timesheet entry (id=%). Unlock it (status -> submitted) first to edit.',
          OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
