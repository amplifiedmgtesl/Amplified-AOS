-- ============================================================================
-- Amplified Operations Suite — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- Last updated: 2026-04-15
--
-- For EXISTING databases run the migration file instead:
--   supabase/migrations/20260415_employee_type_and_timesheet_employee_key.sql
-- ============================================================================

-- ─── Calendar Events ─────────────────────────────────────────────────────────
create table if not exists calendar_events (
  id                       text primary key,
  source                   text,
  client                   text,
  event_name               text,
  venue                    text,
  venue_address            text,
  city                     text,
  state                    text,
  city_state               text,
  google_maps_link         text,
  start_date               text,
  end_date                 text,
  start_time               text,
  end_time                 text,
  notes                    text,
  status                   text,
  lead                     text,
  hands                    text,
  is_deleted               boolean not null default false,
  -- Event profile fields folded in to avoid a second table
  profile_notes            text,
  profile_attachment_names jsonb   not null default '[]'
);

-- ─── Quotes ──────────────────────────────────────────────────────────────────
create table if not exists quotes (
  id                     text primary key,
  client                 text,
  event_name             text,
  venue                  text,
  city_state             text,
  start_date             text,
  end_date               text,
  start_time             text,
  end_time               text,
  expected_hours_per_day numeric,
  total                  numeric not null default 0,
  deposit                numeric not null default 0,
  status                 text    not null default 'draft',
  notes                  text,
  lines                  jsonb   not null default '[]',
  terms                  text,
  linked_job_request_id  text,
  linked_job_sheet_id    text,
  timesheet_summary      jsonb,
  signature_name         text,
  signed_at              text,
  rate_card_profile_id   text
);

-- ─── Quote Draft Workspaces ───────────────────────────────────────────────────
create table if not exists quote_draft_workspaces (
  id         text primary key,
  name       text,
  updated_at text,
  data       jsonb not null default '{}'
);

-- ─── Invoices ─────────────────────────────────────────────────────────────────
create table if not exists invoices (
  id                   text primary key,
  quote_id             text,
  invoice_no           text,
  issue_date           text,
  due_date             text,
  po_no                text,
  bill_to              text,
  client               text,
  event_name           text,
  venue                text,
  city_state           text,
  lines                jsonb   not null default '[]',
  subtotal             numeric not null default 0,
  deposit              numeric not null default 0,
  amount_due           numeric not null default 0,
  terms                text,
  notes                text,
  status               text,
  paid_amount          numeric not null default 0,
  rate_card_profile_id text,
  linked_job_sheet_id  text,
  timesheet_summary    jsonb
);

-- ─── Job Requests ─────────────────────────────────────────────────────────────
create table if not exists job_requests (
  id               text primary key,
  client           text,
  event_name       text,
  venue            text,
  venue_address    text,
  city             text,
  state            text,
  city_state       text,
  google_maps_link text,
  request_date     text,
  end_date         text,
  start_time       text,
  end_time         text,
  expected_hours   numeric,
  add_to_calendar  boolean,
  status           text,
  notes            text,
  attachment_names jsonb not null default '[]',
  packet_notes     text
);

