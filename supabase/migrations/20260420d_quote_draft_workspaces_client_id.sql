-- Add client_id FK to quote_draft_workspaces

ALTER TABLE quote_draft_workspaces
  ADD COLUMN IF NOT EXISTS client_id text REFERENCES clients(id);

-- Seed from JSONB data field where clientId is stored
UPDATE quote_draft_workspaces
SET client_id = data->>'clientId'
WHERE client_id IS NULL
  AND data->>'clientId' IS NOT NULL
  AND data->>'clientId' != '';
