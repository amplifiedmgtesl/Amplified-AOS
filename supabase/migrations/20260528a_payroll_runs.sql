-- Phase 1 Payroll module — payroll_runs + payroll_run_entries.
--
-- A "payroll run" is the paydate header record. Operators pick approved,
-- unpaid timesheet entries (by date, job, employee, etc.) and snapshot
-- them onto a run. The run carries the pay_date, period bounds, totals,
-- and lifecycle (draft → finalized → voided).
--
-- Two tables:
--   payroll_runs           — one row per pay event; header + cached totals
--   payroll_run_entries    — junction with snapshot of rates/hours/pay so
--                            the run's contents are preserved even if a
--                            timesheet entry is later changed (post-void).
--
-- Lifecycle:
--   draft     — operator is building the run; can add/remove entries freely
--   finalized — locked; included timesheet entries cannot change status
--   voided    — soft-cancelled; entries are released back to the candidate
--               pool. The run row + its snapshot rows stay for audit.
--
-- The CSV/IIF export step lives outside this migration (Phase 1.5).
-- 'exported' status is reserved on the CHECK constraint for that step.

-- ─── payroll_runs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              text PRIMARY KEY,
  pay_date        date NOT NULL,
  period_start    date,
  period_end      date,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN (
                    'draft','finalized','exported','voided'
                  )),
  notes           text,

  -- Cached rollups for the index view. Maintained by trigger on
  -- payroll_run_entries; the app can also recompute on demand.
  entry_count     integer NOT NULL DEFAULT 0,
  employee_count  integer NOT NULL DEFAULT 0,
  total_hours     numeric NOT NULL DEFAULT 0,
  total_pay       numeric NOT NULL DEFAULT 0,

  -- Lifecycle audit (pair of *_at / *_by per state transition).
  finalized_at    timestamptz,
  finalized_by    uuid,
  exported_at     timestamptz,
  exported_by     uuid,
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,

  -- Standard audit columns.
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid
);

CREATE INDEX IF NOT EXISTS payroll_runs_pay_date_idx  ON payroll_runs(pay_date);
CREATE INDEX IF NOT EXISTS payroll_runs_status_idx    ON payroll_runs(status);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_runs_full_access" ON payroll_runs;
CREATE POLICY "payroll_runs_full_access" ON payroll_runs FOR ALL USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_runs TO service_role;

DROP TRIGGER IF EXISTS payroll_runs_audit_trg ON payroll_runs;
CREATE TRIGGER payroll_runs_audit_trg
  BEFORE INSERT OR UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── payroll_run_entries ────────────────────────────────────────────────────
-- One row per (run, timesheet_entry). Snapshots the hours/rates/pay so the
-- run's totals stay correct forever, independent of later edits to the
-- source timesheet entry.
CREATE TABLE IF NOT EXISTS payroll_run_entries (
  id                    text PRIMARY KEY,
  payroll_run_id        text NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  timesheet_entry_id    text NOT NULL REFERENCES timesheet_entries(id),

  -- Snapshot fields. Copied from timesheet_entries at insert time.
  employee_key          text,
  first_name            text,
  last_name             text,
  email                 text,
  work_date             date,
  position              text,
  job_id                text,
  std_hours             numeric NOT NULL DEFAULT 0,
  ot_hours              numeric NOT NULL DEFAULT 0,
  dt_hours              numeric NOT NULL DEFAULT 0,
  total_hours           numeric NOT NULL DEFAULT 0,
  std_rate              numeric NOT NULL DEFAULT 0,
  ot_rate               numeric NOT NULL DEFAULT 0,
  dt_rate               numeric NOT NULL DEFAULT 0,
  is_holiday            boolean NOT NULL DEFAULT false,
  holiday_multiplier    numeric,
  total_pay             numeric NOT NULL DEFAULT 0,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_by            uuid
);

-- A timesheet entry can be in at most one non-voided run at a time.
-- We can't filter by parent run status in a unique index, so enforce via
-- partial index + a trigger that releases the unique slot on void.
CREATE UNIQUE INDEX IF NOT EXISTS payroll_run_entries_active_unique
  ON payroll_run_entries(timesheet_entry_id);
-- (When a run is voided we DELETE its run_entries; the unique index then
--  frees that timesheet entry for inclusion in a new run. See trigger
--  payroll_runs_void_releases_entries below.)

CREATE INDEX IF NOT EXISTS payroll_run_entries_run_id_idx
  ON payroll_run_entries(payroll_run_id);
CREATE INDEX IF NOT EXISTS payroll_run_entries_employee_key_idx
  ON payroll_run_entries(employee_key);

