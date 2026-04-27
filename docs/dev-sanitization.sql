-- ============================================================================
-- Dev environment PII sanitization (lightweight)
-- ============================================================================
-- Run once after restoring a prod snapshot to dev. Scope is intentionally
-- narrow because the live data set is small: only employee emails and a
-- handful of admin users — both of which can also be corrected by hand in
-- the Supabase dashboard if anything looks off.
--
-- What it does:
--   - Rewrites employee emails so password-reset / mailing flows can never
--     reach real inboxes from the dev environment.
--   - Voids any pending email/password recovery tokens that came across in
--     the snapshot.
--
-- What it does NOT do:
--   - No mass scrubbing of phones/addresses (the data set is small enough
--     to fix by hand).
--   - No notes/PII text wipes.
--   - No client-table changes (clients table holds business contacts that
--     stay legible for testing).
--   - No auth.users mutations beyond the dev admin allowlist below.
--
-- Usage:
--   1. Edit DEV_ADMIN_EMAILS below — leave anyone who needs to log into dev
--      with their real email; everyone else gets dev+...@example.invalid.
--   2. psql "$DEV_DB_URL" < docs/dev-sanitization.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- ──────────────────────────────────────────────────────────────────────────
-- EDIT ME: list the auth user emails that should keep working on dev.
-- Anything not in this list gets scrambled.
-- ──────────────────────────────────────────────────────────────────────────
-- Format as a Postgres array literal: ARRAY['a@x.com','b@x.com']
\set dev_admin_emails 'ARRAY[''jobrien@synergypro.com'']'

-- ──────────────────────────────────────────────────────────────────────────
-- Safety guard: refuse to run if a marker table named __PRODUCTION__ exists
-- in the public schema. To enable the tripwire, run this ONCE on prod:
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
-- Employees: rewrite emails to non-deliverable @example.invalid
-- ──────────────────────────────────────────────────────────────────────────
update employees
set email = 'dev+emp-' || employee_key || '@example.invalid'
where email is not null and email <> '';

-- ──────────────────────────────────────────────────────────────────────────
-- auth.users: keep dev admins, scramble everyone else
-- ──────────────────────────────────────────────────────────────────────────
update auth.users
set email = 'dev+user-' || id || '@example.invalid'
where email is not null
  and not (email = any (:dev_admin_emails));

-- Make sure the dev admins are confirmed so they can log in straight away
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = any (:dev_admin_emails);

-- Void recovery / change tokens for anyone whose email was scrambled.
update auth.users
set
  recovery_token = null,
  email_change_token_new = null,
  email_change = null,
  reauthentication_token = null,
  confirmation_token = null
where not (email = any (:dev_admin_emails));

-- public.profiles mirrors auth.users emails — keep them in sync.
update profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is distinct from u.email;

commit;

-- ──────────────────────────────────────────────────────────────────────────
-- Sanity report
-- ──────────────────────────────────────────────────────────────────────────
select
  (select count(*) from employees where email like 'dev+%')           as employees_scrubbed,
  (select count(*) from auth.users where email like 'dev+%')          as auth_users_scrubbed,
  (select count(*) from auth.users where email = any (:dev_admin_emails)) as dev_admins_present;
