-- 20261020c_paychex_snapshot.sql — a copy of Paychex kept in AOS
-- (plan: docs/paychex-snapshot-plan.md, John 2026-10-20).
--
-- Reading Paychex live costs ~155 calls (no search, no "changed since"), so
-- Onboarding, the employee profile and Sync from Paychex read this copy
-- instead. Refreshed Monday night, by "Refresh now", and by Send to Paychex
-- when it's over an hour old.
--
-- 1. paychex_workers: one row per Paychex worker. Contact info only for
--    active workers (Paychex's list doesn't carry it). No SSN, birth date or
--    sex: those are dropped before saving, as everywhere else.
-- 2. paychex_snapshot_runs: each refresh, with what it changed in AOS.
-- 3. fill_paychex_worker_ids(): puts Paychex's worker ID on every AOS record
--    whose Payroll ID it matches (prod had 0 of 430 on 10/20).
--
-- Written by the server (service role); admins can read.

CREATE TABLE IF NOT EXISTS paychex_workers (
  worker_id     text PRIMARY KEY,           -- Paychex's internal key
  employee_id   text,                       -- the Payroll ID ("" until onboarding is finished)
  given_name    text,
  middle_name   text,
  family_name   text,
  status        text,                       -- ACTIVE | INACTIVE | TERMINATED | IN_PROGRESS …
  worker_type   text,
  hire_date     date,
  email         text,
  phone         text,
  address       text,
  city          text,
  state_code    text,
  zip           text,
  contact_read  boolean NOT NULL DEFAULT false,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paychex_workers_employee_id_idx ON paychex_workers (employee_id);

CREATE TABLE IF NOT EXISTS paychex_snapshot_runs (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  trigger      text NOT NULL,               -- schedule | manual | send
  run_by       uuid,
  ok           boolean,
  error        text,
  workers      integer,
  active       integer,
  summary      jsonb                        -- what was applied / held
);

ALTER TABLE paychex_workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paychex_workers_admin_read" ON paychex_workers;
CREATE POLICY "paychex_workers_admin_read" ON paychex_workers FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

ALTER TABLE paychex_snapshot_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "paychex_snapshot_runs_admin_read" ON paychex_snapshot_runs;
CREATE POLICY "paychex_snapshot_runs_admin_read" ON paychex_snapshot_runs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Worker IDs for records linked before AOS kept them. Only fills blanks, and
-- skips any Payroll ID Paychex has on more than one worker.
CREATE OR REPLACE FUNCTION public.fill_paychex_worker_ids()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH one AS (
    SELECT employee_id, min(worker_id) AS worker_id
      FROM paychex_workers
     WHERE employee_id ~ '^\d+$'
     GROUP BY employee_id
    HAVING count(*) = 1
  ), upd AS (
    UPDATE employees e SET paychex_worker_id = one.worker_id
      FROM one
     WHERE e.rippling_employee_id = one.employee_id::integer
       AND e.paychex_worker_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM employees x WHERE x.paychex_worker_id = one.worker_id)
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_paychex_worker_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_paychex_worker_ids() TO service_role;
