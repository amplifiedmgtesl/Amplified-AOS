# Invoice Rewrite — Build Plan (Phase C)

**Status:** Designed; ready to execute on `dev`. Prod deferred until both quote + invoice rewrites are complete (per standing user instruction).
**Date drafted:** 2026-05-06
**Companion docs:**
- [quote-rewrite-plan.md](quote-rewrite-plan.md) — Phase A (shipped to dev)
- [system-flow-rewrite.md](system-flow-rewrite.md) — overall architecture
- `feedback_audit_column_convention.md` — naming standard
- `feedback_attachment_storage_pattern.md` — attachment shape

---

## What this rewrite solves

1. **Same overwrite bug class as quotes.** `invoice_no` is `INV-{YYYY}-{MMDD}-{rand 100-999}` with no DB-enforced uniqueness, no FK on `invoice.quote_id`, deposit invoice generation appends `-DEP` to existing numbers (already produced `INV-2026-0423-422-DEP-DEP`). The freeze-trigger + `is_draft` boolean + sequential numbering pattern from quotes applies here too.
2. **Cracking open Phase F.** Final invoices need to bill *actuals* (timesheet entries) not just quoted amounts. Schema must accept either source. Phase C ships with quote-driven; Phase F adds the timesheet path.
3. **Real payment + credit accounting.** Today's `invoices.paid_amount` is a single number; no detail of how/when paid, can't track multi-invoice payments, no overpayment handling, no customer credits. We add proper `customer_payments` + `payment_allocations` + `customer_credit_ledger`.
4. **Multi-invoice jobs.** Per-day finals are real (3-day events billed daily). Schema needs `covered_dates` and re-invoicing prevention.
5. **Retires the legacy `invoice-builder.tsx`** — last reader of the deferred-drop columns on `quotes`. Once retired, those columns drop too.

---

## Locked decisions

Everything ratified in design discussion. No open questions.

| # | Decision |
|---|---|
| 1 | **Number format:** same as quotes — `AES_YYMMDDDD_CLI_EVENT_INV` for finals, `_DEP` for deposits, `_REV{N}` for revisions. |
| 2 | **Deposit and final are separate invoice rows** (different `invoice_type`). Linked by `job_request_id`, not by an FK between them. |
| 3 | **Void is its own status** distinct from supersede. Voided rows are immutable, excluded from billing reports, audit-visible. |
| 4 | **Final-invoice line source: design schema for both, ship Phase C with always-quote-derived.** Phase F flips on timesheet-driven via `source_kind` discriminator. |
| 5 | **One-time draft creation source:** the user picks "Generate Deposit" or "Generate Final" on a frozen quote. Both paths seed the draft from quote_lines. |
| 6 | **"Overwrite from Timesheets" button on a draft** — replaces draft lines with timesheet aggregates. Tracked via `source_kind`. Available from Phase C, but only meaningful once Phase F adds approved-entry workflow. |
| 7 | **Multi-day invoice support:** `invoices.covered_dates date[]` column. NULL = whole job. |
| 8 | **Re-invoicing prevention:** `invoice_lines.source_quote_line_id` and `source_timesheet_entry_id` FKs make double-billing structurally impossible. UI lists already-billed lines as unavailable. |
| 9 | **Per-job uniqueness:** partial unique indices enforce one active deposit per job and one active whole-job final per job. Per-day finals (covered_dates IS NOT NULL) have their own enforcement via the source_quote_line_id check. |
| 10 | **Deposit credit allocation:** `invoices.deposit_applied numeric` — admin chooses how much of the deposit credit to apply per final invoice. UI defaults to MIN(deposit_remaining, subtotal) but allows manual override. |
| 11 | **Multi-invoice payments:** one `customer_payments` row per real-world receipt; many-to-one `payment_allocations` distribute across invoices. Reference number, memo, and notes are three separate fields (rail identifier, customer-written memo, internal notes). |
| 12 | **Overpayment + customer credit:** `customer_credit_ledger` tracks credits per client. Excess payment → credit; credit can be applied to future invoices, refunded, or written off. Explicit "Apply Credit" action — no auto-apply. |
| 13 | **No negative invoices.** Refunds + credit are tracked through the ledger, not as negative-amount invoices. Formal credit memo as a printable document deferred to Phase C+. |
| 14 | **Status enum:** `('issued','sent','paid','superseded','void')`. NULL while `is_draft=true`. |
| 15 | **PDF design mirrors quote PDF** — same letterhead, bill-to, event details, daily breakdown, pricing summary, terms, signatures. Adds a "Source quote" reference in the metadata block. |
| 16 | **Fully copy from quote at draft creation** — including terms, deposit_pct, signature blocks. Each invoice has its own version frozen at issue. |
| 17 | **`amount_paid` is denormalized** — maintained by trigger from `payment_allocations` for fast display. Status auto-flips from `sent → paid` when the math zeros out. |
| 18 | **Recovery linking:** `link_orphan_invoice` RPC mirrors the orphan-quote pattern for legacy/recovered rows. |

