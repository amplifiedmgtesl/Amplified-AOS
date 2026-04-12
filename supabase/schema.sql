-- ============================================================================
-- Amplified Operations Suite — Supabase Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- ─── Calendar Events ─────────────────────────────────────────────────────────
create table if not exists calendar_events (
  id                      text primary key,
  source                  text,
  client                  text,
  event_name              text,
  venue                   text,
  venue_address           text,
  city                    text,
  state                   text,
  city_state              text,
  google_maps_link        text,
  start_date              text,
  end_date                text,
  start_time              text,
  end_time                text,
  notes                   text,
  status                  text,
  lead                    text,
  hands                   text,
  is_deleted              boolean     not null default false,
  -- Event profile fields folded in to avoid a second table
  profile_notes           text,
  profile_attachment_names jsonb      not null default '[]'
);

-- ─── Quotes ──────────────────────────────────────────────────────────────────
create table if not exists quotes (
  id                      text primary key,
  client                  text,
  event_name              text,
  venue                   text,
  city_state              text,
  start_date              text,
  end_date                text,
  start_time              text,
  end_time                text,
  expected_hours_per_day  numeric,
  total                   numeric     not null default 0,
  deposit                 numeric     not null default 0,
  status                  text        not null default 'draft',
  notes                   text,
  lines                   jsonb       not null default '[]',
  terms                   text,
  linked_job_request_id   text,
  linked_job_sheet_id     text,
  timesheet_summary       jsonb,
  signature_name          text,
  signed_at               text,
  rate_card_profile_id    text
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
  lines                jsonb    not null default '[]',
  subtotal             numeric  not null default 0,
  deposit              numeric  not null default 0,
  amount_due           numeric  not null default 0,
  terms                text,
  notes                text,
  status               text,
  paid_amount          numeric  not null default 0,
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

-- ─── Job Sheets ───────────────────────────────────────────────────────────────
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
  attachment_names jsonb not null default '[]',
  workers          jsonb not null default '[]'
);

-- ─── Timesheets ───────────────────────────────────────────────────────────────
create table if not exists timesheets (
  id               text    primary key,
  job_sheet_id     text,
  title            text,
  hide_pay_columns boolean not null default false,
  rows             jsonb   not null default '[]'
);

-- ─── Employees ────────────────────────────────────────────────────────────────
create table if not exists employees (
  employee_key     text primary key,
  employee_id      text,
  full_name        text,
  first_name       text,
  last_name        text,
  payroll_name     text,
  preferred_name   text,
  status           text,
  worker_category  text,
  position_status  text,
  employment_type  text,
  city             text,
  state            text,
  state_code       text,
  email            text,
  phone            text,
  address          text,
  notes            text,
  profile_picture  text,
  documents        jsonb   not null default '[]',
  source           text,
  is_deleted       boolean not null default false
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
  payroll_burden              numeric not null default 0.15,
  overhead_per_hour           numeric not null default 3,
  target_margin               numeric not null default 0.25,
  ot_pay_multiplier           numeric not null default 1.5,
  dt_pay_multiplier           numeric not null default 2.0,
  ot_bill_multiplier          numeric not null default 1.5,
  dt_bill_multiplier          numeric not null default 2.0,
  minimum_hours               numeric not null default 5,
  billed_expenses             numeric not null default 0,
  rentals                     numeric not null default 0,
  pass_through_markup_revenue numeric not null default 0,
  actual_travel               numeric not null default 0,
  actual_hotels               numeric not null default 0,
  actual_per_diem             numeric not null default 0,
  actual_equipment            numeric not null default 0,
  actual_other_costs          numeric not null default 0,
  actual_revenue_collected    numeric not null default 0,
  estimated_job_cost          numeric not null default 0,
  lines                       jsonb   not null default '[]',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ─── Rate Card Profiles ───────────────────────────────────────────────────────
create table if not exists rate_card_profiles (
  id          text primary key,
  client_name text,
  rows        jsonb not null default '[]',
  terms       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── App Rate State (current rate rows, terms, client name) ───────────────────
-- Simple key/value store for the "active" rate card that isn't a saved profile.
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
