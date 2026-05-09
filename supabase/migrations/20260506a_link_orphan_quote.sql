-- Allow legacy orphan frozen quotes (job_request_id IS NULL) to be linked
-- retroactively to a job. The freeze trigger blocks job_request_id and
-- quote_no changes; relax that ONLY for the NULL -> non-NULL transition so
-- it's a one-time adoption, not a re-parenting.
--
-- Companion RPC: link_orphan_quote(p_quote_id, p_job_request_id) — recomputes
-- quote_no from the chosen job's job_no + '_EST' (or '_EST_REV{N}' for revisions).

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
    -- One-time orphan adoption: NULL -> non-NULL is allowed for both
    -- job_request_id and the paired quote_no recompute. Re-parenting (changing
    -- a non-NULL job_request_id to anything else) is still blocked.
    IF OLD.job_request_id IS NOT NULL
      AND NEW.job_request_id IS DISTINCT FROM OLD.job_request_id
    THEN
      RAISE EXCEPTION
        'Cannot change job_request_id on a linked frozen quote (id=%). Re-parenting not allowed.',
        OLD.id;
    END IF;
    -- quote_no: only allowed to change when the orphan-adoption transition is happening.
    IF OLD.job_request_id IS NOT NULL
      AND NEW.quote_no IS DISTINCT FROM OLD.quote_no
    THEN
      RAISE EXCEPTION
        'Cannot change quote_no on a linked frozen quote (id=%).',
        OLD.id;
    END IF;

    -- Standard freeze: all other content columns must remain unchanged.
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

-- ─── RPC: link an orphan quote to a job ──────────────────────────────────────
CREATE OR REPLACE FUNCTION link_orphan_quote(
  p_quote_id text,
  p_job_request_id text
)
RETURNS text  -- the new quote_no
LANGUAGE plpgsql AS $$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_job          job_requests%ROWTYPE;
  v_quote_no     text;
  v_revision_no  int;
  v_parent_rev   int;
BEGIN
  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found: %', p_quote_id;
  END IF;
  IF v_quote.is_draft THEN
    RAISE EXCEPTION 'link_orphan_quote is for frozen quotes only (id=% is a draft)', p_quote_id;
  END IF;
  IF v_quote.job_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quote % is already linked to job_request %. Use Revise to change linkage.',
      p_quote_id, v_quote.job_request_id;
  END IF;

  SELECT * INTO v_job FROM job_requests WHERE id = p_job_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job request not found: %', p_job_request_id;
  END IF;
  IF v_job.job_no IS NULL OR v_job.job_no = '' THEN
    RAISE EXCEPTION 'Cannot link: job_request % has no job_no yet', p_job_request_id;
  END IF;

  -- Compute quote_no. Same convention as issue_quote_draft:
  --   first quote (no parent)  -> {job_no}_EST
  --   revision N (parent set)  -> {job_no}_EST_REV{N-1}
  v_revision_no := COALESCE(v_quote.revision_no, 1);
  IF v_quote.parent_quote_id IS NOT NULL AND v_revision_no > 1 THEN
    v_quote_no := v_job.job_no || '_EST_REV' || (v_revision_no - 1)::text;
  ELSE
    v_quote_no := v_job.job_no || '_EST';
  END IF;

  UPDATE quotes
     SET job_request_id = p_job_request_id,
         quote_no       = v_quote_no
   WHERE id = p_quote_id;

  RETURN v_quote_no;
END;
$$;

REVOKE ALL ON FUNCTION link_orphan_quote(text, text) FROM public;
GRANT EXECUTE ON FUNCTION link_orphan_quote(text, text) TO authenticated;
