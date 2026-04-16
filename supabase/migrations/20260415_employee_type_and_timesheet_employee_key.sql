-- ============================================================================
-- Migration: 2026-04-15
-- - Add type column to employees (staff | contractor)
-- - Add employee_key to timesheet_entries for history queries
-- - Add job_sheet_workers table if not already created
-- - Add timesheet_entries table if not already created
-- - Add profiles table if not already created
-- - Enable RLS + open policies on all tables (matching existing pattern)
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- ─── employees: add type column ───────────────────────────────────────────────
alter table employees
  add column if not exists type text not null default 'contractor';

-- All existing records default to 'contractor'.
-- Manually update specific records to 'staff' as needed:
--   update employees set type = 'staff' where employee_key = 'AES-XXXXX';

-- ─── timesheet_entries: add employee_key column ───────────────────────────────
alter table timesheet_entries
  add column if not exists employee_key text references employees(employee_key);

-- Backfill employee_key from job_sheet_workers where email matches:
update timesheet_entries te
set employee_key = jsw.employee_key
from job_sheet_workers jsw
where te.job_sheet_id = jsw.job_sheet_id
  and lower(te.email) = lower(jsw.email)
  and te.employee_key is null
  and jsw.employee_key is not null
  and jsw.employee_key <> '';

-- ─── job_sheet_workers: create if not exists + RLS ───────────────────────────
create table if not exists job_sheet_workers (
  id           bigserial primary key,
  job_sheet_id text    not null references job_sheets(id) on delete cascade,
  employee_key text    references employees(employee_key),
  full_name    text,
  first_name   text,
  last_name    text,
  state_code   text,
  phone        text,
  email        text,
  role         text,
  confirmed    boolean not null default false,
  sort_order   integer not null default 0
);

alter table job_sheet_workers enable row level security;

drop policy if exists "job_sheet_workers_full_access" on job_sheet_workers;
create policy "job_sheet_workers_full_access"
  on job_sheet_workers for all
  to anon, authenticated
  using (true)
  with check (true);

-- ─── timesheet_entries: create if not exists + RLS ───────────────────────────
create table if not exists timesheet_entries (
  id            text        primary key,
  timesheet_id  text        references timesheets(id) on delete cascade,
  job_sheet_id  text        references job_sheets(id),
  employee_key  text        references employees(employee_key),
  user_id       uuid,
  position      text,
  first_name    text,
  last_name     text,
  phone         text,
  email         text,
  time_in1      text,
  time_out1     text,
  lunch_minutes integer     not null default 30,
  time_in2      text,
  time_out2     text,
  std_hours     numeric     not null default 0,
  ot_hours      numeric     not null default 0,
  dt_hours      numeric     not null default 0,
  total_hours   numeric     not null default 0,
  std_rate      numeric     not null default 0,
  ot_rate       numeric     not null default 0,
  dt_rate       numeric     not null default 0,
  total_pay     numeric     not null default 0,
  sort_order    integer     not null default 0,
  updated_at    timestamptz not null default now()
);

alter table timesheet_entries enable row level security;

drop policy if exists "timesheet_entries_full_access" on timesheet_entries;
create policy "timesheet_entries_full_access"
  on timesheet_entries for all
  to anon, authenticated
  using (true)
  with check (true);

-- ─── profiles: create if not exists + RLS ────────────────────────────────────
create table if not exists profiles (
  id           uuid primary key,
  role         text not null default 'staff',
  employee_key text references employees(employee_key),
  full_name    text,
  email        text,
  phone        text,
  address      text,
  city         text,
  state        text
);

alter table profiles enable row level security;

drop policy if exists "profiles_full_access" on profiles;
create policy "profiles_full_access"
  on profiles for all
  to anon, authenticated
  using (true)
  with check (true);

-- ─── employees: ensure RLS is enabled ────────────────────────────────────────
alter table employees enable row level security;

drop policy if exists "employees_full_access" on employees;
create policy "employees_full_access"
  on employees for all
  to anon, authenticated
  using (true)
  with check (true);

-- ─── job_sheets: drop legacy workers JSONB column ────────────────────────────
-- Workers are now stored in job_sheet_workers. Safe to drop once confirmed.
-- Uncomment when ready:
-- alter table job_sheets drop column if exists workers;

-- ─── timesheets: drop legacy rows JSONB column ───────────────────────────────
-- Entries are now stored in timesheet_entries. Safe to drop once confirmed.
-- Uncomment when ready:
-- alter table timesheets drop column if exists rows;
