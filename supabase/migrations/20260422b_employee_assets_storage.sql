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

-- Authenticated users can upload / update / delete within this bucket.
-- (Public read is handled by the bucket's public = true flag.)
drop policy if exists "employee_assets_insert_auth" on storage.objects;
create policy "employee_assets_insert_auth"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'employee-assets');

drop policy if exists "employee_assets_update_auth" on storage.objects;
create policy "employee_assets_update_auth"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'employee-assets')
  with check (bucket_id = 'employee-assets');

drop policy if exists "employee_assets_delete_auth" on storage.objects;
create policy "employee_assets_delete_auth"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'employee-assets');
