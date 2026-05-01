-- Constrain rate_card_profile_rows.dt_after to the supported OT-trigger sentinels.
-- Adds two new options beyond the original 10..15 daily thresholds:
--   'none'      → No OT (flat rate)
--   'weekly40'  → OT after 40 / week (weekly threshold; only valid for hourly billing)

ALTER TABLE rate_card_profile_rows
  DROP CONSTRAINT IF EXISTS rate_card_profile_rows_dt_after_check;

ALTER TABLE rate_card_profile_rows
  ADD CONSTRAINT rate_card_profile_rows_dt_after_check
  CHECK (dt_after IN ('none','10','11','12','13','14','15','weekly40'));
