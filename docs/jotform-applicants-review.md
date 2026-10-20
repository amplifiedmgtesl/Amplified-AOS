# Website applicants (#121): build review with John

Built 2026-10-20 in unattended mode on `feature/jotform-applicants` (off `origin/main`). Plan: `docs/jotform-applicants-plan.md` on `docs/backlog-121-jotform-applicants`.

## What's built

- **Migration `20261020b_jotform_applicants.sql`**, applied to **dev only**:
  - new employee columns `applied_at`, `jotform_submission_id`, `sms_consent`, `sms_consent_at`, `application_contact`;
  - table `jotform_application_log`, unique by submission ID;
  - `merge_employee` now carries the newer application and SMS answer onto the kept record (see judgement call 6).
- **Rules** `lib/jotform/application.ts` (pure), with 22 tests in `tests/store/jotform-application.test.ts`.
- **Writes and log** `lib/jotform/server.ts`.
- **Webhook** `POST /api/jotform/application/<secret>`.
- **One-time load page** `/onboarding/applications`, not in the menu. Pick the CSV, click **Check** (dry run), then **Load**. Running it again is safe.
- **Onboarding:** "Applied with: …" under the email or phone box when the application has a different one. Click it to use it.
- **Employee profile:** "Applied on website", showing the date (linked to the submission in JotForm) and "Texts: Yes/No".
- **Employee list:** a new **Applied Online** filter (Everyone / Applied / Didn't apply).

Typecheck is clean, and all 262 tests pass. The tests cover the matching and fill rules only. The database writes, webhook and pages haven't been run yet; that's the preview test below.

## Judgement calls (approve or overturn)

1. **Several matching records → change nothing, just log it.** The plan said to create a new record, but these people are already duplicated in AOS, so a new record would make a third copy. The Onboarding page already flags the duplicates. The load report lists them under "Several records".
2. **A phone match needs the first name to fit** (same first name, nickname or close spelling). Families share phones, and the Onboarding duplicate rules work the same way. Otherwise the phone is ignored and the name is tried.
3. **Same name only matches a record with no email and no phone.** Email and phone are checked first, so any the record has must already disagree, and a disagreeing record isn't matched (plan rule).
4. **CSV load fills state and zip only.** JotForm's export joins street and city with a space ("12 Main St Dayton, OH, 45402"), so they can't be split reliably. Webhook submissions arrive in parts, so they fill street and city too. The full one-line address is kept in `application_contact`.
5. **The list filter uses "applied", not the record's source.** Every profile save stamps source = "local", so a source filter would lose people the first time someone edits them. New records still start with source `website-application`.
6. **Merging keeps the newer application.** Without this, merging an applicant's new record into a crew lead's record would lose the application date, SMS answer and "Applied with" values. The function is otherwise identical to 20261013a (checked against dev before replacing).
7. **New record key `app-<submissionID>`**, like the `crew-` / `manual-` / `emp-` prefixes. The key shows where the record came from, and the same submission can't create two records.
8. **Names typed in all-lower or all-upper are tidied** ("chandler escota" → "Chandler Escota"). Mixed case is left as typed.
9. **The webhook answers 404 when the secret is wrong or unset.** It answers 400 for any form other than 260385023196052.
10. **A submission that failed with an error can be retried** (by the webhook or the load). Everything else is handled once.
12. **The load page is temporary** (John OK'd 10/20). The session can't bulk-read or bulk-write employees, so the one-time load runs from the hidden admin page. Delete `/onboarding/applications`, `components/shared/applications-load.tsx` and `app/api/jotform/load` in the release after the prod load.
11. **Misspelled email domains** (gamil.com etc.) are loaded and noted in the log and report, as the plan says.

## Needed from John before testing

1. **Set `JOTFORM_WEBHOOK_SECRET` in Vercel** for Preview and Production: a long random string, at least 24 characters. I can generate one.
2. OK to **push to dev / main** when the time comes (feature branch is pushed).

## Test plan (preview)

1. Open `/onboarding/applications`, choose the CSV, click **Check**, and compare the counts with the 10/20 analysis.
2. Click **Load** on dev, then spot-check: a new record, a filled-blank record, an "Applied with" note on Onboarding, the profile line, and the list filter.
3. Before production: John adds the webhook in JotForm (Settings → Integrations → WebHooks, `https://amplified-aos.vercel.app/api/jotform/application/<secret>`) and sends one test application. Check it lands, then delete the test record.

## Help text (HELP.md lives on dev: add when merging back)

**Employees section:** change "Finding someone" to also say: "Click a column heading to sort by it; click it again to reverse." (The Employee Key column was removed from the list on 10/20, and so was the Name Sort box; the key still shows on the profile.) Then add:

> **Applied Online** shows only the people who applied through the website (or only those who didn't). A profile shows **Applied on website** with the date. Click it to open their application and résumé in JotForm (you need to be signed in to JotForm). **Texts** is their answer to the text-message question.
>
> **Website applications land here automatically.** When someone applies on the website, AOS looks for them first by email, then phone, then exact name, and fills in only what's blank. If they're new, they're added as a Contractor. Nothing already in AOS is overwritten.

**Onboarding section:** after the Email / Phone bullet, add:

> - **Applied with: …** under the email or phone means their website application has a different one. Click it to use that instead.
