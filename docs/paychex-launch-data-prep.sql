-- Paychex launch — one-time data prep (v2.6.0, 2026-10-12)
--
-- NOT a migration. Run by hand against PROD (and dev, for parity) AFTER
-- 20261012a_paychex_export.sql. John runs it — see CLAUDE.md "Writes to prod
-- are John's to make". Everything runs in one transaction; step 0 is a
-- read-only preview and step 1 keeps a backup table for rollback.
--
-- What it does:
--   2. Loads 24 Payroll IDs worked out during the 9/17 payroll (EXACT/STRONG
--      matches in ~/amplified/payroll-2026-09-17/rippling-ids-RESOLVED.csv)
--      that were never loaded into AOS, plus Chris Travis = 13 and
--      Paul Dunbar = 21 (Rippling employee pay schedule). Only fills BLANK
--      IDs — never overwrites one already set.
--   3. Sets employment_type: 'Employee' for the 8 people on the Rippling
--      employee (W-2) pay schedule, 'Contractor' for everyone else.
--      Paychex kept the Rippling numbers, so the W-2 list is matched by ID.
--
-- W-2 list (Rippling employee schedule, 9/17 run; matches Paychex's sample):
--   2 David Strang · 13 Chris Travis · 15 Devan Keska · 21 Paul Dunbar ·
--   110 Corey Sparks · 111 Brent Gonzalez · 129 Ryan Andrews ·
--   204 Stephen Sadlowski

-- ── 0. Preview (read-only) ───────────────────────────────────────────────────
-- Who will become Employee (expect the 8 above, possibly with duplicate
-- AOS records for the same person):
SELECT employee_key, full_name, rippling_employee_id, employment_type
FROM employees
WHERE rippling_employee_id IN (2, 13, 15, 21, 110, 111, 129, 204)
   OR employee_key = 'emp-1784912488771'
   OR full_name ILIKE 'Paul%Dunbar%'
ORDER BY rippling_employee_id NULLS LAST, full_name;

-- Current spread of employment_type values:
SELECT coalesce(employment_type, '(null)') AS employment_type, count(*)
FROM employees GROUP BY 1 ORDER BY 2 DESC;

-- ── 1–4. Apply ───────────────────────────────────────────────────────────────
BEGIN;

-- 1. Backup (drop it once the export has been used for a payroll or two).
CREATE TABLE IF NOT EXISTS employees_backup_20261012 AS
  SELECT employee_key, rippling_employee_id, employment_type FROM employees;

-- 2. Payroll IDs. Blank-only.
WITH ids(employee_key, payroll_id, note) AS (VALUES
  ('AES-00063', 174, 'Anthony A Lavine-Thigpen → Anthony Thigpen (EXACT)'),
  ('AES-01905', 463, 'Blake Williamson → Blake Williamson (EXACT)'),
  ('emp-1784912488770', 134, 'Brian Tapia → Brian Tapia (EXACT)'),
  ('AES-01644', 12, 'Cameron Pasley → Cameron Pasley (EXACT)'),
  ('emp-1788508400043', 461, 'Dominique vannoy → Dominique VanNoy (EXACT)'),
  ('emp-1788508351097', 459, 'Eli howard → Eli Howard (EXACT)'),
  ('emp-1781369976469', 349, 'Ian sullivan → Ian Sullivan (EXACT)'),
  ('AES-01664', 458, 'Jason Phelps → Jason Phelps (EXACT)'),
  ('emp-1788630700671', 456, 'Jerron Smith → Jerron Smith (EXACT)'),
  ('emp-1788508464063', 460, 'Maxwell Sebastian → Maxwell Sebastian (EXACT)'),
  ('AES-00659', 462, 'Samantha Huffman → Samantha Huffman (EXACT)'),
  ('emp-1784912488773', 79, 'Sean Brown → Sean Brown (EXACT)'),
  ('emp-1784912488774', 109, 'Shelby Bowman → Shelby Bowman (EXACT)'),
  ('emp-1787022314708', 469, 'Trinidad Price → Trinidad Price (EXACT)'),
  ('AES-00060', 468, 'William Kuttner → William Kuttner (EXACT)'),
  ('emp-1786538151970', 331, 'Abbey Davis → Abigail Davis (STRONG)'),
  ('emp-1787022185331', 445, 'Carlos Verlade → Carlos Velarde (STRONG 0.93)'),
  ('emp-1787022166770', 78, 'Cody Sweatt → Cody Sweatt LLC (STRONG)'),
  ('AES-00069', 95, 'Dominic Manno → Dom Manno (STRONG)'),
  ('emp-1787022277647', 146, 'Jefferey Eckel → Jeffrey Eckel (STRONG 0.96)'),
  ('emp-1786823866047', 426, 'Josh Malone → Joshua Malone (STRONG 0.92)'),
  ('AES-01144', 457, 'Michael Bufka → Mike Bufka (STRONG)'),
  ('AES-26724', 209, 'Muhammad Ba → Mohamed Ba (STRONG)'),
  ('emp-1787022221011', 431, 'Sergio Verlade → Sergio Velarde (STRONG 0.93)'),
  ('emp-1784912488771', 13, 'Chris Travis (Rippling employee schedule)')
)
UPDATE employees e
SET rippling_employee_id = ids.payroll_id
FROM ids
WHERE e.employee_key = ids.employee_key
  AND e.rippling_employee_id IS NULL;

-- Paul Dunbar = 21. Matched by name because his AOS key isn't on file here;
-- only applied when exactly one blank-ID record matches.
UPDATE employees
SET rippling_employee_id = 21
WHERE rippling_employee_id IS NULL
  AND full_name ILIKE 'Paul%Dunbar%'
  AND (SELECT count(*) FROM employees
       WHERE rippling_employee_id IS NULL AND full_name ILIKE 'Paul%Dunbar%') = 1;

-- 3. Employee / Contractor. The 20261012a trigger would also normalize, but
--    set both values explicitly so the result doesn't depend on it.
UPDATE employees
SET employment_type = CASE
  WHEN rippling_employee_id IN (2, 13, 15, 21, 110, 111, 129, 204) THEN 'Employee'
  ELSE 'Contractor'
END
WHERE employment_type IS DISTINCT FROM CASE
  WHEN rippling_employee_id IN (2, 13, 15, 21, 110, 111, 129, 204) THEN 'Employee'
  ELSE 'Contractor'
END;

-- 4. Check before committing: expect only 'Employee' (~8) and 'Contractor'.
SELECT employment_type, count(*) FROM employees GROUP BY 1;
SELECT full_name, rippling_employee_id FROM employees
WHERE employment_type = 'Employee' ORDER BY rippling_employee_id;

COMMIT;   -- or ROLLBACK if step 4 looks wrong

-- ── Rollback (after COMMIT) ──────────────────────────────────────────────────
-- UPDATE employees e
-- SET rippling_employee_id = b.rippling_employee_id,
--     employment_type      = b.employment_type
-- FROM employees_backup_20261012 b
-- WHERE e.employee_key = b.employee_key;
-- NB: the 20261012a trigger re-normalizes employment_type on that UPDATE, so
-- a full rollback of the old free-text values also needs the trigger dropped
-- first: DROP TRIGGER employees_normalize_employment_type_trg ON employees;
