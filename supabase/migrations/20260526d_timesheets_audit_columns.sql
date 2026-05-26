-- Phase 6: audit columns on timesheets + timesheet_entries.
--
-- Brings these two tables into the same audit convention used by the
-- rest of the rewrite (migration 20260503d). Adds:
--   created_at  timestamptz NOT NULL DEFAULT now()
--   updated_at  timestamptz NOT NULL DEFAULT now()
--   created_by  uuid
--   updated_by  uuid
--
-- Attaches the shared set_audit_columns() trigger that:
--   * stamps created_at/by on INSERT
--   * refreshes updated_at on every UPDATE
--   * stamps updated_by from auth.uid() when caller doesn't set it
--   * leaves by-fields NULL on service-role writes (backfills / cron / mcp)
--
-- Backfill: recover original creation timestamps from id suffixes where
-- the format embeds millis. The timekeeping entry ids in dev follow three
-- conventions:
--   timesheet-jobsheet-1777325808245    (millis at end)
--   row-1775843448831                   (millis at end)
--   ts-1776736345784-x7ak5              (millis followed by random)
-- A relaxed regex `(\d{13})` finds the first 13-digit run anywhere.
--
-- timesheet_entries.updated_at already exists from the timesheet_entries
-- table's original definition (used by the staff-review queries). Phase 6
-- just adds the missing audit columns and attaches the canonical trigger
-- so updated_at is now auto-refreshed instead of app-supplied.
--
-- Freeze trigger compatibility: created_at / updated_at / created_by /
-- updated_by are NOT in the freeze trigger's protected list — they remain
-- editable on approved rows (the audit trigger sets them automatically).

-- ─── timesheets ─────────────────────────────────────────────────────────────
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS timesheets_audit_trg ON timesheets;
CREATE TRIGGER timesheets_audit_trg
  BEFORE INSERT OR UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── timesheet_entries ──────────────────────────────────────────────────────
ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;
-- updated_at already exists on this table; the trigger below takes over
-- the responsibility for refreshing it.

DROP TRIGGER IF EXISTS timesheet_entries_audit_trg ON timesheet_entries;
CREATE TRIGGER timesheet_entries_audit_trg
  BEFORE INSERT OR UPDATE ON timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Backfill created_at from id-suffix millis ─────────────────────────────
-- The freeze trigger doesn't include created_at in its protected list, but
-- it DOES protect timesheet_id, etc. — so the backfill needs to be safe on
-- approved rows. We're only touching created_at, which is allowed.
DO $$
DECLARE
  cutoff timestamptz := now() - interval '10 minutes';
BEGIN
  UPDATE timesheets
    SET created_at = to_timestamp(substring(id from '(\d{13})')::bigint / 1000.0)
    WHERE id ~ '\d{13}' AND created_at > cutoff;

  UPDATE timesheet_entries
    SET created_at = to_timestamp(substring(id from '(\d{13})')::bigint / 1000.0)
    WHERE id ~ '\d{13}' AND created_at > cutoff;
END $$;
