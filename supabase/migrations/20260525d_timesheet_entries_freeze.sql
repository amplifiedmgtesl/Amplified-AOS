-- Phase 1 follow-up: freeze trigger on timesheet_entries.
--
-- Once an entry is approved, its content is locked. Once an approved
-- entry has been billed onto an invoice line, its status is locked too.
-- Same model as `quotes_freeze_check` / `invoices_freeze_check`.
--
-- Allowed on approved rows:
--   * status transitions AWAY from 'approved' (unlock to submitted/rejected)
--   * invoice_line_id (the Pull-Actuals flow writes this AFTER approval)
--   * sort_order (cosmetic re-ordering within a timesheet)
--   * audit columns (updated_at, etc.)
--
-- Blocked on approved rows:
--   * All content fields (hours/times/rates/employee/position/dates/notes)
--   * Re-assigning to a different timesheet/job
--   * DELETE
--
-- Super-freeze when invoice_line_id IS NOT NULL (entry has been billed):
--   * status cannot change. To un-approve, the invoice line must be
--     unlinked first via the invoice draft editor's unbind workflow.
--   * DELETE still blocked.
--
-- The trigger raises a clear error message so the UI / a direct SQL hand
-- both see WHY the change was rejected.

CREATE OR REPLACE FUNCTION timesheet_entries_freeze_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- ─── DELETE ────────────────────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION
        'Cannot delete an approved timesheet entry (id=%). Unlock it (status -> submitted) first, or reject it.',
        OLD.id
        USING ERRCODE = '23514';  -- check_violation, surfaces cleanly in app code
    END IF;
    RETURN OLD;
  END IF;

  -- ─── UPDATE ────────────────────────────────────────────────────────────
  -- Only protect when the row WAS approved at the start of the UPDATE.
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN

    -- Super-freeze: row is billed onto an invoice line. Status cannot change.
    IF OLD.invoice_line_id IS NOT NULL THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION
          'Cannot change status of an invoice-bound timesheet entry (id=%). Unlink the invoice line first.',
          OLD.id
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- Content freeze: while still approved (status unchanged or also approved
    -- in NEW), block changes to every content field. Status transitions away
    -- from approved are allowed; once status leaves 'approved', the trigger
    -- doesn't fire on subsequent edits (OLD.status will be the new value).
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
      ) THEN
        RAISE EXCEPTION
          'Cannot modify content of an approved timesheet entry (id=%). Unlock it (status -> submitted) first to edit.',
          OLD.id
          USING ERRCODE = '23514';
      END IF;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS timesheet_entries_freeze_iud_trg ON timesheet_entries;
CREATE TRIGGER timesheet_entries_freeze_iud_trg
  BEFORE UPDATE OR DELETE ON timesheet_entries
  FOR EACH ROW
  EXECUTE FUNCTION timesheet_entries_freeze_check();

-- Quick smoke test: confirm the trigger is installed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'timesheet_entries_freeze_iud_trg'
      AND tgrelid = 'timesheet_entries'::regclass
  ) THEN
    RAISE EXCEPTION 'timesheet_entries_freeze_iud_trg did not install';
  END IF;
END $$;
