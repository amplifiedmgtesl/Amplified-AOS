-- Allow the admin to pin a specific rate card on a job_request, overriding
-- the effective-date-aware auto-resolution that pickRateCardForJob does.
-- NULL means "auto" — fall back to the lookup. Pinned value flows through
-- to the quote when createDraftFromJob runs.

ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS rate_card_profile_id text REFERENCES rate_card_profiles(id);

CREATE INDEX IF NOT EXISTS job_requests_rate_card_profile_id_idx
  ON job_requests(rate_card_profile_id);
