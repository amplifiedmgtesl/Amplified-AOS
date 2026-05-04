-- Followup to 20260504a_master_rate_card_seed.sql.
--
-- That migration seeded the Master Default rate card profile with its 29
-- rows, but set terms = '' (empty string). The DEFAULT_TERMS constant in
-- lib/rates/defaults.ts was the canonical text and was never carried over
-- to the DB row. Backfill it now so:
--   - Drafts created from the master pick up real terms
--   - The DEFAULT_TERMS code constant becomes obsolete (can be deleted in
--     a future cleanup pass once all profiles have populated terms)
--
-- Idempotent: only updates rows where terms is currently empty/null, so
-- re-runs and rows that already have hand-edited terms are untouched.

UPDATE rate_card_profiles
   SET terms = 'Billing Structure:
All positions are billed at a five (5) hour minimum per shift.
Day rates are based on ten (10) hour shifts.

OT may be triggered after ten (10), eleven (11), twelve (12), thirteen (13), fourteen (14), or fifteen (15) hours, based on the selected position structure.
DT is billed only after fifteen (15) hours.

Travel may be added per position as quoted.

Overtime is billed at 1.5 times the regular hourly rate after 40 worked hours in a contiguous work week. The standard work week runs Sunday through Saturday.

Holiday hours are billed at 2.0 times the regular hourly rate. Recognized holidays include Christmas Eve, Christmas Day, New Year''s Eve, New Year''s Day, Easter, Memorial Day, Independence Day, and Thanksgiving Day.'
 WHERE id = 'ratecard-master-default'
   AND (terms IS NULL OR terms = '');
