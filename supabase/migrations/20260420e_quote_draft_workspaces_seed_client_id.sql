-- Seed client_id on quote_draft_workspaces by matching the client name stored in the JSONB data blob

UPDATE quote_draft_workspaces qdw
SET client_id = c.id
FROM clients c
WHERE lower(trim(qdw.data->>'client')) = lower(trim(c.name))
  AND qdw.client_id IS NULL
  AND qdw.data->>'client' IS NOT NULL
  AND qdw.data->>'client' != '';
