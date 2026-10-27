-- 20261027a_onboarding_access.sql — Onboarding for chosen users (Connor, 2026-10-27).
--
-- profiles.can_onboard: Connor ticks "Onboarding" on a user in Maintenance →
-- Users and that user gets the Onboarding screen, whatever their role.
-- Admins always have it. Checked by the app shell and the /api/onboarding
-- routes (lib/onboarding/server.ts requireOnboarding). Merging records stays
-- admin-only (merge_employee is unchanged).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_onboard boolean NOT NULL DEFAULT false;
