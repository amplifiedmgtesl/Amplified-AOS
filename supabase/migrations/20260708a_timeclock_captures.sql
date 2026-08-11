-- Time Clock (kiosk) — Phase 1 schema.
--
-- A new on-site kiosk (/timeclock) lets crew members self-serve sign-in/out with
-- a captured signature. It writes the SAME timesheet_entries.time_in1..out2 fields
-- the crew leader types today (so records are indistinguishable), and records an
-- audit/provenance layer underneath in a new child table.
--
-- This migration is PURELY ADDITIVE: one nullable column, one new child table, one
-- new storage bucket. It does not alter or drop any existing data, and does not
-- touch the timesheet_entries freeze trigger (the child table sits outside it).

-- ─── 1. Job timezone (source of truth for rendering the on-site local time) ───
-- Nullable. When set, the kiosk renders the captured instant in this IANA zone to
-- derive time_in*/out*; when null it falls back to the on-site device's zone (the
-- kiosk device is physically at the venue). Auto-derivation from venue ZIP is a
-- later enhancement; this column can be set/edited on the job today.
alter table public.job_requests
  add column if not exists timezone text;

comment on column public.job_requests.timezone is
  'IANA timezone of the job venue (e.g. America/Chicago). Used by the Time Clock kiosk to render captured instants as local wall-clock. Null = fall back to the on-site device zone.';

-- ─── 2. timesheet_captures — one audit row per timesheet_entries row ──────────
-- Holds the four RAW capture instants (ground truth) + up to two sign-in
-- signatures. The pay-facing rounded times live on timesheet_entries; comparing
-- the two layers yields per-slot provenance (timeclock / manual / overridden).
create table if not exists public.timesheet_captures (
  timesheet_entry_id    text primary key references public.timesheet_entries(id) on delete cascade,
  -- raw absolute instants captured on tap (audit); rounded values live on timesheet_entries.time_*
  actual_in1            timestamptz,
  actual_out1           timestamptz,
  actual_in2            timestamptz,
  actual_out2           timestamptz,
  -- signatures (sign-ins only) — object paths in the timeclock-signatures bucket
  signature_in1_path    text,
  signature_in2_path    text,
  -- audit
  captured_employee_key text,
  capture_tz            text,   -- IANA zone the device captured in (self-describing)
  updated_at            timestamptz not null default now()
);

comment on table public.timesheet_captures is
  'Time Clock kiosk audit layer: raw capture instants + sign-in signatures for a timesheet_entries row. Pay-facing rounded times stay on timesheet_entries; this is provenance/audit only.';

alter table public.timesheet_captures enable row level security;

-- Standard "full_access" policy, matching timesheet_entries and every other table
-- in this schema (anon + authenticated, unrestricted). Access is gated at the app
-- layer (kiosk runs in the crew leader's session).
drop policy if exists "timesheet_captures_full_access" on public.timesheet_captures;
create policy "timesheet_captures_full_access"
  on public.timesheet_captures for all
  to anon, authenticated
  using (true)
  with check (true);

-- ─── 3. Private storage bucket for signatures ────────────────────────────────
-- PRIVATE (public = false): signatures are more sensitive than the existing
-- public buckets (profile pics, job diagrams) warrant. Reads use short-lived
-- signed URLs (added when the live view / PDF are built in Phase 2/3).
insert into storage.buckets (id, name, public)
values ('timeclock-signatures', 'timeclock-signatures', false)
on conflict (id) do nothing;

drop policy if exists "timeclock_signatures_full_access" on storage.objects;
create policy "timeclock_signatures_full_access"
  on storage.objects for all
  to anon, authenticated
  using (bucket_id = 'timeclock-signatures')
  with check (bucket_id = 'timeclock-signatures');
