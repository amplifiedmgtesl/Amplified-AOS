-- Normalize quote_lines and invoice_lines: add position_id + specialty_id FKs.
-- Text columns (department, position, specialty) stay in place as safety net /
-- historical snapshot per plan.

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS position_id  text,
  ADD COLUMN IF NOT EXISTS specialty_id text;

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS position_id  text,
  ADD COLUMN IF NOT EXISTS specialty_id text;

-- Seed position_id on quote_lines by matching positions.name to line.department
-- (department column was a backward-compat duplicate of the position name).
UPDATE quote_lines ql
SET position_id = p.id
FROM positions p
WHERE p.is_active = true
  AND lower(trim(ql.department)) = lower(trim(p.name))
  AND ql.position_id IS NULL;

-- Seed specialty_id on quote_lines by matching (position, specialty) pair.
UPDATE quote_lines ql
SET specialty_id = s.id
FROM specialties s
JOIN positions p ON p.id = s.position_id
WHERE s.is_active = true
  AND p.is_active = true
  AND lower(trim(ql.department)) = lower(trim(p.name))
  AND lower(trim(ql.specialty)) = lower(trim(s.name))
  AND ql.specialty_id IS NULL;

-- Same for invoice_lines
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
  AND lower(trim(il.specialty)) = lower(trim(s.name))
  AND il.specialty_id IS NULL;

-- Report unmatched
SELECT 'quote_lines' AS tbl, department AS position_text, specialty, count(*)
FROM quote_lines
WHERE position_id IS NULL AND coalesce(department, '') <> ''
GROUP BY department, specialty
UNION ALL
SELECT 'quote_lines (specialty only)', department, specialty, count(*)
FROM quote_lines
WHERE position_id IS NOT NULL AND specialty_id IS NULL AND coalesce(specialty, '') <> ''
GROUP BY department, specialty
UNION ALL
SELECT 'invoice_lines', department, specialty, count(*)
FROM invoice_lines
WHERE position_id IS NULL AND coalesce(department, '') <> ''
GROUP BY department, specialty
UNION ALL
SELECT 'invoice_lines (specialty only)', department, specialty, count(*)
FROM invoice_lines
WHERE position_id IS NOT NULL AND specialty_id IS NULL AND coalesce(specialty, '') <> ''
GROUP BY department, specialty;
