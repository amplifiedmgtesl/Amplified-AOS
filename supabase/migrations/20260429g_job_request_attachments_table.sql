-- Normalized child table for job request attachments. Replaces the
-- jsonb-array-of-URLs in job_requests.attachment_names so each upload can
-- carry per-file metadata (description, doc type, mime, size, etc.).
--
-- The old job_requests.attachment_names column is left in place for now as
-- a safety backup; the UI will stop reading from it. Drop in a future
-- cleanup pass once we're confident.

create table if not exists job_request_attachments (
  id              text primary key,
  job_request_id  text not null references job_requests(id),
  storage_path    text not null,            -- e.g. "jobreq-123/1764-floor.pdf"
  url             text not null,            -- public URL ready for <a href>
  file_name       text not null,            -- original filename for display
  description     text,
  doc_type        text not null default 'other'
                    check (doc_type in (
                      'diagram', 'floor_plan', 'map',
                      'scope_packet', 'contract', 'photo', 'other'
                    )),
  mime_type       text,
  file_size       bigint,
  uploaded_at     timestamptz not null default now(),
  is_active       boolean not null default true
);

create index if not exists job_request_attachments_job_request_id_idx
  on job_request_attachments(job_request_id);

alter table job_request_attachments enable row level security;

drop policy if exists job_request_attachments_full_access on job_request_attachments;
create policy job_request_attachments_full_access
  on job_request_attachments for all using (true);
