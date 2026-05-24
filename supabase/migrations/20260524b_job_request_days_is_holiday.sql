-- Holiday handling, Phase 1: source-of-truth flag on the job day.
--
-- Per project_holiday_handling.md (design finalized 2026-05-24):
--   - is_holiday lives on job_request_days as the single source of truth
--   - 2.0× multiplier applied at calc time (hardcoded, no settings table)
--   - No recognized-holidays calendar — operator flags manually
--   - No partial-day splits — whole day = holiday or not
--   - Snapshot tables (quote_days, invoice_days) come in Phase 2 + 3
--
-- This migration is additive only — no calc wiring yet. Phase 2 introduces
-- quote_days and teaches the quote calc engine to look up holiday status;
-- Phase 3 mirrors for invoices. Drafts will auto-recalc on flag toggle;
-- frozen docs require Revise (existing freeze trigger handles that).

ALTER TABLE job_request_days
  ADD COLUMN IF NOT EXISTS is_holiday boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS job_request_days_holiday_idx
  ON job_request_days(job_request_id, event_date) WHERE is_holiday = true;

-- Final state report.
SELECT 'days total'          AS metric, count(*) AS n FROM job_request_days
UNION ALL
SELECT 'days flagged holiday', count(*) FROM job_request_days WHERE is_holiday = true;
