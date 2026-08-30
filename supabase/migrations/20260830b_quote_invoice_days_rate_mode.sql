-- Carry the day-rate basis onto quote_days and invoice_days.
--
-- 20260830a put rate_mode + day_rate_hours on job_request_days and pointed
-- payroll at them. Those two columns are a DAY-LEVEL FACT, exactly like
-- is_holiday — which is the only thing quote_days and invoice_days already
-- carry, and which travels job -> quote -> invoice for the same reason:
-- a document must be able to explain itself after the job record moves on.
--
-- Added here so the shape exists in one migration rather than two. Payroll
-- reads job_request_days only (20260830a). Quoting and invoicing move onto
-- these columns as a separate change — see
-- docs/day-rate-source-of-truth-design.md §8 step 4 — at which point a
-- quote frozen at issue time keeps the basis it was sold under even if the
-- job's days are later edited.
--
-- Nullable on purpose: nothing writes them yet, and a NULL here means
-- "this document predates the columns", not "hourly".

ALTER TABLE quote_days
  ADD COLUMN IF NOT EXISTS rate_mode      text,
  ADD COLUMN IF NOT EXISTS day_rate_hours numeric;

ALTER TABLE invoice_days
  ADD COLUMN IF NOT EXISTS rate_mode      text,
  ADD COLUMN IF NOT EXISTS day_rate_hours numeric;

-- Same constraints as job_request_days. quote_lines was never constrained
-- and drifted to a third spelling ('day_rate', 19 rows) that the code
-- silently treats as hourly — do not let that happen again here.
ALTER TABLE quote_days   DROP CONSTRAINT IF EXISTS quote_days_rate_mode_check;
ALTER TABLE invoice_days DROP CONSTRAINT IF EXISTS invoice_days_rate_mode_check;
ALTER TABLE quote_days   DROP CONSTRAINT IF EXISTS quote_days_day_rate_hours_check;
ALTER TABLE invoice_days DROP CONSTRAINT IF EXISTS invoice_days_day_rate_hours_check;
ALTER TABLE quote_days   DROP CONSTRAINT IF EXISTS quote_days_day_rate_hours_required_check;
ALTER TABLE invoice_days DROP CONSTRAINT IF EXISTS invoice_days_day_rate_hours_required_check;

ALTER TABLE quote_days
  ADD CONSTRAINT quote_days_rate_mode_check
  CHECK (rate_mode IS NULL OR rate_mode IN ('day','hourly'));
ALTER TABLE invoice_days
  ADD CONSTRAINT invoice_days_rate_mode_check
  CHECK (rate_mode IS NULL OR rate_mode IN ('day','hourly'));

ALTER TABLE quote_days
  ADD CONSTRAINT quote_days_day_rate_hours_check
  CHECK (day_rate_hours IS NULL OR (day_rate_hours > 0 AND day_rate_hours <= 24));
ALTER TABLE invoice_days
  ADD CONSTRAINT invoice_days_day_rate_hours_check
  CHECK (day_rate_hours IS NULL OR (day_rate_hours > 0 AND day_rate_hours <= 24));

-- "Day rate with no hours" must be impossible here too.
ALTER TABLE quote_days
  ADD CONSTRAINT quote_days_day_rate_hours_required_check
  CHECK (rate_mode IS DISTINCT FROM 'day' OR day_rate_hours > 0);
ALTER TABLE invoice_days
  ADD CONSTRAINT invoice_days_day_rate_hours_required_check
  CHECK (rate_mode IS DISTINCT FROM 'day' OR day_rate_hours > 0);

COMMENT ON COLUMN quote_days.rate_mode IS
  'Day-rate basis this quote was issued under, copied from job_request_days. NULL means the quote predates these columns. Not yet written — see design doc step 4.';
COMMENT ON COLUMN quote_days.day_rate_hours IS
  'Hours the day rate covered when this quote was issued. Frozen with the quote so it survives later edits to the job day record.';
COMMENT ON COLUMN invoice_days.rate_mode IS
  'Day-rate basis this invoice was billed under, carried from the source quote. NULL means the invoice predates these columns.';
COMMENT ON COLUMN invoice_days.day_rate_hours IS
  'Hours the day rate covered when this invoice was raised.';

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
DECLARE n_missing int;
BEGIN
  SELECT count(*) INTO n_missing
    FROM (VALUES ('quote_days','rate_mode'), ('quote_days','day_rate_hours'),
                 ('invoice_days','rate_mode'), ('invoice_days','day_rate_hours')) AS c(tbl, col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=c.tbl AND column_name=c.col
   );
  IF n_missing > 0 THEN
    RAISE EXCEPTION '% expected columns missing from quote_days/invoice_days', n_missing;
  END IF;
END $$;
