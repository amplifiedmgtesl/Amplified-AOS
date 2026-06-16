# Event-Driven Notifications (Email + SMS) — Spec

Status: **Draft v1** (2026-06-16) — design agreed, not started. May start sooner rather than later.
Owner: jobrien

## Goal

Send **email and/or SMS automatically when certain events happen in AOS** — fire-and-forget,
triggered by the event, with no template-opening or confirmation modal. The message content is
fixed in code per event (a server-rendered template), not edited by the user at send time.

This is the *automated transactional* slice of the broader
[Communications & external calendar integrations project](#) — it intentionally skips the
editable confirmation-modal flow that project also describes.

## Channels & providers

| Concern | Choice | Notes |
|---|---|---|
| Email | **Resend** | Called via HTTP API directly from AOS server code. **Separate, client-owned Resend account** (AOS is a client — billing/domain/reputation stay with Amplified). |
| SMS | **Twilio** | Requires A2P 10DLC brand + campaign registration (carrier-mandated for US business SMS). |
| Data + audit | Supabase Postgres | Stores recipients and the `notification_log`. **Not** used for sending. |

### This does NOT use Supabase's email

Supabase's email rate limits apply only to its built-in **auth mailer** (signup/reset/magic-link),
which uses a throttled shared SMTP. None of that is touched here. AOS server code calls Resend's
and Twilio's HTTP APIs directly; Supabase is only the database + audit store. The throttle that bit
the other project does not exist on this path.

> Optional, separate: AOS's *Supabase auth* SMTP can also be pointed at the same client-owned Resend
> account to fix auth-mail throttling. Independent config change; not part of this build.

## Events in scope

| Event | Trigger location | Email | SMS | PDF attachment |
|---|---|---|---|---|
| **Crew assignment / confirmation** | Crew-assignment action (server) | ✅ | ✅ (best fit — texts get read) | No |
| **Quote / invoice issued** | The "Issue" action (browser → server) | ✅ | — | **Yes** (the document PDF) |
| **Internal alert to staff/IT** | Wherever the condition is detected (server) | ✅ | optional | No |

SMS is inherently the *plain-notification* channel (no attachments). Quote/invoice stays email
because it needs the PDF.

## Architecture

```
Event fires
   │
   ▼
dispatchNotification({ event, channels, recipients, data, attachments? })
   │  ├─► lib/email/send.ts   → Resend API   ─┐
   │  └─► lib/sms/send.ts     → Twilio API    ├─► write notification_log row (per channel)
   │                                          ─┘
   ▼
recipient
```

A single **channel dispatcher** is the seam. Events emit a notification with a desired channel set;
the dispatcher routes to email and/or SMS and writes one `notification_log` row per channel/recipient.
Building this seam from the start avoids bolting SMS on awkwardly later.

### Where the send runs

All sends run **server-side** (never expose provider keys to the browser). Two homes, by trigger type:

- **Next.js API route / server action** (`app/api/notifications/...`) — default. Co-located with the
  app, follows the existing `supabaseAdmin` + Bearer-token guard pattern in
  [app/api/users/route.ts](../app/api/users/route.ts). Used for crew assignment, quote/invoice issue,
  and most internal alerts (all app-driven).
- **Supabase Edge Function + DB webhook** — only if a future event is a pure data change with no UI
  action behind it. Note: even there, the function calls Resend/Twilio, not any Supabase mailer.

## Data model

### `notification_log` (new table)

One row per channel per recipient per send. Covers "did X actually go out?", idempotency, and re-send.

```sql
CREATE TABLE notification_log (
  id                  text PRIMARY KEY,              -- e.g. nlog-{millis}-{rand}
  event_type          text NOT NULL,                 -- 'crew_assigned' | 'quote_issued' | 'invoice_issued' | 'internal_alert' | ...
  channel             text NOT NULL CHECK (channel IN ('email','sms')),
  entity_type         text,                          -- 'quote' | 'invoice' | 'job_request' | 'crew_assignment' | null
  entity_id           text,                          -- FK-ish pointer to the source row (kept loose; cross-entity)
  to_address          text NOT NULL,                 -- email address or E.164 phone
  cc                  text,                          -- email only; comma-separated
  subject             text,                          -- email only
  body_snippet        text,                          -- first ~200 chars, for the audit view
  attachment_path     text,                          -- Storage key of the attached PDF, if any
  status              text NOT NULL DEFAULT 'queued' -- 'queued' | 'sent' | 'failed'
                        CHECK (status IN ('queued','sent','failed')),
  provider            text,                          -- 'resend' | 'twilio'
  provider_message_id text,                          -- Resend/Twilio id for traceability
  error               text,                          -- provider error message on failure
  sent_at             timestamptz,                   -- when the provider accepted it
  -- audit columns (set_audit_columns trigger, per convention)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid
);

CREATE INDEX notification_log_entity_idx ON notification_log (entity_type, entity_id);
CREATE INDEX notification_log_event_idx  ON notification_log (event_type);

-- RLS + Data API grants (per project convention)
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_log_full_access" ON notification_log FOR ALL USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_log TO authenticated;

-- audit trigger (set_audit_columns defined in 20260503d)
DROP TRIGGER IF EXISTS notification_log_audit_trg ON notification_log;
CREATE TRIGGER notification_log_audit_trg
  BEFORE INSERT OR UPDATE ON notification_log
  FOR EACH ROW EXECUTE FUNCTION set_audit_columns();
```

### Recipient phone data (prerequisite for SMS)

Phone columns already exist: `employees.phone`, `client_contacts.phone`, `clients.phone` — but as
**freeform text**. Before SMS can send:
- Add a normalize-to-E.164 (`+1XXXXXXXXXX`) guard on save, and
- One-time backfill sweep of existing rows.
- Honor opt-out: add `sms_opt_out boolean DEFAULT false` (Twilio handles `STOP`/`START`, but we must
  not send to opted-out numbers).

### PDF attachments — capture-at-issue + Storage (recommended strategy)

AOS PDFs are produced **browser-side** today via a print-ready route
([components/shared/quote-pdf-view.tsx](../components/shared/quote-pdf-view.tsx) at `/quotes/[id]/pdf`,
[components/shared/invoice-pdf-view.tsx](../components/shared/invoice-pdf-view.tsx)) and the browser
print dialog ([lib/print-with-title.ts](../lib/print-with-title.ts)). There is **no server-side PDF
generation**.

Rather than introduce headless Chromium on the server, capture at issue time:

1. On the "Issue" action (user is in the browser, where the print route works), render the document to
   a PDF blob client-side.
2. Upload to a dedicated Supabase Storage bucket `notification-documents`, path
   `{entity_type}/{entity_id}/{timestamp}-{safe-name}.pdf` — following the
   **canonical attachment storage pattern** (child-table + bucket + helper module; never jsonb).
3. The email send attaches the **stored** file (or links to a signed URL). Re-sends reuse the stored
   copy — the audit trail keeps exactly what went out.

This reuses 100% of the existing PDF layout, needs no server Chromium, and gives a stored copy for the
audit trail. It works because issuance is always a user-in-browser action.

> Alternatives considered: headless Chromium server-side (`@sparticuz/chromium` on Vercel — cold
> starts, binary-size pain, needs the print route authed for the server) and a hosted HTML→PDF API
> (DocRaptor/PDFShift — extra paid vendor). Capture-at-issue wins on least-new-infrastructure.

## Code surfaces (new)

```
lib/notifications/dispatch.ts     # dispatchNotification() — the channel seam
lib/email/send.ts                 # Resend wrapper; writes notification_log
lib/sms/send.ts                   # Twilio wrapper; writes notification_log
lib/notifications/templates/      # one module per event (subject + html/text builders)
app/api/notifications/route.ts    # server entry for app-driven sends (Bearer-guarded)
supabase/migrations/<date>_notification_log.sql
supabase/migrations/<date>_phone_e164_and_opt_out.sql   # SMS prerequisite
```

### Env vars (server-only — never `NEXT_PUBLIC_`)

```
RESEND_API_KEY=               # AOS's own client-owned Resend account
NOTIFICATIONS_FROM_EMAIL=     # e.g. noreply@amplifiedesl.com (verified sending domain)
NOTIFICATIONS_CC_EMAIL=       # John, CC'd on outbound for the trail (see Safety)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
NOTIFICATIONS_ENABLED=        # 'true' to actually send; otherwise log-only (see Safety)
```

Add these to `.env.example` (placeholders) and the deployment env. Keep secrets out of the repo.

## Safety / rollout guards

Automatic, no-confirmation sending means a misfire emails or texts a real client instantly. Required
guards:

- **`NOTIFICATIONS_ENABLED` flag** — when not `'true'`, the dispatcher writes a `notification_log` row
  with `status='queued'` but does **not** call the provider. Lets you exercise the full path on Preview
  (against the dev DB) without touching real recipients.
- **CC John on all outbound email** (`NOTIFICATIONS_CC_EMAIL`) — paper trail + early warning of misfires.
- **Idempotency** — before sending, check `notification_log` for an existing `sent` row matching
  `(event_type, entity_id, channel, to_address)` so a re-fired event doesn't double-send.
- **First rollout** points at John's own inbox / phone before any client address is wired.
- **SMS opt-out** is honored (`sms_opt_out`); never text an opted-out number.

## Audit UI (later, optional)

On the quote/invoice (and crew) screens, surface "Last emailed to AP@client on 2026-05-02 ✓" with a
re-send button, read from `notification_log`. Re-send is a good candidate for **IT-only gating**
(`useUserEmail()` + `IT_EMAIL`, tooltip starts "IT-only recovery action.") until trusted.

## Effort & sequencing

Build the foundation + channel seam first, plain-body events next, PDF email last. Kick off Twilio
10DLC registration on **day one** so the carrier-approval clock (days–weeks) runs in parallel.

| Phase | Work | Est. |
|---|---|---|
| 0 | **Kick off Twilio 10DLC registration** (form + wait). Create client-owned Resend account, verify sending domain (DNS/DKIM). | ~1–2 hr work + wall-clock wait |
| 1 | `notification_log` migration (RLS/grants/audit). `dispatch.ts` seam + `email/send.ts` (Resend). `NOTIFICATIONS_ENABLED` log-only mode. | ~1 day |
| 2 | **Internal alert** event end-to-end (simplest; recipient = John). Validates the whole path on Preview. | ~half day |
| 3 | **Crew assignment** email. Then phone E.164 normalize + backfill + `sms_opt_out`, `sms/send.ts` (Twilio), crew **SMS** (once 10DLC approved). | ~1.5 days |
| 4 | **Quote/invoice issued**: Storage bucket + capture-at-issue upload + attach-from-storage in the email send. | ~1.5 days |
| 5 | Audit UI + re-send button (optional). | ~half day |

**~4 days code for email + all three events; +~1.5 days for SMS** — but SMS go-live is gated by 10DLC
approval wall-clock, not effort.

## Open decisions

- [ ] Exact recipient resolution per event (which `client_contacts.type` for quote vs invoice; which
      crew contact field). Carry over the dossier's type-discriminator rules.
- [ ] Templates as plain template strings vs React Email components. (Lean: simple template strings
      first; React Email only if layouts get rich.)
- [ ] Whether internal alerts also go SMS, or email-only.
- [ ] Signed-URL vs direct-attach for the PDF (size limits: Resend attachment cap vs link).

## Deployment

Per project convention: build on a branch, **push to `dev`** for Preview against the dev DB, verify
with `NOTIFICATIONS_ENABLED` off (log-only) then on against test recipients, and only merge `dev→main`
after explicit approval. Migrations applied to dev first; track pending prod migrations.

## Related code & references

- [app/api/users/route.ts](../app/api/users/route.ts) — server route + Bearer-token auth-guard pattern to mirror
- [lib/supabase/admin.ts](../lib/supabase/admin.ts) — `supabaseAdmin` server client
- [components/shared/quote-pdf-view.tsx](../components/shared/quote-pdf-view.tsx), [components/shared/invoice-pdf-view.tsx](../components/shared/invoice-pdf-view.tsx), [lib/print-with-title.ts](../lib/print-with-title.ts) — existing browser PDF path to reuse
- [lib/auth/use-user-email.ts](../lib/auth/use-user-email.ts) — IT-only gating hook
- Conventions: audit columns (migration `20260503d`), RLS + Data API grants, canonical attachment storage pattern
- `client_contacts` table (migration `20260429b`) — recipient resolution source
