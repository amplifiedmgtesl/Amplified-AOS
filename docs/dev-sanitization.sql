-- ============================================================================
-- Dev environment PII sanitization
-- ============================================================================
-- Run this against your DEV Supabase database immediately after restoring
-- a snapshot from production. It scrambles emails, phones, and street
-- addresses while preserving names, financial data, IDs, and dates so the
-- app behaves realistically.
--
-- Usage:
--   1. Edit DEV_ADMIN_EMAIL below to match the email you want to keep
--      functional for logging into dev.
--   2. psql "$DEV_DB_URL" < docs/dev-sanitization.sql
--
-- DO NOT RUN THIS AGAINST PRODUCTION. The first guard below makes that
-- harder, but you still need to triple-check the connection string.
-- ============================================================================

\set ON_ERROR_STOP on

-- ──────────────────────────────────────────────────────────────────────────
-- EDIT ME: the one auth user you want to keep working on dev
-- ──────────────────────────────────────────────────────────────────────────
\set dev_admin_email '''jobrien@synergypro.com'''

-- ──────────────────────────────────────────────────────────────────────────
-- Safety guard: refuse to run if a marker table named __PRODUCTION__ exists.
-- Create that marker on your prod DB once, before ever running this script,
-- as a tripwire:
--   create table public."__PRODUCTION__" (id int);
-- ──────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = '__PRODUCTION__'
  ) then
    raise exception 'PRODUCTION TRIPWIRE TRIPPED — refusing to sanitize. This DB looks like prod.';
  end if;
end$$;

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- Clients
-- ──────────────────────────────────────────────────────────────────────────
update clients
set
  email   = case when email   is not null and email   <> '' then 'dev+client-' || id || '@example.invalid' else null end,
  phone   = case when phone   is not null and phone   <> '' then '555-0100' else null end,
  address = case when address is not null and address <> '' then '1 Dev Lane' else null end;

-- contact_name kept as-is so reports look real

-- ──────────────────────────────────────────────────────────────────────────
-- Employees — these are real people; scrub aggressively
-- ──────────────────────────────────────────────────────────────────────────
update employees
set
  email   = case when email   is not null and email   <> '' then 'dev+emp-' || employee_key || '@example.invalid' else null end,
  phone   = case when phone   is not null and phone   <> '' then '555-0100' else null end,
  address = case when address is not null and address <> '' then '1 Dev Lane' else null end;

-- ──────────────────────────────────────────────────────────────────────────
-- Profiles (Supabase auth profile rows in public.profiles)
-- Keep the dev admin's email intact so they can log in.
-- ──────────────────────────────────────────────────────────────────────────
update profiles
set email = 'dev+profile-' || id || '@example.invalid'
where email is not null
  and email <> ''
  and email <> :dev_admin_email;

-- ──────────────────────────────────────────────────────────────────────────
-- Job sheet workers (denormalized snapshot of crew at time of scheduling)
-- ──────────────────────────────────────────────────────────────────────────
update job_sheet_workers
set
  email = case when email is not null and email <> '' then 'dev+jsw-' || id || '@example.invalid' else null end,
  phone = case when phone is not null and phone <> '' then '555-0100' else null end;

-- ──────────────────────────────────────────────────────────────────────────
-- Timesheet entries (snapshot of worker contact at time of entry)
-- ──────────────────────────────────────────────────────────────────────────
update timesheet_entries
set
  email = case when email is not null and email <> '' then 'dev+te-' || id || '@example.invalid' else null end,
  phone = case when phone is not null and phone <> '' then '555-0100' else null end;

-- ──────────────────────────────────────────────────────────────────────────
-- Job requests — venue addresses are usually public info; leave them.
-- The `client` text and `contact_name` fields stay as-is for realistic UI.
-- (No email/phone columns on this table.)
-- ──────────────────────────────────────────────────────────────────────────

-- ──────────────────────────────────────────────────────────────────────────
-- auth.users — the real login table
-- Keep the dev admin functional. Scramble everyone else's email so password-
-- reset flows can't send to real inboxes. Passwords stay intact (still hashed)
-- but no one can recover the changed email, so prod creds won't reach dev.
-- ──────────────────────────────────────────────────────────────────────────
update auth.users
set email = 'dev+user-' || id || '@example.invalid'
where email is not null
  and email <> :dev_admin_email;

-- Confirm the dev admin's email is verified so they can log in straight away
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = :dev_admin_email;

-- Optional: nuke any pending email/password recovery tokens that came across
update auth.users
set
  recovery_token = null,
  email_change_token_new = null,
  email_change = null,
  reauthentication_token = null,
  confirmation_token = null
where email <> :dev_admin_email;

-- ──────────────────────────────────────────────────────────────────────────
-- Notes fields that sometimes carry PII pasted in by users
-- (Optional — uncomment if you want to wipe them. Most are operational notes
-- without PII, so we leave them by default.)
-- ──────────────────────────────────────────────────────────────────────────
-- update job_requests   set notes = '[scrubbed]' where notes is not null and notes <> '';
-- update job_requests   set packet_notes = '[scrubbed]' where packet_notes is not null and packet_notes <> '';
-- update quotes         set notes = '[scrubbed]' where notes is not null and notes <> '';
-- update invoices       set notes = '[scrubbed]' where notes is not null and notes <> '';
-- update timesheet_entries set notes = '[scrubbed]' where notes is not null and notes <> '';

-- ──────────────────────────────────────────────────────────────────────────
-- Storage objects — clear any user-uploaded file metadata that may reveal
-- internal naming conventions. Skip if you copied storage binaries; they'll
-- be re-linked properly.
-- ──────────────────────────────────────────────────────────────────────────
-- delete from storage.objects;  -- uncomment to wipe all uploaded file refs

commit;

-- ──────────────────────────────────────────────────────────────────────────
-- Sanity report
-- ──────────────────────────────────────────────────────────────────────────
select
  (select count(*) from clients where email like 'dev+%')                     as clients_scrubbed,
  (select count(*) from employees where email like 'dev+%')                   as employees_scrubbed,
  (select count(*) from profiles where email like 'dev+%')                    as profiles_scrubbed,
  (select count(*) from job_sheet_workers where email like 'dev+%')           as job_sheet_workers_scrubbed,
  (select count(*) from timesheet_entries where email like 'dev+%')           as timesheet_entries_scrubbed,
  (select count(*) from auth.users where email like 'dev+%')                  as auth_users_scrubbed,
  (select count(*) from auth.users where email = :dev_admin_email)            as dev_admin_present;
