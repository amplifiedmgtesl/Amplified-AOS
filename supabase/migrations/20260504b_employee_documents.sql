-- Normalize employees.documents (jsonb) into a proper child table.
-- Bytes have always been in Supabase Storage (employee-assets bucket); this
-- migration just gives the metadata its own row+column structure with audit
-- columns, FK integrity, soft-delete, doc_type enum, and RLS — the same
-- pattern as job_request_attachments. Mirrors that shape so future
-- attachment/document features should follow this design (not jsonb arrays).
--
-- Safe to run: 0 rows have populated documents on dev or prod, so no
-- backfill is needed and the column drop is non-destructive.

CREATE TABLE IF NOT EXISTS employee_documents (
  id            text PRIMARY KEY,
  employee_key  text NOT NULL REFERENCES employees(employee_key) ON DELETE CASCADE,
  storage_path  text NOT NULL,            -- e.g. "AES-00042/docs/1764-w9.pdf"
  url           text NOT NULL,            -- public URL ready for <a href>
  file_name     text NOT NULL,            -- original filename for display
  description   text,
  doc_type      text NOT NULL DEFAULT 'other'
                  CHECK (doc_type IN (
                    'w9', 'i9', 'id', 'contract', 'certification',
                    'resume', 'photo', 'other'
                  )),
  mime_type     text,
  file_size     bigint,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid
);

CREATE INDEX IF NOT EXISTS employee_documents_employee_key_idx
  ON employee_documents(employee_key);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_documents_full_access" ON employee_documents;
CREATE POLICY "employee_documents_full_access"
  ON employee_documents FOR ALL USING (true);

-- Reuse the shared audit trigger from migration 20260503d
DROP TRIGGER IF EXISTS employee_documents_audit_trg ON employee_documents;
CREATE TRIGGER employee_documents_audit_trg
  BEFORE INSERT OR UPDATE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();

-- Drop the legacy jsonb column. 0 rows populated so no data loss.
ALTER TABLE employees DROP COLUMN IF EXISTS documents;
