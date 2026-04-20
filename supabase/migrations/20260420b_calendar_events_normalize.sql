-- Add client_id FK and linked_job_request_id FK to calendar_events

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS client_id            text REFERENCES clients(id),
  ADD COLUMN IF NOT EXISTS linked_job_request_id text REFERENCES job_requests(id);

-- Seed client_id from client text field
UPDATE calendar_events ce
SET client_id = c.id
FROM clients c
WHERE lower(trim(ce.client)) = lower(trim(c.name))
  AND ce.client_id IS NULL;
