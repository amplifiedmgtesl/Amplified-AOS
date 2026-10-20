# Onboarding screen: plan (backlog #120)

**Status:** plan only, nothing built. Written 2026-10-20 from John's design; John is reviewing it with Connor before any build.

## Why

Connor asked whether AOS can onboard a new crew member into Paychex once their email is in AOS. Today a new person can work a job, get approved hours, and then be **left out of the Paychex export** because they have no Payroll ID. Nobody finds out until the payroll file is built. Connor needs one list of everyone who is working but not set up for payroll yet, and the tools to fix each row from there.

**Size on prod (2026-10-20):** using the 60-day window below, **99 people** have no Payroll ID. **89 of them have neither email nor phone.** All 99 come from timesheets; none come from upcoming confirmed crew, because Assigned Crew is still barely used. Since Oct 1, 61 of them have actual hours. Only 3 name-match someone who already has an ID, so most are likely new local hires from the out-of-town jobs.

## Who's on the list

Anyone (not deleted) with **no Payroll ID** (`employees.rippling_employee_id` is null) who is on a job in a **rolling window of 30 days back to 30 days ahead**, via either:
- a **confirmed** crew assignment (`job_request_assignments.confirmed`, dated by `job_request_days.event_date`), or
- a **timesheet entry** (`timesheet_entries.work_date`), any status.

The window is not tied to payroll runs (John, 10/20). A person drops off the list as soon as they have a Payroll ID.

## The screen

A new page, **Onboarding**, under Payroll, for admins and the payroll role. Each person gets one row:

| Column | Notes |
|---|---|
| Name | Links to the employee profile |
| Email | Editable inline. Blank is highlighted. |
| Phone | Editable inline. Blank is highlighted. |
| Employee / Contractor | Toggle button. Writes `employment_type` (the DB already normalizes to Employee/Contractor). |
| Jobs | Last job and date worked, plus the next booked job if there is one |
| Hours | Hours in the window that aren't paid yet |
| Possible duplicate | "Looks like *Name* (#ID)" with a **Merge** button (see below) |
| Paychex | Found / Not found / Sent, plus the matching action (see below) |

Sort with the most urgent first: has unpaid hours, then soonest upcoming job. Keep on-screen text to a minimum: no banners, and use tooltips for explanations. Disable a button rather than explain why it can't be used.

## Possible duplicates + Merge button

**This reverses the 10/13 "no merge button on screen" decision. John asked for it on 10/20.**

- **Matching:** the same rules as the 10/12 duplicates file. Same phone with a compatible first name, then the name rule from `scoreName` in `lib/storage/crew-roster-import.ts`, then nicknames and near spellings. The other record can be anyone in the Employee list, with or without a Payroll ID. Jr/Sr/II differences show as "possible" only (father and son, e.g. the two David Strangs).
- **Merge:** a confirm dialog that shows both records side by side and asks which one to keep. It defaults to the record holding the Payroll ID, otherwise the one with the most history. Then it calls the existing DB function `merge_employee(p_dup, p_keep)`.
  - It's already **live on prod and dev** and ran the 233 merges on 10/14.
  - **⚠ Its migration file `20261013a_employee_merge.sql` is only on `feature/employee-merge`, not on dev or main.** Merge that branch to dev first so the repo matches the DB.
  - What it already does: admin-only; refuses if the two records have different Payroll IDs ("may be two different people"); moves crew assignments, timesheets, payroll entries, documents, job-sheet workers and profile links, including old and invoiced rows (narrow freeze-trigger exception for `employee_key` only); drops a same-day duplicate crew assignment; fills the kept record's blanks; saves the full duplicate row to `employees_merged`; then hard-deletes the duplicate.
  - Because **all** history moves, including old history, nothing is left on the duplicate and the delete is always safe. John's "unless it has really old stuff" case doesn't come up.
- **"Not the same person":** a dismiss button stores the pair, so the flag doesn't keep coming back. This needs a small table, e.g. `employee_not_duplicate (key_a, key_b, by, at)`.

## Paychex: find or onboard

1. **Found in Paychex** (works today, read-only API): reuse the matching from **Sync from Paychex** (`lib/paychex/sync-plan.ts`, v2.7.0). If a Paychex worker clearly matches this person, show "Found #123" with a **Use this ID** button, which sets the Payroll ID and pulls contact info, following the sync's rules (Paychex wins, and blanks never overwrite). Unclear matches are shown but not offered as one-click.
2. **Send to Paychex** (needs Paychex write access, see below): for people who aren't in Paychex.
   - **Disabled until the row has an EMAIL** (John, 10/20: without one the self-serve invite can't go out, which defeats the purpose). A phone number alone doesn't count. Email is the only gate. Connor presses the button himself, so checking the name, email and Employee/Contractor type before sending is his call (John, 10/20). The send-confirm dialog shows all three.
   - Calls `POST /companies/{companyId}/workers` with given name, family name, `workerType` (`EMPLOYEE` / `INDEPENDENT_CONTRACTOR`) and a `communications` object holding the email (sent as PERSONAL), plus the mobile phone if we have it.
   - **The invite only goes out if the email is in that first call.** It can't be added later to trigger it, which is why the button requires an email.
   - Paychex returns a `workerId` and the worker starts as **IN_PROGRESS**. The person finishes SSN, address, tax forms and direct deposit themselves in Flex. Some pay setup may still be needed in Flex, depending on the company's configuration.
   - Store the result on the employee: Paychex worker ID, sent at, sent by. Show "Sent, waiting on onboarding" until the Paychex employee number (the Payroll ID) appears.
   - **Guard against double-sends:** one send per person (button disabled after a send); always check for a Paychex match first; and use `workerCorrelationId`. A **423** response means the Paychex account is locked: discard any workerId returned with it and retry later. Only a 200 workerId is valid.
3. **Picking up the Payroll ID:** the Paychex employee number may not exist until onboarding is complete. Running Sync from Paychex (or a per-row "check" button) links it by the stored worker ID, so there's no name matching on the way back.

## Prerequisites

1. **Merge `feature/employee-merge` into dev** so the `merge_employee` migration is in the repo.
2. **Paychex write access** for the "Amplified AOS" app: Flex → Company Settings → Integrated apps. Today the Company and worker APIs are Read only (GET). Only Send to Paychex needs this; everything else works without it. Turning it on is John's step.
3. **Check the Paychex docs at build time:** required fields for the company's setup, whether contractors (`INDEPENDENT_CONTRACTOR`) get the same invite, and the exact `communications` shape.

## Not in this item

- Preventing new duplicates at every "add a person" path (#116 part 2).
- The system-wide Health page (#119). Its "crew with no Payroll ID" check should **link to this screen** instead of building its own list.
- Sending payroll through the API (#118).

## Decided (John, 10/20)

1. **Accuracy is Connor's call.** Sending is manual, one person at a time, and the screen adds no extra approval step beyond requiring an email.
2. **Collecting missing emails is outside AOS's scope.** The screen shows the blanks, and that's all.
3. **Setup left to do in Flex after onboarding is outside AOS's scope.** AOS's job ends once the worker is created and the Payroll ID is linked back.

## Build order (when approved)

1. List + inline email/phone + Employee/Contractor toggle (read/write AOS only).
2. Possible-duplicate flag + Merge button + "not the same person".
3. Found-in-Paychex lookup + Use this ID.
4. Send to Paychex (after write access is on).
5. Help guide (`HELP.md` / `lib/help`) + changelog + version.
