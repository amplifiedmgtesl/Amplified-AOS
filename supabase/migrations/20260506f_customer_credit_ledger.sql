-- Phase C invoice rewrite — Migration 5: customer credit ledger.
--
-- Per-client running ledger of credits. Used for:
--   - overpayments → +amount as 'overpayment'
--   - admin grants → +amount as 'manual_credit'
--   - applying credit to a future invoice → -amount as 'applied_to_invoice'
--   - refunding cash to the customer → -amount as 'refunded'
--   - administrative zero-out → -amount as 'written_off'
--
-- Customer's available credit at any time:
--   SELECT
--     SUM(CASE WHEN transaction_type IN ('overpayment','manual_credit') THEN amount ELSE -amount END)
--     FROM customer_credit_ledger
--    WHERE client_id = $1 AND is_active;
--
-- Plus trigger to maintain invoices.credits_applied as a denormalized SUM.
--
-- Companion: docs/invoice-rewrite-plan.md

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
  id                  text PRIMARY KEY,
  client_id           text NOT NULL REFERENCES clients(id),
  transaction_date    date NOT NULL,
  transaction_type    text NOT NULL CHECK (transaction_type IN (
                        'overpayment',
                        'manual_credit',
                        'applied_to_invoice',
                        'refunded',
                        'written_off'
                      )),
  amount              numeric NOT NULL CHECK (amount > 0),
  related_invoice_id  text REFERENCES invoices(id),
  -- (related_payment_id removed 2026-05-27 along with the customer_payments
  -- table. Overpayment-to-credit flow has no UI today; if/when re-added,
  -- a related_invoice_payment_id text REFERENCES invoice_payments(id) can
  -- ship at that time.)
  refund_reference    text,                  -- check #, etc., when type='refunded'
  refund_memo         text,                  -- what was on the memo line
  refund_date         date,
  notes               text,                  -- internal AES notes
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid
);

CREATE INDEX IF NOT EXISTS customer_credit_ledger_client_idx
  ON customer_credit_ledger(client_id);
CREATE INDEX IF NOT EXISTS customer_credit_ledger_invoice_idx
  ON customer_credit_ledger(related_invoice_id) WHERE related_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_credit_ledger_date_idx
  ON customer_credit_ledger(transaction_date);

ALTER TABLE customer_credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_credit_ledger_full_access" ON customer_credit_ledger;
CREATE POLICY "customer_credit_ledger_full_access"
  ON customer_credit_ledger FOR ALL USING (true);

DROP TRIGGER IF EXISTS customer_credit_ledger_audit_trg ON customer_credit_ledger;
CREATE TRIGGER customer_credit_ledger_audit_trg
  BEFORE INSERT OR UPDATE ON customer_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Maintain invoices.credits_applied ───────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_invoice_credits_applied()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_invoice_id text;
BEGIN
  v_invoice_id := COALESCE(NEW.related_invoice_id, OLD.related_invoice_id);
  IF v_invoice_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  UPDATE invoices SET credits_applied = COALESCE((
    SELECT SUM(amount)
      FROM customer_credit_ledger
     WHERE related_invoice_id = v_invoice_id
       AND transaction_type = 'applied_to_invoice'
       AND is_active
  ), 0)
  WHERE id = v_invoice_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS customer_credit_ledger_refresh_credits_applied ON customer_credit_ledger;
CREATE TRIGGER customer_credit_ledger_refresh_credits_applied
  AFTER INSERT OR UPDATE OR DELETE ON customer_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION refresh_invoice_credits_applied();
