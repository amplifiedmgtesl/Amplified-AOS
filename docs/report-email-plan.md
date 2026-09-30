# Email a Report — Plan

Status: **Draft for John's review** (2026-09-29). Branch `feature/report-email`. No code yet.

## Goal

Every report page gets the same toolbar: **preview on screen → Print → Email**. Email opens a
pop-up where the sender picks recipients from lists AOS already knows about, and sends the report
as an attachment. AOS keeps a copy of exactly what was sent, who sent it, and to whom, and shows that
history.

First report: **Pre-Invoice Summary** (on prod today). Second: **Payroll report PDF + payroll CSV**.
Later reports (signed Actuals, sign-in sheet, anything new) plug into the same wrapper.

## Decisions already made (John, 2026-09-29)

| # | Decision |
|---|---|
| D1 | One standard wrapper for all reports: preview + Print + Email. |
| D2 | Office recipients (Payroll, Accounting, CPA…) are a **list of labelled entries** in System Maintenance, not fixed fields. |
| D3 | First report = Pre-Invoice Summary; second = payroll report / CSV. |
| D4 | **Log who sent it**, and provide an **easy email history** view. |
| D5 | **Store the exact file that was sent**, so an earlier emailed version can be proven if data changes later. |
| D6 | **One report per email** in this release. No bundles. If two documents must go in one email, Connor sends it from his own mail. |
| D7 | Sender/reply-to is a **choice in the pop-up, with a default per report**. |

## What already exists (verified on `dev`, 2026-09-29)

- **Sending code, built 6/16, never wired into any screen** (`lib/notifications/`, spec
  `docs/notifications-spec.md`): Resend + Twilio senders behind a common interface, a **mock sender**
  used automatically when no key is set, `notify()` dispatcher, attachments by base64 or by Storage
  path, and the `notification_log` table (on dev and prod). Test page `/notification-test`, IT only.
  That spec is for *automatic* event emails; this plan is for *person-initiated* report emails and
  reuses the senders, not the automatic flow.
- **Resend is NOT configured.** Neither Vercel project has `RESEND_API_KEY` or any `NOTIFICATIONS_*`
  variable, so everything today goes to the mock sender.
- **⚠ Safety bug to fix first:** `lib/notifications/config.ts:27` treats an unset
  `NOTIFICATIONS_ENABLED` as **on**. The moment a Resend key is added, preview deployments would send
  real email. The spec says the opposite (off unless explicitly `"true"`). Flip it.
- **No PDF library.** Every "PDF" in AOS is the browser's print dialog (`lib/print-with-title.ts`).
  To attach a PDF, AOS has to be able to *make* one — see Decision needed #1.
- **No shared report toolbar.** Pre-Invoice, job print preview, and payroll PDF each build their own,
  sharing only CSS (`.print-actions`, `.print-preview-page` in `globals.css`).
- **Payroll CSV** is built in the browser (`lib/store/payroll-export.ts`) and downloaded as a file —
  easy to attach as-is. Paychex will change its contents; the email wrapper doesn't care.
- **No email history screen** of any kind.

## Design

### 1. The report wrapper (`ReportFrame`)

One component every report page renders inside. It owns the toolbar (Print, Email) and the paper
preview; the report supplies:

- `reportType` (e.g. `pre_invoice`, `payroll_pdf`, `payroll_csv`) and the record it's about
  (job id, payroll run id)
- a file name (`Pre-Invoice Summary – AES_26081112 – 2026-09-29.pdf`)
- how to produce the attachment (render the page to PDF, or build the CSV)
- **a fingerprint of the report's data** (used for "changed since last sent", §6)
- who may email it (same roles that may view it; Pre-Invoice stays blocked for crew_leader, payroll,
  coordinator)

Print behaves exactly as today. Pages move onto the wrapper one at a time.

### 2. The Email pop-up

- **To / CC** — tick boxes, grouped:
  - **Client contacts** — `client_contacts` for the job's client (billing contacts first for
    Pre-Invoice). Hidden for reports with no client (payroll).
  - **Office recipients** — the System Maintenance list (D2).
  - **AOS users** — staff with a login and an email (admins, coordinators, crew leaders), so Connor
    can send to a coordinator or lead. See Decision needed #3.
  - **Me** — the sender.
  - **Other** — type any address.
