-- Auto-release timesheet_entries from invoice lines when the parent
-- invoice transitions to superseded/void.
--
-- Why: the "already billed" check used by overwriteFromTimesheets needs to
-- treat entries on inactive invoices as available again so a revised
-- invoice can re-pull them. The previous implementation tried to express
-- this as a nested-foreignTable OR-filter in PostgREST — brittle and silent
-- when wrong. By unlinking at the lifecycle transition we collapse the
-- "available" check to a single `WHERE invoice_line_id IS NOT NULL`,
-- structurally simple and impossible to get wrong.
--
-- Trade-off accepted (per design discussion 2026-05-27): once an invoice is
-- superseded, the entry-to-line back-pointer is gone. The line itself still
-- exists on the superseded invoice with all its hours/crew/total, so the
-- customer-visible record is preserved. We're only losing "which physical
-- entries fed line 3 of this old invoice." That's never been a business
-- need; supersedes are deliberate corrections, not forensic events.
--
-- Existing freeze trigger on timesheet_entries explicitly allows changes to
-- invoice_line_id on approved rows (see 20260525d_timesheet_entries_freeze.sql
-- line 9 — "invoice_line_id (the Pull-Actuals flow writes this AFTER
-- approval)"). So this UPDATE doesn't fight that protection.

CREATE OR REPLACE FUNCTION release_entries_on_invoice_lifecycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('superseded', 'void')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE timesheet_entries
       SET invoice_line_id = NULL
     WHERE invoice_line_id IN (
       SELECT id FROM invoice_lines WHERE invoice_id = NEW.id
     );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_release_entries_trg ON invoices;
CREATE TRIGGER invoices_release_entries_trg
  AFTER UPDATE OF status ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION release_entries_on_invoice_lifecycle();

-- One-time backfill: clear invoice_line_id on entries currently linked to
-- lines of already-superseded/void invoices. The trigger covers all FUTURE
-- transitions; this handles whatever state the data is in today.
UPDATE timesheet_entries
   SET invoice_line_id = NULL
 WHERE invoice_line_id IN (
   SELECT il.id
     FROM invoice_lines il
     JOIN invoices i ON i.id = il.invoice_id
    WHERE i.status IN ('superseded', 'void')
 );

-- Smoke test: confirm the trigger is installed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'invoices_release_entries_trg'
      AND tgrelid = 'invoices'::regclass
  ) THEN
    RAISE EXCEPTION 'invoices_release_entries_trg did not install';
  END IF;
END $$;
