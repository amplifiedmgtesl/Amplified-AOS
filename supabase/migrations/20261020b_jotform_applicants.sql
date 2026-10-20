-- 20261020b_jotform_applicants.sql — website applicants into the Employee
-- list (backlog #121, plan docs/jotform-applicants-plan.md).
--
-- 1. employees.applied_at / jotform_submission_id: the person's latest
--    Employee Application (JotForm form 260385023196052).
-- 2. employees.sms_consent / sms_consent_at: their answer to the text-message
--    question, so nobody has to ask again (John, 10/20).
-- 3. employees.application_contact: what they typed on that application
--    (email, phone, address). Never copied over AOS values by itself; the
--    Onboarding page shows it where it differs, with one click to use it.
-- 4. jotform_application_log: every submission handled (webhook or the
--    one-time load), with the record as it was before, so any change can be
--    undone by hand. Submission ID is unique: a JotForm retry is ignored.
--
-- Written only by the server (service role). Admins can read the log.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS applied_at            timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS jotform_submission_id text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sms_consent           boolean;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS sms_consent_at        timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS application_contact   jsonb;

CREATE TABLE IF NOT EXISTS jotform_application_log (
  id             bigserial PRIMARY KEY,
  submission_id  text NOT NULL UNIQUE,
  submitted_at   timestamptz,
  received_at    timestamptz NOT NULL DEFAULT now(),
  via            text NOT NULL,              -- webhook | load
  outcome        text NOT NULL,              -- created | updated | matched | older | skipped | error
  match_reason   text,                       -- email | phone | name
  employee_key   text,
  reason         text,                       -- why skipped / what differs
  application    jsonb,                      -- name, email, phone, address, position, sms (no work history)
  before         jsonb,                      -- employees row before (NULL for create)
  after          jsonb                       -- what was written
);

CREATE INDEX IF NOT EXISTS jotform_application_log_emp_idx ON jotform_application_log (employee_key);

ALTER TABLE jotform_application_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "jotform_application_log_admin_read" ON jotform_application_log;
CREATE POLICY "jotform_application_log_admin_read" ON jotform_application_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- 5. merge_employee: carry the newer application (and SMS answer) onto the
--    kept record, so merging an applicant's new record into the one a crew
--    lead typed in doesn't lose it. Same function as 20261013a otherwise.
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
                           THEN 'Employee' ELSE k.employment_type END,
    -- Website application (20261020b): the newer one wins.
    applied_at            = CASE WHEN v_dup.applied_at > coalesce(k.applied_at, '-infinity') THEN v_dup.applied_at ELSE k.applied_at END,
    jotform_submission_id = CASE WHEN v_dup.applied_at > coalesce(k.applied_at, '-infinity') THEN v_dup.jotform_submission_id ELSE k.jotform_submission_id END,
    application_contact   = CASE WHEN v_dup.applied_at > coalesce(k.applied_at, '-infinity') THEN v_dup.application_contact ELSE k.application_contact END,
    sms_consent           = CASE WHEN v_dup.sms_consent_at > coalesce(k.sms_consent_at, '-infinity') THEN v_dup.sms_consent ELSE k.sms_consent END,
    sms_consent_at        = CASE WHEN v_dup.sms_consent_at > coalesce(k.sms_consent_at, '-infinity') THEN v_dup.sms_consent_at ELSE k.sms_consent_at END
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
