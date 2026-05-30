-- Prepared By name + title on quotes. These appear on the rendered quote
-- PDF (legacy quote-builder had inputs for them). Pure additive — both
-- nullable, no backfill needed.

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS prepared_by_name  text;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS prepared_by_title text;
