-- Phase 3: position_id + specialty_id FKs on timesheet_entries.
--
-- Brings timekeeping into the same normalized position/specialty model
-- that quote_lines and invoice_lines and job_request_crew_needs and
-- job_request_assignments use. Replaces the free-text `position` column
-- as the source of truth (text column kept as a historical snapshot,
-- same convention as quote/invoice line tables).
--
-- Backfill: name-match existing `position` text → `positions.id`. The
-- legacy text column stays in place — rowToTimeEntry continues to read
-- it as a fallback display. Specialty stays NULL (legacy entries have
-- no specialty assignment).
--
-- The freeze trigger temporarily disables for the backfill UPDATE
-- (otherwise approved rows would reject the new column write), then
-- re-enables with position_id + specialty_id added to the protected list.

ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS position_id  text,
  ADD COLUMN IF NOT EXISTS specialty_id text;

-- Temporarily disable freeze trigger so the backfill UPDATE can touch
-- approved rows that we own here.
ALTER TABLE timesheet_entries DISABLE TRIGGER timesheet_entries_freeze_iud_trg;

UPDATE timesheet_entries te
SET position_id = p.id
FROM positions p
WHERE te.position_id IS NULL
  AND NULLIF(TRIM(te.position),'') IS NOT NULL
  AND lower(TRIM(te.position)) = lower(TRIM(p.name));

ALTER TABLE timesheet_entries ENABLE TRIGGER timesheet_entries_freeze_iud_trg;

-- Pre-flight orphans (should be zero after backfill — but the FK add
-- below would fail noisily if not).
DO $$
DECLARE op int; os int;
BEGIN
  SELECT count(*) INTO op FROM timesheet_entries te
   WHERE te.position_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.id = te.position_id);
  IF op > 0 THEN RAISE NOTICE 'timesheet_entries.position_id orphans: %', op; END IF;

  SELECT count(*) INTO os FROM timesheet_entries te
   WHERE te.specialty_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM specialties s WHERE s.id = te.specialty_id);
  IF os > 0 THEN RAISE NOTICE 'timesheet_entries.specialty_id orphans: %', os; END IF;
END $$;

ALTER TABLE timesheet_entries DROP CONSTRAINT IF EXISTS timesheet_entries_position_id_fkey;
ALTER TABLE timesheet_entries ADD  CONSTRAINT timesheet_entries_position_id_fkey
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE RESTRICT;

ALTER TABLE timesheet_entries DROP CONSTRAINT IF EXISTS timesheet_entries_specialty_id_fkey;
ALTER TABLE timesheet_entries ADD  CONSTRAINT timesheet_entries_specialty_id_fkey
  FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_timesheet_entries_position_id  ON timesheet_entries(position_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_specialty_id ON timesheet_entries(specialty_id);

-- Refresh freeze trigger to include the new columns.
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
      ) THEN
        RAISE EXCEPTION 'Cannot modify content of an approved timesheet entry (id=%). Unlock it (status -> submitted) first to edit.',
          OLD.id USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
