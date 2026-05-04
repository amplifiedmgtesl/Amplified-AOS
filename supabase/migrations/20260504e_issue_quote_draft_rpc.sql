-- Phase A of the quote rewrite: issue_quote_draft(p_quote_id) RPC.
--
-- Promotes a draft (is_draft=true) into a frozen issued quote in a single
-- atomic transaction. Snapshots client/event/venue/dates from the parent
-- job_request, computes quote_no from job_no, and advances the job_request's
-- status from 'lead' to 'quoted' if applicable. For revisions, supersedes the
-- parent quote and increments revision_no.
--
-- Companion: docs/quote-rewrite-plan.md

CREATE OR REPLACE FUNCTION issue_quote_draft(p_quote_id text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_quote        quotes%ROWTYPE;
  v_job          job_requests%ROWTYPE;
  v_quote_no     text;
  v_revision_no  int;
BEGIN
  SELECT * INTO v_quote FROM quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR NOT v_quote.is_draft THEN
    RAISE EXCEPTION 'Quote not found or already issued: %', p_quote_id;
  END IF;

  SELECT * INTO v_job FROM job_requests WHERE id = v_quote.job_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote % has no valid job_request_id', p_quote_id;
  END IF;
  IF v_job.job_no IS NULL OR v_job.job_no = '' THEN
    RAISE EXCEPTION 'Cannot issue quote: job_request % has no job_no yet', v_quote.job_request_id;
  END IF;

  -- Compute quote_no from job's current job_no + revision marker. Lock parent
  -- (if any) so two simultaneous revisions of the same parent serialize.
  IF v_quote.parent_quote_id IS NOT NULL THEN
    SELECT revision_no INTO v_revision_no
      FROM quotes WHERE id = v_quote.parent_quote_id FOR UPDATE;
    v_revision_no := v_revision_no + 1;
    v_quote_no := v_job.job_no || '_EST_REV' || v_revision_no::text;

    UPDATE quotes
       SET status = 'superseded',
           superseded_at = now(),
           superseded_by = auth.uid()
     WHERE id = v_quote.parent_quote_id;
  ELSE
    v_revision_no := 1;
    v_quote_no := v_job.job_no || '_EST';
  END IF;

  -- Snapshot the fields that appear on the quote PDF / list view, then flip to frozen.
  -- Live-read fields not snapshotted (start_time, end_time, expected_hours_per_day,
  -- linked_job_sheet_id, timesheet_summary) are dropped from the new flow.
  UPDATE quotes
     SET is_draft     = false,
         status       = 'issued',
         quote_no     = v_quote_no,
         revision_no  = v_revision_no,
         issued_at    = now(),
         issued_by    = auth.uid(),
         client       = v_job.client,
         client_id    = v_job.client_id,
         event_name   = v_job.event_name,
         venue        = v_job.venue,
         city_state   = v_job.city_state,
         start_date   = v_job.request_date,
         end_date     = v_job.end_date
   WHERE id = p_quote_id;

  -- Advance the source job_request lifecycle if still in 'lead' status.
  -- This locks the job's source fields (job_no, event_abbr, etc.) per the
  -- existing job_no recompute rules.
  UPDATE job_requests
     SET status = 'quoted'
   WHERE id = v_quote.job_request_id AND status = 'lead';

  RETURN p_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION issue_quote_draft FROM public;
GRANT EXECUTE ON FUNCTION issue_quote_draft TO authenticated;
