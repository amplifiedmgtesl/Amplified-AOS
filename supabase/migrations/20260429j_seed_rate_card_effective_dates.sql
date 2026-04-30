-- Backfill effective_date on existing rate_card_profiles. Migration 20260429i
-- added the column nullable; this seeds existing rows with their created_at
-- date so downstream "pick by event date" logic has a defensible default for
-- already-existing cards.
--
-- Users can override any of these later via the UI. Cards added after this
-- migration ships are blank-by-default and the user picks an explicit date
-- (or leaves it null for an undated current card).

update rate_card_profiles
   set effective_date = created_at::date
 where effective_date is null
   and created_at is not null;
