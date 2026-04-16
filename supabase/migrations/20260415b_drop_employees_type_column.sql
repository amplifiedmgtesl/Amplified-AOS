-- ============================================================================
-- Migration: 2026-04-15b
-- Drop the redundant `type` column from employees.
--
-- The staff/contractor distinction is already captured by `employment_type`:
--   "Employee"              → staff
--   "Independent Contractor" or blank → contractor
--
-- Application code now derives type from employment_type at read time.
-- ============================================================================

alter table employees drop column if exists type;
