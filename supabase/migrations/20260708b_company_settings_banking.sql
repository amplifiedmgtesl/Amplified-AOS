-- Banking / remittance fields for the company_settings singleton.
--
-- Connor is paid by clients via ACH and wire transfer, so the invoice
-- "Remit Payment To" block needs the bank details a client uses to pay.
-- These are added to the existing singleton row (see 20260505a) and edited
-- in the Maintenance > Company Settings screen; they print on invoice PDFs.
--
-- Field notes:
--   bank_routing_number       ACH / ABA routing (9 digits) — used for ACH.
--   bank_wire_routing_number  Some banks use a *different* ABA for wires;
--                             leave blank if the ACH routing also works.
--   bank_address              Bank's address — required on wire instructions.
--   bank_account_type         'Checking' | 'Savings' (free text, not enforced).

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS bank_name                text,
  ADD COLUMN IF NOT EXISTS bank_account_name        text,
  ADD COLUMN IF NOT EXISTS bank_account_number      text,
  ADD COLUMN IF NOT EXISTS bank_account_type        text,
  ADD COLUMN IF NOT EXISTS bank_routing_number      text,
  ADD COLUMN IF NOT EXISTS bank_wire_routing_number text,
  ADD COLUMN IF NOT EXISTS bank_address             text;
