-- Add discrete UI columns to quote_lines and invoice_lines.
-- These replace the fragile serviceKey/rule string parsing in the client.

-- ─── quote_lines ──────────────────────────────────────────────────────────────

ALTER TABLE quote_lines
  ADD COLUMN IF NOT EXISTS department  text,
  ADD COLUMN IF NOT EXISTS specialty   text,
  ADD COLUMN IF NOT EXISTS shift_label text,
  ADD COLUMN IF NOT EXISTS quote_date  text,
  ADD COLUMN IF NOT EXISTS start_time  text,
  ADD COLUMN IF NOT EXISTS end_time    text,
  ADD COLUMN IF NOT EXISTS rate_mode   text;

-- Backfill new format: "date | department | dep | specialty | shiftLabel | rateMode" (6+ parts)
UPDATE quote_lines SET
  quote_date  = split_part(service_key, ' | ', 1),
  department  = split_part(service_key, ' | ', 2),
  specialty   = split_part(service_key, ' | ', 4),
  shift_label = split_part(service_key, ' | ', 5),
  rate_mode   = split_part(service_key, ' | ', 6),
  start_time  = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 1),
  end_time    = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 2)
WHERE array_length(string_to_array(service_key, ' | '), 1) >= 6;

-- Backfill old format: "department | specialty" (2 parts, no date/shift info)
UPDATE quote_lines SET
  department  = split_part(service_key, ' | ', 1),
  specialty   = split_part(service_key, ' | ', 2),
  shift_label = 'Shift 1',
  rate_mode   = 'hourly',
  quote_date  = '',
  start_time  = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 1),
  end_time    = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 2)
WHERE array_length(string_to_array(service_key, ' | '), 1) = 2;

-- ─── invoice_lines ────────────────────────────────────────────────────────────

ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS department  text,
  ADD COLUMN IF NOT EXISTS specialty   text,
  ADD COLUMN IF NOT EXISTS shift_label text,
  ADD COLUMN IF NOT EXISTS quote_date  text,
  ADD COLUMN IF NOT EXISTS start_time  text,
  ADD COLUMN IF NOT EXISTS end_time    text,
  ADD COLUMN IF NOT EXISTS rate_mode   text;

-- Backfill new format
UPDATE invoice_lines SET
  quote_date  = split_part(service_key, ' | ', 1),
  department  = split_part(service_key, ' | ', 2),
  specialty   = split_part(service_key, ' | ', 4),
  shift_label = split_part(service_key, ' | ', 5),
  rate_mode   = split_part(service_key, ' | ', 6),
  start_time  = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 1),
  end_time    = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 2)
WHERE array_length(string_to_array(service_key, ' | '), 1) >= 6;

-- Backfill old format
UPDATE invoice_lines SET
  department  = split_part(service_key, ' | ', 1),
  specialty   = split_part(service_key, ' | ', 2),
  shift_label = 'Shift 1',
  rate_mode   = 'hourly',
  quote_date  = '',
  start_time  = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 1),
  end_time    = split_part(split_part(COALESCE(rule,''), ' | ', 1), ' to ', 2)
WHERE array_length(string_to_array(service_key, ' | '), 1) = 2;
