-- Phase 2: Normalize rate_card_profiles.rows JSONB into rate_card_profile_rows table.
-- Each row references specialty_id (FK → specialties), dropping the redundant department column.

-- ─── Fix specialty name mismatch from Phase 1 seed ────────────────────────────
-- DEFAULT_RATE_ROWS uses "Large Fork Options"; seed had "Large Fork"
UPDATE specialties SET name = 'Large Fork Options' WHERE id = 'spc-08-03';

-- ─── New table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_card_profile_rows (
  id           text    PRIMARY KEY,
  profile_id   text    NOT NULL REFERENCES rate_card_profiles(id) ON DELETE CASCADE,
  specialty_id text    NOT NULL REFERENCES specialties(id),
  hourly       numeric NOT NULL DEFAULT 0,
  day          numeric NOT NULL DEFAULT 0,
  ot_rate      numeric NOT NULL DEFAULT 0,
  dt_rate      numeric NOT NULL DEFAULT 0,
  dt_after     text    NOT NULL DEFAULT '10',
  travel       numeric NOT NULL DEFAULT 0,
  show         boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS rate_card_profile_rows_profile_id_idx ON rate_card_profile_rows(profile_id);

-- ─── Backfill from JSONB ──────────────────────────────────────────────────────
-- Matches specialty by name. Skips rows where specialty name has no match
-- (those stay in JSONB only until manually corrected).
INSERT INTO rate_card_profile_rows (
  id, profile_id, specialty_id, hourly, day, ot_rate, dt_rate, dt_after, travel, show, sort_order
)
SELECT
  rcp.id || '_' || t.ordinality,
  rcp.id,
  s.id,
  COALESCE((t.row_data->>'hourly')::numeric,  0),
  COALESCE((t.row_data->>'day')::numeric,     0),
  COALESCE((t.row_data->>'otRate')::numeric,  0),
  COALESCE((t.row_data->>'dtRate')::numeric,  0),
  COALESCE(t.row_data->>'dtAfter', '10'),
  COALESCE((t.row_data->>'travel')::numeric,  0),
  COALESCE((t.row_data->>'show')::boolean,    true),
  t.ordinality::integer
FROM rate_card_profiles rcp
CROSS JOIN LATERAL jsonb_array_elements(rcp.rows) WITH ORDINALITY AS t(row_data, ordinality)
JOIN specialties s ON s.name = t.row_data->>'specialty'
WHERE rcp.rows IS NOT NULL
  AND jsonb_array_length(rcp.rows) > 0
ON CONFLICT (id) DO NOTHING;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE rate_card_profile_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_card_profile_rows_full_access" ON rate_card_profile_rows
  FOR ALL USING (true);
