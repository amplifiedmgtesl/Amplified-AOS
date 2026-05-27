-- Phase C invoice rewrite — Migration 4: invoice payments.
--
-- Single table per-invoice payment tracking. One row = one real-world
-- payment applied to one invoice.
--
-- The 2026-05-27 redesign collapsed a previous two-table model
-- (customer_payments + payment_allocations) that was over-engineered
-- for a single-invoice flow. If we later need one check → many invoices,
-- a `payment_receipts` parent table can be layered on top with a
-- nullable receipt_id FK on this table — no breaking change.

CREATE TABLE IF NOT EXISTS invoice_payments (
  id                text PRIMARY KEY,
  invoice_id        text NOT NULL REFERENCES invoices(id),
  payment_date      date NOT NULL,
  payment_method    text NOT NULL CHECK (payment_method IN (
                      'check','ach','credit_card','cash','wire',
                      'zelle','venmo','money_order','other'
                    )),
  amount            numeric NOT NULL CHECK (amount > 0),
  reference_number  text,                  -- check #, CC txn id, Venmo id, etc.
  memo              text,                  -- what the customer wrote (memo line, Venmo note)
  notes             text,                  -- internal AES notes
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid
);

CREATE INDEX IF NOT EXISTS invoice_payments_invoice_id_idx ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_payments_payment_date_idx ON invoice_payments(payment_date);

ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invoice_payments_full_access" ON invoice_payments;
CREATE POLICY "invoice_payments_full_access"
  ON invoice_payments FOR ALL USING (true);

DROP TRIGGER IF EXISTS invoice_payments_audit_trg ON invoice_payments;
CREATE TRIGGER invoice_payments_audit_trg
  BEFORE INSERT OR UPDATE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Maintain invoices.paid_amount as denormalized SUM ───────────────────────
-- Sums active payment rows for the invoice; the auto-paid-status trigger
-- (20260527c) reads paid_amount to flip status to/from 'paid' automatically.
CREATE OR REPLACE FUNCTION refresh_invoice_paid_amount()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_invoice_id text;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  UPDATE invoices SET paid_amount = COALESCE((
    SELECT SUM(amount)
      FROM invoice_payments
     WHERE invoice_id = v_invoice_id AND is_active
  ), 0)
  WHERE id = v_invoice_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS invoice_payments_refresh_paid_amount ON invoice_payments;
CREATE TRIGGER invoice_payments_refresh_paid_amount
  AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
  FOR EACH ROW EXECUTE FUNCTION refresh_invoice_paid_amount();
