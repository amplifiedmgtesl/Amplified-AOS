-- Backfill client_id on historical 2024 calendar_events where the legacy
-- `client` text value clearly maps to an existing canonical client.
-- Also updates the text column to the canonical name for consistency.

-- Lighthouse Immersive → LHI
UPDATE calendar_events
SET client_id = 'clt-new-lhi',
    client    = 'Lighthouse Immersive Cleveland LLC'
WHERE client_id IS NULL
  AND lower(trim(client)) = 'lighthouse immersive';

-- Loud and Clear LLC → LNC
UPDATE calendar_events
SET client_id = 'clt-new-lnc',
    client    = 'Loud&Clear, Inc.'
WHERE client_id IS NULL
  AND lower(trim(client)) = 'loud and clear llc';

-- Project Live/Jayson Ent → JAY
UPDATE calendar_events
SET client_id = 'clt-new-jay',
    client    = 'JAYSON Entertainment Group'
WHERE client_id IS NULL
  AND lower(trim(client)) = 'project live/jayson ent';

-- Sunbelt variants → existing "Sunbelt Ground Protection Division"
UPDATE calendar_events
SET client_id = 'clt-ad61aaef5cd35ccaa04d0a1245456058',
    client    = 'Sunbelt Ground Protection Division'
WHERE client_id IS NULL
  AND lower(trim(client)) IN (
    'sunbelt floor division',
    'sunbelt floor protection',
    'sunbelt flooring division',
    'sunbelt floor protection division'
  );

-- Report anything still unmatched
SELECT client, count(*)
FROM calendar_events
WHERE client_id IS NULL
GROUP BY client
ORDER BY count(*) DESC;
