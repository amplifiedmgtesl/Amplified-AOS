-- Add 'timesheet' to the allowed doc_type values on job_request_attachments.
-- Connor sometimes writes timekeeping out manually in the field; attaching
-- the signed/scanned sheet to the job keeps the document tied to the right
-- record without forcing it into an unrelated bucket.

alter table job_request_attachments
  drop constraint if exists job_request_attachments_doc_type_check;

alter table job_request_attachments
  add constraint job_request_attachments_doc_type_check
  check (doc_type in (
    'diagram', 'floor_plan', 'map',
    'scope_packet', 'contract', 'photo',
    'timesheet', 'other'
  ));
