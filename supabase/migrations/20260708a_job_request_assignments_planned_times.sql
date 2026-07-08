-- Planned (scheduled) times on crew assignments — the "planned" side of the
-- Planned-vs-Actual redesign (docs/timekeeping-planned-vs-actual-design.md §5.1).
--
-- Until now the crew-assignment import copied the day's SCHEDULED window into
-- the timesheet's ACTUAL time columns, conflating planned and actual in one
-- place. We separate the two by WHERE they live:
--   * planned = crew assignments (these columns + the day window fallback)
--   * actual  = timesheet_entries.time_in1..out2
--
-- Two-pair shape mirrors the timesheet (pair 1 + an optional pair 2 for a
-- meal-break split or a genuine second shift — see design §2). All nullable:
-- leave blank to fall back to the day window (job_request_days.start/end_time)
-- for display, the sign-in sheet, and the "copy planned -> actual" button.
--
-- Stored as text HH:MM (24h) to match job_request_days.start_time/end_time and
-- timesheet_entries.time_in1.. — no format conversion anywhere in the pipeline.

ALTER TABLE job_request_assignments
  ADD COLUMN IF NOT EXISTS planned_in1  text,
  ADD COLUMN IF NOT EXISTS planned_out1 text,
  ADD COLUMN IF NOT EXISTS planned_in2  text,
  ADD COLUMN IF NOT EXISTS planned_out2 text;

COMMENT ON COLUMN job_request_assignments.planned_in1  IS 'Planned start, pair 1 (HH:MM 24h). NULL = fall back to the day window.';
COMMENT ON COLUMN job_request_assignments.planned_out1 IS 'Planned end, pair 1 (HH:MM 24h). NULL = fall back to the day window.';
COMMENT ON COLUMN job_request_assignments.planned_in2  IS 'Planned start, pair 2 (HH:MM 24h) — meal-break return or second shift. NULL = none.';
COMMENT ON COLUMN job_request_assignments.planned_out2 IS 'Planned end, pair 2 (HH:MM 24h). NULL = none.';
