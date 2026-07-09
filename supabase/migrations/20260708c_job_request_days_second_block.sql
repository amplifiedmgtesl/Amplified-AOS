-- Second time block (pair 2) on the day record — the day-level default for a
-- work → meal → work schedule (Planned-vs-Actual redesign follow-up).
--
-- job_request_days already carries a single window (start_time / end_time =
-- pair 1). Real event days are usually two blocks (e.g. 08:00–13:00, then back
-- 14:00–19:00). Adding pair 2 here — on the ONE shared day record that both the
-- Daily Requirements tab and the Assigned Crew tab read — lets a coordinator set
-- the realistic two-block schedule once per day, and have it flow to:
--   * the Assigned Crew planned-times fallback (pair 2 placeholder),
--   * the "copy planned → actual" button (fills actual pair 2), and
--   * the crew sign-in sheet's Expected column.
-- Per-worker planned times on job_request_assignments stay the exception override.
--
-- Nullable text HH:MM to match start_time/end_time. NULL pair 2 = single-block day.

ALTER TABLE job_request_days
  ADD COLUMN IF NOT EXISTS start_time2 text,
  ADD COLUMN IF NOT EXISTS end_time2   text;

COMMENT ON COLUMN job_request_days.start_time2 IS 'Day-level second-block start (HH:MM 24h) — e.g. after-lunch return. NULL = single-block day.';
COMMENT ON COLUMN job_request_days.end_time2   IS 'Day-level second-block end (HH:MM 24h). NULL = single-block day.';
