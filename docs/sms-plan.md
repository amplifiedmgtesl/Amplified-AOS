# Text Messages (SMS) — Plan

Status: **Draft for John's review** (2026-09-30). Branch `feature/report-email` (shares the sending,
logging and history pieces with [report-email-plan.md](report-email-plan.md)). No code yet.

## Decisions so far (John, 2026-09-30)

| # | Decision |
|---|---|
| S1 | Texts are for **crew assignments / confirmations, day-before reminders, schedule changes, and general messages**. |
| S2 | **One-way first.** Replies (e.g. "YES" to confirm) are a later phase. |
| S3 | **Office roles send; crew leads probably too.** |

## What already exists

- Twilio sender built 6/16 (`lib/notifications/providers/twilio.ts`), with the mock fallback when no
  key is set — same pattern as email.
- Phone numbers: on prod, **2,386 of 2,992** employee records have a phone, and **all** of them are
  10–11 digits once punctuation is stripped (checked 2026-09-30), so conversion to the `+1XXXXXXXXXX`
  format Twilio needs is mechanical.
- No consent / opt-out fields anywhere.

## Setup outside the code (Connor / John) — start early, carrier review takes weeks

1. **Twilio account** under Amplified; buy one local number (~$1.15/month).
2. **Brand registration** (A2P 10DLC): legal business name, EIN, address, website, contact person.
   Low-volume standard brand: $4.50 one-time.
3. **Campaign registration**: $15 one-time review + monthly fee ($1.50 low-volume mixed, $10
   standard; Twilio decides which fits at sign-up). Use the draft wording below.
4. **Website:** amplifiedesl.com needs a privacy policy that mentions text messages (draft below).
   Reviewers check this. Same website/DNS access that's holding up email.

Running cost: ~$0.0083 per text segment (160 characters) plus small carrier fees.

### Draft campaign wording (for Connor to submit)

- **Use case:** Mixed (low volume) — staffing notifications to our own crew members.
- **Description:** Amplified (Connor to fill in the exact legal name) sends text messages to crew members who have
  agreed to receive them: job assignments and confirmations, reminders the day before a job,
  schedule changes, and occasional operational messages about jobs they are working. No marketing.
- **How people opt in:** Crew members agree to receive texts on their onboarding paperwork (or by
  verbal agreement recorded by the office in our system), which states message types, that
  frequency varies, that message and data rates may apply, and that they can reply STOP to opt out
  or HELP for help.
- **Sample messages:**
  1. `Amplified: You're scheduled for Rhino Staging on Sat 10/4, 8:00 AM–5:00 PM, Stagehand. Questions? Call 555-555-5555. Reply STOP to opt out.`
  2. `Amplified reminder: Tomorrow 8:00 AM at Freeman, 123 Main St. Check in with Dickens. Reply STOP to opt out.`
  3. `Amplified: Schedule change for Rhino Staging Sat 10/4 — start moved to 9:00 AM. Reply STOP to opt out.`
- **Opt-out / help replies:** `You're unsubscribed from Amplified texts. Reply START to resubscribe.` /
  `Amplified crew texts. Call 555-555-5555 for help. Reply STOP to opt out.`

(Phone numbers and names are placeholders — fill in Connor's real ones.)

### Draft privacy-policy paragraph for amplifiedesl.com

> **Text messages.** If you agree to receive text messages from Amplified, we use your mobile number
> only to send job-related messages (assignments, reminders, schedule changes). Message frequency
> varies. Message and data rates may apply. Reply STOP to opt out at any time or HELP for help.
> We do not sell or share your mobile number or text-messaging consent with third parties for
> marketing.

## Design (in the app)

### 1. Consent and opt-out

- New employee fields: **texts OK** (yes/no), **when**, **how** (onboarding form / verbal / other),
  and **opted out on**. Edited on the employee screen.
- AOS **never texts anyone without "texts OK"** — they appear greyed out in the picker.
- STOP is handled by Twilio automatically. When a send fails because the person replied STOP,
  AOS records the opt-out on the employee so they're greyed out from then on. (No reply handling
  needed for that — S2.)

### 2. Phone numbers

- One-time cleanup: convert every stored phone to `+1XXXXXXXXXX`.
- On save, the employee screen checks and converts the number, and flags one that can't be a US
  mobile number.

### 3. Sending (the "Text" pop-up)

Same shape as the email pop-up:

- **Who:** pick crew — by default the crew assigned to the job/day you're looking at, with
  select-all; or anyone with "texts OK".
- **Message type:** Assignment · Reminder · Schedule change · General. Each pre-fills a message from
  the job details (date, times, location, crew lead) that the sender can edit. Every message starts
  with "Amplified:" and ends with "Reply STOP to opt out" (carrier requirement; not editable).
- Character count shown (one text = 160 characters; longer costs more).
- **Sent individually** to each person (texts can't be CC'd); one history entry for the batch, with
  per-person status.

**Where the Text button lives:**
- **Office:** job screen (Assigned Crew tab) and Timekeeping.
- **Crew leads (S3):** their `/lead` screens, and **only to crew on jobs they lead**. Note `/lead`
  has its own layout, separate from the office screens, so the button is added in both places.

### 4. History

The Email History screen from the email plan becomes **Message History**: emails and texts together,
filterable by type. Each text batch shows who sent it, the message, and each recipient's status
(sent / failed / skipped — opted out or no phone).

### 5. Safety

- Same test mode as email: nothing is sent unless `NOTIFICATIONS_ENABLED` is `"true"`; previews use an
  allowlist (John's phone only).
- Send limit per batch (e.g. 100) with an "Are you sure — 87 texts?" confirmation above ~20.

## Roll-out order

| Step | What |
|---|---|
| 0 | Connor/John start Twilio account + brand + campaign registration (runs in parallel with everything below) |
| 1 | Phone cleanup + consent/opt-out fields on employees (dev) |
| 2 | Text pop-up + sending on the job screen (office), mock sender |
| 3 | History merged into Message History |
| 4 | Crew-lead Text button on `/lead` |
| 5 | Live on preview, allowlist = John's phone, once registration is approved |
| 6 | Promote to prod |

**Later phases:** replies (S2) — Twilio forwards replies to AOS, shown on the job and used for
"YES" confirmations; **automatic day-before reminders** (a daily scheduled job) once manual sending
has been used for a while.

## Decisions needed

1. **How do existing crew give consent?** Recommendation: add the text-message statement to
   onboarding paperwork going forward, and for current crew have the office mark "texts OK (verbal)"
   as they confirm with each person — or send one email asking them to agree. Carriers can ask for
   proof, so each yes needs a date and method.
2. **Reminders: manual or automatic in this release?** Recommendation: manual (a template) now;
   automatic later.
3. **Crew leads sending (S3 "probably")** — include in this release, or office only first?
   Recommendation: include it; it's limited to their own crew.
