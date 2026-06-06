-- One-shot data backfill of rate_card_profile_rows.ot_after to preserve
-- the OLD single-trigger intent of each row under the new two-column model.
--
-- Background: before migration 20260606a, rate_card_profile_rows had ONE
-- trigger column (`dt_after`) whose dropdown was labeled "OT after X" in
-- the UI. The value encoded a single OT threshold; DT was hardcoded to
-- 15 in lib/rates/ot-trigger.ts.
--
-- After 20260606a, there are TWO independent columns:
--   ot_after — explicit OT threshold ("none" / "8" / "9" / "10" / ... / "weekly40")
--   dt_after — explicit DT threshold ("none" / "8" / ... / "15")
--
-- This migration translates each row's stored value into both columns so
-- existing rate cards keep behaving the way the operator originally
-- intended:
--
--   Old dt_after  →  New ot_after  |  New dt_after
--   ─────────────────────────────────────────────────
--   numeric "N"        "N"              "15" (preserves the historical hardcoded DT-after-15)
--   "weekly40"         "weekly40"       "none"
--   "none"             "none"           "none"
--
-- Per-client overrides (e.g. CCMF) run AFTER this migration as separate
-- data ops, since they're contract-specific decisions, not data-shape
-- corrections.
--
-- Note on ot_after column starting state: 20260606a added the column as
-- nullable with no default, so every row currently has ot_after IS NULL.
-- After this migration, every row has both columns set explicitly.

BEGIN;

-- ─── Numeric trigger → ot_after = same, dt_after = "15" (legacy hardcoded) ─
UPDATE public.rate_card_profile_rows
   SET ot_after = dt_after,
       dt_after = '15'
 WHERE dt_after ~ '^[0-9]+$';

-- ─── "weekly40" → ot_after = "weekly40", dt_after = "none" ──────────────
UPDATE public.rate_card_profile_rows
   SET ot_after = 'weekly40',
       dt_after = 'none'
 WHERE dt_after = 'weekly40';

-- ─── "none" → ot_after = "none" (dt_after already correct) ──────────────
UPDATE public.rate_card_profile_rows
   SET ot_after = 'none'
 WHERE dt_after = 'none' AND ot_after IS NULL;

-- ─── Safety: any row that fell through (unexpected dt_after value) ──────
-- Set ot_after to "none" so the new code doesn't default it. Log how many
-- rows landed here in case the value set widens later.
DO $$
DECLARE
  fallthrough_count integer;
BEGIN
  SELECT COUNT(*) INTO fallthrough_count
    FROM public.rate_card_profile_rows
   WHERE ot_after IS NULL;
  IF fallthrough_count > 0 THEN
    RAISE NOTICE '20260606b: % rate-card rows had unrecognized dt_after values — setting ot_after = none', fallthrough_count;
    UPDATE public.rate_card_profile_rows
       SET ot_after = 'none'
     WHERE ot_after IS NULL;
  END IF;
END $$;

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
DECLARE
  total integer;
  null_ot integer;
BEGIN
  SELECT COUNT(*) INTO total FROM public.rate_card_profile_rows;
  SELECT COUNT(*) INTO null_ot FROM public.rate_card_profile_rows WHERE ot_after IS NULL;
  IF null_ot > 0 THEN
    RAISE EXCEPTION '20260606b: % rows still have NULL ot_after after backfill (total=%); investigate', null_ot, total;
  END IF;
END $$;

COMMIT;
