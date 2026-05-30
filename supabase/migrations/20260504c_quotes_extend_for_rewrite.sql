-- Phase A of the quote rewrite: extend the quotes table with the columns and
-- constraints needed for the draft/frozen split, revision chain, and lifecycle
-- audit. Additive — old code keeps working since new columns are nullable and
-- the freeze trigger (next migration) only fires on is_draft=false rows.
--
-- Companion: docs/quote-rewrite-plan.md
--
-- Pre-flight checked before applying:
--   - Existing status values (see pre-flight query #1 in the plan)
--   - Orphan linked_job_request_id (#2)
--   - Draft duplicates per job (#3)
--
-- Adjust the status normalization UPDATE below if any out-of-enum values surfaced.

-- ─── Identity + revision wiring ──────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS job_request_id  text REFERENCES job_requests(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS parent_quote_id text REFERENCES quotes(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quote_no        text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS revision_no     int  NOT NULL DEFAULT 1;

-- ─── Draft / frozen separator ────────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT true;

-- ─── Lifecycle audit ─────────────────────────────────────────────────────────
-- Per feedback_audit_column_convention.md — paired {event}_at + {event}_by.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS issued_at      timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS issued_by      uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS superseded_at  timestamptz;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS superseded_by  uuid;

-- Existing signed_at is text (legacy). Convert to timestamptz and add the missing
-- _by half so the customer-signature triple matches the convention.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'quotes' AND column_name = 'signed_at' AND data_type = 'text'
  ) THEN
    ALTER TABLE quotes
      ALTER COLUMN signed_at TYPE timestamptz USING NULLIF(signed_at, '')::timestamptz;
  END IF;
END $$;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_by uuid;

-- ─── Standard row-level audit (quotes was missed by 20260503d) ───────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_by uuid;

DROP TRIGGER IF EXISTS quotes_audit_trg ON quotes;
CREATE TRIGGER quotes_audit_trg
  BEFORE INSERT OR UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Status normalization + draft separator backfill ─────────────────────────
-- Pre-flight (2026-05-04 dev) surfaced two existing status values: 'quoted' (24
-- rows) and 'signed' (5 rows). 'quoted' is semantically equivalent to 'issued' in
-- the new enum — same meaning, just a different historical label. Map explicitly.
UPDATE quotes SET status = 'issued' WHERE status = 'quoted';

-- Catch-all for anything else that might have slipped past the pre-flight (defensive,
-- idempotent — runs against zero rows on the known-clean dev state).
UPDATE quotes SET status = 'issued'
 WHERE status IS NOT NULL
   AND status NOT IN ('draft','issued','signed','superseded');

-- Backfill is_draft from current status, then null out the legacy 'draft' value so
-- status holds only the issued-document lifecycle going forward.
UPDATE quotes SET is_draft = false  WHERE status IN ('issued','signed','superseded');
UPDATE quotes SET is_draft = true,  status = NULL WHERE status = 'draft';

-- ─── Constraints ─────────────────────────────────────────────────────────────
-- Status restricted to issued-document lifecycle (NULL while draft).
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IS NULL OR status IN ('issued','signed','superseded'));

-- Pin the relationship between is_draft and status — no drift possible.
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_draft_status_consistency;
ALTER TABLE quotes ADD CONSTRAINT quotes_draft_status_consistency
  CHECK (
    (is_draft = true  AND status IS NULL) OR
    (is_draft = false AND status IN ('issued','signed','superseded'))
  );

-- ─── Indices ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS quotes_quote_no_idx
  ON quotes(quote_no) WHERE quote_no IS NOT NULL;

-- One open draft per (job_request_id, parent_quote_id) pair. NULL job_request_id
-- excluded so any pre-rewrite orphan drafts don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_open_draft_per_job_idx
  ON quotes(job_request_id, COALESCE(parent_quote_id, ''))
  WHERE is_draft AND job_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quotes_job_request_id_idx  ON quotes(job_request_id);
CREATE INDEX IF NOT EXISTS quotes_parent_quote_id_idx ON quotes(parent_quote_id);
CREATE INDEX IF NOT EXISTS quotes_is_draft_idx        ON quotes(is_draft);

-- ─── FK backfill ─────────────────────────────────────────────────────────────
-- Populate the new job_request_id FK from the legacy linked_job_request_id text
-- column, but only where the target row exists. Orphan references stay NULL and
-- surface in the post-flight audit query below.
UPDATE quotes q
   SET job_request_id = q.linked_job_request_id
  FROM job_requests jr
 WHERE q.job_request_id IS NULL
   AND q.linked_job_request_id = jr.id;

-- ─── Post-flight audit (review output, no automatic action) ──────────────────
-- Run these by hand after the migration applies to surface any rows that need
-- manual remediation:
--
-- SELECT id, client, event_name, start_date, status, linked_job_request_id
--   FROM quotes
--  WHERE NOT is_draft AND job_request_id IS NULL
--  ORDER BY start_date DESC;
--
-- SELECT count(*) AS post_flight_drafts FROM quotes WHERE is_draft;
-- SELECT count(*) AS post_flight_frozen FROM quotes WHERE NOT is_draft;
