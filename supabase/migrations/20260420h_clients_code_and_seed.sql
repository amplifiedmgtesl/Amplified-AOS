-- Add client code column and seed clean client records provided by the business.
-- These are the canonical records; existing duplicates will be merged into them
-- via the Client Maintenance merge UI.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS code text;

INSERT INTO clients (id, name, code, address, city, state, zip, is_active) VALUES
  ('clt-new-jay', 'JAYSON Entertainment Group',         'JAY', '1005 Lavern Circle',         'Hendersonville', 'TN', '37075', true),
  ('clt-new-lnc', 'Loud&Clear, Inc.',                   'LNC', '10310 Julian Dr',            'Cincinnati',     'OH', '45215', true),
  ('clt-new-csg', 'CSG Productions, LLC.',              'CSG', '216 Angell Knoll Ave',       'Mocksville',     'NC', '27028', true),
  ('clt-new-lhi', 'Lighthouse Immersive Cleveland LLC', 'LHI', '850 E 72 Street',            'Cleveland',      'OH', '44103', true),
  ('clt-new-lft', 'Row Crop LLC - Vaden Group',         'LFT', '1600 Division St. Suite 225','Nashville',      'TN', '37203', true),
  ('clt-new-stw', 'Stageworx AV Group LLC',             'STW', '3729 Boettler Oaks Dr',      'Uniontown',      'OH', '44685', true),
  ('clt-new-alv', 'Alive Productions, Inc.',            'ALV', '7147 Wild Fox Run Ave NW',   'Massillon',      'OH', '44646', true)
ON CONFLICT (id) DO NOTHING;
