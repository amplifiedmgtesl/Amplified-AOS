-- Employee merge (backlog #116, 2026-10-13).
--
-- One person = one employees row. merge_employee(dup, keep) moves everything
-- that points at the duplicate onto the kept record, fills the kept record's
-- blanks from the duplicate, saves a full backup of the duplicate, then HARD
-- deletes it — all in one transaction, so a merge either fully happens or
-- doesn't happen at all.
--
-- Why hard delete: the 8/30 "retire to Inactive" left the duplicates in the
-- picker and 10 of 44 were used again. Once the history has moved there's
-- nothing left to keep. The delete doubles as a safety check: timesheet
-- entries and crew assignments have NO ACTION foreign keys, so if anything
-- was missed the delete fails and the whole merge rolls back.
--
-- Rules agreed with John 2026-10-12:
--   • The kept record's values win; only its BLANKS are filled from the
--     duplicate (phone, email, address, Payroll ID, …).
--   • Employment type: Employee if either record is Employee (a W-2 must
--     never quietly become 1099).
--   • Crew assignments: a person can be on a day+shift once. If both records
--     were assigned to the same day+shift, the duplicate's assignment is
--     dropped (Confirmed carries over if either was confirmed).
--   • Two timesheet rows on the same date are NOT touched — they could be a
--     real second call. They're moved and reported for review.
--
-- References (checked on prod + dev 2026-10-12): timesheet_entries,
-- job_request_assignments, payroll_run_entries, employee_documents (ON
-- DELETE CASCADE — must move before the delete), job_sheet_workers,
-- profiles (login → employee link), timesheet_captures.captured_employee_key
-- (dev/Time Clock only, handled if the column exists).

-- ── 1. Invoice lock: allow ONLY the employee to change, ONLY during a merge ──
-- Same function as 20260606d with one line changed (employee_key).
CREATE OR REPLACE FUNCTION public.timesheet_entries_freeze_check()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_line_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot delete an invoice-bound timesheet entry (id=%). Unlink the invoice line first (void or supersede the invoice).',
        OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.invoice_line_id IS NOT NULL THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Cannot change status of an invoice-bound timesheet entry (id=%). Unlink the invoice line first.',
        OLD.id USING ERRCODE = '23514';
    END IF;

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
     -- Employee merge (20261013a) may re-point the row to the kept record.
     OR (NEW.employee_key        IS DISTINCT FROM OLD.employee_key
         AND coalesce(current_setting('app.employee_merge', true), '') <> 'on')
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
$function$;

-- ── 2. Backup of every merged-away record ───────────────────────────────────
CREATE TABLE IF NOT EXISTS employees_merged (
  id            bigserial PRIMARY KEY,
  merged_key    text NOT NULL,          -- the duplicate that was deleted
  merged_into   text NOT NULL,          -- the kept record
  merged_at     timestamptz NOT NULL DEFAULT now(),
  merged_by     uuid,
  employee_row  jsonb NOT NULL,         -- the full deleted row
  kept_before   jsonb NOT NULL,         -- the kept row before blanks were filled
  moved         jsonb NOT NULL          -- ids moved per table (for an undo)
);
ALTER TABLE employees_merged ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employees_merged_read" ON employees_merged;
CREATE POLICY "employees_merged_read" ON employees_merged FOR SELECT USING (true);

-- ── 3. The merge ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_employee(p_dup text, p_keep text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dup   employees%ROWTYPE;
  v_keep  employees%ROWTYPE;
  v_role  text;
  v_ts    text[];  v_asg text[];  v_asg_dropped text[];
  v_pay   text[];  v_doc text[];  v_jsw  text[];  v_prof text[];  v_cap text[];
  v_overlaps jsonb;
BEGIN
  -- Admins only when called from the app. Direct SQL (no auth.uid) is the
  -- batch path run by John/Claude.
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
    IF coalesce(v_role, '') <> 'admin' THEN
      RAISE EXCEPTION 'Only admins can merge employee records.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_dup IS NULL OR p_keep IS NULL OR p_dup = p_keep THEN
    RAISE EXCEPTION 'Pick two different employee records to merge.';
  END IF;

  SELECT * INTO v_keep FROM employees WHERE employee_key = p_keep FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kept record % not found.', p_keep; END IF;
  SELECT * INTO v_dup  FROM employees WHERE employee_key = p_dup  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicate record % not found.', p_dup; END IF;
  IF v_dup.rippling_employee_id IS NOT NULL AND v_keep.rippling_employee_id IS NOT NULL
     AND v_dup.rippling_employee_id <> v_keep.rippling_employee_id THEN
    RAISE EXCEPTION 'These records have different Payroll IDs (% and %) — they may be two different people.',
      v_keep.rippling_employee_id, v_dup.rippling_employee_id;
  END IF;

  -- Same-date timesheet rows: moved, but reported for a human to check.
  SELECT coalesce(jsonb_agg(jsonb_build_object('date', d.work_date, 'job_id', d.job_id,
           'kept_entry', k.id::text, 'moved_entry', d.id::text)), '[]'::jsonb)
    INTO v_overlaps
    FROM timesheet_entries d
    JOIN timesheet_entries k
      ON k.employee_key = p_keep AND k.work_date = d.work_date
     AND coalesce(k.shift_id, '') = coalesce(d.shift_id, '')
   WHERE d.employee_key = p_dup;

  PERFORM set_config('app.employee_merge', 'on', true);

  -- Crew assignments: drop the duplicate's where the kept record is already
  -- on the same day+shift (carry Confirmed over), move the rest.
  UPDATE job_request_assignments k SET confirmed = true
    FROM job_request_assignments d
   WHERE d.employee_key = p_dup AND k.employee_key = p_keep
     AND k.job_request_day_id = d.job_request_day_id
     AND coalesce(k.shift_id, '') = coalesce(d.shift_id, '')
     AND d.confirmed AND NOT k.confirmed;
  WITH gone AS (
    DELETE FROM job_request_assignments d
     USING job_request_assignments k
     WHERE d.employee_key = p_dup AND k.employee_key = p_keep
       AND k.job_request_day_id = d.job_request_day_id
       AND coalesce(k.shift_id, '') = coalesce(d.shift_id, '')
    RETURNING d.id::text AS id)
  SELECT coalesce(array_agg(id), '{}') INTO v_asg_dropped FROM gone;
  WITH m AS (UPDATE job_request_assignments SET employee_key = p_keep WHERE employee_key = p_dup RETURNING id::text AS id)
  SELECT coalesce(array_agg(id), '{}') INTO v_asg FROM m;

  WITH m AS (UPDATE timesheet_entries SET employee_key = p_keep WHERE employee_key = p_dup RETURNING id::text AS id)
  SELECT coalesce(array_agg(id), '{}') INTO v_ts FROM m;
  WITH m AS (UPDATE payroll_run_entries SET employee_key = p_keep WHERE employee_key = p_dup RETURNING id::text AS id)
  SELECT coalesce(array_agg(id), '{}') INTO v_pay FROM m;
  WITH m AS (UPDATE employee_documents SET employee_key = p_keep WHERE employee_key = p_dup RETURNING id)
  SELECT coalesce(array_agg(id::text), '{}') INTO v_doc FROM m;
  WITH m AS (UPDATE job_sheet_workers SET employee_key = p_keep WHERE employee_key = p_dup RETURNING id)
  SELECT coalesce(array_agg(id::text), '{}') INTO v_jsw FROM m;
  WITH m AS (UPDATE profiles SET employee_key = p_keep WHERE employee_key = p_dup RETURNING id)
  SELECT coalesce(array_agg(id::text), '{}') INTO v_prof FROM m;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'timesheet_captures'
                AND column_name = 'captured_employee_key') THEN
    EXECUTE 'WITH m AS (UPDATE timesheet_captures SET captured_employee_key = $1
               WHERE captured_employee_key = $2 RETURNING timesheet_entry_id)
             SELECT coalesce(array_agg(timesheet_entry_id::text), ''{}'') FROM m'
      INTO v_cap USING p_keep, p_dup;
  END IF;

  PERFORM set_config('app.employee_merge', 'off', true);

  -- Backup, then delete. Payroll entries have no FK, so check them by hand.
  IF EXISTS (SELECT 1 FROM payroll_run_entries WHERE employee_key = p_dup) THEN
    RAISE EXCEPTION 'Payroll entries still point at % — merge aborted.', p_dup;
  END IF;
  INSERT INTO employees_merged (merged_key, merged_into, merged_by, employee_row, kept_before, moved)
  VALUES (p_dup, p_keep, auth.uid(), to_jsonb(v_dup), to_jsonb(v_keep), jsonb_build_object(
    'timesheet_entries', v_ts, 'job_request_assignments', v_asg,
    'job_request_assignments_dropped', v_asg_dropped, 'payroll_run_entries', v_pay,
    'employee_documents', v_doc, 'job_sheet_workers', v_jsw, 'profiles', v_prof,
    'timesheet_captures', coalesce(v_cap, '{}')));

  DELETE FROM employees WHERE employee_key = p_dup;   -- fails if anything was missed

  -- Fill the kept record's blanks (after the delete, so a unique Payroll ID
  -- can move across).
  UPDATE employees k SET
    full_name       = coalesce(nullif(btrim(k.full_name), ''), v_dup.full_name),
    first_name      = coalesce(nullif(btrim(k.first_name), ''), v_dup.first_name),
    last_name       = coalesce(nullif(btrim(k.last_name), ''), v_dup.last_name),
    preferred_name  = coalesce(nullif(btrim(k.preferred_name), ''), v_dup.preferred_name),
    payroll_name    = coalesce(nullif(btrim(k.payroll_name), ''), v_dup.payroll_name),
    email           = coalesce(nullif(btrim(k.email), ''), v_dup.email),
    phone           = coalesce(nullif(btrim(k.phone), ''), v_dup.phone),
    address         = coalesce(nullif(btrim(k.address), ''), v_dup.address),
    city            = coalesce(nullif(btrim(k.city), ''), v_dup.city),
    state           = coalesce(nullif(btrim(k.state), ''), v_dup.state),
    state_code      = coalesce(nullif(btrim(k.state_code), ''), v_dup.state_code),
    zip             = coalesce(nullif(btrim(k.zip), ''), v_dup.zip),
    profile_picture = coalesce(nullif(btrim(k.profile_picture), ''), v_dup.profile_picture),
    notes           = CASE WHEN nullif(btrim(v_dup.notes), '') IS NULL THEN k.notes
                           WHEN nullif(btrim(k.notes), '') IS NULL THEN v_dup.notes
                           WHEN position(btrim(v_dup.notes) IN k.notes) > 0 THEN k.notes
                           ELSE k.notes || E'\n' || v_dup.notes END,
    hire_date       = CASE WHEN k.hire_date IS NULL THEN v_dup.hire_date
                           WHEN v_dup.hire_date IS NULL THEN k.hire_date
                           ELSE least(k.hire_date, v_dup.hire_date) END,
    rippling_employee_id = coalesce(k.rippling_employee_id, v_dup.rippling_employee_id),
    pay_std_rate    = coalesce(k.pay_std_rate, v_dup.pay_std_rate),
    pay_ot_rate     = coalesce(k.pay_ot_rate, v_dup.pay_ot_rate),
    pay_dt_rate     = coalesce(k.pay_dt_rate, v_dup.pay_dt_rate),
    employment_type = CASE WHEN 'Employee' IN (k.employment_type, v_dup.employment_type)
                           THEN 'Employee' ELSE k.employment_type END
   WHERE k.employee_key = p_keep;

  RETURN jsonb_build_object(
    'merged', p_dup, 'into', p_keep,
    'timesheet_entries', cardinality(v_ts),
    'crew_assignments', cardinality(v_asg),
    'crew_assignments_dropped_as_duplicate', cardinality(v_asg_dropped),
    'payroll_entries', cardinality(v_pay),
    'documents', cardinality(v_doc),
    'job_sheet_workers', cardinality(v_jsw),
    'logins', cardinality(v_prof),
    'time_clock_captures', cardinality(coalesce(v_cap, '{}')),
    'same_day_timesheet_rows', v_overlaps);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_employee(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_employee(text, text) TO authenticated, service_role;
