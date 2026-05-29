-- Hire date on employees, so HR can identify who still needs onboarding.
--
-- Hiring is not done by HR at AES — coordinators add contractors on the
-- fly from the Timekeeping screen (and the Employee Directory). HR has
-- no signal today that a new person hit the roster. hire_date gives
-- them a column to filter / sort on, plus a basis for an onboarding
-- backlog report later.
--
-- The Timekeeping inline-create flow stamps this with today's date so
-- HR sees an accurate "added on" timestamp without coordinator effort.
-- The Employee Directory form exposes it as a normal editable field;
-- HR / admin can correct it for historical employees during a backfill
-- pass.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hire_date date;

-- No backfill: NULL on existing rows is the correct "we don't know
-- when this person was hired" signal. HR's onboarding backlog query
-- will treat NULL the same as a recent date (i.e. "needs review")
-- depending on the rule we land on.

COMMENT ON COLUMN employees.hire_date IS
  'Date the person was added to the roster. Auto-stamped (today) by the on-the-fly create flow from Timekeeping. NULL on legacy rows pre-2026-05-28.';
