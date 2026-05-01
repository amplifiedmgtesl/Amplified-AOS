-- Job request address cleanup.
--
-- Users were pasting full mailing addresses into venue_address even though
-- city / state / venue_zip exist as discrete columns. 14 of 20 rows on dev
-- had the entire address jammed in. Also adds venue_address_2 for suite/unit.
--
-- This migration:
--   1. Adds venue_address_2 text column.
--   2. Parses dirty venue_address values back into discrete columns:
--      - venue_address  ← street only
--      - city           ← parsed city (overwrites if differs)
--      - state          ← 2-letter code (fixes "Ohio" → "OH" etc.)
--      - venue_zip      ← parsed zip
--   3. Handles the one 3-comma row where the venue name was prepended
--      (e.g. "New Life Chapel, 8655 Cincinnati Dayton Rd, ...") — strips
--      the leading segment since it's already in the venue field.
--
-- Pattern after migration: venue_address = street line only.

alter table job_requests
  add column if not exists venue_address_2 text;

with parsed as (
  select id,
         -- strip optional leading "venue, " segment if there are 3 commas
         case when length(venue_address) - length(replace(venue_address,',','')) >= 3
              then substring(venue_address from position(', ' in venue_address)+2)
              else venue_address
         end as va_norm
  from job_requests
  where venue_address ~ ','
),
split as (
  select id,
         trim(split_part(va_norm, ',', 1))                              as street,
         trim(split_part(va_norm, ',', 2))                              as city,
         trim(split_part(trim(split_part(va_norm, ',', 3)), ' ', 1))    as state,
         trim(substring(trim(split_part(va_norm, ',', 3)) from '[0-9]{5}')) as zip
  from parsed
),
state_normalized as (
  -- Map common full-name variants to 2-letter codes; fall back to upper-case input.
  select id, street, city,
         case upper(state)
           when 'OHIO'     then 'OH'
           when 'KENTUCKY' then 'KY'
           when 'TEXAS'    then 'TX'
           when 'INDIANA'  then 'IN'
           when 'MICHIGAN' then 'MI'
           when 'TENNESSEE' then 'TN'
           else upper(state)
         end as state,
         zip
  from split
)
update job_requests jr
   set venue_address = sn.street,
       city          = sn.city,
       state         = sn.state,
       venue_zip     = sn.zip
  from state_normalized sn
 where jr.id = sn.id;

-- Validation: zero rows should still have a comma in venue_address.
do $$
declare bad_count int;
begin
  select count(*) into bad_count from job_requests where venue_address ~ ',';
  if bad_count > 0 then
    raise exception 'Address parse incomplete: % rows still have a comma in venue_address', bad_count;
  end if;
end $$;
