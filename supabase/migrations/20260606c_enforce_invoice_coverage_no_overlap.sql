-- Hard guardrails on final-invoice coverage. Three rules, enforced at
-- the row level on INSERT/UPDATE of `invoices`. They only fire when the
-- row would land in an ACTIVE state (is_draft=false AND not superseded/void).
--
-- Rule A: A job can have AT MOST ONE active whole-job final at a time.
--         (Already enforced by partial unique index invoices_one_active_wholejob_final_per_job.)
-- Rule B: A job cannot have BOTH a whole-job final and any per-day final active.
-- Rule C: Per-day finals on the same job cannot have overlapping covered_dates.
--
-- Drafts can stack freely — the trigger only blocks at issue time
-- (or any subsequent update that would put the row into the active set).
-- This matches the existing one-active-deposit/one-active-final pattern.
--
-- Background: 2026-06-06. Earlier today we shipped the per-day-final UI
-- and immediately realized the per-day vs whole-job interaction was only
-- protected at the UI layer. A direct SQL UPDATE, an API call from a
-- future workflow, or a race during issue could all bypass the picker
-- and double-bill the customer. This trigger closes that gap.

CREATE OR REPLACE FUNCTION enforce_invoice_coverage_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  is_active boolean;
  is_per_day boolean;
  conflicting_id text;
BEGIN
  -- Only finals on a real job matter.
  IF NEW.invoice_type IS DISTINCT FROM 'final' OR NEW.job_request_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- "Active" = issued (not draft) and not superseded/void.
  is_active := (
    NEW.is_draft = false
    AND (NEW.status IS NULL OR NEW.status NOT IN ('superseded','void'))
  );
  IF NOT is_active THEN
    RETURN NEW;
  END IF;

  is_per_day := (NEW.covered_dates IS NOT NULL AND array_length(NEW.covered_dates, 1) > 0);

  IF NOT is_per_day THEN
    -- Whole-job final going active. Block if any per-day final is also active.
    SELECT id INTO conflicting_id
      FROM invoices
     WHERE job_request_id = NEW.job_request_id
       AND id <> NEW.id
       AND invoice_type = 'final'
       AND is_draft = false
       AND (status IS NULL OR status NOT IN ('superseded','void'))
       AND covered_dates IS NOT NULL
       AND array_length(covered_dates, 1) > 0
     LIMIT 1;
    IF conflicting_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot issue a whole-job final invoice (id=%) when active per-day final invoices exist for this job (conflicting id=%). Void or supersede the per-day invoices first.',
        NEW.id, conflicting_id
        USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Per-day final going active. Two checks:
    -- (1) No active whole-job final on the same job.
    SELECT id INTO conflicting_id
      FROM invoices
     WHERE job_request_id = NEW.job_request_id
       AND id <> NEW.id
       AND invoice_type = 'final'
       AND is_draft = false
       AND (status IS NULL OR status NOT IN ('superseded','void'))
       AND (covered_dates IS NULL OR array_length(covered_dates, 1) = 0)
     LIMIT 1;
    IF conflicting_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot issue a per-day final invoice (id=%) when an active whole-job final exists for this job (conflicting id=%). Void or supersede the whole-job invoice first.',
        NEW.id, conflicting_id
        USING ERRCODE = '23514';
    END IF;

    -- (2) No date overlap with other active per-day finals on the same job.
    -- `&&` is the PG array-overlap operator.
    SELECT id INTO conflicting_id
      FROM invoices
     WHERE job_request_id = NEW.job_request_id
       AND id <> NEW.id
       AND invoice_type = 'final'
       AND is_draft = false
       AND (status IS NULL OR status NOT IN ('superseded','void'))
       AND covered_dates IS NOT NULL
       AND array_length(covered_dates, 1) > 0
       AND covered_dates && NEW.covered_dates
     LIMIT 1;
    IF conflicting_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot issue a per-day final invoice (id=%) whose covered_dates overlap an existing active per-day final for this job (conflicting id=%). Adjust the date selection.',
        NEW.id, conflicting_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_coverage_no_overlap_trg ON invoices;
CREATE TRIGGER invoices_coverage_no_overlap_trg
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_invoice_coverage_no_overlap();

-- Sanity smoke: the function + trigger now exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_invoice_coverage_no_overlap') THEN
    RAISE EXCEPTION '20260606c: function missing after migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'invoices_coverage_no_overlap_trg') THEN
    RAISE EXCEPTION '20260606c: trigger did not attach';
  END IF;
END $$;
