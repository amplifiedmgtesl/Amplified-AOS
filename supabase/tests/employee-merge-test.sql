-- Employee merge test (20261013a). Runs entirely inside one DO block that ends
-- in RAISE EXCEPTION, so EVERYTHING rolls back — safe to run on dev. Uses dev's
-- test people (Aaron Combs AES-01198) and ties his entry to an invoice line
-- inside the transaction to exercise the invoice lock. Read the result JSON
-- out of the error message.
DO $t$
DECLARE r jsonb; blocked text := 'NOT BLOCKED'; chk jsonb; line text;
BEGIN
  SELECT id INTO line FROM invoice_lines LIMIT 1;
  -- Throwaway duplicate of Aaron Combs (AES-01198)
  INSERT INTO employees (employee_key, full_name, first_name, last_name, phone, email, employment_type, source)
  VALUES ('test-dup-combs', 'Aaron Combs', 'Aaron', 'Combs', '614-555-0100', 'other@example.com', 'Contractor', 'merge-test');
  -- Tie his timesheet entry to an invoice line, then move entry + payroll line onto the duplicate
  UPDATE timesheet_entries SET invoice_line_id = line WHERE id = 'manual-1790646975506';
  PERFORM set_config('app.employee_merge', 'on', true);
  UPDATE timesheet_entries SET employee_key = 'test-dup-combs' WHERE id = 'manual-1790646975506';
  PERFORM set_config('app.employee_merge', 'off', true);
  UPDATE payroll_run_entries SET employee_key = 'test-dup-combs' WHERE id = 'pre-mv5s9lvb-5vock5';
  -- Colliding assignment (same day+shift as Combs, confirmed) and a non-colliding one
  INSERT INTO job_request_assignments (id, job_request_day_id, employee_key, shift_id, confirmed, sort_order)
  VALUES ('test-asg-collide', 'jrd-kiosktest-c-1', 'test-dup-combs', 'shift-kiosktest-c-loadin', true, 99),
         ('test-asg-other', 'jobreq-1779676944207_d20260705', 'test-dup-combs', NULL, false, 99);
  -- Lock still holds for a normal edit of the invoiced entry
  BEGIN
    UPDATE timesheet_entries SET employee_key = 'AES-01198' WHERE id = 'manual-1790646975506';
  EXCEPTION WHEN check_violation THEN blocked := 'BLOCKED (good)';
  END;

  r := merge_employee('test-dup-combs', 'AES-01198');

  SELECT jsonb_build_object(
    'normal_edit_on_invoiced_entry', blocked,
    'merge_result', r,
    'ts_owner_now', (SELECT employee_key FROM timesheet_entries WHERE id = 'manual-1790646975506'),
    'ts_still_invoiced', (SELECT invoice_line_id IS NOT NULL FROM timesheet_entries WHERE id = 'manual-1790646975506'),
    'payroll_owner_now', (SELECT employee_key FROM payroll_run_entries WHERE id = 'pre-mv5s9lvb-5vock5'),
    'dup_still_exists', EXISTS (SELECT 1 FROM employees WHERE employee_key = 'test-dup-combs'),
    'colliding_assignment_gone', NOT EXISTS (SELECT 1 FROM job_request_assignments WHERE id = 'test-asg-collide'),
    'combs_kiosk_assignment_confirmed', (SELECT confirmed FROM job_request_assignments WHERE id = 'jra-kiosktest-c-d1-07'),
    'other_assignment_owner', (SELECT employee_key FROM job_request_assignments WHERE id = 'test-asg-other'),
    'combs_phone_filled', (SELECT phone FROM employees WHERE employee_key = 'AES-01198'),
    'combs_email_kept', (SELECT email FROM employees WHERE employee_key = 'AES-01198'),
    'combs_payroll_id', (SELECT rippling_employee_id FROM employees WHERE employee_key = 'AES-01198'),
    'backup_rows', (SELECT count(*) FROM employees_merged WHERE merged_key = 'test-dup-combs'))
  INTO chk;
  RAISE EXCEPTION 'TEST RESULT (rolled back): %', chk;
END $t$;