---

## Schema changes

### Migration 1: Extend `invoices` table

```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_draft           boolean NOT NULL DEFAULT true;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type       text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS parent_invoice_id  text REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revision_no        int  NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS job_request_id     text REFERENCES job_requests(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_quote_id    text REFERENCES quotes(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_quote_code  text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS covered_dates      date[];
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deposit_applied    numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credits_applied    numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid        numeric NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_at          timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issued_by          uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at            timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_by            uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at            timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_by            uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS superseded_at      timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS superseded_by      uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason        text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at          timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_by          uuid;

-- Standard audit (set_audit_columns trigger)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Pre-flight: audit existing status values; map to enum.
SELECT status, count(*) FROM invoices GROUP BY status ORDER BY status;

-- Normalize status. (Audit results determine the mapping; common values: 'draft','sent','paid'.)
UPDATE invoices SET status = 'sent'   WHERE status IN ('issued','quoted');  -- adjust per audit
UPDATE invoices SET is_draft = false  WHERE status IN ('sent','paid','superseded','void');
UPDATE invoices SET is_draft = true,  status = NULL WHERE status = 'draft';

-- CHECK constraints
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD  CONSTRAINT invoices_status_check
  CHECK (status IS NULL OR status IN ('issued','sent','paid','superseded','void'));
ALTER TABLE invoices ADD  CONSTRAINT invoices_draft_status_consistency
  CHECK (
    (is_draft = true  AND status IS NULL) OR
    (is_draft = false AND status IN ('issued','sent','paid','superseded','void'))
  );
ALTER TABLE invoices ADD  CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IS NULL OR invoice_type IN ('deposit','final'));

-- Indices
CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_no_idx
  ON invoices(invoice_no) WHERE invoice_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_active_deposit_per_job
  ON invoices(job_request_id)
  WHERE invoice_type = 'deposit'
    AND status NOT IN ('superseded','void')
    AND job_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_active_wholejob_final_per_job
  ON invoices(job_request_id)
  WHERE invoice_type = 'final'
    AND status NOT IN ('superseded','void')
    AND covered_dates IS NULL
    AND job_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoices_job_request_id_idx ON invoices(job_request_id);
CREATE INDEX IF NOT EXISTS invoices_source_quote_id_idx ON invoices(source_quote_id);

-- Standard audit trigger
DROP TRIGGER IF EXISTS invoices_audit_trg ON invoices;
CREATE TRIGGER invoices_audit_trg
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Backfill source_quote_id from existing text quote_id (where target exists)
UPDATE invoices i
   SET source_quote_id = i.quote_id
  FROM quotes q
 WHERE i.source_quote_id IS NULL
   AND i.quote_id = q.id;

-- Backfill job_request_id from the source quote's job_request_id
UPDATE invoices i
   SET job_request_id = q.job_request_id
  FROM quotes q
 WHERE i.source_quote_id = q.id
   AND i.job_request_id IS NULL
   AND q.job_request_id IS NOT NULL;
```

### Migration 2: Extend `invoice_lines`

```sql
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS source_kind text
  CHECK (source_kind IS NULL OR source_kind IN ('quote_line','timesheet_entry','manual_override'));
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS source_quote_line_id      text REFERENCES quote_lines(id);
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS source_timesheet_entry_id text REFERENCES timesheet_entries(id);

CREATE INDEX IF NOT EXISTS invoice_lines_source_quote_line_idx
  ON invoice_lines(source_quote_line_id) WHERE source_quote_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS invoice_lines_source_timesheet_idx
  ON invoice_lines(source_timesheet_entry_id) WHERE source_timesheet_entry_id IS NOT NULL;
```

