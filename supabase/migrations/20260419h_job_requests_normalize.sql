-- Normalize job_requests: add client_id FK and linked_quote_id.
-- client text column kept for now; drop in a later migration.

ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS client_id       text,
  ADD COLUMN IF NOT EXISTS linked_quote_id text;

-- Seed client_id from clients table by matching on name (case-insensitive)
UPDATE job_requests jr
SET client_id = c.id
FROM clients c
WHERE lower(trim(jr.client)) = lower(trim(c.name))
  AND jr.client_id IS NULL;

-- Seed linked_quote_id from quotes that point back to this job request
UPDATE job_requests jr
SET linked_quote_id = q.id
FROM quotes q
WHERE q.linked_job_request_id = jr.id
  AND jr.linked_quote_id IS NULL;
