-- Enforce one rate card name per client (case-insensitive). NULL client_id
-- rows are exempt (they're "global / unassigned" working states and aren't
-- subject to client-scoped uniqueness).
--
-- Pre-flight: rename any existing duplicates so the constraint can apply
-- without data loss. Older rows in each (client_id, lower(name)) group get
-- "(legacy YYYY-MM-DD)" appended; the newest keeps its name.
--
-- Dev had two collisions on 2026-04-29:
--   Rhino Staging — Standard (2026-04-15 vs 2026-04-24)
--   Loud&Clear,Inc. — Standard (two on 2026-04-09)
-- Prod likely has the same since dev was cloned earlier today.

with ranked as (
  select id,
         row_number() over (
           partition by client_id, lower(name)
           order by updated_at desc nulls last, id desc
         ) as rn,
         to_char(coalesce(updated_at, now()), 'YYYY-MM-DD') as suffix
  from rate_card_profiles
  where client_id is not null and name is not null
)
update rate_card_profiles rcp
   set name = rcp.name || ' (legacy ' || ranked.suffix || ')'
  from ranked
 where rcp.id = ranked.id
   and ranked.rn > 1;

-- Validation: every (client_id, lower(name)) is now distinct.
do $$
declare bad int;
begin
  select count(*) into bad from (
    select 1 from rate_card_profiles
    where client_id is not null and name is not null
    group by client_id, lower(name) having count(*) > 1
  ) sub;
  if bad > 0 then
    raise exception 'Cannot apply unique constraint: % (client_id, name) groups still duplicate', bad;
  end if;
end $$;

-- The constraint itself.
drop index if exists rate_card_profiles_client_name_unique;
create unique index rate_card_profiles_client_name_unique
  on rate_card_profiles (client_id, lower(name))
  where client_id is not null;