### Migration 3: Freeze trigger on `invoices` + `invoice_lines`

Mirrors `quotes_freeze_check`. Allows status transitions, `sent_at/by`, `paid_at/by`, `superseded_at/by`, `voided_at/by/void_reason`, `amount_paid`, `deposit_applied`, `credits_applied`, audit columns. Blocks everything else when `is_draft=false`.

Plus the orphan-link relaxation: NULL → non-NULL allowed for both `job_request_id` and `source_quote_id` (one-time adoption). Re-parenting blocked.

### Migration 4: `customer_payments` + `payment_allocations` + amount_paid trigger

```sql
CREATE TABLE customer_payments (
  id                text PRIMARY KEY,
  client_id         text NOT NULL REFERENCES clients(id),
  payment_date      date NOT NULL,
  payment_method    text NOT NULL CHECK (payment_method IN (
                      'check','ach','credit_card','cash','wire',
                      'zelle','venmo','money_order','other'
                    )),
  payment_amount    numeric NOT NULL CHECK (payment_amount > 0),
  reference_number  text,
  memo              text,
  received_date     date,
  received_by       uuid,
  deposited_date    date,
  deposited_by      uuid,
  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at, updated_at, created_by, updated_by
);

CREATE INDEX customer_payments_client_id_idx ON customer_payments(client_id);
CREATE INDEX customer_payments_payment_date_idx ON customer_payments(payment_date);

ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_payments_full_access" ON customer_payments FOR ALL USING (true);
CREATE TRIGGER customer_payments_audit_trg
  BEFORE INSERT OR UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

CREATE TABLE payment_allocations (
  id              text PRIMARY KEY,
  payment_id      text NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
  invoice_id      text NOT NULL REFERENCES invoices(id),
  amount          numeric NOT NULL CHECK (amount > 0),
  allocated_date  date NOT NULL DEFAULT CURRENT_DATE,
  notes           text,
  created_at, updated_at, created_by, updated_by
);

CREATE INDEX payment_allocations_payment_id_idx ON payment_allocations(payment_id);
CREATE INDEX payment_allocations_invoice_id_idx ON payment_allocations(invoice_id);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_allocations_full_access" ON payment_allocations FOR ALL USING (true);
CREATE TRIGGER payment_allocations_audit_trg
  BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Constraint: total allocations cannot exceed payment_amount
CREATE OR REPLACE FUNCTION check_payment_overallocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_payment_amount numeric;
  v_allocated_total numeric;
BEGIN
  SELECT payment_amount INTO v_payment_amount FROM customer_payments WHERE id = NEW.payment_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_allocated_total
    FROM payment_allocations WHERE payment_id = NEW.payment_id AND id <> COALESCE(NEW.id, '');
  IF v_allocated_total + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION 'Payment over-allocation: trying to allocate %, but payment total is % with % already allocated.',
      NEW.amount, v_payment_amount, v_allocated_total;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_allocations_overallocation_trg
  BEFORE INSERT OR UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION check_payment_overallocation();

-- Maintain invoice.amount_paid as denormalized SUM
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
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_allocations_refresh_amount_paid
  AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION refresh_invoice_amount_paid();

-- Also refresh when customer_payments.is_active flips
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
CREATE TRIGGER customer_payments_refresh_amount_paid
  AFTER UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION refresh_invoice_amount_paid_from_payment();
```

### Migration 5: `customer_credit_ledger`

