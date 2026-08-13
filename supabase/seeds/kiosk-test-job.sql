-- ─────────────────────────────────────────────────────────────────────────────
-- KIOSK / PHASE 0 TEST JOB — re-seed script (DEV ONLY)
--
-- Job: jobreq-1786821000000 · AES_..._RHI_KIOSK · Rhino Staging
--
-- ⚠ DEV ONLY (project ref ovtbvnfhteqxnyirzctt). Never run against prod.
--
-- Re-runnable: deletes and recreates the job's days, assignments and timesheet
-- every time. The job_requests header is UPDATED, not recreated, so the id stays
-- stable and the references in docs/technical-debt-backlog.md keep working.
-- The ISSUED quote is created once and then left alone — see the note in step 1;
-- it is frozen at the database level and cannot be deleted or edited.
--
-- Day 1 is always TODAY and day 2 tomorrow, computed at run time — nothing to
-- edit. Re-run it on the morning of any test day; the fixture goes stale the
-- moment the clock rolls past midnight, because the kiosk can only punch a day
-- whose window contains now.
--
-- What it deliberately does NOT create: the timesheet. Round 2 has to exercise
-- the import itself — that is what proves Phase 0 still leaves actuals blank and
-- that rows now arrive as 'planned' (#54). Seeding timesheet rows here would
-- skip the very thing under test. Import crew from the Timekeeping screen.
-- ─────────────────────────────────────────────────────────────────────────────

-- Dates live in ONE place: the seed_params view below. Pure SQL (no psql \set)
-- so this runs unchanged through the Supabase Management API /database/query
-- endpoint as well as in the SQL editor.

BEGIN;

-- Dates are DERIVED, not hardcoded: day 1 is always today, day 2 tomorrow.
--
-- They used to be two literals with a "remember to edit these" warning, and the
-- warning did not work — the job was seeded on 2026-08-12 and by the next
-- morning day 1 was YESTERDAY, so the midnight-crossing block could no longer
-- be punched at all. A test fixture that silently expires overnight is worse
-- than one that is obviously wrong.
--
-- America/New_York, not CURRENT_DATE: the DB server is UTC, so re-seeding after
-- 8pm Eastern would roll CURRENT_DATE onto tomorrow and reintroduce the same
-- off-by-one. This matches the zone the kiosk reads from the device clock.
CREATE OR REPLACE TEMP VIEW seed_params AS
  SELECT (now() AT TIME ZONE 'America/New_York')::date       AS day1,
         (now() AT TIME ZONE 'America/New_York')::date + 1   AS day2;

-- ─── 1. Tear down everything derived ────────────────────────────────────────
-- timesheet_captures cascades off timesheet_entries (FK ON DELETE CASCADE).
-- Guard: refuse if anything has been approved or bound to an invoice, because
-- deleting those is a real data-loss action the freeze trigger exists to stop.
DO $$
DECLARE locked int;
BEGIN
  SELECT count(*) INTO locked
  FROM timesheet_entries
  WHERE job_id = 'jobreq-1786821000000'
    AND (status = 'approved' OR invoice_line_id IS NOT NULL);
  IF locked > 0 THEN
    RAISE EXCEPTION
      'Refusing to re-seed: % timesheet entries are approved or invoice-bound. Unlock or unlink them first.', locked;
  END IF;
END $$;

DELETE FROM timesheet_entries WHERE job_id = 'jobreq-1786821000000';
DELETE FROM timesheets        WHERE job_id = 'jobreq-1786821000000';

-- Quotes: DRAFTS only. An issued quote is frozen — quotes_freeze_check() blocks
-- both DELETE and any content change, by design ("Frozen quotes are permanent —
-- supersede via Revise instead"). So the seed cannot recreate one, and must not
-- try: the first version of this script did, and failed on its second run.
-- The insert below is ON CONFLICT DO NOTHING, so an issued quote from an earlier
-- run simply survives — which is the correct outcome, since its content is
-- identical every time. ⚠ Consequence: if the rate card this points at ever
-- changes, this script will NOT repoint it. Supersede it in the app instead.
DELETE FROM quotes WHERE job_request_id = 'jobreq-1786821000000' AND is_draft = true;
DELETE FROM job_request_assignments
  WHERE job_request_day_id IN (SELECT id FROM job_request_days WHERE job_request_id = 'jobreq-1786821000000');
DELETE FROM job_request_crew_needs
  WHERE job_request_day_id IN (SELECT id FROM job_request_days WHERE job_request_id = 'jobreq-1786821000000');
DELETE FROM job_request_days  WHERE job_request_id = 'jobreq-1786821000000';

-- Shifts are date-independent, so they are left in place:
--   shift-kiosktest-loadin (Load In) · shift-kiosktest-show (Show)
INSERT INTO job_request_shifts (id, job_request_id, label, sort_order)
VALUES
  ('shift-kiosktest-loadin', 'jobreq-1786821000000', 'Load In', 0),
  ('shift-kiosktest-show',   'jobreq-1786821000000', 'Show',    1)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- ─── 2. Days ────────────────────────────────────────────────────────────────
-- Day 1 is a TWO-BLOCK day (work → meal → work); day 2 is single-block. The
-- two-block day is what exercises pair 2 everywhere: the kiosk's Block 2, the
-- sign-in sheet header (#47) and the planned-times fallback (#39).
--
-- ⚠ DAY 1 BLOCK 2 CROSSES MIDNIGHT (20:00 → 02:00), on purpose. John, 2026-08-12:
-- "a large percentage of jobs fall into that category," and round 1 never tested
-- one. Block 2 is on day 1 (= today) specifically so it can be PUNCHED at the
-- kiosk and rolled past midnight for real, rather than only looked at.
-- What this exercises, none of which round 1 touched:
--   · computeTimeEntry/inferPairDatesLocal bumping out2 onto the next date
--   · end_date advancing to day+1 while work_date stays day 1
--   · formatClockRange printing "8:00 PM – 2:00 AM" with no next-day marker
--   · the kiosk's work-day selector once the device clock is past midnight
--     (see the ⚠ note in docs/round-2-review-with-john.md — expected to
--      mis-default on a multi-day job; that is the point of testing it)
--
-- A trigger (sync_job_request_from_days_trg) pushes these dates up onto the
-- job_requests header, so request_date/end_date need no manual update.
INSERT INTO job_request_days
  (id, job_request_id, event_date, start_time, end_time, start_time2, end_time2, sort_order, is_holiday)
SELECT 'jrd-kiosktest-1', 'jobreq-1786821000000', p.day1, '08:00', '13:00', '20:00', '02:00', 0, false FROM seed_params p
UNION ALL
SELECT 'jrd-kiosktest-2', 'jobreq-1786821000000', p.day2, '09:00', '17:00', NULL,    NULL,    1, false FROM seed_params p;

-- ─── 3. Crew assignments — 7 on day 1 (both shifts), 3 on day 2 ─────────────
-- Deliberate variety, each row earning its place in the test:
--   ...-01  full override, block 2 CROSSES MIDNIGHT (21:00→03:00) — a
--           per-worker override that rolls over, not just the day window
--   ...-02  PARTIAL override (in1 only)      → the rest must fall back (#39)
--   ...-04  pair-1-only override             → pair 2 falls back to the day,
--           which now means falling back INTO a midnight-crossing window
--   ...-07  UNCONFIRMED                      → the checkbox John couldn't tick (#42/#43)
--   others  no override                      → pure day-window fallback (also
--           crossing midnight on block 2, so most of the roster rolls over)
INSERT INTO job_request_assignments
  (id, job_request_day_id, employee_key, position_id, specialty_id, shift_id, confirmed,
   planned_in1, planned_out1, planned_in2, planned_out2, sort_order)
VALUES
  ('jra-kiosktest-d1-01','jrd-kiosktest-1','AES-00465','pos-04','spc-04-01','shift-kiosktest-loadin',true, '07:00','13:00','21:00','03:00',0),
  ('jra-kiosktest-d1-02','jrd-kiosktest-1','AES-01326','pos-01','spc-01-01','shift-kiosktest-loadin',true, '10:00',NULL,   NULL,   NULL,   1),
  ('jra-kiosktest-d1-03','jrd-kiosktest-1','AES-00734','pos-01','spc-01-02','shift-kiosktest-loadin',true, NULL,   NULL,   NULL,   NULL,   2),
  ('jra-kiosktest-d1-04','jrd-kiosktest-1','AES-01241','pos-05','spc-05-01','shift-kiosktest-show',  true, '09:00','13:00',NULL,   NULL,   3),
  ('jra-kiosktest-d1-05','jrd-kiosktest-1','AES-02081','pos-08','spc-08-01','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   4),
  ('jra-kiosktest-d1-06','jrd-kiosktest-1','AES-01755','pos-10','spc-10-05','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   5),
  ('jra-kiosktest-d1-07','jrd-kiosktest-1','AES-01783','pos-03','spc-03-03','shift-kiosktest-loadin',false,NULL,   NULL,   NULL,   NULL,   6),
  ('jra-kiosktest-d2-01','jrd-kiosktest-2','AES-00465','pos-04','spc-04-01','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   0),
  ('jra-kiosktest-d2-02','jrd-kiosktest-2','AES-01326','pos-01','spc-01-01','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   1),
  ('jra-kiosktest-d2-03','jrd-kiosktest-2','AES-01755','pos-10','spc-10-05','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   2);

-- ─── 3b. Crew NEEDS — the spec the assignments are measured against ─────────
-- Without these the job-health check fires "No crew needs on <date>" for every
-- day, and the Assigned Crew header degrades to "7 assigned (no spec set) ·
-- +6 extra" because there is no spec to compare against — so the short/extra
-- badges show noise instead of signal. The first version of this seed omitted
-- them and both symptoms showed up in testing.
--
-- Quantities match the roster exactly, so a clean re-seed reads "7/7 spec
-- filled" with no short/extra badge. To exercise those badges, delete a need
-- (→ "+1 extra") or bump a quantity (→ "−1 short").
INSERT INTO job_request_crew_needs
  (id, job_request_day_id, position_id, specialty_id, shift_id, quantity, sort_order)
VALUES
  ('jrcn-kiosktest-d1-01','jrd-kiosktest-1','pos-04','spc-04-01','shift-kiosktest-loadin',1,0),
  ('jrcn-kiosktest-d1-02','jrd-kiosktest-1','pos-01','spc-01-01','shift-kiosktest-loadin',1,1),
  ('jrcn-kiosktest-d1-03','jrd-kiosktest-1','pos-01','spc-01-02','shift-kiosktest-loadin',1,2),
  ('jrcn-kiosktest-d1-04','jrd-kiosktest-1','pos-03','spc-03-03','shift-kiosktest-loadin',1,3),
  ('jrcn-kiosktest-d1-05','jrd-kiosktest-1','pos-05','spc-05-01','shift-kiosktest-show',  1,4),
  ('jrcn-kiosktest-d1-06','jrd-kiosktest-1','pos-08','spc-08-01','shift-kiosktest-show',  1,5),
  ('jrcn-kiosktest-d1-07','jrd-kiosktest-1','pos-10','spc-10-05','shift-kiosktest-show',  1,6),
  ('jrcn-kiosktest-d2-01','jrd-kiosktest-2','pos-04','spc-04-01','shift-kiosktest-show',  1,0),
  ('jrcn-kiosktest-d2-02','jrd-kiosktest-2','pos-01','spc-01-01','shift-kiosktest-show',  1,1),
  ('jrcn-kiosktest-d2-03','jrd-kiosktest-2','pos-10','spc-10-05','shift-kiosktest-show',  1,2);

-- ─── 4. An ISSUED quote, so rates resolve ───────────────────────────────────
-- Round 1 ran with NO quote, which is exactly how #57 was found: timekeeping
-- resolves the rate card ONLY from the job's most recent quote
-- (timekeeping.tsx:576), so with none it fell back to the invented $35/52/70
-- literals on every row. #57 is DEFERRED, not fixed — so without a quote here,
-- round 2 would repeat that and nothing billing-adjacent would be meaningful.
--
-- Header only, no quote_lines: rate resolution reads holiday_multiplier and
-- rate_card_profile_id off this row and nothing else. That is enough for
-- timekeeping and the kiosk. It is NOT enough for invoicing or the pre-invoice
-- report — those need real lines, and round 2 skips them anyway.
--
-- is_draft=false + status='issued' is required together by
-- quotes_draft_status_consistency.
INSERT INTO quotes (id, job_request_id, client_id, rate_card_profile_id,
                    holiday_multiplier, is_draft, status, revision_no, total, deposit)
SELECT 'quote-kiosktest-round2', 'jobreq-1786821000000', jr.client_id,
       'ratecard-1776287259366', 2.0, false, 'issued', 1, 0, 0
FROM job_requests jr WHERE jr.id = 'jobreq-1786821000000'
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Header: job_no carries the dates, so keep it honest ─────────────────
UPDATE job_requests jr
SET job_no = 'AES_' || to_char(p.day1, 'YYMMDD') || to_char(p.day2, 'DD') || '_RHI_KIOSK',
    rate_card_profile_id = 'ratecard-1776287259366',
    status = 'booked'
FROM seed_params p
WHERE jr.id = 'jobreq-1786821000000';

COMMIT;
