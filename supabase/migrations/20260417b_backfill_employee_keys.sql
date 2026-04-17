-- =============================================================================
-- Backfill employee_key on timesheet_entries
--
-- Run this in the Supabase SQL Editor AFTER the timesheet_entries_staff_columns
-- migration has been applied.
--
-- Step 1 — Preview what will be matched (read-only, run this first):
--
--   SELECT
--     te.id,
--     te.first_name || ' ' || te.last_name AS entry_name,
--     te.email AS entry_email,
--     e.employee_key,
--     e.full_name AS employee_name,
--     e.email    AS employee_email,
--     CASE
--       WHEN LOWER(te.email) = LOWER(e.email) THEN 'email'
--       ELSE 'name'
--     END AS match_type
--   FROM timesheet_entries te
--   JOIN employees e ON (
--     (te.email IS NOT NULL AND te.email != '' AND LOWER(te.email) = LOWER(e.email))
--     OR
--     (te.first_name IS NOT NULL AND te.last_name IS NOT NULL
--      AND te.first_name != ''
--      AND LOWER(te.first_name || ' ' || te.last_name) = LOWER(e.full_name))
--   )
--   WHERE te.employee_key IS NULL
--     AND (e.is_deleted IS NULL OR e.is_deleted = false)
--   ORDER BY match_type, entry_name;
--
-- Step 2 — Apply the backfill (run the UPDATE statements below):
-- =============================================================================


-- Pass 1: match by email (most reliable)
UPDATE timesheet_entries te
SET
  employee_key = e.employee_key,
  -- Mark as "submitted" (needs approval) if no status has been set yet
  status       = COALESCE(te.status, 'submitted'),
  updated_at   = NOW()
FROM employees e
WHERE te.employee_key IS NULL
  AND te.email IS NOT NULL
  AND te.email != ''
  AND LOWER(te.email) = LOWER(e.email)
  AND (e.is_deleted IS NULL OR e.is_deleted = false);


-- Pass 2: match by full name (first_name + ' ' + last_name = employees.full_name)
-- Only runs on rows still unlinked after the email pass.
UPDATE timesheet_entries te
SET
  employee_key = e.employee_key,
  status       = COALESCE(te.status, 'submitted'),
  updated_at   = NOW()
FROM employees e
WHERE te.employee_key IS NULL
  AND te.first_name IS NOT NULL
  AND te.last_name  IS NOT NULL
  AND te.first_name != ''
  AND LOWER(te.first_name || ' ' || te.last_name) = LOWER(e.full_name)
  AND (e.is_deleted IS NULL OR e.is_deleted = false);
