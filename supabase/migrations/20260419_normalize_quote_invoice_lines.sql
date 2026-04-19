-- Normalize quotes.lines and invoices.lines JSONB → discrete child tables.
-- quote_lines and invoice_lines replace the JSONB blobs.
-- The original JSONB columns are kept (nullable) as a fallback until validated.

-- ─── quote_lines ──────────────────────────────────────────────────────────────

create table if not exists quote_lines (
  id            text    primary key,  -- "{quote_id}_{sort_order}"
  quote_id      text    not null references quotes(id) on delete cascade,
  sort_order    int     not null,
  service_key   text,
  qty           numeric,
  hours         numeric,
  holiday_hours numeric,
  travel        numeric,
  base_hourly   numeric,
  base_day      numeric,
  ot_rate       numeric,
  dt_rate       numeric,
  rule          text,
  total         numeric
);

create index if not exists quote_lines_quote_id_idx on quote_lines(quote_id);

-- Backfill from existing JSONB
insert into quote_lines (
  id, quote_id, sort_order,
  service_key, qty, hours, holiday_hours, travel,
  base_hourly, base_day, ot_rate, dt_rate, rule, total
)
select
  q.id || '_' || (arr.ordinality - 1)::text,
  q.id,
  (arr.ordinality - 1)::int,
  arr.line->>'serviceKey',
  (arr.line->>'qty')::numeric,
  (arr.line->>'hours')::numeric,
  (arr.line->>'holidayHours')::numeric,
  (arr.line->>'travel')::numeric,
  (arr.line->>'baseHourly')::numeric,
  (arr.line->>'baseDay')::numeric,
  (arr.line->>'otRate')::numeric,
  (arr.line->>'dtRate')::numeric,
  arr.line->>'rule',
  (arr.line->>'total')::numeric
from quotes q
cross join lateral jsonb_array_elements(q.lines) with ordinality as arr(line, ordinality)
where jsonb_array_length(q.lines) > 0
on conflict (id) do nothing;

-- ─── invoice_lines ────────────────────────────────────────────────────────────

create table if not exists invoice_lines (
  id            text    primary key,  -- "{invoice_id}_{sort_order}"
  invoice_id    text    not null references invoices(id) on delete cascade,
  sort_order    int     not null,
  service_key   text,
  qty           numeric,
  hours         numeric,
  holiday_hours numeric,
  travel        numeric,
  base_hourly   numeric,
  base_day      numeric,
  ot_rate       numeric,
  dt_rate       numeric,
  rule          text,
  total         numeric
);

create index if not exists invoice_lines_invoice_id_idx on invoice_lines(invoice_id);

-- Backfill from existing JSONB
insert into invoice_lines (
  id, invoice_id, sort_order,
  service_key, qty, hours, holiday_hours, travel,
  base_hourly, base_day, ot_rate, dt_rate, rule, total
)
select
  inv.id || '_' || (arr.ordinality - 1)::text,
  inv.id,
  (arr.ordinality - 1)::int,
  arr.line->>'serviceKey',
  (arr.line->>'qty')::numeric,
  (arr.line->>'hours')::numeric,
  (arr.line->>'holidayHours')::numeric,
  (arr.line->>'travel')::numeric,
  (arr.line->>'baseHourly')::numeric,
  (arr.line->>'baseDay')::numeric,
  (arr.line->>'otRate')::numeric,
  (arr.line->>'dtRate')::numeric,
  arr.line->>'rule',
  (arr.line->>'total')::numeric
from invoices inv
cross join lateral jsonb_array_elements(inv.lines) with ordinality as arr(line, ordinality)
where jsonb_array_length(inv.lines) > 0
on conflict (id) do nothing;

-- NOTE: quotes.lines and invoices.lines JSONB columns are intentionally kept
-- for this migration. Drop them in a follow-up once the app is verified.
