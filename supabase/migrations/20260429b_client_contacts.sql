-- Per-client contacts. A client (production company, law firm, etc.) typically has
-- multiple people: billing AP clerk, quote approver, on-site logistics. The legacy
-- single contact_name on clients can't represent that. This table is the new home.

create table if not exists client_contacts (
  id          text primary key,
  client_id   text not null references clients(id),
  first_name  text not null,
  last_name   text not null,
  title       text,
  phone       text,
  email       text,
  type        text not null check (type in ('billing','quotes','job','other')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists client_contacts_client_id_idx on client_contacts(client_id);

alter table client_contacts enable row level security;

drop policy if exists client_contacts_full_access on client_contacts;
create policy client_contacts_full_access on client_contacts for all using (true);
