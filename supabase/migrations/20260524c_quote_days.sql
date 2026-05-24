-- Holiday handling Phase 2: per-quote day snapshot table.
--
-- See project_holiday_handling.md for the design. Pattern C:
-- job_request_days.is_holiday is the editable source of truth; quote_days
-- snapshots it on draft creation so frozen quotes preserve the holiday
-- treatment that was current at issue time. On a draft, toggling
-- quote_days.is_holiday recalculates line totals immediately. The
-- existing quotes_freeze + quote_lines_freeze triggers block writes to
-- frozen quotes; we extend the freeze net to quote_days here so the same
-- protection applies.
--
-- Backfill: every existing quote (draft OR frozen) gets a quote_days row
-- per distinct quote_date present on its lines (plus its parent job's
-- days when known), with is_holiday copied from job_request_days. For
-- currently-0-holidays data this is a clean no-op; the table just exists
-- with all-false rows.
--
-- Phase 3 will mirror this for invoice_days. Phase 2 only touches quotes.

-- ─── 1. Table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quote_days (
  id          text         PRIMARY KEY,
  quote_id    text         NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  quote_date  date         NOT NULL,
  is_holiday  boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         REFERENCES auth.users(id),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  uuid         REFERENCES auth.users(id),
  UNIQUE (quote_id, quote_date)
);

CREATE INDEX IF NOT EXISTS quote_days_quote_idx
  ON quote_days(quote_id);

CREATE INDEX IF NOT EXISTS quote_days_holiday_idx
  ON quote_days(quote_id) WHERE is_holiday = true;

-- RLS: full access (project pattern).
ALTER TABLE quote_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON quote_days;
CREATE POLICY full_access ON quote_days FOR ALL USING (true) WITH CHECK (true);

-- Audit trigger (reuses the shared set_audit_columns helper).
DROP TRIGGER IF EXISTS set_audit_columns_trg ON quote_days;
CREATE TRIGGER set_audit_columns_trg
  BEFORE INSERT OR UPDATE ON quote_days
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── 2. Freeze trigger: quote_days follows parent quote's freeze state ──

CREATE OR REPLACE FUNCTION quote_days_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q_is_draft boolean;
BEGIN
  SELECT is_draft INTO q_is_draft FROM quotes
   WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF NOT FOUND THEN
    -- Parent quote doesn't exist — let FK handle the error.
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT q_is_draft THEN
    RAISE EXCEPTION
      'Cannot modify quote_days on a frozen quote (quote_id=%). Use Revise to change holiday flagging.',
      COALESCE(NEW.quote_id, OLD.quote_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS quote_days_freeze_iud_trg ON quote_days;
CREATE TRIGGER quote_days_freeze_iud_trg
  BEFORE INSERT OR UPDATE OR DELETE ON quote_days
  FOR EACH ROW EXECUTE FUNCTION quote_days_freeze_check();

-- ─── 3. Backfill: one row per (quote, distinct quote_date), is_holiday
--                  copied from job_request_days where the quote is linked
--                  to a job. ────────────────────────────────────────────

-- Freeze triggers off for the one-time INSERT.
ALTER TABLE quote_days DISABLE TRIGGER quote_days_freeze_iud_trg;

INSERT INTO quote_days (id, quote_id, quote_date, is_holiday)
SELECT
  'qd-' || substr(md5(d.quote_id || '|' || d.quote_date::text), 1, 16),
  d.quote_id,
  d.quote_date,
  COALESCE(jrd.is_holiday, false)
FROM (
  -- Source 1: dates present on existing quote_lines
  SELECT DISTINCT q.id AS quote_id, ql.quote_date::date AS quote_date
    FROM quotes q
    JOIN quote_lines ql ON ql.quote_id = q.id
   WHERE ql.quote_date IS NOT NULL
     AND ql.quote_date::text <> ''
  UNION
  -- Source 2: dates on the parent job's job_request_days (so a fresh draft
  -- with no lines yet still gets seeded days).
  SELECT q.id AS quote_id, jrd2.event_date AS quote_date
    FROM quotes q
    JOIN job_request_days jrd2 ON jrd2.job_request_id = q.job_request_id
   WHERE q.job_request_id IS NOT NULL
) d
LEFT JOIN job_requests jr ON jr.id = (
  SELECT q.job_request_id FROM quotes q WHERE q.id = d.quote_id
)
LEFT JOIN job_request_days jrd
  ON jrd.job_request_id = jr.id AND jrd.event_date = d.quote_date
ON CONFLICT (quote_id, quote_date) DO NOTHING;

ALTER TABLE quote_days ENABLE TRIGGER quote_days_freeze_iud_trg;

-- ─── 4. Final state ─────────────────────────────────────────────────────

SELECT 'quote_days rows'   AS metric, count(*)::bigint AS n FROM quote_days
UNION ALL
SELECT 'quote_days holiday', count(*)::bigint           FROM quote_days WHERE is_holiday = true
UNION ALL
SELECT 'distinct quotes',    count(DISTINCT quote_id)::bigint FROM quote_days;
