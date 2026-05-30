-- Phase C invoice rewrite — Migration 3: freeze trigger on invoices and
-- invoice_lines.
--
-- Once an invoice flips to is_draft=false (issued/sent/paid/superseded/void),
-- its content columns become immutable. Only narrow fields tied to ongoing
-- lifecycle (status flips, payment aggregates, credit aggregates, audit
-- columns, orphan-link fields) may change.
--
-- This kills the Connor-class bug on invoices: any code path that tries to
-- silently mutate a frozen invoice during downstream operations (the legacy
-- saveQuote -> upsertInvoice side-effect chain) gets a clean DB error
-- instead of corrupting data.
--
-- Companion: docs/invoice-rewrite-plan.md

-- ─── Quote-level (well, invoice-level) freeze ────────────────────────────────
CREATE OR REPLACE FUNCTION invoices_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT OLD.is_draft THEN
      RAISE EXCEPTION
        'Cannot delete a frozen invoice (id=%). Frozen invoices are permanent — supersede via Revise or Void instead.',
        OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF NOT OLD.is_draft THEN
    -- One-time orphan-link transitions: NULL → non-NULL allowed for
    -- job_request_id, source_quote_id, source_quote_code, and the paired
    -- invoice_no recompute. Re-parenting blocked.
    IF OLD.job_request_id IS NOT NULL
      AND NEW.job_request_id IS DISTINCT FROM OLD.job_request_id
    THEN
      RAISE EXCEPTION
        'Cannot change job_request_id on a linked frozen invoice (id=%). Re-parenting not allowed.',
        OLD.id;
    END IF;
    IF OLD.source_quote_id IS NOT NULL
      AND NEW.source_quote_id IS DISTINCT FROM OLD.source_quote_id
    THEN
      RAISE EXCEPTION
        'Cannot change source_quote_id on a linked frozen invoice (id=%). Re-parenting not allowed.',
        OLD.id;
    END IF;
    -- invoice_no rewrite allowed only when paired with the orphan-link transition.
    IF OLD.job_request_id IS NOT NULL
      AND NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
    THEN
      RAISE EXCEPTION
        'Cannot change invoice_no on a linked frozen invoice (id=%).',
        OLD.id;
    END IF;

    -- Standard freeze: content columns must remain unchanged.
    -- Allowed-to-change (NOT in this list):
    --   status, sent_at/by, paid_at/by, superseded_at/by, voided_at/by, void_reason
    --   deposit_applied, credits_applied, amount_paid (aggregates updated by app + triggers)
    --   updated_at, updated_by (audit)
    --   job_request_id, source_quote_id, source_quote_code, invoice_no (orphan link, gated above)
    IF NEW.client                IS DISTINCT FROM OLD.client
      OR NEW.client_id           IS DISTINCT FROM OLD.client_id
      OR NEW.event_name          IS DISTINCT FROM OLD.event_name
      OR NEW.venue               IS DISTINCT FROM OLD.venue
      OR NEW.city_state          IS DISTINCT FROM OLD.city_state
      OR NEW.bill_to             IS DISTINCT FROM OLD.bill_to
      OR NEW.po_no               IS DISTINCT FROM OLD.po_no
      OR NEW.issue_date          IS DISTINCT FROM OLD.issue_date
      OR NEW.due_date            IS DISTINCT FROM OLD.due_date
      OR NEW.subtotal            IS DISTINCT FROM OLD.subtotal
      OR NEW.deposit             IS DISTINCT FROM OLD.deposit
      OR NEW.amount_due          IS DISTINCT FROM OLD.amount_due
      OR NEW.notes               IS DISTINCT FROM OLD.notes
      OR NEW.terms               IS DISTINCT FROM OLD.terms
      OR NEW.rate_card_profile_id IS DISTINCT FROM OLD.rate_card_profile_id
      OR NEW.linked_job_sheet_id  IS DISTINCT FROM OLD.linked_job_sheet_id
      OR NEW.timesheet_summary    IS DISTINCT FROM OLD.timesheet_summary
      OR NEW.quote_id             IS DISTINCT FROM OLD.quote_id
      OR NEW.invoice_type         IS DISTINCT FROM OLD.invoice_type
      OR NEW.parent_invoice_id    IS DISTINCT FROM OLD.parent_invoice_id
      OR NEW.revision_no          IS DISTINCT FROM OLD.revision_no
      OR NEW.covered_dates        IS DISTINCT FROM OLD.covered_dates
      OR NEW.is_draft             IS DISTINCT FROM OLD.is_draft
      OR NEW.issued_at            IS DISTINCT FROM OLD.issued_at
      OR NEW.issued_by            IS DISTINCT FROM OLD.issued_by
      OR NEW.created_at           IS DISTINCT FROM OLD.created_at
      OR NEW.created_by           IS DISTINCT FROM OLD.created_by
    THEN
      RAISE EXCEPTION
        'Cannot modify content of a frozen invoice (id=%). Use Revise to create a new revision, or Void.',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_freeze_trg ON invoices;
CREATE TRIGGER invoices_freeze_trg
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_freeze_check();

-- ─── Lines-level freeze ──────────────────────────────────────────────────────
-- Lines belong to their parent invoice's freeze state. Once parent is frozen,
-- lines can't be inserted/updated/deleted at all.
CREATE OR REPLACE FUNCTION invoice_lines_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i_is_draft boolean;
BEGIN
  SELECT is_draft INTO i_is_draft FROM invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT i_is_draft THEN
    RAISE EXCEPTION
      'Cannot modify lines of a frozen invoice (invoice_id=%). Use Revise to create a new revision.',
      COALESCE(NEW.invoice_id, OLD.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS invoice_lines_freeze_iud_trg ON invoice_lines;
CREATE TRIGGER invoice_lines_freeze_iud_trg
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_freeze_check();
