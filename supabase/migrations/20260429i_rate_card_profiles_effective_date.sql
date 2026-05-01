-- Add effective_date to rate_card_profiles so a client can have multiple
-- versions of the same named rate card across time (e.g. "Standard" effective
-- 2025-01-01 vs "Standard" effective 2026-06-01). Downstream selection
-- (quote builder, invoice builder) can then pick the row whose
-- effective_date is the latest one <= the event date.
--
-- Relaxes the just-added uniqueness constraint from (client_id, lower(name))
-- to (client_id, lower(name), effective_date). NULL effective_date is
-- treated as a magic far-future date in the uniqueness key, so at most ONE
-- "no specific effective date" row can exist per (client, name).

alter table rate_card_profiles
  add column if not exists effective_date date;

drop index if exists rate_card_profiles_client_name_unique;
drop index if exists rate_card_profiles_client_name_effective_unique;

create unique index rate_card_profiles_client_name_effective_unique
  on rate_card_profiles (client_id, lower(name), coalesce(effective_date, '9999-12-31'::date))
  where client_id is not null;
