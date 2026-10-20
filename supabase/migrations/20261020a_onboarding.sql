-- 20261020a_onboarding.sql — Onboarding screen (backlog #120).
--
-- 1. employees.paychex_worker_id / paychex_invited_at / paychex_invited_by:
--    set when Connor presses "Send to Paychex". The worker ID is Paychex's
--    own key (not the Payroll ID), so the Payroll ID can be linked back
--    without name matching once onboarding is finished.
-- 2. employee_not_duplicate: pairs Connor has said are NOT the same person,
--    so the possible-duplicate flag stops coming back. Stored with
--    key_a < key_b so each pair has one row.
-- 3. paychex_onboard_log: every send attempt (dry runs included), with the
--    request as sent and Paychex's reply minus SSN/DOB/sex.
--
-- Server routes use the service role; admins can read.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS paychex_worker_id  text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS paychex_invited_at timestamptz;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS paychex_invited_by uuid;

CREATE UNIQUE INDEX IF NOT EXISTS employees_paychex_worker_id_uniq
  ON employees (paychex_worker_id) WHERE paychex_worker_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS employee_not_duplicate (
  key_a       text NOT NULL,
  key_b       text NOT NULL,
  decided_by  uuid,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_a, key_b),
  CHECK (key_a < key_b)
);

ALTER TABLE employee_not_duplicate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_not_duplicate_admin_read" ON employee_not_duplicate;
CREATE POLICY "employee_not_duplicate_admin_read" ON employee_not_duplicate FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE TABLE IF NOT EXISTS paychex_onboard_log (
  id              bigserial PRIMARY KEY,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  sent_by         uuid,
  employee_key    text NOT NULL,
  dry_run         boolean NOT NULL,
  request         jsonb,
  response_status integer,
  response        jsonb,
  worker_id       text,
  ok              boolean NOT NULL,
  error           text
);

CREATE INDEX IF NOT EXISTS paychex_onboard_log_emp_idx ON paychex_onboard_log (employee_key);

ALTER TABLE paychex_onboard_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paychex_onboard_log_admin_read" ON paychex_onboard_log;
CREATE POLICY "paychex_onboard_log_admin_read" ON paychex_onboard_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
