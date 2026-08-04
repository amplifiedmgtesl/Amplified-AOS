-- Exemptions from the daily payroll rules (5-hour minimum + round-up).
--
-- Connor's standing payroll policy applies two adjustments to every
-- (employee, work_date, shift) group at snapshot time — see
-- applyDailyRulesToCandidates in lib/store/payroll.ts:
--   1. floor the day's hours at PAYROLL_DAILY_MINIMUM_HOURS (5)
--   2. round the day's total UP to the next whole hour
--
-- Two situations must escape BOTH rules and pay the exact hours worked
-- (confirmed by Connor via John, 2026-08-04 — the round-up is waived
-- alongside the minimum, not just the minimum):
--
--   A. The "generic" internal job Connor set up under an Amplified client
--      so coordinators can log their own time. Office time isn't a crew
--      call-out, so the 5-hour courtesy minimum doesn't apply. Flagged
--      once on the job and inherited by every entry against it.
--
--   B. A worker who shows up late for a call still gets paid, but
--      forfeits the minimum for that shift. Flagged per timesheet entry
--      by whoever has timekeeping access (crew leader, coordinator,
--      payroll, admin).
--
-- Effective rule at calc time: exempt = job flag OR entry flag. The
-- snapshot column on payroll_run_entries records what was actually
-- applied so a finalized run explains itself without re-joining.
--
-- Named "daily_rules" rather than "minimum" on purpose: the flag waives
-- the whole daily adjustment, both rules. The on-screen label still says
-- "5-hour minimum" because that's the business's name for the policy.

-- ─── Schema ─────────────────────────────────────────────────────────────
ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS payroll_daily_rules_exempt boolean NOT NULL DEFAULT false;

ALTER TABLE timesheet_entries
  ADD COLUMN IF NOT EXISTS payroll_daily_rules_exempt boolean NOT NULL DEFAULT false;

ALTER TABLE payroll_run_entries
  ADD COLUMN IF NOT EXISTS payroll_daily_rules_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN job_requests.payroll_daily_rules_exempt IS
  'When true, entries against this job skip BOTH daily payroll rules (5hr minimum and round-up to whole hour) and pay exact hours worked. Set on the internal/generic job used for coordinator time.';
COMMENT ON COLUMN timesheet_entries.payroll_daily_rules_exempt IS
  'Per-entry override of the daily payroll rules — set when a worker arrives late and forfeits the 5hr minimum for that shift. ORed with the parent job flag at payroll snapshot time.';
COMMENT ON COLUMN payroll_run_entries.payroll_daily_rules_exempt IS
  'Snapshot of the effective exemption (job OR entry) at the moment this run entry was created. Read back by recomputeDailyRulesForRun.';

-- ─── Freeze trigger: deliberately NOT extended ──────────────────────────
-- timesheet_entries_freeze_check() enumerates the columns it protects.
-- The new column is intentionally absent from that list, so the flag stays
-- editable on approved and invoice-bound entries — it is a pay-side
-- classification and has no effect on the billing record the freeze
-- protects. Editing after the entry is already on a payroll run IS
-- blocked, but in the UI (checkbox disabled once payroll_run_id is set),
-- because flipping it there would silently disagree with the run's
-- snapshotted hours.
--
-- Note for whoever rewrites this trigger as part of the #4 linking
-- redesign: if the allowlist becomes a denylist, this column must be
-- explicitly excluded from protection or the late-arrival workflow breaks.

-- ─── Smoke test ─────────────────────────────────────────────────────────
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t.tbl, ', ') INTO missing
  FROM (VALUES ('job_requests'), ('timesheet_entries'), ('payroll_run_entries')) AS t(tbl)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = t.tbl
       AND column_name = 'payroll_daily_rules_exempt'
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'payroll_daily_rules_exempt column missing on: %', missing;
  END IF;
END $$;
