-- Backfill shift_label, quote_date, and rate_mode discrete columns
-- from service_key. Only applies where the discrete column is currently NULL.
--
-- service_key formats:
--   5-part: "date | department | position | specialty | rateMode"   (no shift)
--   6-part: "date | department | position | specialty | shift | rateMode"

-- ─── Backfill quote_date ─────────────────────────────────────────────────────
-- parts[0] in both formats. Only set if it looks like a YYYY-MM-DD.
UPDATE quote_lines
SET quote_date = split_part(service_key, ' | ', 1)
WHERE quote_date IS NULL
  AND service_key IS NOT NULL
  AND split_part(service_key, ' | ', 1) ~ '^\d{4}-\d{2}-\d{2}$';

UPDATE invoice_lines
SET quote_date = split_part(service_key, ' | ', 1)
WHERE quote_date IS NULL
  AND service_key IS NOT NULL
  AND split_part(service_key, ' | ', 1) ~ '^\d{4}-\d{2}-\d{2}$';

-- ─── Backfill shift_label (only for 6-part service_keys) ─────────────────────
-- Detect 6-part: 6 separators means 6 parts. Specifically, parts[5] (rateMode)
-- must exist and be "hourly" or "day".
UPDATE quote_lines
SET shift_label = split_part(service_key, ' | ', 5)
WHERE shift_label IS NULL
  AND service_key IS NOT NULL
  AND lower(split_part(service_key, ' | ', 6)) IN ('hourly', 'day')
  AND split_part(service_key, ' | ', 5) <> '';

UPDATE invoice_lines
SET shift_label = split_part(service_key, ' | ', 5)
WHERE shift_label IS NULL
  AND service_key IS NOT NULL
  AND lower(split_part(service_key, ' | ', 6)) IN ('hourly', 'day')
  AND split_part(service_key, ' | ', 5) <> '';

-- ─── Backfill rate_mode ──────────────────────────────────────────────────────
-- parts[5] in 6-part, parts[4] in 5-part.
UPDATE quote_lines
SET rate_mode = split_part(service_key, ' | ', 6)
WHERE rate_mode IS NULL
  AND service_key IS NOT NULL
  AND lower(split_part(service_key, ' | ', 6)) IN ('hourly', 'day');

UPDATE quote_lines
SET rate_mode = split_part(service_key, ' | ', 5)
WHERE rate_mode IS NULL
  AND service_key IS NOT NULL
  AND lower(split_part(service_key, ' | ', 5)) IN ('hourly', 'day');

UPDATE invoice_lines
SET rate_mode = split_part(service_key, ' | ', 6)
WHERE rate_mode IS NULL
  AND service_key IS NOT NULL
  AND lower(split_part(service_key, ' | ', 6)) IN ('hourly', 'day');

UPDATE invoice_lines
SET rate_mode = split_part(service_key, ' | ', 5)
WHERE rate_mode IS NULL
  AND service_key IS NOT NULL
  AND lower(split_part(service_key, ' | ', 5)) IN ('hourly', 'day');

-- ─── Report rows still missing any of the discrete columns ──────────────────
SELECT 'quote_lines' AS tbl,
       count(*) FILTER (WHERE shift_label IS NULL) AS null_shift,
       count(*) FILTER (WHERE quote_date  IS NULL) AS null_date,
       count(*) FILTER (WHERE rate_mode   IS NULL) AS null_rate_mode
FROM quote_lines
UNION ALL
SELECT 'invoice_lines',
       count(*) FILTER (WHERE shift_label IS NULL),
       count(*) FILTER (WHERE quote_date  IS NULL),
       count(*) FILTER (WHERE rate_mode   IS NULL)
FROM invoice_lines;
