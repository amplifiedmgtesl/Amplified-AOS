-- ─── Positions table: enable RLS + open policy ────────────────────────────────
-- The original positions migration (20260416_positions_table.sql) created the
-- table and seeded rows but omitted RLS, matching no other table in this schema.
-- Without RLS enabled + an anon/authenticated policy, Supabase blocks all reads
-- from the client (anon key), causing the maintenance screen to show no data.
--
-- Run in: Supabase Dashboard → SQL Editor → New Query

alter table positions enable row level security;

drop policy if exists "positions_full_access" on positions;
create policy "positions_full_access"
  on positions for all
  to anon, authenticated
  using (true)
  with check (true);
