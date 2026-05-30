-- Phase 4: holiday snapshot + multiplier on timesheet_entries.
--
-- Crew pay also gets the holiday premium (not just client billing).
-- This brings the same atomic-day + flat-multiplier model that
-- quote_days / invoice_days use into the labor-cost layer.
--
-- Pattern C snapshot:
--   * is_holiday and holiday_multiplier are stored ON the entry row.
--   * Backfilled at migration time from job_request_days for any entry
--     that has both job_id and work_date set.
--   * Snapshot remains stable even if the source day's flag is changed
--     later (the row preserves whatever multiplier applied when the
--     work was paid).
--
-- Calc rule (matches commit c1e2fd0 — atomic days, flat multiplier):
--   * On a holiday row, pay = totalHours × stdRate × holidayMultiplier.
--     OT/DT premium does NOT stack — it's superseded by the multiplier.
--   * On non-holiday rows, pay = the existing ST/OT/DT split.
--
-- Default multiplier on rows with no resolved rate card: 2.0.
--
-- Freeze trigger temporarily disabled around the backfill UPDATE
-- (same idiom as Phase 3's position/specialty backfill).

ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS is_holiday boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS holiday_multiplier numeric;

-- Backfill is_holiday from job_request_days on matched (job_id, work_date).
ALTER TABLE timesheet_entries DISABLE TRIGGER timesheet_entries_freeze_iud_trg;

UPDATE timesheet_entries te
SET is_holiday = true
FROM job_request_days d
WHERE te.is_holiday = false
  AND te.job_id IS NOT NULL
  AND te.work_date IS NOT NULL
  AND d.job_request_id = te.job_id
  AND d.event_date::date = te.work_date::date
  AND d.is_holiday = true;

-- Backfill holiday_multiplier on flagged rows from the job's quote (which
-- already snapshot the rate card's multiplier). If no quote is linked,
-- leave NULL — the calc will fall back to 2.0.
UPDATE timesheet_entries te
SET holiday_multiplier = q.holiday_multiplier
FROM quotes q
WHERE te.is_holiday = true
  AND te.holiday_multiplier IS NULL
  AND q.job_request_id = te.job_id
  AND q.holiday_multiplier IS NOT NULL;

ALTER TABLE timesheet_entries ENABLE TRIGGER timesheet_entries_freeze_iud_trg;

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_is_holiday
  ON timesheet_entries(is_holiday) WHERE is_holiday = true;

-- Refresh the freeze trigger to include the new columns.
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
