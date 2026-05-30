-- Holiday multiplier as a per-rate-card setting (header level).
--
-- Per Connor / John discussion 2026-05-25, holiday rate varies by client
-- contract — common values are 2× (most), 2.5× (some IATSE locals), 3×
-- (rare). Hardcoded HOLIDAY_MULTIPLIER constant (2.0) in line-calc.ts
-- becomes the fallback only; the real value comes from the rate card.
--
-- Snapshot chain:
--   rate_card_profiles.holiday_multiplier  →  quotes.holiday_multiplier  →  invoices.holiday_multiplier
--
-- Each entity snapshots its own copy on creation so frozen records preserve
-- the multiplier that was in effect when issued. Editable on the draft
-- (operator can override per-quote / per-invoice for one-off contract terms).
-- Frozen by the existing freeze trigger via the extended column-check list.
--
-- Backfill: every existing row defaults to 2.0 — matches the prior
-- HOLIDAY_MULTIPLIER constant exactly. Zero money-math change to any
-- already-stored totals.

-- ─── 1. New columns ─────────────────────────────────────────────────────

ALTER TABLE rate_card_profiles
  ADD COLUMN IF NOT EXISTS holiday_multiplier numeric NOT NULL DEFAULT 2.0
  CHECK (holiday_multiplier >= 1.0);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS holiday_multiplier numeric NOT NULL DEFAULT 2.0
  CHECK (holiday_multiplier >= 1.0);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS holiday_multiplier numeric NOT NULL DEFAULT 2.0
  CHECK (holiday_multiplier >= 1.0);

-- ─── 2. Extend quotes freeze trigger to lock the new column ─────────────
-- Identical to the live function definition with one added column at the
-- end of the IS DISTINCT FROM chain. Preserving the rest verbatim avoids
-- accidentally widening the editable surface on frozen quotes.

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
    IF NEW.client                  IS DISTINCT FROM OLD.client
      OR NEW.client_id             IS DISTINCT FROM OLD.client_id
      OR NEW.event_name            IS DISTINCT FROM OLD.event_name
      OR NEW.venue                 IS DISTINCT FROM OLD.venue
      OR NEW.city_state            IS DISTINCT FROM OLD.city_state
      OR NEW.start_date            IS DISTINCT FROM OLD.start_date
      OR NEW.end_date              IS DISTINCT FROM OLD.end_date
      OR NEW.start_time            IS DISTINCT FROM OLD.start_time
      OR NEW.end_time              IS DISTINCT FROM OLD.end_time
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
      OR NEW.holiday_multiplier    IS DISTINCT FROM OLD.holiday_multiplier
    THEN
      RAISE EXCEPTION
        'Cannot modify content of a frozen quote (id=%). Use Revise to create a new revision.',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 3. Extend invoices freeze trigger to lock the new column ──────────
-- Same verbatim-preserve approach. Only addition: holiday_multiplier at end.

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
    IF OLD.job_request_id IS NOT NULL
      AND NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
    THEN
      RAISE EXCEPTION
        'Cannot change invoice_no on a linked frozen invoice (id=%).',
        OLD.id;
    END IF;

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
      OR NEW.holiday_multiplier   IS DISTINCT FROM OLD.holiday_multiplier
    THEN
      RAISE EXCEPTION
        'Cannot modify content of a frozen invoice (id=%). Use Revise to create a new revision, or Void.',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 4. Final state ─────────────────────────────────────────────────────

SELECT 'rate_card_profiles' AS tbl, count(*)::int AS rows,
       MIN(holiday_multiplier)::text || '..' || MAX(holiday_multiplier)::text AS range
  FROM rate_card_profiles
UNION ALL SELECT 'quotes',   count(*)::int, MIN(holiday_multiplier)::text || '..' || MAX(holiday_multiplier)::text FROM quotes
UNION ALL SELECT 'invoices', count(*)::int, MIN(holiday_multiplier)::text || '..' || MAX(holiday_multiplier)::text FROM invoices;
