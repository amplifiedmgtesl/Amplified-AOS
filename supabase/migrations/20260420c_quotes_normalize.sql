-- Add client_id FK to quotes table

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS client_id text REFERENCES clients(id);

-- Seed client_id from client text field
UPDATE quotes q
SET client_id = c.id
FROM clients c
WHERE lower(trim(q.client)) = lower(trim(c.name))
  AND q.client_id IS NULL;
