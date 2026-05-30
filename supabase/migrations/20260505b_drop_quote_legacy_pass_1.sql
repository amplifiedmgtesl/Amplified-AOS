-- Quote rewrite cleanup pass 1: drop tables/columns whose readers were retired
-- with the new quote flow. Phase 2 (quotes.linked_job_request_id, linked_job_sheet_id,
-- timesheet_summary, start_time, end_time) waits for the Phase C invoice rewrite,
-- which is the last reader of those columns.
--
-- All drops here are safe: every remaining reader uses FK lookup or a different path.

-- ─── Drop the JSONB autosave workspace table ─────────────────────────────────
-- Replaced by direct quotes/quote_lines writes through lib/store/quotes.ts.
DROP TABLE IF EXISTS quote_draft_workspaces;

-- ─── Drop redundant columns on quotes ────────────────────────────────────────
ALTER TABLE quotes DROP COLUMN IF EXISTS lines;                    -- jsonb, replaced by quote_lines table (deferred from 20260420q)
ALTER TABLE quotes DROP COLUMN IF EXISTS expected_hours_per_day;   -- recompute from lines

-- ─── Drop denormalized columns on quote_lines ────────────────────────────────
-- Display always looks up via specialty_id FK now.
ALTER TABLE quote_lines DROP COLUMN IF EXISTS department;
ALTER TABLE quote_lines DROP COLUMN IF EXISTS specialty;
ALTER TABLE quote_lines DROP COLUMN IF EXISTS position_id;

-- ─── Drop the reverse-link denormalization on job_requests ───────────────────
-- Replaced by `SELECT FROM quotes WHERE job_request_id = $1` reverse query.
ALTER TABLE job_requests DROP COLUMN IF EXISTS linked_quote_id;

-- ─── Update the quotes freeze trigger ────────────────────────────────────────
-- Drop references to columns that no longer exist (expected_hours_per_day),
-- but keep the others (linked_job_request_id, linked_job_sheet_id,
-- timesheet_summary, start_time, end_time) until they're dropped in Pass 2.

CREATE OR REPLACE FUNCTION quotes_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT OLD.is_draft THEN
      RAISE EXCEPTION
        'Cannot delete a frozen quote (id=%). Frozen quotes are permanent — supersede via Revise instead.',
        OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF NOT OLD.is_draft THEN
    IF NEW.client                IS DISTINCT FROM OLD.client
      OR NEW.client_id           IS DISTINCT FROM OLD.client_id
      OR NEW.event_name          IS DISTINCT FROM OLD.event_name
      OR NEW.venue               IS DISTINCT FROM OLD.venue
      OR NEW.city_state          IS DISTINCT FROM OLD.city_state
      OR NEW.start_date          IS DISTINCT FROM OLD.start_date
      OR NEW.end_date            IS DISTINCT FROM OLD.end_date
      OR NEW.start_time          IS DISTINCT FROM OLD.start_time
      OR NEW.end_time            IS DISTINCT FROM OLD.end_time
      OR NEW.total               IS DISTINCT FROM OLD.total
      OR NEW.deposit             IS DISTINCT FROM OLD.deposit
      OR NEW.notes               IS DISTINCT FROM OLD.notes
      OR NEW.terms               IS DISTINCT FROM OLD.terms
      OR NEW.rate_card_profile_id  IS DISTINCT FROM OLD.rate_card_profile_id
      OR NEW.linked_job_request_id IS DISTINCT FROM OLD.linked_job_request_id
      OR NEW.linked_job_sheet_id   IS DISTINCT FROM OLD.linked_job_sheet_id
      OR NEW.timesheet_summary     IS DISTINCT FROM OLD.timesheet_summary
      OR NEW.job_request_id        IS DISTINCT FROM OLD.job_request_id
      OR NEW.quote_no              IS DISTINCT FROM OLD.quote_no
      OR NEW.parent_quote_id       IS DISTINCT FROM OLD.parent_quote_id
      OR NEW.is_draft              IS DISTINCT FROM OLD.is_draft
      OR NEW.revision_no           IS DISTINCT FROM OLD.revision_no
      OR NEW.issued_at             IS DISTINCT FROM OLD.issued_at
      OR NEW.issued_by             IS DISTINCT FROM OLD.issued_by
      OR NEW.created_at            IS DISTINCT FROM OLD.created_at
      OR NEW.created_by            IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION
        'Cannot modify content of a frozen quote (id=%). Use Revise to create a new revision.',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
