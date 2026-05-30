-- Auto-flip invoice status to/from 'paid' based on paid_amount coverage.
--
-- Replaces the manual "Mark Paid" button workflow now that we record
-- real payments (date, method, amount, ref #) via the customer_payments
-- + payment_allocations tables. The denormalized invoices.paid_amount
-- is maintained by existing triggers in 20260506e; this trigger turns
-- those changes into a status transition.
--
-- Rules:
--   * When a non-draft, non-superseded, non-void invoice's paid_amount
--     covers (subtotal − deposit_applied − credits_applied), status
--     flips to 'paid' and paid_at = now(). Works from 'issued' or
--     'sent' — partial-sent skip is fine.
--   * When paid_amount later drops below that threshold (payment
--     voided, allocation amount reduced), status flips back to
--     'sent' if sent_at is set, else 'issued'. paid_at cleared.
--   * Only fires when paid_amount actually changed — no infinite loop
--     from the trigger updating the same row.
--   * Skips drafts and terminal states (superseded, void).
--
-- Freeze trigger in 20260506d explicitly allows status + paid_at +
-- paid_amount to change on frozen invoices, so this doesn't fight it.

CREATE OR REPLACE FUNCTION auto_paid_status_on_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_billable numeric;
BEGIN
  -- Only react to paid_amount changes.
  IF NEW.paid_amount IS NOT DISTINCT FROM OLD.paid_amount THEN
    RETURN NEW;
  END IF;

  -- Don't touch drafts or terminal states.
  IF NEW.is_draft
     OR NEW.status IN ('superseded', 'void') THEN
    RETURN NEW;
  END IF;

  v_billable := COALESCE(NEW.subtotal, 0)
              - COALESCE(NEW.deposit_applied, 0)
              - COALESCE(NEW.credits_applied, 0);

  -- Going to paid: payments now cover (or exceed) the billable amount.
  IF COALESCE(NEW.paid_amount, 0) >= v_billable
     AND NEW.status IS DISTINCT FROM 'paid'
     AND v_billable > 0 THEN
    NEW.status   := 'paid';
    NEW.paid_at  := COALESCE(NEW.paid_at, now());
    RETURN NEW;
  END IF;

  -- Coming back from paid: payments no longer cover the billable amount.
  IF COALESCE(NEW.paid_amount, 0) < v_billable
     AND NEW.status = 'paid' THEN
    NEW.status  := CASE WHEN NEW.sent_at IS NOT NULL THEN 'sent' ELSE 'issued' END;
    NEW.paid_at := NULL;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_auto_paid_status_trg ON invoices;
CREATE TRIGGER invoices_auto_paid_status_trg
  BEFORE UPDATE OF paid_amount ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_paid_status_on_invoice();

-- Smoke test: confirm the trigger installed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'invoices_auto_paid_status_trg'
      AND tgrelid = 'invoices'::regclass
  ) THEN
    RAISE EXCEPTION 'invoices_auto_paid_status_trg did not install';
  END IF;
END $$;
