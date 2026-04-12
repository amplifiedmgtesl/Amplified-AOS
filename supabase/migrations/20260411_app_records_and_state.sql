create table if not exists public.app_records (
  dataset text not null,
  record_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (dataset, record_id)
);

create table if not exists public.app_state (
  key text primary key,
  payload jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_records enable row level security;
alter table public.app_state enable row level security;

drop policy if exists "app_records_full_access" on public.app_records;
create policy "app_records_full_access"
on public.app_records
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "app_state_full_access" on public.app_state;
create policy "app_state_full_access"
on public.app_state
for all
to anon, authenticated
using (true)
with check (true);

create index if not exists app_records_dataset_idx on public.app_records (dataset);
