-- Holiday handling Phase 3: per-invoice day snapshot table.
--
-- Mirrors quote_days (20260524c). Source of truth chain:
--   job_request_days.is_holiday  →  quote_days.is_holiday  →  invoice_days.is_holiday
-- Each entity stores its own snapshot so frozen records preserve the holiday
-- treatment that was current at issue time. On a draft, the operator can
-- still toggle invoice_days.is_holiday; the freeze trigger blocks edits once
-- the invoice is is_draft=false.
--
-- Backfill priority for an existing invoice:
--   1. Copy from source quote's quote_days where invoice.source_quote_id matches
--   2. Fall back to the parent job's job_request_days
--   3. Final fallback: rows for each distinct invoice_lines.invoice_date with
--      is_holiday=false (deposits have no lines, so they get zero rows here —
--      that's correct, deposits are header-only and holiday treatment doesn't
--      apply at the invoice level).

CREATE TABLE IF NOT EXISTS invoice_days (
  id            text         PRIMARY KEY,
  invoice_id    text         NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_date  date         NOT NULL,
  is_holiday    boolean      NOT NULL DEFAULT false,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         REFERENCES auth.users(id),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  updated_by    uuid         REFERENCES auth.users(id),
  UNIQUE (invoice_id, invoice_date)
);

CREATE INDEX IF NOT EXISTS invoice_days_invoice_idx ON invoice_days(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_days_holiday_idx ON invoice_days(invoice_id) WHERE is_holiday = true;

ALTER TABLE invoice_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS full_access ON invoice_days;
CREATE POLICY full_access ON invoice_days FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS set_audit_columns_trg ON invoice_days;
CREATE TRIGGER set_audit_columns_trg
  BEFORE INSERT OR UPDATE ON invoice_days
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Freeze trigger: invoice_days follows parent invoice's freeze state.
CREATE OR REPLACE FUNCTION invoice_days_freeze_check()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i_is_draft boolean;
BEGIN
  SELECT is_draft INTO i_is_draft FROM invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;
  IF NOT i_is_draft THEN
    RAISE EXCEPTION
      'Cannot modify invoice_days on a frozen invoice (invoice_id=%). Use Revise to change holiday flagging.',
      COALESCE(NEW.invoice_id, OLD.invoice_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS invoice_days_freeze_iud_trg ON invoice_days;
CREATE TRIGGER invoice_days_freeze_iud_trg
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_days
  FOR EACH ROW EXECUTE FUNCTION invoice_days_freeze_check();

-- ─── Backfill ───────────────────────────────────────────────────────────

ALTER TABLE invoice_days DISABLE TRIGGER invoice_days_freeze_iud_trg;

-- Source 1: copy from source quote's quote_days
INSERT INTO invoice_days (id, invoice_id, invoice_date, is_holiday)
SELECT
  'id-' || substr(md5(i.id || '|' || qd.quote_date::text), 1, 16),
  i.id,
  qd.quote_date,
  qd.is_holiday
FROM invoices i
JOIN quote_days qd ON qd.quote_id = i.source_quote_id
ON CONFLICT (invoice_id, invoice_date) DO NOTHING;

-- Source 2: fall back to job_request_days for invoices whose source quote
-- has no quote_days (shouldn't happen post-Phase 2 but defensive).
INSERT INTO invoice_days (id, invoice_id, invoice_date, is_holiday)
SELECT
  'id-' || substr(md5(i.id || '|' || jrd.event_date::text), 1, 16),
  i.id,
  jrd.event_date,
  jrd.is_holiday
FROM invoices i
JOIN job_request_days jrd ON jrd.job_request_id = i.job_request_id
WHERE i.job_request_id IS NOT NULL
ON CONFLICT (invoice_id, invoice_date) DO NOTHING;

-- Source 3: final fallback for any final-invoice line dates not covered above
-- (legacy orphan invoices). is_holiday=false.
INSERT INTO invoice_days (id, invoice_id, invoice_date, is_holiday)
SELECT DISTINCT
  'id-' || substr(md5(il.invoice_id || '|' || il.quote_date::text), 1, 16),
  il.invoice_id,
  il.quote_date::date,
  false
FROM invoice_lines il
WHERE il.quote_date IS NOT NULL AND il.quote_date::text <> ''
ON CONFLICT (invoice_id, invoice_date) DO NOTHING;

ALTER TABLE invoice_days ENABLE TRIGGER invoice_days_freeze_iud_trg;

-- ─── Final state ────────────────────────────────────────────────────────

SELECT 'invoice_days rows'   AS metric, count(*)::bigint AS n FROM invoice_days
UNION ALL
SELECT 'invoice_days holiday', count(*)::bigint           FROM invoice_days WHERE is_holiday = true
UNION ALL
SELECT 'distinct invoices',   count(DISTINCT invoice_id)::bigint FROM invoice_days;
