-- Paychex payroll export (v2.6.0, 2026-10-12).
--
-- Amplified moved payroll from Rippling to Paychex in Oct 2026. Paychex's
-- Standard Payroll Import (SPI) needs a Company ID, the worker's Paychex ID,
-- a pay component that matches Flex EXACTLY (one missing space failed their
-- first import), a rate and hours. The component names are still being
-- confirmed with Paychex, so they live in a table Connor can edit from
-- Maintenance → Payroll Export instead of in code.
--
-- 1. payroll_settings        — singleton: active provider, company ID, which
--                              job field goes in Paychex's Job Name column.
-- 2. payroll_component_map   — provider × worker type × pay type → the exact
--                              component name. Blank = not known yet; the
--                              export stops if it needs a blank one.
-- 3. employees.employment_type is normalized to exactly 'Employee' or
--    'Contractor' on every write (trigger, not a CHECK, so no existing
--    writer — CSV import, roster import, older clients — can fail on it).
--    Anything that isn't recognisably an employee becomes 'Contractor',
--    matching the payroll engine's long-standing "blank = contractor" rule.
--    Existing rows are cleaned up separately (20261012b).
--
-- Worker ID reuses employees.rippling_employee_id — Paychex kept the
-- Rippling numbers. The column keeps its name; only the UI label changes.

-- ── 1. Settings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_settings (
  id               text PRIMARY KEY DEFAULT 'singleton',
  provider         text NOT NULL DEFAULT 'paychex',
  company_id       text NOT NULL DEFAULT '',
  job_name_source  text NOT NULL DEFAULT 'event_abbr',
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  created_by       uuid,
  updated_by       uuid,
  CHECK (id = 'singleton'),
  CHECK (provider IN ('paychex')),
  CHECK (job_name_source IN ('event_abbr', 'event_name', 'none'))
);

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_settings_full_access" ON payroll_settings;
CREATE POLICY "payroll_settings_full_access"
  ON payroll_settings FOR ALL USING (true);

DROP TRIGGER IF EXISTS payroll_settings_audit_trg ON payroll_settings;
CREATE TRIGGER payroll_settings_audit_trg
  BEFORE INSERT OR UPDATE ON payroll_settings
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

INSERT INTO payroll_settings (id, provider, company_id, job_name_source)
VALUES ('singleton', 'paychex', '70400794', 'event_abbr')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Pay component map ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_component_map (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL DEFAULT 'paychex',
  worker_type     text NOT NULL,
  pay_type        text NOT NULL,
  component_name  text NOT NULL DEFAULT '',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  CHECK (worker_type IN ('Employee', 'Contractor')),
  CHECK (pay_type IN ('REG', 'OT', 'DT')),
  UNIQUE (provider, worker_type, pay_type)
);

ALTER TABLE payroll_component_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payroll_component_map_full_access" ON payroll_component_map;
CREATE POLICY "payroll_component_map_full_access"
  ON payroll_component_map FOR ALL USING (true);

DROP TRIGGER IF EXISTS payroll_component_map_audit_trg ON payroll_component_map;
CREATE TRIGGER payroll_component_map_audit_trg
  BEFORE INSERT OR UPDATE ON payroll_component_map
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Known from Paychex's 10/6 sample. Contractors have no legal overtime, so
-- their OT/DT hours go under the same 1099 component at the OT/DT rate.
-- Employee OT/DT names are still pending from Paychex — left blank on purpose.
INSERT INTO payroll_component_map (provider, worker_type, pay_type, component_name) VALUES
  ('paychex', 'Employee',   'REG', 'Day Rate 1'),
  ('paychex', 'Employee',   'OT',  ''),
  ('paychex', 'Employee',   'DT',  ''),
  ('paychex', 'Contractor', 'REG', '1099 - Day Rate 1'),
  ('paychex', 'Contractor', 'OT',  '1099 - Day Rate 1'),
  ('paychex', 'Contractor', 'DT',  '1099 - Day Rate 1')
ON CONFLICT (provider, worker_type, pay_type) DO NOTHING;

-- ── 3. employment_type: exactly 'Employee' or 'Contractor' ───────────────────
CREATE OR REPLACE FUNCTION normalize_employment_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v text := lower(btrim(coalesce(NEW.employment_type, '')));
BEGIN
  IF v IN ('employee', 'w2', 'w-2', 'w 2', 'staff') THEN
    NEW.employment_type := 'Employee';
  ELSE
    NEW.employment_type := 'Contractor';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_normalize_employment_type_trg ON employees;
CREATE TRIGGER employees_normalize_employment_type_trg
  BEFORE INSERT OR UPDATE OF employment_type ON employees
  FOR EACH ROW EXECUTE FUNCTION normalize_employment_type();

ALTER TABLE employees ALTER COLUMN employment_type SET DEFAULT 'Contractor';