```sql
CREATE TABLE customer_credit_ledger (
  id                text PRIMARY KEY,
  client_id         text NOT NULL REFERENCES clients(id),
  transaction_date  date NOT NULL,
  transaction_type  text NOT NULL CHECK (transaction_type IN (
                      'overpayment','manual_credit','applied_to_invoice','refunded','written_off'
                    )),
  amount            numeric NOT NULL CHECK (amount > 0),
  related_invoice_id  text REFERENCES invoices(id),
  related_payment_id  text REFERENCES customer_payments(id),
  refund_reference  text,                   -- check #, etc., when type='refunded'
  refund_memo       text,                   -- what the customer wrote / what we wrote on the refund
  refund_date       date,
  notes             text,                   -- internal AES notes
  is_active         boolean NOT NULL DEFAULT true,
  created_at, updated_at, created_by, updated_by
);

CREATE INDEX customer_credit_ledger_client_idx ON customer_credit_ledger(client_id);
CREATE INDEX customer_credit_ledger_invoice_idx ON customer_credit_ledger(related_invoice_id);

ALTER TABLE customer_credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_credit_ledger_full_access" ON customer_credit_ledger FOR ALL USING (true);
CREATE TRIGGER customer_credit_ledger_audit_trg
  BEFORE INSERT OR UPDATE ON customer_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Maintain invoice.credits_applied
CREATE OR REPLACE FUNCTION refresh_invoice_credits_applied()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_invoice_id text;
BEGIN
  v_invoice_id := COALESCE(NEW.related_invoice_id, OLD.related_invoice_id);
  IF v_invoice_id IS NULL THEN RETURN NEW; END IF;
  UPDATE invoices SET credits_applied = COALESCE((
    SELECT SUM(amount)
      FROM customer_credit_ledger
     WHERE related_invoice_id = v_invoice_id
       AND transaction_type = 'applied_to_invoice'
       AND is_active
  ), 0)
  WHERE id = v_invoice_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER customer_credit_ledger_refresh_credits_applied
  AFTER INSERT OR UPDATE OR DELETE ON customer_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION refresh_invoice_credits_applied();
```

### Migration 6: RPCs

- `issue_invoice_draft(p_invoice_id text)` — mirrors `issue_quote_draft`. Computes `invoice_no` from job's job_no + suffix (`_INV`, `_DEP`, `_REV{N}`). Snapshots event info. Supersedes parent on revisions.
- `link_orphan_invoice(p_invoice_id text, p_source_quote_id text, p_job_request_id text)` — adopts a legacy orphan invoice to a quote + job. Recomputes invoice_no.
- `record_customer_payment(...)` — server-side helper that inserts customer_payment + allocations atomically + handles overpayment routing (credit ledger / refund placeholder).
- `apply_credit_to_invoice(p_client_id text, p_invoice_id text, p_amount numeric)` — atomic: ledger entry `applied_to_invoice` -amount + credit balance check.

### Deferred drops (Migration 7+)

Once invoice-builder.tsx is retired, the legacy quote columns can drop:
```sql
ALTER TABLE quotes DROP COLUMN IF EXISTS linked_job_request_id;   -- replaced by FK
ALTER TABLE quotes DROP COLUMN IF EXISTS linked_job_sheet_id;     -- job_sheets phasing out
ALTER TABLE quotes DROP COLUMN IF EXISTS timesheet_summary;       -- recompute live
ALTER TABLE quotes DROP COLUMN IF EXISTS start_time;              -- read live from job
ALTER TABLE quotes DROP COLUMN IF EXISTS end_time;                -- read live from job
ALTER TABLE quotes DROP COLUMN IF EXISTS lines;                   -- (already dropped, verify)
```

Plus invoice equivalents that mirror what we did to quote_lines:
```sql
ALTER TABLE invoices       DROP COLUMN IF EXISTS lines;            -- jsonb, replaced by invoice_lines
ALTER TABLE invoices       DROP COLUMN IF EXISTS expected_hours_per_day;
ALTER TABLE invoices       DROP COLUMN IF EXISTS linked_job_sheet_id;
ALTER TABLE invoices       DROP COLUMN IF EXISTS timesheet_summary;
ALTER TABLE invoice_lines  DROP COLUMN IF EXISTS department;
ALTER TABLE invoice_lines  DROP COLUMN IF EXISTS specialty;
ALTER TABLE invoice_lines  DROP COLUMN IF EXISTS position_id;
```

---

## Code module map

### New modules

