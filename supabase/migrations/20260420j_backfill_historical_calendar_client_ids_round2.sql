-- Round 2: backfill client_id on more historical calendar_events that
-- clearly map to existing canonical client records.

-- Lighthouse Cleveland → LHI
UPDATE calendar_events
SET client_id = 'clt-new-lhi',
    client    = 'Lighthouse Immersive Cleveland LLC'
WHERE client_id IS NULL
  AND lower(trim(client)) = 'lighthouse cleveland';

-- Jayson Entertainment / Jayson/Project Live → JAY
UPDATE calendar_events
SET client_id = 'clt-new-jay',
    client    = 'JAYSON Entertainment Group'
WHERE client_id IS NULL
  AND lower(trim(client)) IN (
    'jayson entertainment',
    'jayson/project live'
  );

-- Morris Farms → existing "Chris Stewart - Morris Farms" client
UPDATE calendar_events
SET client_id = 'clt-cf4e1df26e5b462fa32922829c06dbc3',
    client    = 'Chris Stewart - Morris Farms'
WHERE client_id IS NULL
  AND lower(trim(client)) = 'morris farms';

-- Row Crop Productions → LFT (Row Crop LLC - Vaden Group)
UPDATE calendar_events
SET client_id = 'clt-new-lft',
    client    = 'Row Crop LLC - Vaden Group'
WHERE client_id IS NULL
  AND lower(trim(client)) = 'row crop productions';

-- Report remaining unmatched
SELECT client, count(*)
FROM calendar_events
WHERE client_id IS NULL
GROUP BY client
ORDER BY count(*) DESC;
