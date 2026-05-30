-- Phase C invoice rewrite — Migration 1: extend the invoices table with the
-- columns and constraints needed for draft/frozen split, revision chain,
-- multi-day support, deposit/credit allocation, and lifecycle audit. Mirrors
-- the structure of the quote rewrite (20260504c).
--
-- Pre-flight (2026-05-06 dev) found:
--   - 44 total invoices
--   - statuses: 'draft' (24), 'sent' (7), 'paid' (7), 'partial' (3),
--     'SENT' (1), 'BALANCE DUE UPON RECIEPT' (1), 'BALANCE PAST DUE' (1)
--   - 12 with -DEP suffix (deposits); 2 with -DEP-DEP corruption ($0 subtotals)
--   - 0 orphan quote_id text references (all targets exist)
--   - 6 recovered invoices (id LIKE 'inv-recovered-%')
--   - 3 unlinked to a quote (quote_id NULL)
--
-- Companion: docs/invoice-rewrite-plan.md

-- ─── Identity + revision wiring ──────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS job_request_id    text REFERENCES job_requests(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_quote_id   text REFERENCES quotes(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_quote_code text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS parent_invoice_id text REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revision_no       int  NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type      text;

-- ─── Draft / frozen separator + multi-day support ────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_draft       boolean NOT NULL DEFAULT true;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS covered_dates  date[];

-- ─── Deposit + credit allocation ─────────────────────────────────────────────
-- These are denormalized aggregates for fast display. amount_paid is maintained
-- by trigger from payment_allocations (Migration 4). credits_applied is
-- maintained by trigger from customer_credit_ledger (Migration 5).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit_applied numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credits_applied numeric NOT NULL DEFAULT 0;
-- amount_paid: existing column was populated as a single number; keep as-is
-- for now. Migration 4 swaps the maintenance to the trigger pattern.

-- ─── Lifecycle audit (per feedback_audit_column_convention.md) ───────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_at      timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_by      uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at        timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_by        uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at        timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_by        uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS superseded_at  timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS superseded_by  uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason    text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at      timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_by      uuid;

-- ─── Standard row-level audit (invoices wasn't in the 20260503d batch) ───────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS invoices_audit_trg ON invoices;
CREATE TRIGGER invoices_audit_trg
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Status normalization ────────────────────────────────────────────────────
-- Map all the historical free-text values onto the new enum.
UPDATE invoices SET status = 'sent' WHERE status IN (
  'BALANCE DUE UPON RECIEPT', 'BALANCE PAST DUE', 'SENT', 'partial'
);
-- Anything else outside the enum that snuck through → 'sent' as the safest
-- fallback (it's outstanding billing rather than draft).
UPDATE invoices SET status = 'sent'
 WHERE status IS NOT NULL
   AND status NOT IN ('draft','sent','paid','superseded','void');

-- Backfill is_draft from current status; null out the legacy 'draft' value.
UPDATE invoices SET is_draft = false WHERE status IN ('sent','paid','superseded','void');
UPDATE invoices SET is_draft = true,  status = NULL WHERE status = 'draft';

-- ─── Infer invoice_type from invoice_no suffix ───────────────────────────────
-- Legacy convention: -DEP suffix = deposit; otherwise final.
UPDATE invoices SET invoice_type = 'deposit'
 WHERE invoice_type IS NULL AND invoice_no LIKE '%-DEP%';
UPDATE invoices SET invoice_type = 'final'
 WHERE invoice_type IS NULL AND status IS NOT NULL;
-- Drafts can have invoice_type NULL until issue.

-- ─── Constraints ─────────────────────────────────────────────────────────────
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD  CONSTRAINT invoices_status_check
  CHECK (status IS NULL OR status IN ('issued','sent','paid','superseded','void'));

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_draft_status_consistency;
ALTER TABLE invoices ADD  CONSTRAINT invoices_draft_status_consistency
  CHECK (
    (is_draft = true  AND status IS NULL) OR
    (is_draft = false AND status IN ('issued','sent','paid','superseded','void'))
  );

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE invoices ADD  CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IS NULL OR invoice_type IN ('deposit','final'));

-- Drop the old NOT NULL on status (some legacy schema may have it)
ALTER TABLE invoices ALTER COLUMN status DROP NOT NULL;

-- ─── Indices ─────────────────────────────────────────────────────────────────
-- Pre-flight surfaced duplicate invoice_nos in legacy data (e.g., the same
-- INV-2026-0424-352 exists on inv-1777300439133 and inv-recovered-922d482c).
-- Can't enforce a global unique index without dedup first.
--
-- Compromise: enforce uniqueness ONLY on new-format invoice_nos (the AES_..._INV
-- pattern produced by the new RPC). Legacy/recovered invoice_nos stay as-is.
-- Plus a non-unique index for fast lookups on either pattern.
CREATE INDEX IF NOT EXISTS invoices_invoice_no_idx
  ON invoices(invoice_no) WHERE invoice_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_no_new_format_unique_idx
  ON invoices(invoice_no)
 WHERE invoice_no IS NOT NULL
   AND invoice_no LIKE 'AES_%';

-- One active deposit per job
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_active_deposit_per_job
  ON invoices(job_request_id)
  WHERE invoice_type = 'deposit'
    AND (status IS NULL OR status NOT IN ('superseded','void'))
    AND job_request_id IS NOT NULL
    AND is_draft = false;

-- One active whole-job final per job (covered_dates IS NULL = whole job)
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_active_wholejob_final_per_job
  ON invoices(job_request_id)
  WHERE invoice_type = 'final'
    AND (status IS NULL OR status NOT IN ('superseded','void'))
    AND covered_dates IS NULL
    AND job_request_id IS NOT NULL
    AND is_draft = false;

CREATE INDEX IF NOT EXISTS invoices_job_request_id_idx ON invoices(job_request_id);
CREATE INDEX IF NOT EXISTS invoices_source_quote_id_idx ON invoices(source_quote_id);
CREATE INDEX IF NOT EXISTS invoices_parent_invoice_id_idx ON invoices(parent_invoice_id);
CREATE INDEX IF NOT EXISTS invoices_is_draft_idx ON invoices(is_draft);

-- ─── FK backfill: source_quote_id from existing quote_id text ────────────────
-- Pre-flight verified 0 orphan refs, so the join is safe.
UPDATE invoices i
   SET source_quote_id = i.quote_id
  FROM quotes q
 WHERE i.source_quote_id IS NULL
   AND i.quote_id = q.id
   AND i.quote_id IS NOT NULL
   AND i.quote_id <> '';

-- ─── FK backfill: job_request_id from the source quote's job_request_id ────
UPDATE invoices i
   SET job_request_id = q.job_request_id
  FROM quotes q
 WHERE i.source_quote_id = q.id
   AND i.job_request_id IS NULL
   AND q.job_request_id IS NOT NULL;

-- ─── Snapshot source_quote_code from the source quote's current quote_no ────
UPDATE invoices i
   SET source_quote_code = q.quote_no
  FROM quotes q
 WHERE i.source_quote_id = q.id
   AND i.source_quote_code IS NULL
   AND q.quote_no IS NOT NULL;

-- ─── Post-flight audit (review output, no automatic action) ──────────────────
-- Run by hand:
-- SELECT count(*) AS unlinked_to_quote FROM invoices WHERE NOT is_draft AND source_quote_id IS NULL;
-- SELECT count(*) AS unlinked_to_job   FROM invoices WHERE NOT is_draft AND job_request_id IS NULL;
-- SELECT id, invoice_no, status, is_draft, invoice_type, source_quote_id, job_request_id
--   FROM invoices WHERE NOT is_draft AND (source_quote_id IS NULL OR job_request_id IS NULL);