- **Subject + message** — pre-filled per report, editable.
- **Reply-To** — dropdown: Me / any office recipient. Default per report (D7, Decision needed #2).
- **Send me a copy** — tick box, default on (BCC to sender).
- **Attachment** — shows the file name and size; not editable.
- Send → spinner → "Sent to 3 people" or the error. Nothing is sent until Send is pressed.

### 3. Sending

- **From:** `"<Sender name> via Amplified" <reports@amplifiedesl.com>` — must be on the verified
  amplifiedesl.com domain. **Reply-To** carries the real person.
- Flow: browser makes the file → uploads it to a private Storage bucket → calls a new server route
  `POST /api/report-email` with the Storage path + recipients. The server checks the sender's login
  and role, sends through Resend with the stored file attached, and writes the history record.
  (Uploading first avoids Vercel's 4.5 MB request limit and guarantees the stored copy *is* the
  attachment.)
- One email to all recipients (To + CC + BCC), not one per person. The Resend sender currently takes
  a single `to`; extend it to lists + `reply_to` + `bcc`.
- Test mode: with `NOTIFICATIONS_ENABLED` not `"true"`, everything runs and is recorded as
  **"Not sent — test mode"**. Add `EMAIL_ALLOWLIST` for previews so real delivery can be tested to
  John's address only.

### 4. Data (one migration)

- **`report_email_recipients`** — the office list (D2): `label` (Payroll, Accounting…), `name`,
  `email`, `sort_order`, `is_active`.
- **`report_emails`** — one row per send: `report_type`, `entity_type`, `entity_id`, `sent_by`
  (user), `from_name`, `reply_to`, `to[]`, `cc[]`, `bcc[]`, `subject`, `message`, `status`
  (sent / failed / test), `provider_message_id`, `error`, `data_fingerprint`, `sent_at`.
- **`report_email_files`** — one row per attached file: `report_email_id`, `file_name`,
  `content_type`, `size_bytes`, `sha256`, `storage_path`. Only one file per email in this release
  (D6), but a separate table means bundling later needs no migration.
- **Storage bucket `sent-reports`** (private), path
  `<report_type>/<entity_id>/<report_email_id>/<file_name>`. Viewed through short-lived signed links.

Why new tables rather than `notification_log`: that table is one row per recipient per channel,
built for automatic single-recipient messages. A report email is one message to several people
with a file; history should show it as one line.

### 5. System Maintenance — "Report Recipients"

New section (or tab) listing the office recipients: add, edit, reorder, deactivate. Modelled on the
existing position maintenance list.

### 6. History

- **Email History screen** — every report email: when, report, job / payroll run, sent by, to,
  status, **View what was sent** (opens the stored file). Filters: date range, report, sender,
  job. Admin roles only.
- **On each report page** — a small line under the toolbar: *"Last sent 10/2 3:14 PM by Connor to
  Acme AP (+2)"*, linking to that entry.
- **Changed since last sent** — at send time AOS stores a fingerprint of the report's *data* (not the
  PDF bytes). If today's data gives a different fingerprint, the line reads *"Changed since last sent
  on 10/2"*. Cheap, and it's the warning Connor needs before invoicing.

### 7. Roll-out order

| Step | What | Testable result |
|---|---|---|
| 0 | **PDF spike** (Decision needed #1) on the Pre-Invoice page | Look at a generated PDF next to a printed one |
| 1 | Safety flag fix + migration + bucket (dev) | Tables exist on dev |
| 2 | Report Recipients in System Maintenance | Add Payroll / Accounting entries |
| 3 | `/api/report-email` + Resend sender changes | Send via mock; history row written |
| 4 | `ReportFrame` + Email pop-up; Pre-Invoice moved onto it | Email the Pre-Invoice on the dev preview (mock) |
| 5 | Email History screen + "last sent / changed since" line | See the send, open the stored PDF |
| 6 | Resend live on preview, allowlist = John | A real email arrives in John's inbox |
| 7 | Payroll PDF + payroll CSV onto the wrapper | Email both (two emails, D6) |
| 8 | Promote to prod | Per `promote-to-prod-checklist.md` |

## Decisions needed

1. **How AOS makes the PDF.** Today only the browser's print dialog can. Options:
   - **A. In the browser (html2pdf / jsPDF).** Uses the exact page on screen, no server work, free.
     But the result is an *image* of each page: text isn't selectable, files are larger
     (roughly 0.3–1 MB a page), and page breaks need tuning.
   - **B. On the server (headless Chrome on Vercel).** Identical to Print, crisp, small files. More
     moving parts: a large dependency near Vercel Hobby's size limits, slower first send, and the
     server must log in as the sender to render the page.
   - **C. Paid HTML→PDF service (PDFShift, DocRaptor).** Crisp and simple; another vendor and bill,
     and report data (with rates) leaves AOS.
   - **Recommendation: spike A first (step 0).** If John is happy with how the Pre-Invoice looks,
     go with it; if not, B. Note the storage estimate I gave earlier (50–200 KB) assumed a
     text PDF; with A expect ~0.5–2 MB per report — still small.
2. **Reply-To defaults.** Recommendation: Pre-Invoice → **Me** (the sender); payroll → the
   **Payroll** office entry. Defaults live with each report in code for now; a settings screen only
   if they change often.
3. **"Staff on the job."** There is **no coordinator field on a job**, and crew leads are only
   identifiable by position name ("Stagehand Lead", "Lead"). Recommendation for this release: list
   **all AOS users with an email, grouped by role**, and skip job-specific staff. Adding a job
   coordinator field is a separate small change if wanted.
4. **CC John on everything?** The 6/16 spec CC'd John on all automatic emails. For report emails
   recommend **no** — the history screen covers it — but it's one setting either way.
5. **Who can open Email History?** Recommendation: admin roles only (it shows priced reports).
6. **How long to keep sent files.** Recommendation: indefinitely for now.

## Setup outside the code (John / Connor)

1. Create a Resend account under Amplified.
2. Add Resend's DNS records to **amplifiedesl.com** (whoever manages that domain's DNS).
3. Add to Vercel (John runs a one-liner; Claude verifies names only): `RESEND_API_KEY`,
   `NOTIFICATIONS_FROM_EMAIL=reports@amplifiedesl.com`, `NOTIFICATIONS_ENABLED` (`true` on production
   only), `EMAIL_ALLOWLIST` (preview only).

## Out of scope for this release

Bundles / several files in one email (D6) · automatic event emails (the 6/16 spec) · SMS · the
staff app · delivery/open tracking (Resend webhooks) · Paychex integration (its own project once
Connor has details) · signed Actuals email (waits for Phase 0 + kiosk on prod).
