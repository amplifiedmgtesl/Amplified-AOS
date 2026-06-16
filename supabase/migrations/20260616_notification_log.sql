-- Notifications module: audit log of every outbound email / SMS.
--
-- One row per channel per recipient per send attempt. Powers:
--   • "did X actually go out?" auditing
--   • idempotency (don't double-send when an event re-fires)
--   • a per-entity "last notified" UI + re-send
--
-- This table is the ONLY database footprint of the notifications module.
-- Sending happens via Resend (email) / Twilio (SMS) HTTP APIs in app code —
-- Supabase is not involved in delivery.

CREATE TABLE IF NOT EXISTS notification_log (
  id                  text PRIMARY KEY,              -- nlog-{millis}-{rand}
  event_type          text NOT NULL,                -- 'crew_assigned' | 'quote_issued' | 'invoice_issued' | 'internal_alert' | ...
  channel             text NOT NULL CHECK (channel IN ('email','sms')),
  entity_type         text,                          -- 'quote' | 'invoice' | 'crew_assignment' | ... (loose, cross-entity)
  entity_id           text,                          -- pointer to the source row
  to_address          text NOT NULL,                 -- email address or E.164 phone
  cc                  text,                          -- email only; comma-separated
  subject             text,                          -- email only
  body_snippet        text,                          -- first ~280 chars, for the audit view
  attachment_path     text,                          -- Storage key of the attached PDF, if any
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','failed','skipped')),
  skip_reason         text,                          -- when status='skipped': 'disabled' | 'duplicate' | 'no_address' | 'opted_out' | 'no_template'
  provider            text,                          -- 'resend' | 'twilio' | 'mock-email' | 'mock-sms'
  provider_message_id text,                          -- Resend/Twilio id for traceability
  error               text,                          -- provider error message on failure
  idempotency_key     text,                          -- dedupe key (event+entity+channel+address)
  sent_at             timestamptz,                   -- when the provider accepted it
  -- audit columns (set_audit_columns trigger, per project convention)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid
);

CREATE INDEX IF NOT EXISTS notification_log_entity_idx ON notification_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS notification_log_event_idx  ON notification_log (event_type);
CREATE INDEX IF NOT EXISTS notification_log_idem_idx   ON notification_log (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- RLS + Data API grants (required on every new table)
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_log_full_access" ON notification_log;
CREATE POLICY "notification_log_full_access" ON notification_log
  FOR ALL USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_log TO authenticated;

-- audit trigger (set_audit_columns defined in 20260503d_audit_columns_first_pass.sql)
DROP TRIGGER IF EXISTS notification_log_audit_trg ON notification_log;
CREATE TRIGGER notification_log_audit_trg
  BEFORE INSERT OR UPDATE ON notification_log
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();