-- ─── Positions ────────────────────────────────────────────────────────────────
-- Controlled vocabulary for worker positions used in timekeeping, job sheets,
-- and job costing. Single source of truth — all four previous hardcoded lists
-- (POSITIONS in timekeeping, ROLES in job-costing, staff portal POSITIONS,
-- and DEFAULT_RATE_ROWS groups) now draw from this table.
create table if not exists positions (
  id         text    primary key,
  name       text    not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

-- Seed data — rationalized unified list. Admins can edit via Position Maintenance.
insert into positions (id, name, sort_order) values
  ('pos-01', 'Stagehand',              1),
  ('pos-02', 'Stagehand Lead',         2),
  ('pos-03', 'Rigger',                 3),
  ('pos-04', 'Head Rigger',            4),
  ('pos-05', 'Audio Technician',       5),
  ('pos-06', 'Lighting Technician',    6),
  ('pos-07', 'Video Technician',       7),
  ('pos-08', 'Forklift Operator',      8),
  ('pos-09', 'Camera Operator',        9),
  ('pos-10', 'Operations',            10),
  ('pos-11', 'Lead',                  11),
  ('pos-12', 'Heavy Equipment Op',    12),
  ('pos-13', 'Aerial Lift Operator',  13),
  ('pos-14', 'General Labor',         14),
  ('pos-15', 'Other',                 15)
on conflict (id) do nothing;

-- ─── Employees ────────────────────────────────────────────────────────────────
-- Unified people table for both internal staff and contractors / labor pool.
-- type = 'staff'      → internal employee; may have a staff portal login
-- type = 'contractor' → labor pool / bookable contractor; no portal login
create table if not exists employees (
  employee_key    text    primary key,
  employee_id     text,
  full_name       text,
  first_name      text,
  last_name       text,
  payroll_name    text,
  preferred_name  text,
  status          text,
  worker_category text,
  position_status text,
  employment_type text,
  -- type (staff/contractor) is derived from employment_type in application code
  city            text,
  state           text,
  state_code      text,
  email           text,
  phone           text,
  address         text,
  notes           text,
  profile_picture text,
  documents       jsonb   not null default '[]',
  source          text,
  is_deleted      boolean not null default false
);

-- ─── Profiles ─────────────────────────────────────────────────────────────────
-- Supabase auth user profiles. Shared by Amplified-AOS and amplified-staff.
-- role = 'staff'        → can submit timesheets via the staff portal
-- role = 'admin'        → full access to Amplified-AOS
-- role = 'crew_leader'  → access to /lead/job-sheets and /lead/timekeeping (no pay/pricing)
-- employee_key links to employees table (required for staff portal users).
create table if not exists profiles (
  id           uuid    primary key,  -- matches auth.users.id
  role         text    not null default 'staff',
  employee_key text    references employees(employee_key),
  full_name    text,
  email        text
  -- contact info (phone, address, city, state) is on the employee record
);

-- ─── Job Sheets ───────────────────────────────────────────────────────────────
-- Workers are stored in job_sheet_workers (normalized), not inline here.
create table if not exists job_sheets (
  id               text primary key,
  source_event_id  text,
  title            text,
  client           text,
  event_name       text,
  venue            text,
  venue_address    text,
  city             text,
  state            text,
  city_state       text,
  google_maps_link text,
  date             text,
  call_time        text,
  notes            text,
  attachment_names jsonb not null default '[]'
);

-- ─── Job Sheet Workers ────────────────────────────────────────────────────────
-- Normalized from the old job_sheets.workers JSONB column.
-- One row per worker per job sheet.
-- employee_key links back to employees (nullable for any legacy rows).
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

-- ─── Timesheets ───────────────────────────────────────────────────────────────
-- Time entries are stored in timesheet_entries (normalized), not inline here.
create table if not exists timesheets (
  id               text    primary key,
  job_sheet_id     text    references job_sheets(id),
  title            text,
  hide_pay_columns boolean not null default false
);

-- ─── Timesheet Entries ────────────────────────────────────────────────────────
-- One row per worker per timesheet.
-- employee_key → links to employees for history queries (nullable; backfill in progress)
-- user_id      → set for entries submitted via the staff portal (Supabase auth user id)
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

-- ─── Job Costing ──────────────────────────────────────────────────────────────
create table if not exists job_costing_drafts (
  id                          text primary key,
  title                       text,
  client                      text,
  event_name                  text,
  venue                       text,
  city_state                  text,
  linked_job_request_id       text,
  linked_quote_id             text,
  linked_job_sheet_id         text,
  linked_timesheet_id         text,
  linked_rate_card_profile_id text,
  payroll_burden              numeric     not null default 0.15,
  overhead_per_hour           numeric     not null default 3,
  target_margin               numeric     not null default 0.25,
  ot_pay_multiplier           numeric     not null default 1.5,
  dt_pay_multiplier           numeric     not null default 2.0,
  ot_bill_multiplier          numeric     not null default 1.5,
  dt_bill_multiplier          numeric     not null default 2.0,
  minimum_hours               numeric     not null default 5,
  billed_expenses             numeric     not null default 0,
  rentals                     numeric     not null default 0,
  pass_through_markup_revenue numeric     not null default 0,
  actual_travel               numeric     not null default 0,
  actual_hotels               numeric     not null default 0,
  actual_per_diem             numeric     not null default 0,
  actual_equipment            numeric     not null default 0,
  actual_other_costs          numeric     not null default 0,
  actual_revenue_collected    numeric     not null default 0,
  estimated_job_cost          numeric     not null default 0,
  lines                       jsonb       not null default '[]',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ─── Rate Card Profiles ───────────────────────────────────────────────────────
create table if not exists rate_card_profiles (
  id          text primary key,
  client_name text,
  rows        jsonb       not null default '[]',
  terms       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── App Rate State ───────────────────────────────────────────────────────────
-- Simple key/value store for the active rate card state.
create table if not exists app_rate_state (
  key   text primary key,   -- 'rate_rows' | 'terms' | 'client_name'
  value jsonb
);

-- ============================================================================
-- Row Level Security (RLS)
-- By default all tables are open (no RLS). Once you add Supabase Auth,
-- enable RLS and add policies here. Example for a single-tenant app:
--
--   alter table quotes enable row level security;
--   create policy "authenticated users only"
--     on quotes for all
--     using (auth.role() = 'authenticated');
--
-- Repeat for every table above.
-- ============================================================================
