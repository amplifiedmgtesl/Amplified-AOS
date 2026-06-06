-- Relax the timesheet_entries freeze trigger.
--
-- Before: two layers of protection
--   1. Invoice-bound entries (invoice_line_id IS NOT NULL): full freeze
--      — status + content immutable. Necessary; this is what protects
--      the customer-facing billing record.
--   2. Approved entries (status = 'approved'), regardless of invoice
--      binding: content immutable. This was approval-as-lock — the idea
--      that "approved" means "operator has reviewed and not touched
--      since." In practice it forced an awkward dance for every
--      legitimate post-approval edit (approve -> submitted -> update ->
--      approve).
--
-- After: only layer 1 remains.
--   - Approved + not invoice-bound: freely editable. Connor can correct
--     typos, fix specialty assignments, etc. without the dance.
--   - Approved + invoice-bound: still fully frozen (same as before).
--     The customer's invoice line never silently drifts.
--   - Submitted: freely editable (no change from before).
--
-- Trade-off accepted per Connor on 2026-06-06: approval becomes
-- weaker as a guarantee (no audit of post-approval edits), but the
-- billing record is still hard-protected once an invoice draws the
-- entry in. Backfill-style operations like today's specialty_id
-- cleanup become one-step instead of three.

CREATE OR REPLACE FUNCTION timesheet_entries_freeze_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- DELETE: only blocked when invoice-bound. (Approved-but-unbound
  -- can be deleted by the operator.)
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_line_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot delete an invoice-bound timesheet entry (id=%). Unlink the invoice line first (void or supersede the invoice).',
        OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: only the invoice-bound case enforces immutability now.
  IF TG_OP = 'UPDATE' AND OLD.invoice_line_id IS NOT NULL THEN
    -- Status can't change while bound (would silently strand the line).
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change status of an invoice-bound timesheet entry (id=%). Unlink the invoice line first.',
        OLD.id USING ERRCODE = '23514';
    END IF;

    -- Content immutability check while bound.
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
     OR NEW.bill_ot_after        IS DISTINCT FROM OLD.bill_ot_after
     OR NEW.bill_dt_after        IS DISTINCT FROM OLD.bill_dt_after
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
      RAISE EXCEPTION 'Cannot modify content of an invoice-bound timesheet entry (id=%). Unlink the invoice line first (void or supersede the invoice).',
        OLD.id USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger itself doesn't change (same name, same timing). Function
-- replacement is enough.
