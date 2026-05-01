-- Job-request-attachments storage bucket. Clients send maps, diagrams,
-- floor plans, scope packets, etc. Today the job_requests.attachment_names
-- jsonb column stored only file names; nothing was uploaded anywhere, so
-- attachments couldn't be retrieved on a different machine.
--
-- Mirrors the employee-assets bucket pattern in 20260422b. Public so
-- download links work without signed-URL round trips. Paths scoped under
-- {job_request_id}/ with a timestamp prefix, so they're effectively
-- unguessable.

insert into storage.buckets (id, name, public)
values ('job-request-attachments', 'job-request-attachments', true)
on conflict (id) do nothing;

drop policy if exists "job_request_attachments_full_access" on storage.objects;
create policy "job_request_attachments_full_access"
  on storage.objects for all
  to anon, authenticated
  using (bucket_id = 'job-request-attachments')
  with check (bucket_id = 'job-request-attachments');
