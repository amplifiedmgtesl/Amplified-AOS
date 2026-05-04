-- First-pass audit columns for the tables we've already touched in this
-- session: clients, job_requests, rate_card_profiles. Other tables get the
-- same treatment as we visit them. Together with the eventual UUID-PK
-- swap (separate later cleanup), this is the canonical audit foundation.
--
-- Adds (where missing):
--   created_at  timestamptz NOT NULL DEFAULT now()
--   updated_at  timestamptz NOT NULL DEFAULT now()
--   created_by  uuid                      -- Supabase auth.users.id
--   updated_by  uuid
--
-- A shared trigger keeps updated_at fresh on every UPDATE and stamps
-- created_by/updated_by from auth.uid() when the caller doesn't set them.
-- Service-role writes (e.g. backfills) leave the by-fields NULL — that's
-- fine for non-user-driven changes.

-- ─── Shared trigger function ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_audit_columns() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_at IS NULL THEN NEW.created_at := now(); END IF;
    NEW.updated_at := now();
    IF NEW.created_by IS NULL THEN
      BEGIN
        NEW.created_by := auth.uid();
      EXCEPTION WHEN OTHERS THEN
        -- auth.uid() not available (service role context); leave NULL.
        NEW.created_by := NULL;
      END;
    END IF;
    IF NEW.updated_by IS NULL THEN
      BEGIN
        NEW.updated_by := auth.uid();
      EXCEPTION WHEN OTHERS THEN
        NEW.updated_by := NULL;
      END;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    -- Only stamp updated_by when the caller didn't explicitly set it.
    IF NEW.updated_by IS NOT DISTINCT FROM OLD.updated_by THEN
      BEGIN
        NEW.updated_by := auth.uid();
      EXCEPTION WHEN OTHERS THEN
        -- Keep prior value.
        NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ─── clients ────────────────────────────────────────────────────────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS clients_audit_trg ON clients;
CREATE TRIGGER clients_audit_trg
  BEFORE INSERT OR UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── job_requests ───────────────────────────────────────────────────────────
ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS job_requests_audit_trg ON job_requests;
CREATE TRIGGER job_requests_audit_trg
  BEFORE INSERT OR UPDATE ON job_requests
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── rate_card_profiles ─────────────────────────────────────────────────────
-- Already has created_at + updated_at as text/timestamptz; just add the
-- by-fields and attach the same trigger so updates auto-stamp consistently.
ALTER TABLE rate_card_profiles
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS rate_card_profiles_audit_trg ON rate_card_profiles;
CREATE TRIGGER rate_card_profiles_audit_trg
  BEFORE INSERT OR UPDATE ON rate_card_profiles
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── rate_card_profile_rows (rate card child) ──────────────────────────────
ALTER TABLE rate_card_profile_rows
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS rate_card_profile_rows_audit_trg ON rate_card_profile_rows;
CREATE TRIGGER rate_card_profile_rows_audit_trg
  BEFORE INSERT OR UPDATE ON rate_card_profile_rows
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── client_contacts (client child) ─────────────────────────────────────────
-- Already has created_at + updated_at columns. Add the by-fields and
-- attach the trigger so updates auto-stamp going forward.
ALTER TABLE client_contacts
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS client_contacts_audit_trg ON client_contacts;
CREATE TRIGGER client_contacts_audit_trg
  BEFORE INSERT OR UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── job_request_days (job child) ──────────────────────────────────────────
ALTER TABLE job_request_days
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS job_request_days_audit_trg ON job_request_days;
CREATE TRIGGER job_request_days_audit_trg
  BEFORE INSERT OR UPDATE ON job_request_days
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── job_request_crew_needs (job child) ────────────────────────────────────
ALTER TABLE job_request_crew_needs
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS job_request_crew_needs_audit_trg ON job_request_crew_needs;
CREATE TRIGGER job_request_crew_needs_audit_trg
  BEFORE INSERT OR UPDATE ON job_request_crew_needs
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── job_request_assignments (job child) ───────────────────────────────────
-- Already has created_at. Add the rest.
ALTER TABLE job_request_assignments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS job_request_assignments_audit_trg ON job_request_assignments;
CREATE TRIGGER job_request_assignments_audit_trg
  BEFORE INSERT OR UPDATE ON job_request_assignments
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── job_request_attachments (job child) ───────────────────────────────────
-- Has uploaded_at (kept as-is — semantic, not generic). Add created_at /
-- updated_at + by-fields for consistency. uploaded_at = "when the file
-- was uploaded to storage"; created_at = "when the metadata row appeared".
-- For new rows the two will match; preserved for legacy rows.
ALTER TABLE job_request_attachments
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS job_request_attachments_audit_trg ON job_request_attachments;
CREATE TRIGGER job_request_attachments_audit_trg
  BEFORE INSERT OR UPDATE ON job_request_attachments
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Backfill: extract real creation timestamps from legacy text IDs ──────
-- Many existing rows have IDs of the form `<prefix>-<13-digit-millis>`
-- (e.g. jobreq-1775744267941, jobsheet-..., inv-..., clt-...). We can
-- recover the original creation time from those millis and use it as
-- created_at instead of the ALTER-time default. Only touches rows whose
-- created_at is within ~10 minutes of "now" (i.e. just got the default).
DO $$
DECLARE
  cutoff timestamptz := now() - interval '10 minutes';
BEGIN
  -- clients: id like 'clt-1234567890123' OR 'clt-<32-hex>' (random)
  UPDATE clients
    SET created_at = to_timestamp(substring(id from '(\d{13})$')::bigint / 1000.0)
    WHERE id ~ '\d{13}$' AND created_at > cutoff;

  -- job_requests: id like 'jobreq-1234567890123'
  UPDATE job_requests
    SET created_at = to_timestamp(substring(id from '(\d{13})$')::bigint / 1000.0)
    WHERE id ~ '\d{13}$' AND created_at > cutoff;
END $$;

-- For attachments, prefer the real upload time over the migration-time default.
UPDATE job_request_attachments
  SET created_at = uploaded_at
  WHERE uploaded_at IS NOT NULL AND uploaded_at < created_at;

-- updated_at = created_at for legacy rows that have never been touched since.
UPDATE clients               SET updated_at = created_at WHERE updated_at > now() - interval '10 minutes' AND created_at <= updated_at;
UPDATE job_requests          SET updated_at = created_at WHERE updated_at > now() - interval '10 minutes' AND created_at <= updated_at;
UPDATE job_request_days      SET updated_at = created_at WHERE updated_at > now() - interval '10 minutes' AND created_at <= updated_at;
UPDATE job_request_crew_needs SET updated_at = created_at WHERE updated_at > now() - interval '10 minutes' AND created_at <= updated_at;
UPDATE job_request_assignments SET updated_at = created_at WHERE updated_at > now() - interval '10 minutes' AND created_at <= updated_at;
UPDATE job_request_attachments SET updated_at = created_at WHERE updated_at > now() - interval '10 minutes' AND created_at <= updated_at;
UPDATE rate_card_profile_rows SET updated_at = created_at WHERE updated_at > now() - interval '10 minutes' AND created_at <= updated_at;
