-- Master Default rate card: a single rate_card_profiles row + its 29 child
-- rate_card_profile_rows that mirror the previously-hardcoded DEFAULT_RATE_ROWS
-- in lib/rates/defaults.ts. Editable via the new "Master Rate Card" tab on
-- the Maintenance page; the regular Rate Card editor's "+ New" button seeds
-- from this profile instead of the code constant going forward.
--
-- Idempotent: ON CONFLICT DO NOTHING on the profile, and the rows skip if
-- the profile already had any (defensive against re-runs).

INSERT INTO rate_card_profiles (id, name, client_id, terms, created_at, updated_at)
VALUES ('ratecard-master-default', 'Master Default', NULL, '', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Seed the 29 rows ONLY if this profile is currently empty (so re-runs don't
-- multiply rows, and so manual edits in the Maintenance UI aren't clobbered).
DO $$
DECLARE existing int;
BEGIN
  SELECT count(*) INTO existing
  FROM rate_card_profile_rows
  WHERE profile_id = 'ratecard-master-default';

  IF existing > 0 THEN
    RAISE NOTICE 'Master default profile already has % rows; skipping seed.', existing;
    RETURN;
  END IF;

  INSERT INTO rate_card_profile_rows
    (id, profile_id, specialty_id, hourly, day, ot_rate, dt_rate, dt_after, travel, show, sort_order)
  VALUES
    ('rcm-001', 'ratecard-master-default', 'spc-01-01',  35,  350, 52.50,  70,   '10', 0, true,  0),
    ('rcm-002', 'ratecard-master-default', 'spc-01-02',  35,  350, 52.50,  70,   '10', 0, true,  1),
    ('rcm-003', 'ratecard-master-default', 'spc-01-03',  35,  350, 52.50,  70,   '10', 0, true,  2),
    ('rcm-004', 'ratecard-master-default', 'spc-01-04',  35,  350, 52.50,  70,   '10', 0, true,  3),
    ('rcm-005', 'ratecard-master-default', 'spc-01-05',  35,  350, 52.50,  70,   '10', 0, true,  4),
    ('rcm-006', 'ratecard-master-default', 'spc-01-06',  35,  350, 52.50,  70,   '10', 0, true,  5),
    ('rcm-007', 'ratecard-master-default', 'spc-03-01',  50,  500, 75.00, 100,   '10', 0, true,  6),
    ('rcm-008', 'ratecard-master-default', 'spc-03-02',  50,  500, 75.00, 100,   '10', 0, true,  7),
    ('rcm-009', 'ratecard-master-default', 'spc-03-03',  50,  500, 75.00, 100,   '10', 0, true,  8),
    ('rcm-010', 'ratecard-master-default', 'spc-03-04',  50,  500, 75.00, 100,   '10', 0, true,  9),
    ('rcm-011', 'ratecard-master-default', 'spc-04-01',  65,  650, 97.50, 130,   '10', 0, true, 10),
    ('rcm-012', 'ratecard-master-default', 'spc-04-02',  65,  650, 97.50, 130,   '10', 0, true, 11),
    ('rcm-013', 'ratecard-master-default', 'spc-04-03',  65,  650, 97.50, 130,   '10', 0, true, 12),
    ('rcm-014', 'ratecard-master-default', 'spc-08-01',  38,  380, 57.00,  76,   '10', 0, true, 13),
    ('rcm-015', 'ratecard-master-default', 'spc-08-02',  38,  380, 57.00,  76,   '10', 0, true, 14),
    ('rcm-016', 'ratecard-master-default', 'spc-08-03',  38,  380, 57.00,  76,   '10', 0, true, 15),
    ('rcm-017', 'ratecard-master-default', 'spc-05-01',  60,  600, 90.00, 120,   '10', 0, true, 16),
    ('rcm-018', 'ratecard-master-default', 'spc-05-02',  50,  500, 75.00, 100,   '10', 0, true, 17),
    ('rcm-019', 'ratecard-master-default', 'spc-06-01',  60,  600, 90.00, 120,   '10', 0, true, 18),
    ('rcm-020', 'ratecard-master-default', 'spc-06-02',  50,  500, 75.00, 100,   '10', 0, true, 19),
    ('rcm-021', 'ratecard-master-default', 'spc-07-01',  60,  600, 90.00, 120,   '10', 0, true, 20),
    ('rcm-022', 'ratecard-master-default', 'spc-07-02',  50,  500, 75.00, 100,   '10', 0, true, 21),
    ('rcm-023', 'ratecard-master-default', 'spc-09-01',  50,  500, 75.00, 100,   '10', 0, true, 22),
    ('rcm-024', 'ratecard-master-default', 'spc-09-02',  50,  500, 75.00, 100,   '10', 0, true, 23),
    ('rcm-025', 'ratecard-master-default', 'spc-10-01',  34,  340, 51.00,  68,   '10', 0, true, 24),
    ('rcm-026', 'ratecard-master-default', 'spc-10-02',  34,  340, 51.00,  68,   '10', 0, true, 25),
    ('rcm-027', 'ratecard-master-default', 'spc-10-03',  34,  340, 51.00,  68,   '10', 0, true, 26),
    ('rcm-028', 'ratecard-master-default', 'spc-10-04',  34,  340, 51.00,  68,   '10', 0, true, 27),
    ('rcm-029', 'ratecard-master-default', 'spc-10-05',  42,  420, 63.00,  84,   '10', 0, true, 28);
END $$;
