-- ─────────────────────────────────────────────────────────────────────────────
-- KIOSK / PHASE 0 TEST JOB — re-seed script (DEV ONLY)
--
-- Job: jobreq-1786821000000 · AES_..._RHI_KIOSK · Rhino Staging
--
-- ⚠ DEV ONLY (project ref ovtbvnfhteqxnyirzctt). Never run against prod.
--
-- Idempotent: deletes and recreates the job's days, assignments, timesheet and
-- quote every time, so it can be re-run before each test round. The job_requests
-- header row itself is UPDATED, not recreated, so the id stays stable and the
-- references in docs/technical-debt-backlog.md keep working.
--
-- ⚠ SET THE TWO DATES BELOW BEFORE RUNNING. Day 1 must be TODAY, or the kiosk
--   opens on a day nobody can punch and half the test is dead on arrival.
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

-- ⬇⬇ EDIT THESE TWO DATES ⬇⬇  day1 MUST be today for the kiosk to be testable.
CREATE OR REPLACE TEMP VIEW seed_params AS
  SELECT DATE '2026-08-12' AS day1,
         DATE '2026-08-13' AS day2;

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
DELETE FROM quotes            WHERE job_request_id = 'jobreq-1786821000000';
DELETE FROM job_request_assignments
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
-- A trigger (sync_job_request_from_days_trg) pushes these dates up onto the
-- job_requests header, so request_date/end_date need no manual update.
INSERT INTO job_request_days
  (id, job_request_id, event_date, start_time, end_time, start_time2, end_time2, sort_order, is_holiday)
SELECT 'jrd-kiosktest-1', 'jobreq-1786821000000', p.day1, '08:00', '13:00', '14:00', '19:00', 0, false FROM seed_params p
UNION ALL
SELECT 'jrd-kiosktest-2', 'jobreq-1786821000000', p.day2, '09:00', '17:00', NULL,    NULL,    1, false FROM seed_params p;

-- ─── 3. Crew assignments — 7 on day 1 (both shifts), 3 on day 2 ─────────────
-- Deliberate variety, each row earning its place in the test:
--   ...-01  full override on both pairs      → "override" chip (#40)
--   ...-02  PARTIAL override (in1 only)      → the rest must fall back (#39)
--   ...-04  pair-1-only override             → pair 2 falls back to the day
--   ...-07  UNCONFIRMED                      → the checkbox John couldn't tick (#42/#43)
--   others  no override                      → pure day-window fallback
INSERT INTO job_request_assignments
  (id, job_request_day_id, employee_key, position_id, specialty_id, shift_id, confirmed,
   planned_in1, planned_out1, planned_in2, planned_out2, sort_order)
VALUES
  ('jra-kiosktest-d1-01','jrd-kiosktest-1','AES-00465','pos-04','spc-04-01','shift-kiosktest-loadin',true, '07:00','13:00','14:00','19:00',0),
  ('jra-kiosktest-d1-02','jrd-kiosktest-1','AES-01326','pos-01','spc-01-01','shift-kiosktest-loadin',true, '10:00',NULL,   NULL,   NULL,   1),
  ('jra-kiosktest-d1-03','jrd-kiosktest-1','AES-00734','pos-01','spc-01-02','shift-kiosktest-loadin',true, NULL,   NULL,   NULL,   NULL,   2),
  ('jra-kiosktest-d1-04','jrd-kiosktest-1','AES-01241','pos-05','spc-05-01','shift-kiosktest-show',  true, '09:00','13:00',NULL,   NULL,   3),
  ('jra-kiosktest-d1-05','jrd-kiosktest-1','AES-02081','pos-08','spc-08-01','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   4),
  ('jra-kiosktest-d1-06','jrd-kiosktest-1','AES-01755','pos-10','spc-10-05','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   5),
  ('jra-kiosktest-d1-07','jrd-kiosktest-1','AES-01783','pos-03','spc-03-03','shift-kiosktest-loadin',false,NULL,   NULL,   NULL,   NULL,   6),
  ('jra-kiosktest-d2-01','jrd-kiosktest-2','AES-00465','pos-04','spc-04-01','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   0),
  ('jra-kiosktest-d2-02','jrd-kiosktest-2','AES-01326','pos-01','spc-01-01','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   1),
  ('jra-kiosktest-d2-03','jrd-kiosktest-2','AES-01755','pos-10','spc-10-05','shift-kiosktest-show',  true, NULL,   NULL,   NULL,   NULL,   2);

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
FROM job_requests jr WHERE jr.id = 'jobreq-1786821000000';

-- ─── 5. Header: job_no carries the dates, so keep it honest ─────────────────
UPDATE job_requests jr
SET job_no = 'AES_' || to_char(p.day1, 'YYMMDD') || to_char(p.day2, 'DD') || '_RHI_KIOSK',
    rate_card_profile_id = 'ratecard-1776287259366',
    status = 'booked'
FROM seed_params p
WHERE jr.id = 'jobreq-1786821000000';

COMMIT;
