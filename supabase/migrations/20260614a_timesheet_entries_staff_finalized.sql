-- Staff finalization signal on timesheet_entries.
--
-- Crew leaders pre-build each day's worker rows in the timekeeping screen (planned
-- entries: status='submitted', timesheet_id set). Workers then enter their ACTUAL
-- time via the staff app, and may save repeatedly. There was no way for the crew
-- leader to tell "still entering" from "done." This adds an explicit, worker-set
-- flag the staff app toggles via a checkbox ("I'm done — final time for this shift").
--
--   staff_finalized     — true once the worker marks the entry final. Default false
--                         (planned/admin rows start not-finalized).
--   staff_finalized_at  — when they marked it (audit / "finalized at" display).
--
-- ADVISORY only: it does NOT gate approval. The crew leader can still approve any
-- row whenever they want; approval (status='approved') remains the hard lock.
--
-- The staff app WRITES these (authenticated UPDATE already granted on the table).
-- AOS only READS them (its entry upsert does not include these columns, so the
-- worker's value is never clobbered). Not added to the freeze trigger's content-
-- change list: it's advisory, and the staff app already blocks editing approved rows.

alter table public.timesheet_entries
  add column if not exists staff_finalized    boolean     not null default false,
  add column if not exists staff_finalized_at timestamptz;

comment on column public.timesheet_entries.staff_finalized is
  'Worker marked their actual time final (staff app checkbox). Advisory — does not gate approval.';
comment on column public.timesheet_entries.staff_finalized_at is
  'Timestamp the worker marked the entry final.';
