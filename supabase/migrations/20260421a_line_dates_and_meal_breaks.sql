-- Line date + meal-break normalization.
--
-- 1. timesheet_entries:
--    - work_date converted text → date
--    - new end_date (date)
--    - lunch_minutes renamed to meal_break_1_minutes + adds meal_break_2_minutes
--    - new created_at timestamptz
-- 2. quote_lines + invoice_lines: new end_date (date)
--
-- lunch_minutes column is retained as a rollback safety net; drops in a later
-- migration once the new fields are stable.

-- ─── timesheet_entries: backfill work_date text before type conversion ──────

-- Backfill work_date where null (admin-entered rows) from job_sheets.date.
-- Must happen BEFORE the type conversion so any garbage values are caught.
UPDATE timesheet_entries te
SET work_date = js.date
FROM timesheets t
JOIN job_sheets js ON js.id = t.job_sheet_id
WHERE te.timesheet_id = t.id
  AND te.work_date IS NULL
  AND js.date ~ '^\d{4}-\d{2}-\d{2}$';

-- Convert text → date. USING clause handles the cast.
-- If any rows have non-YYYY-MM-DD text this will fail; address manually.
ALTER TABLE timesheet_entries
  ALTER COLUMN work_date TYPE date USING work_date::date;

-- Add end_date, meal-break columns, and created_at
ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS end_date              date,
  ADD COLUMN IF NOT EXISTS meal_break_1_minutes  integer,
  ADD COLUMN IF NOT EXISTS meal_break_2_minutes  integer,
  ADD COLUMN IF NOT EXISTS created_at            timestamptz NOT NULL DEFAULT now();

-- Backfill end_date = work_date (default: single-day entry)
UPDATE timesheet_entries
SET end_date = work_date
WHERE end_date IS NULL AND work_date IS NOT NULL;

-- Seed meal_break_1_minutes from existing lunch_minutes
UPDATE timesheet_entries
SET meal_break_1_minutes = lunch_minutes
WHERE meal_break_1_minutes IS NULL
  AND lunch_minutes IS NOT NULL;

-- ─── quote_lines and invoice_lines: end_date ───────────────────────────────

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS end_date date;

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS end_date date;

UPDATE quote_lines
SET end_date = (quote_date)::date
WHERE end_date IS NULL
  AND quote_date ~ '^\d{4}-\d{2}-\d{2}$';

UPDATE invoice_lines
SET end_date = (quote_date)::date
WHERE end_date IS NULL
  AND quote_date ~ '^\d{4}-\d{2}-\d{2}$';

-- ─── Report any rows still missing dates ──────────────────────────────────

SELECT 'timesheet_entries' AS tbl, count(*) AS missing
  FROM timesheet_entries WHERE work_date IS NULL OR end_date IS NULL
UNION ALL
SELECT 'quote_lines',   count(*) FROM quote_lines   WHERE end_date IS NULL
UNION ALL
SELECT 'invoice_lines', count(*) FROM invoice_lines WHERE end_date IS NULL;
