-- Audit table for the PDF recovery import (recovery/scripts/import.mjs).
-- One row per (sha256, target_table) pair recording what was inserted from each PDF.
-- Used for idempotency: re-runs of import.mjs skip files whose sha256 + target_table
-- pair is already present, unless --force is passed.
--
-- Apply to dev first, then to prod after dev is verified.

create table if not exists recovery_import_log (
  id           bigserial primary key,
  filename     text not null,
  sha256       text not null,
  target_table text not null,
  target_id    text not null,
  imported_at  timestamptz not null default now(),
  metadata     jsonb
);

create unique index if not exists recovery_import_log_sha256_table_unique
  on recovery_import_log (sha256, target_table);

alter table recovery_import_log enable row level security;

-- Service-role-only — no app user needs to read this. The script runs as service-role.
create policy recovery_import_log_service_only on recovery_import_log
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
