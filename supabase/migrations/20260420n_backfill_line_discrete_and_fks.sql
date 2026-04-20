-- Cleanup migration: backfill discrete text columns and FK IDs on
-- quote_lines + invoice_lines from legacy service_key string.
--
-- Many older rows have department = NULL / specialty = NULL with all data
-- living inside service_key = "date | department | position | specialty | rateMode".
-- After this migration every seeded row has the discrete text columns
-- populated, plus position_id and specialty_id FKs wherever a match exists.

-- ─── Step 1: Backfill department + specialty from service_key ────────────────
-- service_key format: "date | department | position | specialty | rateMode"
-- parts[0]=date, parts[1]=department, parts[2]=position, parts[3]=specialty,
-- parts[4]=rateMode

UPDATE quote_lines
SET department = split_part(service_key, ' | ', 2)
WHERE department IS NULL
  AND service_key IS NOT NULL
  AND split_part(service_key, ' | ', 2) <> '';

UPDATE quote_lines
SET specialty = split_part(service_key, ' | ', 4)
WHERE specialty IS NULL
  AND service_key IS NOT NULL
  AND split_part(service_key, ' | ', 4) <> '';

UPDATE invoice_lines
SET department = split_part(service_key, ' | ', 2)
WHERE department IS NULL
  AND service_key IS NOT NULL
  AND split_part(service_key, ' | ', 2) <> '';

UPDATE invoice_lines
SET specialty = split_part(service_key, ' | ', 4)
WHERE specialty IS NULL
  AND service_key IS NOT NULL
  AND split_part(service_key, ' | ', 4) <> '';

-- ─── Step 2: Handle legacy position rename ("Fork Op" → "Forklift Operator") ─
-- Update the text value so downstream name match finds it.
UPDATE quote_lines
SET department = 'Forklift Operator'
WHERE lower(trim(department)) = 'fork op';

UPDATE invoice_lines
SET department = 'Forklift Operator'
WHERE lower(trim(department)) = 'fork op';

-- ─── Step 3: Re-run the position_id seed (now that text is populated) ───────
UPDATE quote_lines ql
SET position_id = p.id
FROM positions p
WHERE p.is_active = true
  AND lower(trim(ql.department)) = lower(trim(p.name))
  AND ql.position_id IS NULL;

UPDATE quote_lines ql
SET specialty_id = s.id
FROM specialties s
JOIN positions p ON p.id = s.position_id
WHERE s.is_active = true
  AND p.is_active = true
  AND lower(trim(ql.department)) = lower(trim(p.name))
  AND lower(trim(ql.specialty))  = lower(trim(s.name))
  AND ql.specialty_id IS NULL;

UPDATE invoice_lines il
SET position_id = p.id
FROM positions p
WHERE p.is_active = true
  AND lower(trim(il.department)) = lower(trim(p.name))
  AND il.position_id IS NULL;

UPDATE invoice_lines il
SET specialty_id = s.id
FROM specialties s
JOIN positions p ON p.id = s.position_id
WHERE s.is_active = true
  AND p.is_active = true
  AND lower(trim(il.department)) = lower(trim(p.name))
  AND lower(trim(il.specialty))  = lower(trim(s.name))
  AND il.specialty_id IS NULL;

-- ─── Step 4: Report anything still unseeded ──────────────────────────────────
SELECT 'quote_lines (no position_id)' AS issue, department, specialty, count(*)
FROM quote_lines
WHERE position_id IS NULL AND coalesce(department, '') <> ''
GROUP BY department, specialty
UNION ALL
SELECT 'quote_lines (no specialty_id)', department, specialty, count(*)
FROM quote_lines
WHERE position_id IS NOT NULL AND specialty_id IS NULL AND coalesce(specialty, '') <> ''
GROUP BY department, specialty
UNION ALL
SELECT 'invoice_lines (no position_id)', department, specialty, count(*)
FROM invoice_lines
WHERE position_id IS NULL AND coalesce(department, '') <> ''
GROUP BY department, specialty
UNION ALL
SELECT 'invoice_lines (no specialty_id)', department, specialty, count(*)
FROM invoice_lines
WHERE position_id IS NOT NULL AND specialty_id IS NULL AND coalesce(specialty, '') <> ''
GROUP BY department, specialty;
