-- Restructure employees address fields so they match the rest of the app.
--
-- Before:
--   * employees.address held a single-string full address like
--     "5008 East Thomas Road, Phoenix, AZ, 85018"
--   * no zip column
--
-- After:
--   * employees.address_donotuse — the original single-string address,
--     preserved for history. Application code must not read or write
--     this column. (Renamed, not dropped, so existing rows are never
--     touched destructively.)
--   * employees.address — new column, holds the street portion only
--     (matching the Client.address convention used elsewhere)
--   * employees.zip — new column
--
-- ~97% of the legacy rows match street[, apt], city, ST, zip. We parse
-- those and populate the new address / city / state_code / zip
-- columns. Rows we cannot parse (empty, no trailing zip, fewer than 4
-- comma-separated parts) leave the new address / zip columns NULL; the
-- original text still lives in address_donotuse for manual cleanup.
--
-- Idempotent: safe to re-run. Column renames only happen if the
-- rename is still pending. Parsing only fills rows whose new
-- address / zip columns are still NULL.

-- 1. Rename the legacy column to a loud "do-not-use" name (idempotent)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'address'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees' and column_name = 'address_donotuse'
  ) then
    execute 'alter table public.employees rename column address to address_donotuse';
  end if;
end $$;

-- 2. Add the new discrete columns
alter table public.employees add column if not exists address text;
alter table public.employees add column if not exists zip     text;

-- 3. Backfill address / city / state_code / zip from address_donotuse
with candidate as (
  select
    employee_key,
    address_donotuse as raw,
    (select array_agg(trim(x)) from unnest(string_to_array(address_donotuse, ',')) as x) as parts
  from public.employees
  where is_deleted = false
    and address_donotuse is not null
    and address_donotuse ~ '\d{5}(-\d{4})?\s*$'
    and address is null   -- idempotent: don't overwrite on re-run
),
parsed as (
  select
    employee_key,
    parts,
    array_length(parts, 1) as n,
    parts[array_length(parts, 1)]     as parsed_zip,
    parts[array_length(parts, 1) - 1] as parsed_state,
    parts[array_length(parts, 1) - 2] as parsed_city,
    case
      when array_length(parts, 1) >= 4
        then array_to_string(parts[1:array_length(parts, 1) - 3], ', ')
      else null
    end as parsed_street
  from candidate
)
update public.employees e
set
  address    = p.parsed_street,
  zip        = p.parsed_zip,
  state_code = case when p.parsed_state ~ '^[A-Za-z]{2}$' then upper(p.parsed_state) else e.state_code end,
  state      = case when p.parsed_state ~ '^[A-Za-z]{2}$' then upper(p.parsed_state) else e.state end,
  city       = coalesce(nullif(p.parsed_city, ''), e.city)
from parsed p
where e.employee_key = p.employee_key
  and p.n >= 4
  and p.parsed_zip ~ '^\d{5}(-\d{4})?$'
  and p.parsed_state ~ '^[A-Za-z]{2}$'
  and p.parsed_street is not null
  and p.parsed_street <> '';
