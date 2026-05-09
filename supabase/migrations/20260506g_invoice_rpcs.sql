-- Phase C invoice rewrite — Migration 6: server-side RPCs.
--
--   issue_invoice_draft(p_invoice_id)              — promote draft to frozen
--   link_orphan_invoice(p_invoice_id, p_quote_id, p_job_id) — adopt legacy orphan
--   record_customer_payment(...)                   — atomic payment + allocations
--   apply_credit_to_invoice(p_client_id, p_invoice_id, p_amount) — ledger entry
--
-- Companion: docs/invoice-rewrite-plan.md

-- ─── issue_invoice_draft ─────────────────────────────────────────────────────
-- Mirrors issue_quote_draft. Computes invoice_no based on the linked job's
-- job_no + suffix (_INV / _DEP / _REV{N-1}). For per-day finals (covered_dates
-- IS NOT NULL), appends the first covered date to disambiguate.
--
-- Naming:
--   {job_no}_INV               — whole-job final
--   {job_no}_INV_{YYMMDD}      — per-day final (first covered date)
--   {job_no}_DEP               — deposit
--   {parent_no}_REV{N-1}        — revision (parent invoice's number + revision suffix)
CREATE OR REPLACE FUNCTION issue_invoice_draft(p_invoice_id text)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_invoice      invoices%ROWTYPE;
  v_job          job_requests%ROWTYPE;
  v_invoice_no   text;
  v_revision_no  int;
  v_first_date   date;
  v_date_suffix  text;
  v_type_suffix  text;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT v_invoice.is_draft THEN
    RAISE EXCEPTION 'Invoice not found or already issued: %', p_invoice_id;
  END IF;

  IF v_invoice.invoice_type IS NULL THEN
    RAISE EXCEPTION 'Invoice % has no invoice_type set; must be deposit or final before issuing.', p_invoice_id;
  END IF;

  SELECT * INTO v_job FROM job_requests WHERE id = v_invoice.job_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % has no valid job_request_id', p_invoice_id;
  END IF;
  IF v_job.job_no IS NULL OR v_job.job_no = '' THEN
    RAISE EXCEPTION 'Cannot issue invoice: job_request % has no job_no yet', v_invoice.job_request_id;
  END IF;

  -- Build the type suffix
  v_type_suffix := CASE v_invoice.invoice_type
                     WHEN 'deposit' THEN '_DEP'
                     WHEN 'final'   THEN '_INV'
                   END;

  -- Per-day final disambiguation: append the first covered date
  IF v_invoice.invoice_type = 'final'
     AND v_invoice.covered_dates IS NOT NULL
     AND array_length(v_invoice.covered_dates, 1) > 0
  THEN
    v_first_date := v_invoice.covered_dates[1];
    v_date_suffix := '_' || to_char(v_first_date, 'YYYYMMDD');
  ELSE
    v_date_suffix := '';
  END IF;

  -- Compute invoice_no based on revision-or-not
  IF v_invoice.parent_invoice_id IS NOT NULL THEN
    -- Revision: lock parent, increment revision_no, append _REV{N-1}
    SELECT revision_no INTO v_revision_no
      FROM invoices WHERE id = v_invoice.parent_invoice_id FOR UPDATE;
    v_revision_no := v_revision_no + 1;
    v_invoice_no := v_job.job_no || v_type_suffix || v_date_suffix
                  || '_REV' || (v_revision_no - 1)::text;

    UPDATE invoices
       SET status = 'superseded',
           superseded_at = now(),
           superseded_by = auth.uid()
     WHERE id = v_invoice.parent_invoice_id;
  ELSE
    v_revision_no := 1;
    v_invoice_no := v_job.job_no || v_type_suffix || v_date_suffix;
  END IF;

  -- Snapshot event info from job_request (for PDF reproducibility) + flip to frozen.
  -- source_quote_code is also snapshotted from the source quote at this moment.
  UPDATE invoices
     SET is_draft         = false,
         status           = 'issued',
         invoice_no       = v_invoice_no,
         revision_no      = v_revision_no,
         issued_at        = now(),
         issued_by        = auth.uid(),
         client           = v_job.client,
         client_id        = v_job.client_id,
         event_name       = v_job.event_name,
         venue            = v_job.venue,
         city_state       = v_job.city_state,
         source_quote_code = COALESCE(v_invoice.source_quote_code, (
           SELECT quote_no FROM quotes WHERE id = v_invoice.source_quote_id
         ))
   WHERE id = p_invoice_id;

  RETURN p_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION issue_invoice_draft(text) FROM public;
GRANT EXECUTE ON FUNCTION issue_invoice_draft(text) TO authenticated;

-- ─── link_orphan_invoice ─────────────────────────────────────────────────────
-- Adopts a legacy orphan frozen invoice (job_request_id IS NULL or
-- source_quote_id IS NULL) by attaching it to a job + quote and recomputing
-- invoice_no. One-time per invoice — freeze trigger blocks re-parenting.
CREATE OR REPLACE FUNCTION link_orphan_invoice(
  p_invoice_id      text,
  p_source_quote_id text,
  p_job_request_id  text
)
RETURNS text  -- the new invoice_no
LANGUAGE plpgsql AS $$
DECLARE
  v_invoice      invoices%ROWTYPE;
  v_job          job_requests%ROWTYPE;
  v_invoice_no   text;
  v_revision_no  int;
  v_first_date   date;
  v_date_suffix  text;
  v_type_suffix  text;
  v_quote_no     text;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;
  IF v_invoice.is_draft THEN
    RAISE EXCEPTION 'link_orphan_invoice is for frozen invoices only (id=% is a draft)', p_invoice_id;
  END IF;
  IF v_invoice.job_request_id IS NOT NULL OR v_invoice.source_quote_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % is already linked. Re-parenting not allowed.', p_invoice_id;
  END IF;

  SELECT * INTO v_job FROM job_requests WHERE id = p_job_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job request not found: %', p_job_request_id;
  END IF;
  IF v_job.job_no IS NULL OR v_job.job_no = '' THEN
    RAISE EXCEPTION 'Cannot link: job_request % has no job_no yet', p_job_request_id;
  END IF;

  SELECT quote_no INTO v_quote_no FROM quotes WHERE id = p_source_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found: %', p_source_quote_id;
  END IF;

  -- Default invoice_type if NULL on the orphan: infer from invoice_no suffix.
  IF v_invoice.invoice_type IS NULL THEN
    UPDATE invoices SET invoice_type = CASE
      WHEN invoice_no LIKE '%-DEP%' THEN 'deposit'
      ELSE 'final'
    END WHERE id = p_invoice_id;
    -- Reload
    SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  END IF;

  v_type_suffix := CASE v_invoice.invoice_type
                     WHEN 'deposit' THEN '_DEP'
                     WHEN 'final'   THEN '_INV'
                   END;

  IF v_invoice.invoice_type = 'final'
     AND v_invoice.covered_dates IS NOT NULL
     AND array_length(v_invoice.covered_dates, 1) > 0
  THEN
    v_first_date := v_invoice.covered_dates[1];
    v_date_suffix := '_' || to_char(v_first_date, 'YYYYMMDD');
  ELSE
    v_date_suffix := '';
  END IF;

  v_revision_no := COALESCE(v_invoice.revision_no, 1);
  IF v_invoice.parent_invoice_id IS NOT NULL AND v_revision_no > 1 THEN
    v_invoice_no := v_job.job_no || v_type_suffix || v_date_suffix
                  || '_REV' || (v_revision_no - 1)::text;
  ELSE
    v_invoice_no := v_job.job_no || v_type_suffix || v_date_suffix;
  END IF;

  UPDATE invoices
     SET job_request_id    = p_job_request_id,
         source_quote_id   = p_source_quote_id,
         source_quote_code = v_quote_no,
         invoice_no        = v_invoice_no
   WHERE id = p_invoice_id;

  RETURN v_invoice_no;
END;
$$;

REVOKE ALL ON FUNCTION link_orphan_invoice(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION link_orphan_invoice(text, text, text) TO authenticated;

-- ─── record_customer_payment ─────────────────────────────────────────────────
-- Atomic insert of customer_payments + payment_allocations. Allocations are
-- passed as JSON: [{"invoice_id": "...", "amount": 1234.56, "notes": "..."}]
-- Returns the new payment id.
CREATE OR REPLACE FUNCTION record_customer_payment(
  p_id              text,
  p_client_id       text,
  p_payment_date    date,
  p_payment_method  text,
  p_payment_amount  numeric,
  p_reference_number text,
  p_memo            text,
  p_received_date   date,
  p_received_by     uuid,
  p_deposited_date  date,
  p_deposited_by    uuid,
  p_notes           text,
  p_allocations     jsonb  -- array of { invoice_id, amount, notes }
)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_alloc jsonb;
  v_alloc_id text;
  v_total_allocated numeric := 0;
BEGIN
  -- Insert the payment first
  INSERT INTO customer_payments (
    id, client_id, payment_date, payment_method, payment_amount,
    reference_number, memo, received_date, received_by,
    deposited_date, deposited_by, notes
  ) VALUES (
    p_id, p_client_id, p_payment_date, p_payment_method, p_payment_amount,
    p_reference_number, p_memo, p_received_date, p_received_by,
    p_deposited_date, p_deposited_by, p_notes
  );

  -- Insert allocations. The over-allocation trigger enforces SUM <= payment_amount.
  IF p_allocations IS NOT NULL THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
      v_alloc_id := 'pa-' || encode(gen_random_bytes(10), 'hex');
      INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, notes)
      VALUES (
        v_alloc_id,
        p_id,
        v_alloc->>'invoice_id',
        (v_alloc->>'amount')::numeric,
        v_alloc->>'notes'
      );
      v_total_allocated := v_total_allocated + (v_alloc->>'amount')::numeric;
    END LOOP;
  END IF;

  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION record_customer_payment(
  text, text, date, text, numeric, text, text, date, uuid, date, uuid, text, jsonb
) FROM public;
GRANT EXECUTE ON FUNCTION record_customer_payment(
  text, text, date, text, numeric, text, text, date, uuid, date, uuid, text, jsonb
) TO authenticated;

-- ─── apply_credit_to_invoice ─────────────────────────────────────────────────
-- Atomic: validates the client has enough available credit, then inserts the
-- ledger entry. The credits_applied trigger (Migration 5) maintains the
-- invoice aggregate.
CREATE OR REPLACE FUNCTION apply_credit_to_invoice(
  p_client_id   text,
  p_invoice_id  text,
  p_amount      numeric,
  p_notes       text DEFAULT NULL
)
RETURNS text  -- new ledger entry id
LANGUAGE plpgsql AS $$
DECLARE
  v_available    numeric;
  v_invoice      invoices%ROWTYPE;
  v_ledger_id    text;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Apply amount must be positive (got $%)', p_amount;
  END IF;

  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;
  IF v_invoice.client_id IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'Invoice % belongs to a different client (% vs %)',
      p_invoice_id, v_invoice.client_id, p_client_id;
  END IF;

  -- Compute available credit balance for the client
  SELECT COALESCE(SUM(
    CASE WHEN transaction_type IN ('overpayment','manual_credit') THEN amount ELSE -amount END
  ), 0) INTO v_available
  FROM customer_credit_ledger
  WHERE client_id = p_client_id AND is_active;

  IF v_available < p_amount THEN
    RAISE EXCEPTION 'Insufficient credit: trying to apply $%, available is $%', p_amount, v_available;
  END IF;

  v_ledger_id := 'ccl-' || encode(gen_random_bytes(10), 'hex');
  INSERT INTO customer_credit_ledger (
    id, client_id, transaction_date, transaction_type, amount,
    related_invoice_id, notes
  ) VALUES (
    v_ledger_id, p_client_id, CURRENT_DATE, 'applied_to_invoice', p_amount,
    p_invoice_id, p_notes
  );

  RETURN v_ledger_id;
END;
$$;

REVOKE ALL ON FUNCTION apply_credit_to_invoice(text, text, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION apply_credit_to_invoice(text, text, numeric, text) TO authenticated;