- **`lib/store/invoices.ts`** — single source of truth for invoice CRUD. Mirrors `lib/store/quotes.ts`:
  - `loadInvoices(filters)` — list with status/client/job filters, default hides superseded
  - `loadInvoice(id)` — full record + lines + payments
  - `createDepositDraftFromQuote(quoteId)` — picks deposit_pct, copies relevant lines × pct
  - `createFinalDraftFromQuote(quoteId, opts: { coveredDates?: string[] })` — copies lines for chosen days, excludes already-billed lines
  - `overwriteFromTimesheets(invoiceId)` — pulls approved timesheet entries, replaces lines, sets `source_kind='timesheet_entry'`
  - `saveDraft(invoice)` — upsert + sync lines
  - `issueDraft(invoiceId)` — calls RPC
  - `markSent(invoiceId)`, `markPaid(invoiceId)`, `voidInvoice(invoiceId, reason)` — narrow status updates
  - `reviseInvoice(invoiceId)` — clones into new draft with parent_invoice_id
  - `linkOrphan(invoiceId, quoteId, jobRequestId)`
  - `displayStatus(invoice)`

- **`lib/store/customer-payments.ts`** — payment recording + allocation
  - `recordPayment({ clientId, paymentDate, paymentMethod, paymentAmount, referenceNumber, memo, ... }, allocations: [{ invoiceId, amount }])` — atomic via RPC
  - `loadPaymentsForClient(clientId)` — list of payments
  - `loadPaymentsForInvoice(invoiceId)` — via allocation join
  - `editPayment(paymentId, patch)`, `deactivatePayment(paymentId)`

- **`lib/store/customer-credits.ts`** — credit ledger reads + writes
  - `loadCreditLedger(clientId)` — chronological ledger
  - `getAvailableCredit(clientId)` — running balance
  - `applyCreditToInvoice(clientId, invoiceId, amount)` — calls RPC
  - `recordRefund({ clientId, amount, refundDate, referenceNumber, refundMemo, notes })` — ledger entry
  - `recordWriteoff({ clientId, amount, notes })`

### UI / route map

```
/invoices                       → unified list (drafts + frozen, status filter, client filter)
/invoices/[id]                  → frozen detail (read-only) — Print/PDF, Mark Sent, Mark Paid, Revise, Void, Apply Credit
/invoices/[id]/edit             → draft editor — line items, deposit_applied, Issue, Delete, Overwrite from Timesheets
/invoices/[id]/pdf              → print-ready PDF view (mirrors quote-pdf-view)
/clients/[id]/account           → client account page — credit balance, ledger, outstanding invoices, all payments

Updates to existing routes:
/quotes/[id]                    → frozen quote detail gets back: "Generate Deposit Invoice" + "Generate Final Invoice" buttons
                                  (gated: deposit button hides if active deposit exists; final button shows day picker for multi-day jobs)
```

### Cleanup — keep legacy invoice-builder accessible during transition

