# Website applicants into the Employee list: plan (backlog #121)

**Status:** plan only, nothing built. Written 2026-10-20. Waiting for John's OK.

## Why

People apply on the website (amplifiedesl.com/apply → the JotForm **Employee Application Form**). Today that only produces an email to jobs@amplifiedesl.com. When Connor later books them on a crew, AOS often has no record, or has one a crew lead typed in with no email or phone. So:
- crew get booked under a new, duplicate record;
- the Onboarding page can't send them to Paychex (no email).

If the application lands in the Employee list when they apply, Connor picks the right person when booking, and their email is already there (John, 10/20).

## What the data says (read-only check, 2026-10-20)

`~/amplified/paychex/jotform-applicants-vs-aos-2026-10-20.csv`: one row per applicant. It holds personal details, so it stays on John's Mac.

- 611 submissions from 3/12 to today; **97 are repeats**, so **514 different people**. Only **3 look like junk** (2 misspelled email domains, 1 bad name). Every phone is 10 digits (the form enforces it).
- **Already in AOS:** 295 by email, 48 by phone, 86 by name only (AOS had no email or phone to compare), and 10 match more than one AOS record. **72 would be new.**
- **Would fill:** 33 blank emails and 43 blank phones on email/phone matches, plus 78 emails and 82 phones on name-only matches. AOS has a *different* email for 26 people and a different phone for 23.
- **Onboarding list (99 with no Payroll ID):** 44 match an application by name, and all 44 have a blank email the application fills. 52 never applied.
- **Paychex:** 335 of the 514 are in Paychex; 179 aren't.

## How the data gets in

1. **Webhook, for new applications.** In the form: Settings → Integrations → **WebHooks**, pointing at an AOS address. JotForm posts each submission the moment it's sent.
   - **No JotForm API key.** The account also holds the Direct Deposit, W-9 and I-9 forms (bank and SSN data). An API key can read every form; a webhook only sends this one form's answers, so AOS never has a way into the others.
   - The address ends in a long secret: `/api/jotform/application/<secret>`. The secret lives in a Vercel env var (`JOTFORM_WEBHOOK_SECRET`). AOS also refuses anything whose form ID isn't the Employee Application form (260385023196052).
   - JotForm posts multipart form data, with the answers in a `rawRequest` JSON field. The exact key names get confirmed with one test submission before switching it on.
   - **The jobs@ emails keep coming.** JotForm's email notification is a separate setting and stays on.
2. **One-time load of the 611** from the CSV export John downloaded. Same rules as the webhook. Run as a dry-run report first, then on dev, then on prod with John's OK.

## The rules for each application

Newest application wins when the same person applied more than once (matched by email, else phone).

1. **Find the person first.** They may already be in the Employee list because a crew lead or coordinator added them (John, 10/20). The match is, in order:
   - **email**, then **phone**: that record;
   - **exact name** (nicknames count): only if there's exactly one AOS record with that name and its email and phone don't disagree with the application.
2. **Found exactly one:** fill only what's blank: email, phone, address (street, city, state, zip). **Nothing AOS already has is overwritten.** When AOS has a different email or phone, it's listed for review. Paychex is the source of truth for contact details (10/12), and Sync from Paychex corrects them.
3. **Found more than one, or a "similar name" only:** don't guess. Create the new record and let the Onboarding page flag it as a possible duplicate, so Connor can **Merge** or mark **Not same** when he books them.
4. **Found none:** create a new Employee: name, email, phone, address, **Contractor**, Active, source **Website application**.
5. **Skip junk** and list it as skipped: no valid email, phone not 10 digits, a link or digits in the name, a one-word name. Misspelled email domains (gamil.com) are loaded but flagged.
6. **Same submission twice** (a JotForm retry): ignored. Each submission ID is applied once.

Every record created or changed is logged with the record as it was before, so it can be undone, the same way Sync from Paychex logs.

## What's stored

New columns on `employees`:
- `applied_at`: date of the latest application.
- `jotform_submission_id`: the latest one, so the application and résumé can be found in JotForm.
- `sms_consent` (yes/no/blank) and `sms_consent_at`: their answer to the text-message question. **Decision for John:** keep it (useful if AOS ever texts crew) or skip it.

New table `jotform_application_log`: submission ID, when it was received, the outcome (created / updated / matched / skipped), the employee key, and the record as it was before. **Not stored:** work history, references, education and the résumé file. Those stay in JotForm.

## Screens

- **Employee profile:** "Applied on <date>" with a link to the submission in JotForm (only works for someone signed in to JotForm).
- **Employee list:** a filter for source = Website application.
- No new page. Applicants show up on Onboarding once they're on a job, as now.

## Not in this item

- **Contact clean-up across AOS, applications and Paychex:** the 26 email and 23 phone differences. Sync from Paychex already makes Paychex win. A one-off review of people *not* in Paychex can come later, using the review file.
- **Turning off the old JotForm forms** (Direct Deposit, W-9, I-9, W-4, Tax Info). That's Connor's call, about bank and SSN data sitting in JotForm.
- **A CAPTCHA on the form:** suggest it to Connor (Form Builder → Add Element → CAPTCHA). It's a two-minute change on his side.

## Build order (when approved)

1. Migration: the new employee columns and the log table (dev first).
2. Pure matching and cleanup functions, with tests (reusing the Onboarding name rules).
3. Webhook route plus a test against a captured JotForm sample.
4. One-time load: dry-run report → dev → prod (John's OK).
5. John adds the webhook in JotForm and sends one test application; check it lands, then delete the test record.
6. Profile "Applied on" plus the list filter, Help (`HELP.md`), changelog, version.

Ships the hotfix way: branch off `main`, test on a preview, push to `main` with John's OK, merge back into dev.
