-- Phase 1: Create specialties master table
-- Specialties are child records of positions (FK).
-- Every position must have at least one specialty.

CREATE TABLE IF NOT EXISTS specialties (
  id          text    PRIMARY KEY,
  position_id text    NOT NULL REFERENCES positions(id),
  name        text    NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS specialties_position_id_idx ON specialties(position_id);

-- ─── Seed data ────────────────────────────────────────────────────────────────
-- Mapped from DEFAULT_RATE_ROWS with confirmed position reconciliations:
--   Rigger 1  → pos-04 (Head Rigger)
--   Fork Op   → pos-08 (Forklift Operator)
--   Camera Op → pos-09 (Camera Operator)

INSERT INTO specialties (id, position_id, name, sort_order) VALUES
  -- pos-01 Stagehand
  ('spc-01-01', 'pos-01', 'Labor',          1),
  ('spc-01-02', 'pos-01', 'Show Call',       2),
  ('spc-01-03', 'pos-01', 'AVL',             3),
  ('spc-01-04', 'pos-01', 'Stage',           4),
  ('spc-01-05', 'pos-01', 'Scaffolding',     5),
  ('spc-01-06', 'pos-01', 'Loader',          6),
  -- pos-02 Stagehand Lead
  ('spc-02-01', 'pos-02', 'Stagehand Lead',  1),
  -- pos-03 Rigger
  ('spc-03-01', 'pos-03', 'Climber',         1),
  ('spc-03-02', 'pos-03', 'Operator',        2),
  ('spc-03-03', 'pos-03', 'Up',              3),
  ('spc-03-04', 'pos-03', 'Down',            4),
  -- pos-04 Head Rigger (formerly Rigger 1)
  ('spc-04-01', 'pos-04', 'Head Rigger',     1),
  ('spc-04-02', 'pos-04', 'High Steel',      2),
  ('spc-04-03', 'pos-04', 'Rope Access',     3),
  -- pos-05 Audio Technician
  ('spc-05-01', 'pos-05', 'A1',              1),
  ('spc-05-02', 'pos-05', 'A2',              2),
  -- pos-06 Lighting Technician
  ('spc-06-01', 'pos-06', 'L1',              1),
  ('spc-06-02', 'pos-06', 'L2',              2),
  -- pos-07 Video Technician
  ('spc-07-01', 'pos-07', 'V1',              1),
  ('spc-07-02', 'pos-07', 'V2',              2),
  -- pos-08 Forklift Operator (formerly Fork Op)
  ('spc-08-01', 'pos-08', 'Shop',            1),
  ('spc-08-02', 'pos-08', 'Telendler',       2),
  ('spc-08-03', 'pos-08', 'Large Fork',      3),
  -- pos-09 Camera Operator (formerly Camera Op)
  ('spc-09-01', 'pos-09', 'Tripod',          1),
  ('spc-09-02', 'pos-09', 'Mobile',          2),
  -- pos-10 Operations
  ('spc-10-01', 'pos-10', 'Prod. Runner',    1),
  ('spc-10-02', 'pos-10', 'Prod. Assist',    2),
  ('spc-10-03', 'pos-10', 'Services',        3),
  ('spc-10-04', 'pos-10', 'Steward',         4),
  ('spc-10-05', 'pos-10', 'Crew Chief',      5),
  -- pos-11 Lead
  ('spc-11-01', 'pos-11', 'Lead',            1),
  -- pos-12 Heavy Equipment Op
  ('spc-12-01', 'pos-12', 'Heavy Equipment Op', 1),
  -- pos-13 Aerial Lift Operator
  ('spc-13-01', 'pos-13', 'Aerial Lift Operator', 1),
  -- pos-14 General Labor
  ('spc-14-01', 'pos-14', 'General Labor',   1),
  -- pos-15 Other
  ('spc-15-01', 'pos-15', 'Other',           1)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE specialties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "specialties_full_access" ON specialties
  FOR ALL USING (true);
