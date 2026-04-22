-- Employee-assets storage bucket for profile pictures and document uploads.
-- Replaces the previous scheme of stuffing base64 data URLs into
-- employees.profile_picture (text) and employees.documents (jsonb).
--
-- Bucket is PUBLIC so <img src> and file links work without signed-URL
-- round trips. Object paths are scoped under {employee_key}/ and include
-- timestamps, so they're effectively unguessable. If stricter access is
-- needed later, flip bucket.public = false and switch to signed URLs on
-- read.

insert into storage.buckets (id, name, public)
values ('employee-assets', 'employee-assets', true)
on conflict (id) do nothing;

-- Single "full_access" policy matching the standard used on every other
-- table in this schema (see 20260416b_positions_rls.sql,
-- 20260420p_quote_invoice_lines_rls.sql, etc).
drop policy if exists "employee_assets_full_access" on storage.objects;
create policy "employee_assets_full_access"
  on storage.objects for all
  to anon, authenticated
  using (bucket_id = 'employee-assets')
  with check (bucket_id = 'employee-assets');
