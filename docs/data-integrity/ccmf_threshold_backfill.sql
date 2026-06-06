-- CCMF Invoice Cleanup — 2026-06-06
--
-- Connor's Carolina Country Music Fest (job_request_id =
-- 'jobreq-1779670159567', client CCMF LLC, rate card
-- 'ratecard-1779807998187') was billed with 8/12 OT-DT splits despite
-- the contract calling for "day rate flat 10 hrs, hourly thereafter,
-- no premium" on build days. Migration 20260606a added per-entry
-- ot_after / dt_after thresholds; this script:
--
--   1. Sets CCMF rate-card rows to ot_after = dt_after = "none"
--      so future entries created from this card carry the no-premium rule.
--   2. Deletes the older duplicate draft invoice entirely. Cascade FK
--      removes its lines; the SET NULL FK on timesheet_entries.invoice_line_id
--      releases any entries that were bound to it.
--   3. Snapshots affected entry IDs for re-approve later.
--   4. Deletes the remaining (current) draft invoice's lines so the
--      bound entries get released too.
--   5. Temporarily transitions affected entries 'approved' → 'submitted'
--      so the freeze trigger's immutable-content check doesn't block.
--   6. Rewrites bill_ot_after = bill_dt_after = 0 and collapses all
--      person-hours into std_hours (matching the contract).
--      Recomputes bill_total per the same rule already used in TS.
--   7. Re-approves the entries.
--
-- After this runs, Connor opens the remaining draft (i-mq1h3qvp-bd8f5xc3)
-- in the invoice builder and clicks "Overwrite from Timesheets". The
-- aggregator will rebuild clean per-day-per-position lines with all
-- hours in the std bucket and zero OT/DT.
--
-- Wrapped in a transaction. To preview, change COMMIT to ROLLBACK at
-- the end; re-run with COMMIT once the row-counts look right.

BEGIN;

-- ─── 0. Scope the remaining draft to days 5/31-6/3 ──────────────────────
-- Without covered_dates, the invoice is a "whole-job final" and the
-- one-per-job constraint would block future progress invoices for
-- 6/4-6/6 and 6/8-6/10. Setting covered_dates makes it a per-day-range
-- final, which is allowed to stack with future per-day-range finals.
UPDATE public.invoices
   SET covered_dates = ARRAY['2026-05-31','2026-06-01','2026-06-02','2026-06-03']::date[]
 WHERE id = 'i-mq1h3qvp-bd8f5xc3';

-- ─── 1. Rate card row thresholds → "none" ───────────────────────────────
UPDATE public.rate_card_profile_rows
   SET ot_after = 'none', dt_after = 'none'
 WHERE profile_id = 'ratecard-1779807998187';

-- ─── 2. Drop the older duplicate draft first ────────────────────────────
-- Cascades to its invoice_lines (FK ON DELETE CASCADE), which in turn
-- SETs NULL on timesheet_entries.invoice_line_id for anything it bound.
DELETE FROM public.invoices
 WHERE id = 'i-mq1bezjs-qaavqxlk';

-- ─── 3. Snapshot entries we'll need to re-approve at the end ────────────
CREATE TEMP TABLE _ccmf_re_approve ON COMMIT DROP AS
  SELECT id FROM public.timesheet_entries
   WHERE job_id = 'jobreq-1779670159567' AND status = 'approved';

-- ─── 4. Delete the current draft's lines — releases its bound entries ───
DELETE FROM public.invoice_lines
 WHERE invoice_id = 'i-mq1h3qvp-bd8f5xc3';

-- ─── 5. Unfreeze: approved → submitted (now allowed; not invoice-bound) ─
UPDATE public.timesheet_entries
   SET status = 'submitted'
 WHERE id IN (SELECT id FROM _ccmf_re_approve);

-- ─── 6. Recompute thresholds + buckets + bill_total ─────────────────────
UPDATE public.timesheet_entries
   SET bill_ot_after = 0,
       bill_dt_after = 0,
       std_hours = total_hours,
       ot_hours  = 0,
       dt_hours  = 0,
       bill_total = ROUND(
         (CASE WHEN is_holiday
               THEN total_hours * bill_std_rate * COALESCE(holiday_multiplier, 2.0)
               ELSE total_hours * bill_std_rate
          END)::numeric, 2)
 WHERE job_id = 'jobreq-1779670159567';

-- ─── 7. Re-approve ──────────────────────────────────────────────────────
UPDATE public.timesheet_entries
   SET status = 'approved'
 WHERE id IN (SELECT id FROM _ccmf_re_approve);

-- ─── 8. Sanity check row counts ─────────────────────────────────────────
DO $$
DECLARE
  approved_count integer;
  pending_count integer;
  draft_count integer;
BEGIN
  SELECT COUNT(*) INTO approved_count
    FROM public.timesheet_entries
   WHERE job_id = 'jobreq-1779670159567' AND status = 'approved';
  SELECT COUNT(*) INTO pending_count
    FROM public.timesheet_entries
   WHERE job_id = 'jobreq-1779670159567' AND status = 'submitted';
  SELECT COUNT(*) INTO draft_count
    FROM public.invoices
   WHERE client_id = 'clt-1779804875904' AND is_draft = true;
  RAISE NOTICE 'CCMF backfill: approved=%, submitted=%, drafts_remaining=%',
    approved_count, pending_count, draft_count;
END $$;

COMMIT;
