-- Paychex worker sync log (backlog #117, 2026-10-14).
--
-- The Payroll page's "Sync from Paychex" previews changes Paychex has for
-- AOS employees (contact info, new Payroll IDs, new people) and applies the
-- ones an admin ticks. Every applied change is recorded here with the row as
-- it was before, so any of them can be undone by hand.
--
-- Written only by the server (service role) from app/api/paychex/sync.
-- RLS on with a read-only policy for admins; no client writes.

CREATE TABLE IF NOT EXISTS paychex_sync_log (
  id            bigserial PRIMARY KEY,
  run_id        text NOT NULL,              -- one Apply click
  run_at        timestamptz NOT NULL DEFAULT now(),
  run_by        uuid,                       -- auth user who clicked Apply
  change_id     text NOT NULL,              -- update:<key> / link:<key>:<id> / create:<id>
  kind          text NOT NULL,              -- update | link | create
  employee_key  text,
  payroll_id    integer,
  before        jsonb,                      -- the employees row before (NULL for create)
  after         jsonb,                      -- what was written
  ok            boolean NOT NULL,
  error         text
);

CREATE INDEX IF NOT EXISTS paychex_sync_log_run_idx ON paychex_sync_log (run_id);
CREATE INDEX IF NOT EXISTS paychex_sync_log_emp_idx ON paychex_sync_log (employee_key);

ALTER TABLE paychex_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paychex_sync_log_admin_read" ON paychex_sync_log;
CREATE POLICY "paychex_sync_log_admin_read" ON paychex_sync_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
