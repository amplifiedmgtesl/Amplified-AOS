-- Phase A of the quote rewrite: freeze trigger on quotes + quote_lines.
--
-- Once a quote is is_draft=false (issued/signed/superseded), its content columns
-- become immutable. Only narrow fields tied to ongoing lifecycle (status,
-- signature, supersede tracking) and audit columns may change. Lines on a frozen
-- quote can't be inserted, updated, or deleted at all.
--
-- This is the structural fix for the Connor bug class — saveInvoiceDraft → saveQuote
-- on a frozen row throws cleanly instead of silently overwriting.
--
-- Companion: docs/quote-rewrite-plan.md

-- ─── Quote-level freeze ──────────────────────────────────────────────────────
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

  -- UPDATE
  IF NOT OLD.is_draft THEN
    -- Allowed to change on a frozen row:
    --   status, signed_at, signed_by, signature_name (signature workflow)
    --   superseded_at, superseded_by (when a new revision supersedes this row)
    --   updated_at, updated_by (audit — set by set_audit_columns trigger)
    -- Everything else is content and must not change post-issue.
    IF NEW.client                  IS DISTINCT FROM OLD.client
      OR NEW.client_id             IS DISTINCT FROM OLD.client_id
      OR NEW.event_name            IS DISTINCT FROM OLD.event_name
      OR NEW.venue                 IS DISTINCT FROM OLD.venue
      OR NEW.city_state            IS DISTINCT FROM OLD.city_state
      OR NEW.start_date            IS DISTINCT FROM OLD.start_date
      OR NEW.end_date              IS DISTINCT FROM OLD.end_date
      OR NEW.start_time            IS DISTINCT FROM OLD.start_time
      OR NEW.end_time              IS DISTINCT FROM OLD.end_time
      OR NEW.expected_hours_per_day IS DISTINCT FROM OLD.expected_hours_per_day
      OR NEW.total                 IS DISTINCT FROM OLD.total
      OR NEW.deposit               IS DISTINCT FROM OLD.deposit
      OR NEW.notes                 IS DISTINCT FROM OLD.notes
      OR NEW.terms                 IS DISTINCT FROM OLD.terms
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

DROP TRIGGER IF EXISTS quotes_freeze_trg ON quotes;
CREATE TRIGGER quotes_freeze_trg
  BEFORE UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION quotes_freeze_check();

-- ─── Lines-level freeze ──────────────────────────────────────────────────────
-- Lines belong to their parent quote's freeze state. Once parent is frozen, lines
-- can't be inserted/updated/deleted. Drafts can edit lines freely.
CREATE OR REPLACE FUNCTION quote_lines_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q_is_draft boolean;
BEGIN
  SELECT is_draft INTO q_is_draft FROM quotes
   WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF NOT FOUND THEN
    -- Parent quote doesn't exist yet — let the FK constraint handle the error.
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT q_is_draft THEN
    RAISE EXCEPTION
      'Cannot modify lines of a frozen quote (quote_id=%). Use Revise to create a new revision.',
      COALESCE(NEW.quote_id, OLD.quote_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS quote_lines_freeze_iud_trg ON quote_lines;
CREATE TRIGGER quote_lines_freeze_iud_trg
  BEFORE INSERT OR UPDATE OR DELETE ON quote_lines
  FOR EACH ROW EXECUTE FUNCTION quote_lines_freeze_check();
