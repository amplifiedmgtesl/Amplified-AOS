-- ════════════════════════════════════════════════════════════════════
-- LEGACY QUOTE BACKFILL — Block D: Backfill quote_no + invoice.job_request_id
--
-- Two halves:
--   (1) Set quote_no = parent job's job_no + '_EST' for all linked quotes
--       (Miami special case: signed orphan stays base _EST, $44826 billed becomes _EST_REV2)
--   (2) Cascade backfill invoices.job_request_id from source_quote chain
--
-- Quarantined quotes (from Block C) keep quote_no=NULL — they're not active.
-- Freeze triggers disabled for the duration.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE quotes        DISABLE TRIGGER quotes_freeze_trg;
ALTER TABLE invoices      DISABLE TRIGGER invoices_freeze_trg;

-- ════════════════════════════════════════════════════════════════════
-- PART 1: Backfill quotes.quote_no from parent job
-- ════════════════════════════════════════════════════════════════════

-- Generic rule: for every active (non-quarantined, non-superseded) quote with a job_request_id,
-- set quote_no = job.job_no + '_EST' if not already set.
UPDATE quotes q
SET quote_no = jr.job_no || '_EST'
FROM job_requests jr
WHERE q.job_request_id = jr.id
  AND jr.job_no IS NOT NULL
  AND q.quote_no IS NULL
  AND (q.status IS NULL OR q.status <> 'superseded')
  AND jr.id NOT LIKE 'jobreq-qrx-%';

-- Miami special case: $44826 (the billed revision) becomes _EST_REV2
-- since the signed $36918 just got assigned _EST as base.
-- Need to be careful: the prior UPDATE above will have assigned BOTH to _EST,
-- violating unique constraint. The signed orphan was inserted to the job FIRST in Block C,
-- but both UPDATEs run in this transaction, so result depends on order.
-- Fix: assign REV2 explicitly here, AFTER the generic backfill.
-- The constraint job_requests_quote_no_unique is partial on job_no IS NOT NULL — so we
-- need to handle the conflict. Strategy:
--   1. Set signed orphan to base _EST
--   2. Set $44826 billed quote to _EST_REV2 + revision_no=2 + status='superseded' on the original?

-- Actually simpler: explicitly set the $44826 row.
UPDATE quotes
SET quote_no = (SELECT job_no FROM job_requests WHERE id = 'jobreq-1777325737896') || '_EST_REV2',
    revision_no = 2,
    parent_quote_id = 'recovered-6e82573f-miami-university-commencement'
WHERE id = 'loud&clear,-inc.-miami-university-commencement--2026-05-11';

-- Ensure the signed orphan keeps _EST (in case the generic UPDATE assigned _EST to a different row first)
UPDATE quotes
SET quote_no = (SELECT job_no FROM job_requests WHERE id = 'jobreq-1777325737896') || '_EST',
    revision_no = COALESCE(revision_no, 1)
WHERE id = 'recovered-6e82573f-miami-university-commencement';

-- ════════════════════════════════════════════════════════════════════
-- PART 2: Cascade backfill invoices.job_request_id from source_quote
-- ════════════════════════════════════════════════════════════════════

-- For every invoice with NULL job_request_id where its source_quote now has one,
-- inherit it.
UPDATE invoices i
SET job_request_id = q.job_request_id
FROM quotes q
WHERE q.id = i.source_quote_id
  AND i.job_request_id IS NULL
  AND q.job_request_id IS NOT NULL
  AND q.job_request_id NOT LIKE 'jobreq-qrx-%';

-- ─── Re-enable freeze triggers ──────────────────────────────────────
ALTER TABLE quotes        ENABLE TRIGGER quotes_freeze_trg;
ALTER TABLE invoices      ENABLE TRIGGER invoices_freeze_trg;

-- ─── Verification ───────────────────────────────────────────────────
DO $$
DECLARE
  null_quote_no int;
  null_inv_job int;
  bad_miami_count int;
BEGIN
  -- Active quotes with NULL quote_no should ONLY be quarantined ones
  SELECT count(*) INTO null_quote_no FROM quotes
   WHERE quote_no IS NULL
     AND (job_request_id IS NULL OR job_request_id NOT LIKE 'jobreq-qrx-%')
     AND (status IS NULL OR status <> 'superseded');

  -- Invoices with NULL job_request_id should ONLY be quarantined ones now
  SELECT count(*) INTO null_inv_job FROM invoices
   WHERE job_request_id IS NULL;

  -- Miami chain sanity
  SELECT count(*) INTO bad_miami_count FROM quotes
   WHERE job_request_id = 'jobreq-1777325737896'
     AND status NOT IN ('superseded')
     AND id NOT IN ('recovered-6e82573f-miami-university-commencement','loud&clear,-inc.-miami-university-commencement--2026-05-11');

  RAISE NOTICE 'Block D verification:';
  RAISE NOTICE '  Active quotes still with NULL quote_no: % (expect 0)', null_quote_no;
  RAISE NOTICE '  Invoices still with NULL job_request_id: % (expect 0 or low — true orphans only)', null_inv_job;
  RAISE NOTICE '  Miami chain non-superseded non-recognized quotes: % (expect 0)', bad_miami_count;
END;
$$;

COMMIT;
