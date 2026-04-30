-- Make every linked_job_request_id reference a real FK so the DB blocks
-- deletes that would orphan downstream records. Today only
-- calendar_events.linked_job_request_id is an FK; quotes and
-- job_costing_drafts have a free-text column that nothing enforces.
--
-- Orphan check (run before applying):
--   select count(*) from quotes q where q.linked_job_request_id <> ''
--     and not exists (select 1 from job_requests jr where jr.id = q.linked_job_request_id);
-- Verified zero orphans on dev 2026-04-29 before this migration.
--
-- Behavior: NO ACTION (== RESTRICT for our purposes) — same as the existing
-- calendar_events FK. The application-level UI also blocks delete with a
-- friendly message and a count of dependents per table.

-- 1. Normalize empty-string linked_job_request_id to NULL so the FK accepts them.
update quotes set linked_job_request_id = null
 where linked_job_request_id is not null and trim(linked_job_request_id) = '';

update job_costing_drafts set linked_job_request_id = null
 where linked_job_request_id is not null and trim(linked_job_request_id) = '';

-- 2. Add FK constraints (idempotent).
alter table quotes
  drop constraint if exists quotes_linked_job_request_id_fkey;
alter table quotes
  add constraint quotes_linked_job_request_id_fkey
  foreign key (linked_job_request_id) references job_requests(id);

alter table job_costing_drafts
  drop constraint if exists job_costing_drafts_linked_job_request_id_fkey;
alter table job_costing_drafts
  add constraint job_costing_drafts_linked_job_request_id_fkey
  foreign key (linked_job_request_id) references job_requests(id);
