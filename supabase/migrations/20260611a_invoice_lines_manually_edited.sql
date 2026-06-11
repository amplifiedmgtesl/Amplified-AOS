-- invoice_lines.manually_edited — operator-corrected pulled lines.
--
-- Connor's workflow: pull labor actuals from timesheets, then hand-correct
-- individual lines (rates, hours, descriptions). Before this flag, a
-- subsequent "Overwrite from Timesheets" wiped every non-manual_override
-- line, destroying those corrections. The editor now sets this flag the
-- moment a pulled (timesheet_entry / quote_line sourced) line is edited,
-- and the overwrite path preserves flagged lines the same way it preserves
-- manual_override lines — only untouched lines are rebuilt, new timesheet
-- days are added alongside.
--
-- The flag is also directly toggleable in the draft editor ("corrected —
-- preserve on re-pull") so lines edited BEFORE this feature shipped can be
-- marked by hand.

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS manually_edited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN invoice_lines.manually_edited IS
  'Operator hand-corrected this pulled line; Overwrite from Timesheets preserves it instead of rebuilding it.';