ALTER TABLE payroll_run_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_run_entries_full_access" ON payroll_run_entries;
CREATE POLICY "payroll_run_entries_full_access" ON payroll_run_entries FOR ALL USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run_entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run_entries TO service_role;

DROP TRIGGER IF EXISTS payroll_run_entries_audit_trg ON payroll_run_entries;
CREATE TRIGGER payroll_run_entries_audit_trg
  BEFORE INSERT OR UPDATE ON payroll_run_entries
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Cached rollups on payroll_runs ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_payroll_run_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_run_id text;
BEGIN
  v_run_id := COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);
  UPDATE payroll_runs SET
    entry_count    = COALESCE((SELECT COUNT(*)                 FROM payroll_run_entries WHERE payroll_run_id = v_run_id), 0),
    employee_count = COALESCE((SELECT COUNT(DISTINCT employee_key) FROM payroll_run_entries WHERE payroll_run_id = v_run_id AND employee_key IS NOT NULL), 0),
    total_hours    = COALESCE((SELECT SUM(total_hours)         FROM payroll_run_entries WHERE payroll_run_id = v_run_id), 0),
    total_pay      = COALESCE((SELECT SUM(total_pay)           FROM payroll_run_entries WHERE payroll_run_id = v_run_id), 0)
   WHERE id = v_run_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS payroll_run_entries_refresh_totals ON payroll_run_entries;
CREATE TRIGGER payroll_run_entries_refresh_totals
  AFTER INSERT OR UPDATE OR DELETE ON payroll_run_entries
  FOR EACH ROW EXECUTE FUNCTION refresh_payroll_run_totals();

-- ─── Void releases entries ──────────────────────────────────────────────────
-- When a run transitions to 'voided', drop its junction rows so the
-- referenced timesheet entries become candidates again. The run header
-- stays for audit (voided_at/by + void_reason + cached totals at time
-- of void are preserved on the row).
CREATE OR REPLACE FUNCTION payroll_runs_void_releases_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided' THEN
    NEW.voided_at := COALESCE(NEW.voided_at, now());
    DELETE FROM payroll_run_entries WHERE payroll_run_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payroll_runs_void_trg ON payroll_runs;
CREATE TRIGGER payroll_runs_void_trg
  BEFORE UPDATE OF status ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_void_releases_entries();

-- ─── Lock entries to a run once finalized ───────────────────────────────────
-- Block changes to / deletion of payroll_run_entries while their parent
-- run is in a locked state ('finalized' or 'exported'). The void flow
-- above bypasses by deleting the rows itself in a controlled way.
CREATE OR REPLACE FUNCTION payroll_run_entries_freeze_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM payroll_runs WHERE id = OLD.payroll_run_id;
    IF v_status IN ('finalized','exported') THEN
      RAISE EXCEPTION
        'Cannot delete payroll_run_entries row (%) — parent run % is %.',
        OLD.id, OLD.payroll_run_id, v_status
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_status FROM payroll_runs WHERE id = NEW.payroll_run_id;
    IF v_status IN ('finalized','exported')
       AND (NEW.timesheet_entry_id IS DISTINCT FROM OLD.timesheet_entry_id
         OR NEW.total_pay          IS DISTINCT FROM OLD.total_pay
         OR NEW.total_hours        IS DISTINCT FROM OLD.total_hours
         OR NEW.std_hours          IS DISTINCT FROM OLD.std_hours
         OR NEW.ot_hours           IS DISTINCT FROM OLD.ot_hours
         OR NEW.dt_hours           IS DISTINCT FROM OLD.dt_hours
         OR NEW.std_rate           IS DISTINCT FROM OLD.std_rate
         OR NEW.ot_rate            IS DISTINCT FROM OLD.ot_rate
         OR NEW.dt_rate            IS DISTINCT FROM OLD.dt_rate)
    THEN
      RAISE EXCEPTION
        'Cannot modify payroll_run_entries row (%) — parent run % is %.',
        OLD.id, OLD.payroll_run_id, v_status
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payroll_run_entries_freeze_trg ON payroll_run_entries;
CREATE TRIGGER payroll_run_entries_freeze_trg
  BEFORE UPDATE OR DELETE ON payroll_run_entries
  FOR EACH ROW EXECUTE FUNCTION payroll_run_entries_freeze_check();

-- Smoke test: confirm triggers installed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_runs_audit_trg') THEN
    RAISE EXCEPTION 'payroll_runs_audit_trg did not install';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_run_entries_refresh_totals') THEN
    RAISE EXCEPTION 'payroll_run_entries_refresh_totals did not install';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payroll_runs_void_trg') THEN
    RAISE EXCEPTION 'payroll_runs_void_trg did not install';
  END IF;
END $$;
