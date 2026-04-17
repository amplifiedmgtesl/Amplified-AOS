-- ─── timesheet_entries: add staff-portal columns ────────────────────────────
-- The staff portal writes status, notes, work_date, and job_name when a staff
-- member submits a timesheet. These columns were referenced in code but were
-- missing from the table definition.
--
-- status    — lifecycle: submitted → approved | rejected
-- notes     — optional notes from the staff member
-- work_date — the date the work was performed (staff-entered)
-- job_name  — denormalized job label for the staff portal list view
--
-- Run in: Supabase Dashboard → SQL Editor → New Query

alter table timesheet_entries
  add column if not exists status    text,
  add column if not exists notes     text,
  add column if not exists work_date text,
  add column if not exists job_name  text;
