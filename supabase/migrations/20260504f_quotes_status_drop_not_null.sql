-- Followup to 20260504c. The quotes.status column was originally NOT NULL with
-- DEFAULT 'draft'. Migration 20260504c added a CHECK that allows NULL while
-- is_draft=true (drafts have no issued-document lifecycle status), but didn't
-- remove the NOT NULL — so INSERTs with status=NULL fail at the column-level
-- constraint before reaching the CHECK.
--
-- Drop the NOT NULL. The new CHECK + draft/status consistency CHECK together
-- enforce: drafts must have NULL status, frozen rows must have a valid enum
-- value.

ALTER TABLE quotes ALTER COLUMN status DROP NOT NULL;
