-- Single-row settings table for AES (or whoever's running this app) company
-- info. Used by the quote / invoice PDFs for the letterhead, remit-to, etc.
--
-- Modeled as a singleton: PK is the literal text 'singleton', enforced by a
-- CHECK constraint, so there's exactly one row regardless of how many INSERTs.
-- Reads do `SELECT * FROM company_settings WHERE id = 'singleton'`.
--
-- Populate via: UPDATE company_settings SET company_name='...', ... WHERE id='singleton'.
-- A Maintenance UI for editing these can come later.

CREATE TABLE IF NOT EXISTS company_settings (
  id            text PRIMARY KEY DEFAULT 'singleton',
  company_name  text,
  address_line1 text,
  address_line2 text,
  city          text,
  state         text,
  zip           text,
  phone         text,
  email         text,
  website       text,
  tax_id        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  CHECK (id = 'singleton')
);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_settings_full_access" ON company_settings;
CREATE POLICY "company_settings_full_access"
  ON company_settings FOR ALL USING (true);

DROP TRIGGER IF EXISTS company_settings_audit_trg ON company_settings;
CREATE TRIGGER company_settings_audit_trg
  BEFORE INSERT OR UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Seed the singleton with placeholders. User updates in Maintenance later.
INSERT INTO company_settings (id, company_name, address_line1, city, state, zip, phone, email, website)
VALUES (
  'singleton',
  'Amplified Event Solutions',
  '(your street address)',
  '(city)',
  '(ST)',
  '(zip)',
  '(phone)',
  '(email)',
  '(website)'
)
ON CONFLICT (id) DO NOTHING;
