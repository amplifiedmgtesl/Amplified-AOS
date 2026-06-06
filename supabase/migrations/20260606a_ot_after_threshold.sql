-- Per-role OT/DT threshold on rate card + timesheet entries.
--
-- Background: as of today the entry→bucket split in
-- lib/store/timekeeping.ts hardcodes std=min(8,total), ot=min(4,total-8),
-- dt=total-12. That contradicts contracts like CCMF where build-day labor
-- is "day rate flat for 10 hours, hourly thereafter, no OT premium." The
-- rate card already carries `dt_after` per role (defaulting to "10"); this
-- migration adds the matching `ot_after` and snapshots BOTH thresholds onto
-- each timesheet entry at creation, alongside the existing bill_*_rate
-- columns. NULL on a threshold means "no bucket at this tier" — all hours
-- past the prior tier stay in stdHours.
--
-- Bucket semantics with thresholds T_ot and T_dt:
--   stdHours = min(total, T_ot or T_dt or total)
--   otHours  = T_ot is null ? 0 : clamp(total - T_ot, 0, T_dt - T_ot)
--   dtHours  = T_dt is null ? 0 : max(total - T_dt, 0)
--
-- Per-entry snapshot (not per-job, not per-rate-card) so threshold changes
-- on the rate card don't retroactively re-split frozen / approved entries.
-- Matches the existing bill_std_rate/bill_ot_rate/bill_dt_rate snapshot
-- pattern from 20260528b.

-- ─── 1. rate_card_profile_rows.ot_after ─────────────────────────────────
-- Text column matching the existing dt_after pattern (which is also text —
-- editor stores "" / "8" / "10" / etc.). NULL or "" treated as "no OT".
ALTER TABLE rate_card_profile_rows
  ADD COLUMN IF NOT EXISTS ot_after text;

-- ─── 2. timesheet_entries snapshots ──────────────────────────────────────
ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS bill_ot_after integer,
  ADD COLUMN IF NOT EXISTS bill_dt_after integer;

COMMENT ON COLUMN timesheet_entries.bill_ot_after IS
  'Hours after which OT bucket starts. Snapshotted from rate card row at entry creation. NULL = no OT bucket; all hours stay in std.';
COMMENT ON COLUMN timesheet_entries.bill_dt_after IS
  'Hours after which DT bucket starts. Snapshotted from rate card row at entry creation. NULL = no DT bucket.';

-- ─── 3. Re-create freeze trigger with new column list ───────────────────
-- Same pattern as 20260528b: drop, redefine function with new cols added
-- to the "immutable once approved" check, re-attach. Both new columns are
-- additive to the snapshot, so they need to be frozen alongside the rates.
DROP TRIGGER IF EXISTS timesheet_entries_freeze_iud_trg ON timesheet_entries;

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

-- ─── 4. Smoke test ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'timesheet_entries' AND column_name = 'bill_ot_after'
  ) THEN
    RAISE EXCEPTION 'bill_ot_after column missing after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'timesheet_entries' AND column_name = 'bill_dt_after'
  ) THEN
    RAISE EXCEPTION 'bill_dt_after column missing after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'rate_card_profile_rows' AND column_name = 'ot_after'
  ) THEN
    RAISE EXCEPTION 'rate_card_profile_rows.ot_after column missing after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'timesheet_entries_freeze_iud_trg'
  ) THEN
    RAISE EXCEPTION 'freeze trigger did not re-attach';
  END IF;
END $$;
