-- Normalize rate_card_profiles: add client_id FK and name field.
-- client_name kept for fallback.

ALTER TABLE rate_card_profiles
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS name      text;

-- Seed client_id from clients by matching on client_name (case-insensitive)
UPDATE rate_card_profiles rcp
SET client_id = c.id
FROM clients c
WHERE lower(trim(rcp.client_name)) = lower(trim(c.name))
  AND rcp.client_id IS NULL;

-- Seed name as 'Standard' for all existing records
UPDATE rate_card_profiles
SET name = 'Standard'
WHERE name IS NULL;
