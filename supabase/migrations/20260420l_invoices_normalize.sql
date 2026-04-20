-- Normalize invoices: add client_id FK.
-- `client` text column kept for backward compat with downstream reads.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id text;

-- Seed client_id by matching on client name (case-insensitive, trimmed)
UPDATE invoices i
SET client_id = c.id
FROM clients c
WHERE lower(trim(i.client)) = lower(trim(c.name))
  AND i.client_id IS NULL;

-- Report unmatched
SELECT client, count(*) AS unmatched_count
FROM invoices
WHERE client_id IS NULL
  AND coalesce(client, '') <> ''
GROUP BY client;
