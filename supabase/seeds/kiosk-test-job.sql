-- ─────────────────────────────────────────────────────────────────────────────
-- KIOSK / PHASE 0 TEST JOBS — re-seed script (DEV ONLY)
--
-- Round 4+ (backlog #85, decided 2026-09-13): TWO jobs, both seeded WITHOUT a quote.
--
--   A  jobreq-kiosktest-a · AES_..._RHI_KIOSKA · status LEAD
--      The full fixture (2 days, 2 shifts, midnight-crossing block, 7+3 crew).
--      Test step 1 is in the app: Create Quote from the Daily Requirements, issue
--      it, then Book the job. Quote pricing runs in app code, so a SQL seed can't
--      build a faithful quote — which is why this seed no longer inserts one.
--      LEAD, because Create Quote is hidden once a job is past Lead
--      (job-detail.tsx isLocked).
--
--   B  jobreq-kiosktest-b · AES_..._RHI_KIOSKB · status BOOKED
--      Never gets a quote (#55/#57). One day, one block, no shifts, 3 crew, and
--      NO pinned rate card, so rates come from the client's card effective on the
--      start date (AOS Timekeeping AND the staff app — review call 13). One worker
--      is General Labor, which is NOT on that card → must read "Rate TBD", never
--      an invented $35. Different people from job A so the kiosk rosters don't
--      overlap.
--
-- The previous job (jobreq-1786821000000, AES_..._RHI_KIOSK) carries an ISSUED
-- quote from round 2. Issued quotes are frozen at the database level
-- (quotes_freeze_check blocks DELETE), so that job can never be "no quote" again.
-- This script retires it: its days, crew and timesheet are removed so it drops
-- off the kiosk and Timekeeping; the header, shifts and frozen quote stay.
--
-- ⚠ DEV ONLY (project ref ovtbvnfhteqxnyirzctt). Never run against prod.
--
-- Re-runnable: deletes and recreates both jobs' days, crew needs, assignments and
-- timesheets every time; the job headers are upserted so the ids stay stable.
-- Day 1 is always TODAY and day 2 tomorrow, computed at run time. Re-run it on
-- the morning of any test day; the fixture goes stale at midnight, because the
-- kiosk can only punch a day whose window contains now.
--
-- ⚠ Once job A's quote has been issued in the app, it is frozen too. Re-seeding on
-- day 2 of a test run is fine — the quote survives (a NOTICE says so) and the job
-- shows "View Quote". But job A's status (LEAD) and job number are reset only
-- when it has no issued quote; with one, both are left as they are.
--
-- What it deliberately does NOT create: timesheets or quotes. Import crew from
-- the Timekeeping screen — that import is under test (#54).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pure SQL (no psql \set) so this runs unchanged through the Supabase Management
-- API /database/query endpoint as well as in the SQL editor.

BEGIN;

-- America/New_York, not CURRENT_DATE: the DB server is UTC, so re-seeding after
-- 8pm Eastern would roll CURRENT_DATE onto tomorrow. This matches the zone the
-- kiosk reads from the device clock.
CREATE OR REPLACE TEMP VIEW seed_params AS
  SELECT (now() AT TIME ZONE 'America/New_York')::date       AS day1,
         (now() AT TIME ZONE 'America/New_York')::date + 1   AS day2;

-- ─── 1. Tear down everything derived ────────────────────────────────────────
-- Guard: refuse if anything has been approved or bound to an invoice, because
-- deleting those is a real data-loss action the freeze trigger exists to stop.
DO $$
DECLARE locked int;
BEGIN
  SELECT count(*) INTO locked
  FROM timesheet_entries
  WHERE job_id IN ('jobreq-1786821000000', 'jobreq-kiosktest-a', 'jobreq-kiosktest-b')
    AND (status = 'approved' OR invoice_line_id IS NOT NULL);
  IF locked > 0 THEN
    RAISE EXCEPTION
      'Refusing to re-seed: % timesheet entries are approved or invoice-bound. Unlock or unlink them first.', locked;
  END IF;
END $$;

-- timesheet_captures cascades off timesheet_entries (FK ON DELETE CASCADE).
DELETE FROM timesheet_entries WHERE job_id IN ('jobreq-1786821000000', 'jobreq-kiosktest-a', 'jobreq-kiosktest-b');
DELETE FROM timesheets        WHERE job_id IN ('jobreq-1786821000000', 'jobreq-kiosktest-a', 'jobreq-kiosktest-b');

-- Quotes: DRAFTS only (issued ones are frozen — see header). Job B should never
-- have one; job A's issued quote, once the tester creates it, survives.
DELETE FROM quotes WHERE job_request_id IN ('jobreq-kiosktest-a', 'jobreq-kiosktest-b') AND is_draft = true;

DELETE FROM job_request_assignments
  WHERE job_request_day_id IN (SELECT id FROM job_request_days
                               WHERE job_request_id IN ('jobreq-1786821000000', 'jobreq-kiosktest-a', 'jobreq-kiosktest-b'));
DELETE FROM job_request_crew_needs
  WHERE job_request_day_id IN (SELECT id FROM job_request_days
                               WHERE job_request_id IN ('jobreq-1786821000000', 'jobreq-kiosktest-a', 'jobreq-kiosktest-b'));
DELETE FROM job_request_days
  WHERE job_request_id IN ('jobreq-1786821000000', 'jobreq-kiosktest-a', 'jobreq-kiosktest-b');

-- Retire the old job (header, shifts and frozen quote stay).
UPDATE job_requests
SET notes = 'RETIRED 2026-09-14: carries a frozen issued quote from round 2, so it cannot be reset to "no quote". Replaced by jobreq-kiosktest-a / -b. Safe to ignore.'
WHERE id = 'jobreq-1786821000000';

-- ─── 2. Job headers ─────────────────────────────────────────────────────────
-- Client and venue copied from the old job (Rhino Staging, client code RHI).
-- request_date/end_date are set here only so a brand-new row is valid; the
-- sync_job_request_from_days_trg trigger moves them onto the days below.
INSERT INTO job_requests
  (id, client, client_id, event_name, venue, venue_address, city, state, city_state, venue_zip,
   request_date, end_date, status, notes, event_abbr, job_no, rate_card_profile_id, timezone,
   payroll_daily_rules_exempt, attachment_names)
SELECT 'jobreq-kiosktest-a', o.client, o.client_id, 'KIOSK TEST A - quote from requirements',
       o.venue, o.venue_address, o.city, o.state, o.city_state, o.venue_zip,
       p.day1, p.day2, 'lead',
       'Seeded for Phase 0 / kiosk re-test. Step 1: Create Quote from Daily Requirements, issue, then Book. Safe to delete.',
       'KIOSKA', 'AES_' || to_char(p.day1, 'YYMMDD') || to_char(p.day2, 'DD') || '_RHI_KIOSKA',
       'ratecard-1776287259366', 'America/New_York', false, '[]'::jsonb
FROM job_requests o, seed_params p WHERE o.id = 'jobreq-1786821000000'
UNION ALL
SELECT 'jobreq-kiosktest-b', o.client, o.client_id, 'KIOSK TEST B - no quote',
       o.venue, o.venue_address, o.city, o.state, o.city_state, o.venue_zip,
       p.day1, p.day1, 'booked',
       'Seeded for Phase 0 / kiosk re-test. NEVER quote this job (#55/#57 Rate TBD test). Safe to delete.',
       'KIOSKB', 'AES_' || to_char(p.day1, 'YYMMDD') || '_RHI_KIOSKB',
       NULL, 'America/New_York', false, '[]'::jsonb
FROM job_requests o, seed_params p WHERE o.id = 'jobreq-1786821000000'
ON CONFLICT (id) DO UPDATE SET
  event_name           = EXCLUDED.event_name,
  notes                = EXCLUDED.notes,
  event_abbr           = EXCLUDED.event_abbr,
  rate_card_profile_id = EXCLUDED.rate_card_profile_id,
  -- Job A with an issued quote: keep its job number (the quote number derives
  -- from it — review call 16) and its status (see header). Otherwise reset.
  job_no = CASE
    WHEN job_requests.id = 'jobreq-kiosktest-a'
     AND EXISTS (SELECT 1 FROM quotes q WHERE q.job_request_id = 'jobreq-kiosktest-a' AND q.is_draft = false)
    THEN job_requests.job_no
    ELSE EXCLUDED.job_no
  END,
  status = CASE
    WHEN job_requests.id = 'jobreq-kiosktest-a'
     AND EXISTS (SELECT 1 FROM quotes q WHERE q.job_request_id = 'jobreq-kiosktest-a' AND q.is_draft = false)
    THEN job_requests.status
    ELSE EXCLUDED.status
  END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM quotes WHERE job_request_id = 'jobreq-kiosktest-a' AND is_draft = false) THEN
    RAISE NOTICE 'Job A already has an issued quote (frozen) — it survives this re-seed; status left as-is.';
  END IF;
  IF EXISTS (SELECT 1 FROM quotes WHERE job_request_id = 'jobreq-kiosktest-b' AND is_draft = false) THEN
    RAISE NOTICE 'Job B has an issued quote — it is frozen and can''t be removed, so the no-quote test is void. Seed a new job id.';
  END IF;
END $$;

-- Shifts are date-independent. Job A has two; job B has none (single shift, so
-- no shift is required anywhere).
INSERT INTO job_request_shifts (id, job_request_id, label, sort_order)
VALUES
  ('shift-kiosktest-a-loadin', 'jobreq-kiosktest-a', 'Load In', 0),
  ('shift-kiosktest-a-show',   'jobreq-kiosktest-a', 'Show',    1)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order;

-- ─── 3. Days ────────────────────────────────────────────────────────────────
-- Job A day 1 is a TWO-BLOCK day (work → meal → work); day 2 is single-block.
-- The two-block day exercises pair 2 everywhere: the kiosk's Block 2, the
-- sign-in sheet header (#47) and the planned-times fallback (#39).
--
-- ⚠ JOB A DAY 1 BLOCK 2 CROSSES MIDNIGHT (20:00 → 02:00), on purpose. John,
-- 2026-08-12: "a large percentage of jobs fall into that category." Block 2 is on
-- day 1 (= today) so it can be PUNCHED at the kiosk and rolled past midnight.
--
-- rate_mode seeded explicitly as 'hourly' — the app never writes it (#105).
INSERT INTO job_request_days
  (id, job_request_id, event_date, start_time, end_time, start_time2, end_time2, sort_order, is_holiday, rate_mode)
SELECT 'jrd-kiosktest-a-1', 'jobreq-kiosktest-a', p.day1, '08:00', '13:00', '20:00', '02:00', 0, false, 'hourly' FROM seed_params p
UNION ALL
SELECT 'jrd-kiosktest-a-2', 'jobreq-kiosktest-a', p.day2, '09:00', '17:00', NULL,    NULL,    1, false, 'hourly' FROM seed_params p
UNION ALL
SELECT 'jrd-kiosktest-b-1', 'jobreq-kiosktest-b', p.day1, '09:00', '17:00', NULL,    NULL,    0, false, 'hourly' FROM seed_params p;

-- ─── 4. Crew assignments ────────────────────────────────────────────────────
-- Job A — 7 on day 1 (both shifts), 3 on day 2. Deliberate variety:
--   ...-01  full override, block 2 CROSSES MIDNIGHT (21:00→03:00)
--   ...-02  PARTIAL override (in1 only)      → the rest must fall back (#39)
--   ...-04  pair-1-only override             → pair 2 falls back INTO the
--           midnight-crossing day window
--   ...-07  UNCONFIRMED                      → (#42/#43)
--   others  no override                      → pure day-window fallback
-- Job B — 3 crew, no overrides. Joseph Allen (Stagehand $38) and Ryan Anderson
-- (Head Rigger $65) are on the client card; Caleb Ballard (General Labor) is not
-- → "Rate TBD".
INSERT INTO job_request_assignments
  (id, job_request_day_id, employee_key, position_id, specialty_id, shift_id, confirmed,
   planned_in1, planned_out1, planned_in2, planned_out2, sort_order)
VALUES
  ('jra-kiosktest-a-d1-01','jrd-kiosktest-a-1','AES-00465','pos-04','spc-04-01','shift-kiosktest-a-loadin',true, '07:00','13:00','21:00','03:00',0),
  ('jra-kiosktest-a-d1-02','jrd-kiosktest-a-1','AES-01326','pos-01','spc-01-01','shift-kiosktest-a-loadin',true, '10:00',NULL,   NULL,   NULL,   1),
  ('jra-kiosktest-a-d1-03','jrd-kiosktest-a-1','AES-00734','pos-01','spc-01-02','shift-kiosktest-a-loadin',true, NULL,   NULL,   NULL,   NULL,   2),
  ('jra-kiosktest-a-d1-04','jrd-kiosktest-a-1','AES-01241','pos-05','spc-05-01','shift-kiosktest-a-show',  true, '09:00','13:00',NULL,   NULL,   3),
  ('jra-kiosktest-a-d1-05','jrd-kiosktest-a-1','AES-02081','pos-08','spc-08-01','shift-kiosktest-a-show',  true, NULL,   NULL,   NULL,   NULL,   4),
  ('jra-kiosktest-a-d1-06','jrd-kiosktest-a-1','AES-01755','pos-10','spc-10-05','shift-kiosktest-a-show',  true, NULL,   NULL,   NULL,   NULL,   5),
  ('jra-kiosktest-a-d1-07','jrd-kiosktest-a-1','AES-01783','pos-03','spc-03-03','shift-kiosktest-a-loadin',false,NULL,   NULL,   NULL,   NULL,   6),
  ('jra-kiosktest-a-d2-01','jrd-kiosktest-a-2','AES-00465','pos-04','spc-04-01','shift-kiosktest-a-show',  true, NULL,   NULL,   NULL,   NULL,   0),
  ('jra-kiosktest-a-d2-02','jrd-kiosktest-a-2','AES-01326','pos-01','spc-01-01','shift-kiosktest-a-show',  true, NULL,   NULL,   NULL,   NULL,   1),
  ('jra-kiosktest-a-d2-03','jrd-kiosktest-a-2','AES-01755','pos-10','spc-10-05','shift-kiosktest-a-show',  true, NULL,   NULL,   NULL,   NULL,   2),
  ('jra-kiosktest-b-d1-01','jrd-kiosktest-b-1','AES-00001','pos-01','spc-01-01',NULL,                      true, NULL,   NULL,   NULL,   NULL,   0),
  ('jra-kiosktest-b-d1-02','jrd-kiosktest-b-1','AES-00002','pos-04','spc-04-01',NULL,                      true, NULL,   NULL,   NULL,   NULL,   1),
  ('jra-kiosktest-b-d1-03','jrd-kiosktest-b-1','AES-00003','pos-14','spc-14-01',NULL,                      true, NULL,   NULL,   NULL,   NULL,   2);

-- ─── 4b. Crew NEEDS — the spec the assignments are measured against ─────────
-- Without these the job-health check fires "No crew needs on <date>" and the
-- Assigned Crew header shows noise. They are also what Create Quote builds job
-- A's quote lines from.
--
-- Only CONFIRMED crew count toward the spec and job A's ...-07 is unconfirmed on
-- purpose, so a clean re-seed reads "6/7 spec filled · −1 short" on A day 1 until
-- that box is ticked. A day 2 reads "3/3"; B reads "3/3".
INSERT INTO job_request_crew_needs
  (id, job_request_day_id, position_id, specialty_id, shift_id, quantity, sort_order)
VALUES
  ('jrcn-kiosktest-a-d1-01','jrd-kiosktest-a-1','pos-04','spc-04-01','shift-kiosktest-a-loadin',1,0),
  ('jrcn-kiosktest-a-d1-02','jrd-kiosktest-a-1','pos-01','spc-01-01','shift-kiosktest-a-loadin',1,1),
  ('jrcn-kiosktest-a-d1-03','jrd-kiosktest-a-1','pos-01','spc-01-02','shift-kiosktest-a-loadin',1,2),
  ('jrcn-kiosktest-a-d1-04','jrd-kiosktest-a-1','pos-03','spc-03-03','shift-kiosktest-a-loadin',1,3),
  ('jrcn-kiosktest-a-d1-05','jrd-kiosktest-a-1','pos-05','spc-05-01','shift-kiosktest-a-show',  1,4),
  ('jrcn-kiosktest-a-d1-06','jrd-kiosktest-a-1','pos-08','spc-08-01','shift-kiosktest-a-show',  1,5),
  ('jrcn-kiosktest-a-d1-07','jrd-kiosktest-a-1','pos-10','spc-10-05','shift-kiosktest-a-show',  1,6),
  ('jrcn-kiosktest-a-d2-01','jrd-kiosktest-a-2','pos-04','spc-04-01','shift-kiosktest-a-show',  1,0),
  ('jrcn-kiosktest-a-d2-02','jrd-kiosktest-a-2','pos-01','spc-01-01','shift-kiosktest-a-show',  1,1),
  ('jrcn-kiosktest-a-d2-03','jrd-kiosktest-a-2','pos-10','spc-10-05','shift-kiosktest-a-show',  1,2),
  ('jrcn-kiosktest-b-d1-01','jrd-kiosktest-b-1','pos-01','spc-01-01',NULL,                      1,0),
  ('jrcn-kiosktest-b-d1-02','jrd-kiosktest-b-1','pos-04','spc-04-01',NULL,                      1,1),
  ('jrcn-kiosktest-b-d1-03','jrd-kiosktest-b-1','pos-14','spc-14-01',NULL,                      1,2);

COMMIT;
