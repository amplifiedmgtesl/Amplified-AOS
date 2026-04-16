-- ─── Positions table ──────────────────────────────────────────────────────────
-- Replaces four hardcoded position/role arrays with a single DB-managed list.
-- Consumed by timekeeping, job sheets, job costing, and the staff portal.

create table if not exists positions (
  id         text    primary key,
  name       text    not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true
);

insert into positions (id, name, sort_order) values
  ('pos-01', 'Stagehand',              1),
  ('pos-02', 'Stagehand Lead',         2),
  ('pos-03', 'Rigger',                 3),
  ('pos-04', 'Head Rigger',            4),
  ('pos-05', 'Audio Technician',       5),
  ('pos-06', 'Lighting Technician',    6),
  ('pos-07', 'Video Technician',       7),
  ('pos-08', 'Forklift Operator',      8),
  ('pos-09', 'Camera Operator',        9),
  ('pos-10', 'Operations',            10),
  ('pos-11', 'Lead',                  11),
  ('pos-12', 'Heavy Equipment Op',    12),
  ('pos-13', 'Aerial Lift Operator',  13),
  ('pos-14', 'General Labor',         14),
  ('pos-15', 'Other',                 15)
on conflict (id) do nothing;
