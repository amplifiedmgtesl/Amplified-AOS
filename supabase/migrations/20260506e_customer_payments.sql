-- Phase C invoice rewrite — Migration 4: customer payments + allocations.
--
-- Real payments come in once but can cover many invoices (one check, three
-- invoices). Schema:
--   customer_payments     — one row per real-world receipt
--   payment_allocations   — many-to-one breakdown across invoices
--
-- Plus triggers:
--   - over-allocation check: SUM(allocations.amount) <= payment_amount
--   - amount_paid maintenance: invoices.amount_paid kept in sync
--
-- Companion: docs/invoice-rewrite-plan.md

CREATE TABLE IF NOT EXISTS customer_payments (
  id                text PRIMARY KEY,
  client_id         text NOT NULL REFERENCES clients(id),
  payment_date      date NOT NULL,
  payment_method    text NOT NULL CHECK (payment_method IN (
                      'check','ach','credit_card','cash','wire',
                      'zelle','venmo','money_order','other'
                    )),
  payment_amount    numeric NOT NULL CHECK (payment_amount > 0),
  reference_number  text,                  -- check #, CC txn id, Venmo id, etc.
  memo              text,                  -- what the customer wrote (memo line, Venmo note)
  received_date     date,
  received_by       uuid,
  deposited_date    date,
  deposited_by      uuid,
  notes             text,                  -- internal AES notes
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid
);

CREATE INDEX IF NOT EXISTS customer_payments_client_id_idx ON customer_payments(client_id);
CREATE INDEX IF NOT EXISTS customer_payments_payment_date_idx ON customer_payments(payment_date);

ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_payments_full_access" ON customer_payments;
CREATE POLICY "customer_payments_full_access"
  ON customer_payments FOR ALL USING (true);

DROP TRIGGER IF EXISTS customer_payments_audit_trg ON customer_payments;
CREATE TRIGGER customer_payments_audit_trg
  BEFORE INSERT OR UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── payment_allocations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_allocations (
  id              text PRIMARY KEY,
  payment_id      text NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  invoice_id      text NOT NULL REFERENCES invoices(id),
  amount          numeric NOT NULL CHECK (amount > 0),
  allocated_date  date NOT NULL DEFAULT CURRENT_DATE,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid
);

CREATE INDEX IF NOT EXISTS payment_allocations_payment_id_idx ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS payment_allocations_invoice_id_idx ON payment_allocations(invoice_id);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payment_allocations_full_access" ON payment_allocations;
CREATE POLICY "payment_allocations_full_access"
  ON payment_allocations FOR ALL USING (true);

DROP TRIGGER IF EXISTS payment_allocations_audit_trg ON payment_allocations;
CREATE TRIGGER payment_allocations_audit_trg
  BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- ─── Over-allocation guard ───────────────────────────────────────────────────
-- Total allocations against a single payment can never exceed payment_amount.
CREATE OR REPLACE FUNCTION check_payment_overallocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_payment_amount numeric;
  v_allocated_total numeric;
BEGIN
  SELECT payment_amount INTO v_payment_amount
    FROM customer_payments WHERE id = NEW.payment_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_allocated_total
    FROM payment_allocations
   WHERE payment_id = NEW.payment_id
     AND id <> COALESCE(NEW.id, '');
  IF v_allocated_total + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION
      'Payment over-allocation: trying to allocate $%, but payment total is $% with $% already allocated.',
      NEW.amount, v_payment_amount, v_allocated_total;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_allocations_overallocation_trg ON payment_allocations;
CREATE TRIGGER payment_allocations_overallocation_trg
  BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION check_payment_overallocation();

-- ─── Maintain invoices.amount_paid as denormalized SUM ───────────────────────
-- Triggered on every change to allocations + on customer_payments.is_active flip.
CREATE OR REPLACE FUNCTION refresh_invoice_amount_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_invoice_id text;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  UPDATE invoices SET amount_paid = COALESCE((
    SELECT SUM(pa.amount)
      FROM payment_allocations pa
      JOIN customer_payments cp ON cp.id = pa.payment_id
     WHERE pa.invoice_id = v_invoice_id AND cp.is_active
  ), 0)
  WHERE id = v_invoice_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS payment_allocations_refresh_amount_paid ON payment_allocations;
CREATE TRIGGER payment_allocations_refresh_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION refresh_invoice_amount_paid();

-- When a customer_payments row's is_active flips (soft-delete / restore),
-- recompute amount_paid on every invoice that this payment touched.
CREATE OR REPLACE FUNCTION refresh_invoice_amount_paid_from_payment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    UPDATE invoices i
       SET amount_paid = COALESCE((
         SELECT SUM(pa.amount)
           FROM payment_allocations pa
           JOIN customer_payments cp ON cp.id = pa.payment_id
          WHERE pa.invoice_id = i.id AND cp.is_active
       ), 0)
     WHERE i.id IN (SELECT invoice_id FROM payment_allocations WHERE payment_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_payments_refresh_amount_paid ON customer_payments;
CREATE TRIGGER customer_payments_refresh_amount_paid
  AFTER UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION refresh_invoice_amount_paid_from_payment();