Mirroring the quote rewrite's transitional approach: **don't delete the legacy
builder yet** — hide it from primary nav but keep the route functional in case
we need to refer back during the transition (verifying behavior, recovering edits
that didn't make it through, etc.). After the new flow has been live and stable
for a while, the cleanup pass deletes it.

- `components/shared/invoice-builder.tsx` — **kept** as `/invoice-builder` route
- `app/invoices/page.tsx` → swapped to render `<InvoicesList />` (the new unified list)
- `app/invoice-builder/page.tsx` — **new file** (or rename existing) that exposes the legacy builder behind a less-prominent URL
- Nav: "Invoices" points to `/invoices` (new); "Invoice Builder (legacy)" added briefly to nav for transition, removed once confidence is high
- `db.ts` invoice-shaped functions: **kept** during transition since the legacy builder reads them. Final delete happens in a follow-up cleanup pass mirroring the quote one (PASS 2 cleanup, after invoice rewrite has shipped and been stable).
- `app-store.ts` invoice re-exports: same — kept during transition.

### What stays unchanged

- Rate card profiles + rows — already in good shape
- Quote PDF rendering — provides the visual template; invoice PDF cribs from it
- Calendar event sync, etc.

---

## Workflows

### 1. Generate deposit invoice from a quote

1. User on frozen quote detail → "Generate Deposit Invoice" button
2. Confirms: "Create a deposit invoice at {deposit_pct}% × ${total} = ${deposit}? Continue?"
3. `createDepositDraftFromQuote(quoteId)` runs — creates draft invoice with:
   - `invoice_type='deposit'`, `is_draft=true`
   - One line: "Deposit (50% of $X)" with amount = deposit
   - OR copy quote lines × deposit_pct (per-line approach)
   - `source_quote_id`, `job_request_id` populated
4. Redirects to `/invoices/[newId]/edit`
5. User reviews, optionally edits notes / tweaks amount, clicks Issue → frozen with `_DEP` suffix

### 2. Generate final invoice from a quote (whole job)

1. User on frozen quote detail → "Generate Final Invoice" → confirms
2. `createFinalDraftFromQuote(quoteId, {})` — creates draft with:
   - `invoice_type='final'`, `is_draft=true`, `covered_dates=NULL`
   - All quote_lines copied as invoice_lines with `source_kind='quote_line'` + `source_quote_line_id`
   - Excludes any quote_lines already billed on a non-superseded final
   - `deposit_applied` defaults to MIN(deposit_credit_remaining, subtotal); user can edit
3. Redirects to draft editor

### 3. Generate per-day final invoice

1. On frozen quote with multiple days → "Generate Final for Selected Days"
2. Modal with day checklist; greyed-out days are already billed (with link to billing invoice)
3. User picks days, clicks Generate
4. `createFinalDraftFromQuote(quoteId, { coveredDates: [picked] })` — same as #2 but lines filtered to chosen dates, `covered_dates=[picked]`

### 4. Overwrite from timesheets

1. On invoice draft → "Overwrite from Timesheets"
2. Confirm: "Replace lines with timesheet actuals for {covered days or all}? This loses any manual edits."
3. Server aggregates timesheet_entries by (date × position_id × specialty_id), creates new invoice_lines with `source_kind='timesheet_entry'`
4. Quote-derived lines without matching timesheet entries are dropped
5. Timesheet entries without matching quote_line rows are added
6. User reviews

### 5. Record a customer payment

1. From client account page → "Record Payment" OR from a specific invoice → "Record Payment"
2. Form: date, method, amount, reference, memo, internal notes, optional received/deposited dates+by
3. Allocation step (when client has multiple outstanding invoices):
   - Default: pre-populate first outstanding invoice with full payment amount (or invoice's balance, whichever is less)
   - User can rebalance across invoices
   - Unallocated amount → "Hold as credit" (default) or "Refund"
4. Save → creates customer_payments + payment_allocations + (optional) customer_credit_ledger entries

### 6. Apply credit to an invoice

1. On frozen invoice with positive client credit balance → "Apply Customer Credit" button
2. Modal: "Available credit: $X. Apply how much to this invoice (max $Y based on balance due)? [_____]"
3. Confirm → ledger entry `applied_to_invoice -amount` + invoice's `credits_applied` updates → balance recomputes

### 7. Refund a credit

1. From client account page → ledger row with positive overpayment balance → "Issue Refund" button
2. Form: amount, refund date, reference (check #), refund memo (what to write in memo), notes
3. Save → ledger entry `refunded -amount` with reference fields populated
4. The actual outgoing check is processed offline; the system just records it

### 8. Void an invoice

1. On frozen invoice → "Void" button (with warning copy if status is `paid` — "This invoice was paid; voiding implies refund. Continue?")
2. Modal: void reason, confirm
3. Status flips to `void`, voided_at/by set, void_reason saved
4. Voided invoices excluded from billing reports; visible in audit views

---

## PDF rendering

`components/shared/invoice-pdf-view.tsx` — copy `quote-pdf-view.tsx` with these adjustments:

- Title: "INVOICE" (or "DEPOSIT INVOICE" / "FINAL INVOICE" based on `invoice_type`)
- Metadata block adds: `Source quote: <quote_no>` (linked to `/quotes/{source_quote_id}` digitally; printed as text)
- Pricing summary at top + bottom shows: Subtotal / Deposit Applied / Credits Applied / Amount Paid / **Balance Due**
- "Pay To" block in addition to "Bill To" — uses `company_settings` for AES remit-to address
- Payment instructions block (optional text from `company_settings`)
- Signature block: customer signature only (no AES counter-signature on invoices typically)
- Same letterhead, same day-grouped lines, same terms, same draft watermark

---

## Rollout sequence

1. **Pre-flight queries** on dev (status audit, orphan-link audit, recovered-invoice audit)
2. **Migrations 1–6 to dev** in order. Status normalization step adapts to pre-flight results.
3. **New code shipped to dev branch** — `lib/store/invoices.ts`, customer-payments, customer-credits modules + UI components/routes
4. **Smoke tests** on Preview (verification list below)
5. **Cleanup**: retire `invoice-builder.tsx`, drop legacy db.ts/app-store.ts invoice functions
6. **Deferred-drop migration** for the legacy quote columns + invoice columns
7. **Repair migration** for any inconsistent existing invoice data (similar to the quote totals repair)
8. **Update memory notes** — mark migrations as queued for prod batch
9. **Prod replay** — when the user gives the go-ahead. All dev work bundles for one big release.

---

## Verification checklist (smoke tests)

- [ ] Generate deposit invoice from quote → frozen with `_DEP` suffix; deposit_applied carries through
- [ ] Generate final invoice (whole job) → frozen with `_INV`; lines from quote with source_quote_line_id set
- [ ] Generate per-day final → covered_dates populated, lines filtered correctly
- [ ] Try to generate a second whole-job final on same job → blocked by partial unique index
- [ ] Try to bill a quote_line already on another final → excluded from picker / blocked at insert
- [ ] Overwrite from timesheets → lines flip to `source_kind='timesheet_entry'`; new lines added for crew without quote rows; missing-actuals lines dropped
- [ ] Record customer payment → allocation across multiple invoices works, sum check enforced
- [ ] Over-allocate via direct SQL → trigger blocks
- [ ] Overpayment → modal routes excess to credit ledger; credit balance increments
- [ ] Apply credit to invoice → balance_due drops by applied amount; ledger entry created
- [ ] Refund credit → ledger entry with reference + memo + date
- [ ] Mark Sent → status flips, sent_at populated
- [ ] Mark Paid (via payment that zeros balance) → status auto-flips to paid
- [ ] Void invoice → status=void, immutable thereafter
- [ ] Revise issued invoice → new draft, parent superseded on issue, `_REV1` suffix
- [ ] Try to UPDATE frozen invoice content via dashboard → freeze trigger errors
- [ ] Link orphan invoice to quote+job → invoice_no recomputes, page reloads with new value
- [ ] Print PDF includes all the right sections + balance due reflects reality
- [ ] Client account page shows ledger + outstanding invoices + credit balance correctly
- [ ] Apply Credit button hidden when client has $0 credit
- [ ] Generate Deposit button hidden when active deposit exists for the job

---

## Out of scope (explicit)

- Tax / VAT line items
- Multi-currency
- Recurring invoices / subscriptions
- Stripe / ACH payment processing integration (entry-only for now)
- Formal credit memo as a printable document (Phase C+)
- Customer account statement PDF (Phase C+)
- Bad-debt write-off categorization with reporting
- AP-side outbound check register
- Tax form generation (1099-NEC etc.)
- Phase B: `job_requests → jobs` rename
- Phase D: shifts normalization
- Phase E: client_contacts multi-contact

---

## Critical files

**New:**
- `lib/store/invoices.ts`
- `lib/store/customer-payments.ts`
- `lib/store/customer-credits.ts`
- `components/shared/invoices-list.tsx`
- `components/shared/invoice-detail.tsx`
- `components/shared/invoice-draft-editor.tsx`
- `components/shared/invoice-pdf-view.tsx`
- `components/shared/customer-payment-form.tsx`
- `components/shared/client-account-view.tsx`
- `app/invoices/page.tsx`, `app/invoices/[id]/page.tsx`, `app/invoices/[id]/edit/page.tsx`, `app/invoices/[id]/pdf/page.tsx`
- `app/clients/[id]/account/page.tsx`
- `supabase/migrations/2026050{6b,...}_*.sql` — six forward migrations + deferred drops

**Updated:**
- `components/shared/quote-detail.tsx` — restore Generate Deposit + Generate Final buttons
- `components/shared/quotes-list.tsx` — show "has deposit / has final" indicators per quote
- `components/layout/app-shell.tsx` — Invoices nav already exists; verify

**Deleted (after new flow ships):**
- `components/shared/invoice-builder.tsx`
- `lib/store/db.ts` invoice functions
- `lib/store/app-store.ts` invoice re-exports
